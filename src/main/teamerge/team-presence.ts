import type { LocalTaskAnnouncement, TeamAgentPresence } from '../../shared/teamerge/teamerge-types'
import { readRepoState, updateRepoState } from './core/local-state'
import type { TeamPayload } from './core/relay-client'
import { parseClaims, parsePresence } from './core/teammate-payloads'
import type { PaneShareHost } from './pane-share'
import type { TeamContext } from './team-data'

const PRESENCE_TTL_MS = 2 * 60 * 1000

/** Which teammates are online, what their agents are doing, and which files they claimed. */
export class TeamPresence {
  private peers: string[] = []
  private remoteAgents = new Map<string, TeamAgentPresence[]>()
  private localTasks: LocalTaskAnnouncement[] = []

  constructor(
    private readonly ctx: TeamContext,
    private readonly panes: PaneShareHost
  ) {}

  onlineMemberIds(): string[] {
    return this.peers
  }

  reset(): void {
    this.peers = []
    this.remoteAgents.clear()
  }

  onPeers(peers: string[]): void {
    const joined = peers.filter((id) => !this.peers.includes(id))
    const left = this.peers.filter((id) => !peers.includes(id))
    this.peers = peers
    for (const id of left) {
      this.remoteAgents.delete(id)
      this.panes.onPeerLeft(id)
    }
    if (joined.length > 0) {
      this.broadcast()
      void this.broadcastClaims()
    }
    this.emit()
  }

  announceTasks(tasks: LocalTaskAnnouncement[]): void {
    this.localTasks = tasks.map((task) => ({
      ...task,
      shared: task.paneId ? this.panes.isShared(task.paneId) : false
    }))
    this.broadcast()
  }

  setPaneShared(paneId: string, shared: boolean): void {
    this.panes.setShared(paneId, shared)
    this.localTasks = this.localTasks.map((task) =>
      task.paneId === paneId ? { ...task, shared } : task
    )
    this.broadcast()
  }

  private broadcast(): void {
    this.ctx.send('everyone', { kind: 'presence', tasks: this.localTasks })
  }

  agents(): TeamAgentPresence[] {
    const now = Date.now()
    return [...this.remoteAgents.values()]
      .flat()
      .filter((agent) => now - agent.updatedAt < PRESENCE_TTL_MS)
  }

  emit(): void {
    const agents = this.agents()
    this.ctx.emit({ type: 'presence', agents })
    const repoPath = this.ctx.repoPath()
    if (repoPath) {
      void updateRepoState(this.ctx.run, repoPath, (state) => {
        state.remoteAgents = agents
      }).catch(() => undefined)
    }
  }

  async broadcastClaims(): Promise<void> {
    const repoPath = this.ctx.repoPath()
    if (!repoPath) {
      return
    }
    const { claims } = await readRepoState(this.ctx.run, repoPath)
    this.ctx.send('everyone', { kind: 'claims', claims })
    this.ctx.emit({ type: 'claims', claims })
  }

  onPresence(senderId: string, senderName: string, payload: TeamPayload): void {
    this.remoteAgents.set(
      senderId,
      parsePresence(payload.tasks, { id: senderId, name: senderName })
    )
    this.emit()
  }

  async onClaims(senderId: string, senderName: string, payload: TeamPayload): Promise<void> {
    const repoPath = this.ctx.repoPath()
    if (!repoPath) {
      return
    }
    const claims = parseClaims(payload.claims, { id: senderId, name: senderName })
    await updateRepoState(this.ctx.run, repoPath, (state) => {
      state.remoteClaims = [
        ...state.remoteClaims.filter((claim) => claim.memberId !== senderId),
        ...claims
      ]
    })
  }
}
