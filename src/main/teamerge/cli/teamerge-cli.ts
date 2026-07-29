#!/usr/bin/env node
/* oxlint-disable eslint/max-lines */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { TeamAgentMessage } from '../../../shared/teamerge/teamerge-types'
import {
  assessEditRisk,
  claimFiles,
  computeCollisions,
  releaseClaims,
  type LocalTaskInput
} from '../core/collisions'
import {
  currentBranch,
  git,
  listWorktrees,
  nodeGitRunner as run,
  repoTopLevel
} from '../core/git-runner'
import { loadOrCreateIdentity, readTeamFile } from '../core/identity'
import { readRepoState, updateRepoState } from '../core/local-state'
import { RelayClient } from '../core/relay-client'
import { RELAY_DEFAULT_PORT } from '../core/relay-protocol'
import { startRelayServer } from '../core/relay-server'

const HELP = `teamerge — team coordination for coding agents

Usage: teamerge <command> [options]

Who is working on what
  context [--json]          Tasks in this repo and on teammates' machines, claims, and overlaps with yours
  why <file> [--json]       Who is changing or has claimed <file>, and the recent commits behind it
  risk [file...] [--json]   Collision risk for your task: overlapping files and real merge conflicts

Claims
  claim <file...> [--note <text>]   Claim files for this task so other agents are warned
  release [file...]                  Release your claims (all of them when no files are given)
  claims [--json]                    List every claim in the repo

Agents
  check-edit [file]          Pre-edit check; reads a Claude Code hook payload on stdin when no file is given
  install-hooks              Add the pre-edit check to .claude/settings.local.json in this worktree
  send <to> <message>        Message another agent: a task name, a teammate name, or teammate/task
  inbox [--all] [--json]     Messages for this task

Team
  whoami                     This machine's member id and name
  team                       Team roster and relay
  relay [--port <n>]         Run the end-to-end encrypted relay for your team (default ${RELAY_DEFAULT_PORT})
`

type Flags = { json: boolean; all: boolean; note?: string; port?: number; strict: boolean }

