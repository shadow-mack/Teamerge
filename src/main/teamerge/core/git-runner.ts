import { runProcess } from '@orca/process-host'

export type GitRunOptions = { stdin?: string; allowFailure?: boolean }

export type GitResult = { stdout: string; stderr: string; code: number }

/** Runs git in `cwd`. Core modules take this so the app and the standalone CLI share them. */
export type GitRunner = (cwd: string, args: string[], options?: GitRunOptions) => Promise<GitResult>

export class GitCommandError extends Error {
  constructor(
    readonly args: string[],
    readonly result: GitResult
  ) {
    super(result.stderr.trim() || result.stdout.trim() || `git ${args[0]} failed (${result.code})`)
  }
}

const GIT_TIMEOUT_MS = 10 * 60 * 1000
const GIT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

export const nodeGitRunner: GitRunner = async (cwd, args, options = {}) => {
  const run = await runProcess({
    program: 'git',
    args,
    cwd,
    input: options.stdin,
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: GIT_MAX_OUTPUT_BYTES,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
  })
  const failure = run.timedOut
    ? `git ${args[0]} timed out`
    : run.outputTruncated
      ? `git ${args[0]} produced more output than Teamerge reads`
      : null
  const result = {
    stdout: run.stdout,
    stderr: failure ?? run.stderr,
    code: failure ? 1 : (run.code ?? 1)
  }
  if (result.code !== 0 && !options.allowFailure) {
    throw new GitCommandError(args, result)
  }
  return result
}

export async function git(
  run: GitRunner,
  cwd: string,
  args: string[],
  options?: GitRunOptions
): Promise<string> {
  return (await run(cwd, args, options)).stdout
}

export async function gitOk(run: GitRunner, cwd: string, args: string[]): Promise<boolean> {
  return (await run(cwd, args, { allowFailure: true })).code === 0
}

export async function currentBranch(run: GitRunner, cwd: string): Promise<string> {
  return (await git(run, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

export async function headSha(run: GitRunner, cwd: string, ref = 'HEAD'): Promise<string> {
  return (await git(run, cwd, ['rev-parse', '--verify', `${ref}^{commit}`])).trim()
}

/** Shared `.git` dir for all worktrees of a repo; Teamerge keeps local coordination state there. */
export async function commonGitDir(run: GitRunner, cwd: string): Promise<string> {
  const out = (
    await git(run, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim()
  return out
}

export async function repoTopLevel(run: GitRunner, cwd: string): Promise<string> {
  return (await git(run, cwd, ['rev-parse', '--show-toplevel'])).trim()
}

export type WorktreeListing = { path: string; branch: string | null; head: string }

export async function listWorktrees(run: GitRunner, cwd: string): Promise<WorktreeListing[]> {
  const out = await git(run, cwd, ['worktree', 'list', '--porcelain'])
  const rows: WorktreeListing[] = []
  let current: Partial<WorktreeListing> = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null }
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5)
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch refs/heads/'.length)
    } else if (line === '' && current.path) {
      rows.push(current as WorktreeListing)
      current = {}
    }
  }
  if (current.path) {
    rows.push(current as WorktreeListing)
  }
  return rows
}

/** Worktree whose checkout holds `branch`, if any; merges into a checked-out branch must run there. */
export async function worktreeForBranch(
  run: GitRunner,
  cwd: string,
  branch: string
): Promise<string | null> {
  const rows = await listWorktrees(run, cwd)
  return rows.find((row) => row.branch === branch)?.path ?? null
}

export async function isDirty(run: GitRunner, cwd: string): Promise<boolean> {
  const out = await git(run, cwd, ['status', '--porcelain', '--untracked-files=no'])
  return out.trim().length > 0
}

export async function aheadBehind(
  run: GitRunner,
  cwd: string,
  left: string,
  right: string
): Promise<{ ahead: number; behind: number }> {
  const out = await git(run, cwd, ['rev-list', '--left-right', '--count', `${left}...${right}`])
  const [behind, ahead] = out.trim().split(/\s+/).map(Number)
  return { ahead: ahead ?? 0, behind: behind ?? 0 }
}

/** Files changed on `branch` since it forked from `base`. */
export async function changedFilesSince(
  run: GitRunner,
  cwd: string,
  base: string,
  branch: string
): Promise<string[]> {
  const out = await git(run, cwd, ['diff', '--name-only', `${base}...${branch}`])
  return out.split('\n').filter(Boolean)
}

/** Committed + uncommitted changes of a worktree relative to its merge base with `base`. */
export async function worktreeChangedFiles(
  run: GitRunner,
  worktreePath: string,
  base: string
): Promise<string[]> {
  const mergeBase = (
    await run(worktreePath, ['merge-base', base, 'HEAD'], { allowFailure: true })
  ).stdout.trim()
  const files = new Set<string>()
  if (mergeBase) {
    for (const f of (await git(run, worktreePath, ['diff', '--name-only', mergeBase])).split(
      '\n'
    )) {
      if (f) {
        files.add(f)
      }
    }
  }
  const untracked = await git(run, worktreePath, ['ls-files', '--others', '--exclude-standard'])
  for (const f of untracked.split('\n')) {
    if (f) {
      files.add(f)
    }
  }
  return [...files].sort()
}

/**
 * Three-way merge without touching any checkout (git >= 2.38).
 * Returns the conflicting paths, or [] for a clean merge.
 */
export async function mergeTreeConflicts(
  run: GitRunner,
  cwd: string,
  ours: string,
  theirs: string
): Promise<string[]> {
  const result = await run(
    cwd,
    ['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs],
    { allowFailure: true }
  )
  if (result.code === 0) {
    return []
  }
  if (result.code !== 1) {
    throw new GitCommandError(['merge-tree'], result)
  }
  // Line 1 is the tree id; the rest are conflicted paths.
  return [...new Set(result.stdout.split('\n').slice(1).filter(Boolean))]
}

/** Snapshot of a worktree (including uncommitted edits) as a commit object, without touching refs. */
export async function snapshotWorktreeCommit(
  run: GitRunner,
  worktreePath: string
): Promise<string> {
  const stash = (await git(run, worktreePath, ['stash', 'create'])).trim()
  return stash || (await headSha(run, worktreePath))
}
