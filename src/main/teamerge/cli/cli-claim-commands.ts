import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { assessEditRisk, claimFiles, releaseClaims } from '../core/collisions'
import { nodeGitRunner as run } from '../core/git-runner'
import { loadOrCreateIdentity } from '../core/identity'
import { readRepoState } from '../core/local-state'
import { print, repoContext, type Flags } from './cli-repo-context'

/** File claims, and the pre-edit check agents run before touching a file. */

type HookEntry = { matcher?: string; hooks?: { type?: string; command?: string }[] }

export async function cmdClaim(files: string[], flags: Flags): Promise<void> {
  if (files.length === 0) {
    throw new Error('Usage: teamerge claim <file...> [--note <why>]')
  }
  const ctx = await repoContext()
  const identity = await loadOrCreateIdentity()
  const paths = files.map((f) => relative(ctx.worktreeRoot, resolve(ctx.cwd, f)))
  await claimFiles(
    run,
    ctx.cwd,
    {
      taskId: ctx.selfTaskId,
      branch: ctx.branch,
      memberId: identity.memberId,
      memberName: identity.name,
      note: flags.note
    },
    paths
  )
  print(flags, { claimed: paths }, () => `Claimed ${paths.join(', ')} for ${ctx.branch}.`)
}

export async function cmdRelease(files: string[], flags: Flags): Promise<void> {
  const ctx = await repoContext()
  const paths = files.length
    ? files.map((f) => relative(ctx.worktreeRoot, resolve(ctx.cwd, f)))
    : undefined
  await releaseClaims(run, ctx.cwd, ctx.selfTaskId, paths)
  print(
    flags,
    { released: paths ?? 'all' },
    () => `Released ${paths ? paths.join(', ') : 'all claims'} for ${ctx.branch}.`
  )
}

export async function cmdClaims(flags: Flags): Promise<void> {
  const state = await readRepoState(run, process.cwd())
  const claims = [...state.claims, ...state.remoteClaims]
  print(flags, claims, () =>
    claims.length
      ? claims
          .map((c) => `${c.path} — ${c.memberName} (${c.branch})${c.note ? `: ${c.note}` : ''}`)
          .join('\n')
      : 'No claims.'
  )
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return ''
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Claude Code PreToolUse hook: warns (or with --strict, blocks) an edit to a file another task is changing. */
export async function cmdCheckEdit(file: string | undefined, flags: Flags): Promise<void> {
  let target = file
  let hookMode = false
  if (!target) {
    const raw = await readStdin()
    try {
      const payload: {
        tool_input?: { file_path?: string; notebook_path?: string; path?: string }
      } = JSON.parse(raw)
      target =
        payload.tool_input?.file_path ??
        payload.tool_input?.notebook_path ??
        payload.tool_input?.path
      hookMode = true
    } catch {
      return
    }
  }
  if (!target) {
    return
  }
  const ctx = await repoContext()
  const path = relative(ctx.worktreeRoot, resolve(ctx.cwd, target))
  if (path.startsWith('..')) {
    return
  }
  const risk = await assessEditRisk(run, ctx.cwd, path, ctx.selfTaskId, ctx.tasks)
  if (risk.level === 'none') {
    if (!hookMode) {
      print(flags, risk, () => `OK to edit ${path}.`)
    }
    return
  }
  const warning = `Teamerge: ${risk.messages.join(' ')} Run \`teamerge why ${path}\` before editing, and keep the change small or coordinate with them.`
  if (!hookMode) {
    print(flags, risk, () => warning)
    process.exitCode = risk.level === 'claimed' ? 2 : 1
    return
  }
  if (flags.strict && risk.level === 'claimed') {
    process.stderr.write(`${warning}\n`)
    process.exitCode = 2
    return
  }
  process.stdout.write(
    `${JSON.stringify({
      systemMessage: warning,
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: warning }
    })}\n`
  )
}

export async function cmdInstallHooks(flags: Flags): Promise<void> {
  const ctx = await repoContext()
  const file = join(ctx.worktreeRoot, '.claude', 'settings.local.json')
  let settings: { hooks?: Record<string, HookEntry[]> } = {}
  try {
    settings = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    // Start fresh.
  }
  const command = `teamerge check-edit${flags.strict ? ' --strict' : ''}`
  const hooks = (settings.hooks ??= {})
  const pre = (hooks.PreToolUse ??= [])
  if (
    !pre.some((entry) =>
      entry.hooks?.some((hook) => hook.command?.startsWith('teamerge check-edit'))
    )
  ) {
    pre.push({
      matcher: 'Edit|Write|MultiEdit|NotebookEdit',
      hooks: [{ type: 'command', command }]
    })
  }
  await mkdir(join(ctx.worktreeRoot, '.claude'), { recursive: true })
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`)
  print(
    flags,
    { file },
    () => `Added the Teamerge pre-edit check to ${relative(process.cwd(), file)}.`
  )
}
