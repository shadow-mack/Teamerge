import type { LocalTaskInput } from '../core/collisions'
import {
  currentBranch,
  listWorktrees,
  nodeGitRunner as run,
  repoTopLevel
} from '../core/git-runner'
import { readRepoState } from '../core/local-state'

export type Flags = { json: boolean; all: boolean; note?: string; port?: number; strict: boolean }

export function parseArgs(argv: string[]): { command: string; args: string[]; flags: Flags } {
  const flags: Flags = { json: false, all: false, strict: false }
  const args: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      flags.json = true
    } else if (arg === '--all') {
      flags.all = true
    } else if (arg === '--strict') {
      flags.strict = true
    } else if (arg === '--note') {
      flags.note = argv[++i]
    } else if (arg === '--port') {
      flags.port = Number(argv[++i])
    } else {
      args.push(arg)
    }
  }
  return { command: args.shift() ?? 'help', args, flags }
}

export type RepoContext = {
  cwd: string
  worktreeRoot: string
  repoPath: string
  branch: string
  selfTaskId: string
  tasks: LocalTaskInput[]
}

export async function defaultBase(cwd: string): Promise<string> {
  const head = await run(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
    allowFailure: true
  })
  if (head.code === 0 && head.stdout.trim()) {
    return head.stdout.trim()
  }
  for (const candidate of ['main', 'master']) {
    if (
      (await run(cwd, ['rev-parse', '--verify', '--quiet', candidate], { allowFailure: true }))
        .code === 0
    ) {
      return candidate
    }
  }
  return 'HEAD'
}

export async function repoContext(): Promise<RepoContext> {
  const cwd = process.cwd()
  const worktreeRoot = await repoTopLevel(run, cwd)
  const worktrees = await listWorktrees(run, cwd)
  const repoPath = worktrees[0]?.path ?? worktreeRoot
  const state = await readRepoState(run, cwd)
  const base = await defaultBase(cwd)
  const tasks: LocalTaskInput[] = worktrees
    .flatMap((wt) => (wt.branch ? [{ path: wt.path, branch: wt.branch }] : []))
    .map((wt) => ({
      taskId: wt.path,
      taskName: state.tasks[wt.path]?.taskName ?? wt.branch,
      worktreePath: wt.path,
      branch: wt.branch,
      baseRef: state.tasks[wt.path]?.parentBranch ?? state.tasks[wt.path]?.baseRef ?? base
    }))
    .filter(
      (task) => task.branch !== base.replace(/^origin\//, '') || task.worktreePath === worktreeRoot
    )
  return {
    cwd,
    worktreeRoot,
    repoPath,
    branch: await currentBranch(run, cwd),
    selfTaskId: worktreeRoot,
    tasks
  }
}

export function print(flags: Flags, data: unknown, text: () => string): void {
  process.stdout.write(flags.json ? `${JSON.stringify(data, null, 2)}\n` : `${text()}\n`)
}
