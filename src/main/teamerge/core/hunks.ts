import { createHash, randomUUID } from 'node:crypto'
import type { DiffHunk, FileHunks, HunkUndoEntry } from '../../../shared/teamerge/teamerge-types'
import { git, type GitRunner } from './git-runner'

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Splits `git diff` output into per-file hunks. Binary files yield no hunks. */
export function parseUnifiedDiff(diff: string, staged: boolean): FileHunks[] {
  const files: FileHunks[] = []
  let file: FileHunks | null = null
  let hunk: Omit<DiffHunk, 'id'> | null = null

  const finishHunk = (): void => {
    if (file && hunk) {
      const id = createHash('sha1')
        .update(`${file.filePath}\0${hunk.header}\0${hunk.lines.join('\n')}`)
        .digest('hex')
        .slice(0, 16)
      file.hunks.push({ ...hunk, id })
    }
    hunk = null
  }

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      finishHunk()
      file = { filePath: '', staged, hunks: [], fileHeader: [line] }
      files.push(file)
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
      file.filePath = match?.[2] ?? ''
      continue
    }
    if (!file) {
      continue
    }
    const header = HUNK_HEADER.exec(line)
    if (header) {
      finishHunk()
      hunk = {
        filePath: file.filePath,
        header: line,
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: []
      }
      continue
    }
    if (hunk) {
      if (
        line.startsWith(' ') ||
        line.startsWith('+') ||
        line.startsWith('-') ||
        line.startsWith('\\')
      ) {
        hunk.lines.push(line)
      }
      continue
    }
    if (line.startsWith('+++ b/')) {
      file.filePath = line.slice(6)
    }
    file.fileHeader.push(line)
  }
  finishHunk()
  return files.filter((f) => f.filePath)
}

export function buildHunkPatch(file: FileHunks, hunk: DiffHunk): string {
  return [...file.fileHeader, hunk.header, ...hunk.lines, ''].join('\n')
}

export async function readFileHunks(
  run: GitRunner,
  worktreePath: string,
  filePath: string,
  staged: boolean
): Promise<FileHunks | null> {
  const args = ['diff', '--no-color', '--no-ext-diff', '-U3']
  if (staged) {
    args.push('--cached')
  }
  args.push('--', filePath)
  const files = parseUnifiedDiff(await git(run, worktreePath, args), staged)
  return files.find((f) => f.filePath === filePath) ?? files[0] ?? null
}

async function applyPatch(
  run: GitRunner,
  worktreePath: string,
  patch: string,
  flags: string[]
): Promise<void> {
  await git(run, worktreePath, ['apply', '--whitespace=nowarn', ...flags, '-'], { stdin: patch })
}

const UNDO_LIMIT = 50

/** Hunk-level stage/unstage/discard with an undo stack per worktree. */
export class HunkStager {
  private readonly undo = new Map<string, HunkUndoEntry[]>()

  constructor(private readonly run: GitRunner) {}

  private async findHunk(
    worktreePath: string,
    filePath: string,
    hunkId: string,
    staged: boolean
  ): Promise<{ file: FileHunks; hunk: DiffHunk }> {
    const file = await readFileHunks(this.run, worktreePath, filePath, staged)
    const hunk = file?.hunks.find((h) => h.id === hunkId)
    if (!file || !hunk) {
      throw new Error(`${filePath} changed since this diff loaded. Refresh and try again.`)
    }
    return { file, hunk }
  }

  private push(entry: Omit<HunkUndoEntry, 'id' | 'at'>): HunkUndoEntry {
    const full = { ...entry, id: randomUUID(), at: Date.now() }
    const stack = this.undo.get(entry.worktreePath) ?? []
    stack.push(full)
    if (stack.length > UNDO_LIMIT) {
      stack.shift()
    }
    this.undo.set(entry.worktreePath, stack)
    return full
  }

  async stage(worktreePath: string, filePath: string, hunkId: string): Promise<HunkUndoEntry> {
    const { file, hunk } = await this.findHunk(worktreePath, filePath, hunkId, false)
    const patch = buildHunkPatch(file, hunk)
    await applyPatch(this.run, worktreePath, patch, ['--cached'])
    return this.push({ worktreePath, kind: 'stage', filePath, patch })
  }

  async unstage(worktreePath: string, filePath: string, hunkId: string): Promise<HunkUndoEntry> {
    const { file, hunk } = await this.findHunk(worktreePath, filePath, hunkId, true)
    const patch = buildHunkPatch(file, hunk)
    await applyPatch(this.run, worktreePath, patch, ['--cached', '--reverse'])
    return this.push({ worktreePath, kind: 'unstage', filePath, patch })
  }

  /** Discards an unstaged hunk from the working tree; Undo re-applies it. */
  async discard(worktreePath: string, filePath: string, hunkId: string): Promise<HunkUndoEntry> {
    const { file, hunk } = await this.findHunk(worktreePath, filePath, hunkId, false)
    const patch = buildHunkPatch(file, hunk)
    await applyPatch(this.run, worktreePath, patch, ['--reverse'])
    return this.push({ worktreePath, kind: 'discard', filePath, patch })
  }

  history(worktreePath: string): HunkUndoEntry[] {
    return [...(this.undo.get(worktreePath) ?? [])].toReversed()
  }

  /** Reverts the most recent hunk action for the worktree. */
  async undoLast(worktreePath: string): Promise<HunkUndoEntry | null> {
    const stack = this.undo.get(worktreePath) ?? []
    const last = stack.at(-1)
    if (!last) {
      return null
    }
    if (last.kind === 'stage') {
      await applyPatch(this.run, worktreePath, last.patch, ['--cached', '--reverse'])
    } else if (last.kind === 'unstage') {
      await applyPatch(this.run, worktreePath, last.patch, ['--cached'])
    } else {
      await applyPatch(this.run, worktreePath, last.patch, [])
    }
    stack.pop()
    return last
  }
}
