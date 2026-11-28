import { randomUUID } from 'node:crypto'
import type { TeamAgentMessage } from '../../shared/teamerge/teamerge-types'
import { updateRepoState } from './core/local-state'
import type { TeamPayload } from './core/relay-client'
import { parseMessage } from './core/teammate-payloads'
import type { TeamContext } from './team-data'

const MAX_MESSAGES = 500

/** Agent-to-agent messages; agents read theirs with `teamerge inbox`. */
export class TeamMessages {
  constructor(private readonly ctx: TeamContext) {}

  private emit(): void {
    this.ctx.emit({ type: 'messages', messages: this.ctx.data().messages })
  }

  async send(input: {
    toMemberId: string
    toTask: string | null
    fromTask: string | null
    body: string
  }): Promise<TeamAgentMessage> {
    const identity = this.ctx.identity()
    const message: TeamAgentMessage = {
      id: randomUUID(),
      fromMemberId: identity.memberId,
      fromName: identity.name,
      fromTask: input.fromTask,
      toMemberId: input.toMemberId,
      toTask: input.toTask,
      body: input.body,
      at: Date.now()
    }
    if (input.toMemberId === identity.memberId) {
      await this.store(message)
      return message
    }
    this.ctx.send(input.toMemberId, { kind: 'message', message })
    const data = this.ctx.data()
    data.messages = [message, ...data.messages].slice(0, MAX_MESSAGES)
    await this.ctx.save()
    this.emit()
    return message
  }

  async onMessage(senderId: string, senderName: string, payload: TeamPayload): Promise<void> {
    const me = this.ctx.memberId()
    const message = me
      ? parseMessage(payload.message, { id: senderId, name: senderName }, me)
      : null
    if (message && !this.ctx.data().messages.some((entry) => entry.id === message.id)) {
      await this.store(message)
    }
  }

  /** Keeps a message for this machine's agents: in the app and in the repo state the CLI reads. */
  private async store(message: TeamAgentMessage): Promise<void> {
    const data = this.ctx.data()
    data.messages = [message, ...data.messages].slice(0, MAX_MESSAGES)
    await this.ctx.save()
    const repoPath = this.ctx.repoPath()
    if (repoPath) {
      await updateRepoState(this.ctx.run, repoPath, (state) => {
        state.messages = [message, ...state.messages].slice(0, MAX_MESSAGES)
      })
    }
    const from = message.fromTask ? `${message.fromName} (${message.fromTask})` : message.fromName
    this.ctx.log('message', `${from}: ${message.body.slice(0, 80)}`)
    this.emit()
  }
}