function parseArgs(argv: string[]): { command: string; args: string[]; flags: Flags } {
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

type RepoContext = {
  cwd: string
  worktreeRoot: string
  repoPath: string
  branch: string
  selfTaskId: string
  tasks: LocalTaskInput[]
}

async function defaultBase(cwd: string): Promise<string> {
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

async function repoContext(): Promise<RepoContext> {
  const cwd = process.cwd()
  const worktreeRoot = await repoTopLevel(run, cwd)
  const worktrees = await listWorktrees(run, cwd)
  const repoPath = worktrees[0]?.path ?? worktreeRoot
  const state = await readRepoState(run, cwd)
  const base = await defaultBase(cwd)
  const tasks: LocalTaskInput[] = worktrees
    .filter((wt) => wt.branch)
    .map((wt) => ({
      taskId: wt.path,
      taskName: state.tasks[wt.path]?.taskName ?? wt.branch ?? wt.path,
      worktreePath: wt.path,
      branch: wt.branch as string,
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

function print(flags: Flags, data: unknown, text: () => string): void {
  process.stdout.write(flags.json ? `${JSON.stringify(data, null, 2)}\n` : `${text()}\n`)
}

async function cmdContext(flags: Flags): Promise<void> {
  const ctx = await repoContext()
  const state = await readRepoState(run, ctx.cwd)
  const identity = await loadOrCreateIdentity()
  const collisions = await computeCollisions(
    run,
    ctx.repoPath,
    ctx.tasks,
    state.remoteAgents,
    identity.name
  )
  const mine = collisions.filter((c) => c.tasks.some((t) => t.taskId === ctx.selfTaskId))
  const data = {
    you: { task: ctx.branch, worktree: ctx.worktreeRoot },
    localTasks: ctx.tasks.map(({ taskName, branch, worktreePath }) => ({
      taskName,
      branch,
      worktreePath
    })),
    teammates: state.remoteAgents.map(
      ({ memberName, taskName, branch, agent, state: s, changedFiles }) => ({
        memberName,
        taskName,
        branch,
        agent,
        state: s,
        changedFiles
      })
    ),
    claims: [...state.claims, ...state.remoteClaims],
    overlapsWithYou: mine
  }
  print(flags, data, () => {
    const lines = [
      `You: ${ctx.branch} (${relative(process.cwd(), ctx.worktreeRoot) || '.'})`,
      '',
      'Tasks on this machine:'
    ]
    for (const task of ctx.tasks) {
      lines.push(
        `  ${task.worktreePath === ctx.selfTaskId ? '▸' : ' '} ${task.taskName}  [${task.branch}]`
      )
    }
    lines.push('', 'Teammates:')
    if (state.remoteAgents.length === 0) {
      lines.push('  (none online — open Teamerge to sync presence)')
    }
    for (const agent of state.remoteAgents) {
      lines.push(
        `  ${agent.memberName}: ${agent.taskName} [${agent.branch}] · ${agent.agent} · ${agent.state} · ${agent.changedFiles.length} files`
      )
    }
    const claims = data.claims
    if (claims.length > 0) {
      lines.push('', 'Claims:')
      for (const claim of claims) {
        lines.push(
          `  ${claim.path} — ${claim.memberName} (${claim.branch})${claim.note ? `: ${claim.note}` : ''}`
        )
      }
    }
    lines.push(
      '',
      mine.length ? 'Overlaps with your task:' : 'No other task is changing your files.'
    )
    for (const c of mine) {
      const others = c.tasks
        .filter((t) => t.taskId !== ctx.selfTaskId)
        .map((t) => `${t.memberName}/${t.taskName}`)
      lines.push(
        `  ${c.conflict ? '✖ conflict' : '△ overlap '}  ${c.filePath}  ← ${others.join(', ')}`
      )
    }
    return lines.join('\n')
  })
}

async function cmdWhy(file: string | undefined, flags: Flags): Promise<void> {
  if (!file) {
    throw new Error('Usage: teamerge why <file>')
  }
  const ctx = await repoContext()
  const path = relative(ctx.worktreeRoot, resolve(ctx.cwd, file))
  const state = await readRepoState(run, ctx.cwd)
  const claims = [...state.claims, ...state.remoteClaims].filter((c) => c.path === path)
  const tasks: { who: string; task: string; branch: string; commits: string[] }[] = []
  for (const task of ctx.tasks) {
    if (task.worktreePath === ctx.selfTaskId) {
      continue
    }
    const changed = await git(run, task.worktreePath, ['diff', '--name-only', task.baseRef]).catch(
      () => ''
    )
    if (changed.split('\n').includes(path)) {
      const log = await git(run, task.worktreePath, [
        'log',
        '--format=%h %s',
        `${task.baseRef}..HEAD`,
        '--',
        path
      ]).catch(() => '')
      tasks.push({
        who: 'this machine',
        task: task.taskName,
        branch: task.branch,
        commits: log.split('\n').filter(Boolean)
      })
    }
  }
  for (const agent of state.remoteAgents.filter((a) => a.changedFiles.includes(path))) {
    tasks.push({ who: agent.memberName, task: agent.taskName, branch: agent.branch, commits: [] })
  }
  const recent = (
    await git(run, ctx.cwd, ['log', '-5', '--format=%h %an %ar — %s', '--', path]).catch(() => '')
  )
    .split('\n')
    .filter(Boolean)
  print(flags, { file: path, claims, tasks, recentHistory: recent }, () => {
    const lines = [`${path}`]
    lines.push(
      claims.length ? '' : '',
      ...claims.map(
        (c) => `Claimed by ${c.memberName} for ${c.branch}${c.note ? `: ${c.note}` : ''}`
      )
    )
    if (tasks.length === 0) {
      lines.push('No other task is changing it.')
    }
    for (const t of tasks) {
      lines.push(`Changed by ${t.who} in ${t.task} [${t.branch}]`)
      for (const commit of t.commits) {
        lines.push(`    ${commit}`)
      }
    }
    if (recent.length) {
      lines.push('', 'Recent history:', ...recent.map((line) => `  ${line}`))
    }
    return lines.filter((line, i) => !(i === 1 && line === '')).join('\n')
  })
}

async function cmdRisk(files: string[], flags: Flags): Promise<void> {
  const ctx = await repoContext()
  const state = await readRepoState(run, ctx.cwd)
  const identity = await loadOrCreateIdentity()
  const collisions = await computeCollisions(
    run,
    ctx.repoPath,
    ctx.tasks,
    state.remoteAgents,
    identity.name
  )
  const wanted = new Set(files.map((f) => relative(ctx.worktreeRoot, resolve(ctx.cwd, f))))
  const mine = collisions.filter(
    (c) =>
      c.tasks.some((t) => t.taskId === ctx.selfTaskId) &&
      (wanted.size === 0 || wanted.has(c.filePath))
  )
  const level = mine.some((c) => c.conflict) ? 'high' : mine.length ? 'medium' : 'low'
  print(flags, { level, collisions: mine }, () => {
    if (mine.length === 0) {
      return 'Risk: low — no other task touches these files.'
    }
    const lines = [
      `Risk: ${level} — ${mine.filter((c) => c.conflict).length} conflicting, ${mine.length} overlapping`
    ]
    for (const c of mine) {
      const others = c.tasks
        .filter((t) => t.taskId !== ctx.selfTaskId)
        .map((t) => `${t.memberName}/${t.taskName} [${t.branch}]`)
      lines.push(`  ${c.conflict ? '✖' : '△'} ${c.filePath}  ← ${others.join(', ')}`)
    }
    if (level === 'high') {
      lines.push(
        '',
        'Merging these tasks as they are would conflict. Coordinate with the owner, or `teamerge why <file>`.'
      )
    }
    return lines.join('\n')
  })
  if (level === 'high') {
    process.exitCode = 3
  }
}

async function cmdClaim(files: string[], flags: Flags): Promise<void> {
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

async function cmdRelease(files: string[], flags: Flags): Promise<void> {
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

async function cmdClaims(flags: Flags): Promise<void> {
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
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Claude Code PreToolUse hook: warns (or with --strict, blocks) an edit to a file another task is changing. */
async function cmdCheckEdit(file: string | undefined, flags: Flags): Promise<void> {
  let target = file
  let hookMode = false
  if (!target) {
    const raw = await readStdin()
    try {
      const payload = JSON.parse(raw) as {
        tool_input?: { file_path?: string; notebook_path?: string; path?: string }
      }
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

async function cmdInstallHooks(flags: Flags): Promise<void> {
  const ctx = await repoContext()
  const file = join(ctx.worktreeRoot, '.claude', 'settings.local.json')
  let settings: { hooks?: Record<string, unknown[]> } = {}
  try {
    settings = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    // Start fresh.
  }
  const command = `teamerge check-edit${flags.strict ? ' --strict' : ''}`
  const hooks = (settings.hooks ??= {})
  const pre = (hooks.PreToolUse ??= []) as { matcher?: string; hooks?: { command?: string }[] }[]
  if (
    !pre.some((entry) =>
      entry.hooks?.some((hook) => hook.command?.startsWith('teamerge check-edit'))
    )
  ) {
    pre.push({
      matcher: 'Edit|Write|MultiEdit|NotebookEdit',
      hooks: [{ type: 'command', command } as { command: string }]
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

async function cmdSend(args: string[], flags: Flags): Promise<void> {
  const [to, ...rest] = args
  const body = rest.join(' ').trim()
  if (!to || !body) {
    throw new Error('Usage: teamerge send <task|teammate|teammate/task> <message>')
  }
  const ctx = await repoContext()
  const identity = await loadOrCreateIdentity()
  const team = await readTeamFile(ctx.repoPath)
  const [memberPart, taskPart] = to.includes('/') ? to.split('/', 2) : [to, null]
  const member = team?.members.find(
    (m) => m.name.toLowerCase() === memberPart.toLowerCase() || m.id === memberPart
  )
  const message: TeamAgentMessage = {
    id: randomUUID(),
    fromMemberId: identity.memberId,
    fromName: identity.name,
    fromTask: ctx.branch,
    toMemberId: member?.id ?? identity.memberId,
    toTask: member ? taskPart : to,
    body,
    at: Date.now()
  }
  if (!member || member.id === identity.memberId) {
    await updateRepoState(run, ctx.cwd, (state) => {
      state.messages = [message, ...state.messages].slice(0, 500)
    })
    print(flags, message, () => `Sent to ${message.toTask} on this machine.`)
    return
  }
  if (!team?.relayUrl) {
    throw new Error('This team has no relay URL. Set one in Teamerge → Team.')
  }
  await new Promise<void>((resolveSend, reject) => {
    const timer = setTimeout(() => {
      client.close()
      reject(new Error(`${member.name} is not online on the relay right now.`))
    }, 8000)
    const client = new RelayClient(identity, team, {
      onState: () => {},
      onPayload: () => {},
      onPeers: (peers) => {
        if (peers.includes(member.id)) {
          client.send(member.id, { kind: 'message', message })
          setTimeout(() => {
            clearTimeout(timer)
            client.close()
            resolveSend()
          }, 300)
        }
      }
    })
    client.connect()
  })
  print(
    flags,
    message,
    () => `Sent to ${member.name}${taskPart ? `/${taskPart}` : ''} (end-to-end encrypted).`
  )
}

async function cmdInbox(flags: Flags): Promise<void> {
  const ctx = await repoContext()
  const state = await readRepoState(run, ctx.cwd)
  const messages = flags.all
    ? state.messages
    : state.messages.filter(
        (m) =>
          !m.toTask ||
          m.toTask === ctx.branch ||
          ctx.tasks.find((t) => t.taskId === ctx.selfTaskId)?.taskName === m.toTask
      )
  print(flags, messages, () =>
    messages.length
      ? messages
          .map(
            (m) =>
              `${new Date(m.at).toLocaleString()}  ${m.fromName}${m.fromTask ? `/${m.fromTask}` : ''} → ${m.toTask ?? 'you'}: ${m.body}`
          )
          .join('\n')
      : 'No messages.'
  )
}

async function cmdRelay(flags: Flags): Promise<void> {
  const relay = await startRelayServer({
    port: flags.port ?? RELAY_DEFAULT_PORT,
    log: (line) => console.log(line)
  })
  console.log(
    `Relay ready. Set the team relay URL to ws://<this-host>:${relay.port}. It forwards encrypted envelopes only.`
  )
  const stop = (): void => {
    void relay.close().then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv.slice(2))
  switch (command) {
    case 'context':
      return cmdContext(flags)
    case 'why':
      return cmdWhy(args[0], flags)
    case 'risk':
      return cmdRisk(args, flags)
    case 'claim':
      return cmdClaim(args, flags)
    case 'release':
      return cmdRelease(args, flags)
    case 'claims':
      return cmdClaims(flags)
    case 'check-edit':
      return cmdCheckEdit(args[0], flags)
    case 'install-hooks':
      return cmdInstallHooks(flags)
    case 'send':
      return cmdSend(args, flags)
    case 'inbox':
      return cmdInbox(flags)
    case 'relay':
      return cmdRelay(flags)
    case 'whoami': {
      const identity = await loadOrCreateIdentity()
      return print(
        flags,
        { memberId: identity.memberId, name: identity.name },
        () => `${identity.name} (${identity.memberId})`
      )
    }
    case 'team': {
      const ctx = await repoContext()
      const team = await readTeamFile(ctx.repoPath)
      return print(flags, team, () =>
        team
          ? [
              `${team.name} · relay ${team.relayUrl || '(not set)'}`,
              ...team.members.map((m) => `  ${m.name} (${m.id})`)
            ].join('\n')
          : 'No .teamerge/team.json in this repo. Create a team from Teamerge → Team.'
      )
    }
    default:
      process.stdout.write(HELP)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`teamerge: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
