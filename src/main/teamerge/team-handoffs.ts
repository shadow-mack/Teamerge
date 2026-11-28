import { randomUUID } from 'node:crypto'
import type { TeamHandoff } from '../../shared/teamerge/teamerge-types'
import { git } from './core/git-runner'
import type { TeamPayload } from './core/relay-client'
import { isSafeBranchName } from './core/teammate-input'
import { parseHandoff } from './core/teammate-payloads'
import type { TeamContext } from './team-data'

/** Handing a task to a teammate with a brief, and taking one handed to you. */
export class TeamHandoffs {
  constructor(private readonly ctx: TeamContext) {}

  private emit(): void {
    this.ctx.emit({ type: 'handoffs', handoffs: this.ctx.data().handoffs })
  }

  async send(input: {
    toMemberId: string
    title: string
    branch: string
    baseBranch: string
    brief: string
    agent: string
    worktreePath: string
    push: boolean
  }): Promise<TeamHandoff> {
    this.ctx.teamRepoPath()
    const identity = this.ctx.identity()
    if (!isSafeBranchName(input.branch) || !isSafeBranchName(input.baseBranch)) {
      throw new Error('Pick a task whose branch name git accepts before handing it off.')
    }
    if (input.push) {
      const pushed = await this.ctx.run(
        input.worktreePath,
        ['push', '-u', 'origin', input.branch],
        { allowFailure: true }
      )
      if (pushed.code !== 0) {
        throw new Error(`Push failed: ${pushed.stderr.trim() || pushed.stdout.trim()}`)
      }
    }
    const handoff: TeamHandoff = {
      id: randomUUID(),
      fromMemberId: identity.memberId,
      fromName: identity.name,
      toMemberId: input.toMemberId,
      title: input.title,
      branch: input.branch,
      baseBranch: input.baseBranch,
      brief: input.brief,
      agent: input.agent,
      createdAt: Date.now(),
      status: 'sent',
      direction: 'outgoing'
    }
    this.ctx.send(input.toMemberId, {
      kind: 'handoff',
      handoff: { ...handoff, direction: 'incoming' }
    })
    const data = this.ctx.data()
    data.handoffs = [handoff, ...data.handoffs]
    await this.ctx.save()
    this.ctx.log(
      'handoff',
      `Handed off “${handoff.title}” to ${this.ctx.memberName(input.toMemberId)}.`
    )
    this.emit()
    return handoff
  }

  /** Fetches the handed-off branch so the taker can open a workspace on it. */
  async prepareBranch(handoffId: string): Promise<{ branch: string }> {
    const repoPath = this.ctx.teamRepoPath()
    const handoff = this.ctx.data().handoffs.find((entry) => entry.id === handoffId)
    if (!handoff) {
      throw new Error('This handoff no longer exists.')
    }
    if (!isSafeBranchName(handoff.branch)) {
      throw new Error('This handoff names a branch git would refuse, so it was not fetched.')
    }
    const fetched = await this.ctx.run(
      repoPath,
      ['fetch', 'origin', `${handoff.branch}:refs/remotes/origin/${handoff.branch}`],
      { allowFailure: true }
    )
    const hasLocal =
      (
        await this.ctx.run(
          repoPath,
          ['rev-parse', '--verify', '--quiet', `refs/heads/${handoff.branch}`],
          { allowFailure: true }
        )
      ).code === 0
    if (!hasLocal) {
      if (fetched.code !== 0) {
        throw new Error(`Couldn't fetch ${handoff.branch} from origin: ${fetched.stderr.trim()}`)
      }
      await git(this.ctx.run, repoPath, [
        'branch',
        '--track',
        handoff.branch,
        `origin/${handoff.branch}`
      ])
    }
    return { branch: handoff.branch }
  }

  async setStatus(handoffId: string, status: TeamHandoff['status']): Promise<void> {
    const handoff = this.ctx.data().handoffs.find((entry) => entry.id === handoffId)
    if (!handoff) {
      return
    }
    handoff.status = status
    if (handoff.direction === 'incoming') {
      this.ctx.send(handoff.fromMemberId, { kind: 'handoff-status', id: handoffId, status })
    }
    await this.ctx.save()
    this.ctx.log('handoff', `${status === 'taken' ? 'Took' : 'Declined'} “${handoff.title}”.`)
    this.emit()
  }

  async onHandoff(senderId: string, senderName: string, payload: TeamPayload): Promise<void> {
    const me = this.ctx.memberId()
    const handoff = me
      ? parseHandoff(payload.handoff, { id: senderId, name: senderName }, me)
      : null
    const data = this.ctx.data()
    if (!handoff || data.handoffs.some((entry) => entry.id === handoff.id)) {
      return
    }
    data.handoffs = [handoff, ...data.handoffs]
    await this.ctx.save()
    this.ctx.log('handoff', `${senderName} handed you “${handoff.title}”.`)
    this.emit()
  }

  async onStatus(senderId: string, senderName: string, payload: TeamPayload): Promise<void> {
    const handoff = this.ctx
      .data()
      .handoffs.find((entry) => entry.id === payload.id && entry.toMemberId === senderId)
    if (!handoff || (payload.status !== 'taken' && payload.status !== 'declined')) {
      return
    }
    handoff.status = payload.status
    await this.ctx.save()
    this.ctx.log(
      'handoff',
      `${senderName} ${payload.status === 'taken' ? 'took' : 'declined'} “${handoff.title}”.`
    )
    this.emit()
  }
}
