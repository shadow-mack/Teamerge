import { relative, resolve } from 'node:path'
import { computeCollisions } from '../core/collisions'
import { git, nodeGitRunner as run } from '../core/git-runner'
import { loadOrCreateIdentity } from '../core/identity'
import { readRepoState } from '../core/local-state'
import { print, repoContext, type Flags } from './cli-repo-context'

/** `context`, `why` and `risk`: who is working on what, and whether it collides with you. */

export async function cmdContext(flags: Flags): Promise<void> {
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

export async function cmdWhy(file: string | undefined, flags: Flags): Promise<void> {
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

export async function cmdRisk(files: string[], flags: Flags): Promise<void> {
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
