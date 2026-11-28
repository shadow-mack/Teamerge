import { randomUUID } from 'node:crypto'
import type { TeamAgentMessage } from '../../../shared/teamerge/teamerge-types'
import { nodeGitRunner as run } from '../core/git-runner'
import { loadOrCreateIdentity, readTeamFile } from '../core/identity'
import { readRepoState, updateRepoState } from '../core/local-state'
import { RelayClient } from '../core/relay-client'
import { RELAY_DEFAULT_PORT } from '../core/relay-protocol'
import { startRelayServer } from '../core/relay-server'
import { print, repoContext, type Flags } from './cli-repo-context'

/** Agent-to-agent messages, and running the relay from a terminal. */

export async function cmdSend(args: string[], flags: Flags): Promise<void> {
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

export async function cmdInbox(flags: Flags): Promise<void> {
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

export async function cmdRelay(flags: Flags): Promise<void> {
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
