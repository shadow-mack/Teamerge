#!/usr/bin/env node
import { loadOrCreateIdentity, readTeamFile } from '../core/identity'
import { RELAY_DEFAULT_PORT } from '../core/relay-protocol'
import { cmdContext, cmdRisk, cmdWhy } from './cli-awareness-commands'
import {
  cmdCheckEdit,
  cmdClaim,
  cmdClaims,
  cmdInstallHooks,
  cmdRelease
} from './cli-claim-commands'
import { cmdInbox, cmdRelay, cmdSend } from './cli-message-commands'
import { parseArgs, print, repoContext } from './cli-repo-context'

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

Workspaces
  Every other command (worktree, terminal, project, ...) runs the full workspace CLI,
  for example: teamerge worktree list
`

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
