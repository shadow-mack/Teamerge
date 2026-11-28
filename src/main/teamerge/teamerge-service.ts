import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  RelayConnectionState,
  TeamActivityEvent,
  TeamAgentPresence,
  TeamergeEvent,
  TeamFile,
  TeamStatus
} from '../../shared/teamerge/teamerge-types'
import { git, repoTopLevel, type GitRunner } from './core/git-runner'
import {
  createTeamFile,
  joinTeamFile,
  loadOrCreateIdentity,
  publicIdentity,
  readTeamFile,
  saveIdentity,
  writeTeamFile,
  type TeamIdentity
} from './core/identity'
import { RelayClient, type TeamPayload } from './core/relay-client'
import { LocalRelayHost } from './local-relay-host'
import { PaneShareHost } from './pane-share'
import { routePanePayload } from './pane-share-payloads'
import {
  emptyTeamData,
  loadTeamData,
  saveTeamData,
  type TeamContext,
  type TeamData
} from './team-data'
import { TeamHandoffs } from './team-handoffs'
import { TeamMessages } from './team-messages'
import { TeamNotes } from './team-notes'
import { TeamPresence } from './team-presence'
import { TeamReviews } from './team-reviews'

const MAX_ACTIVITY = 200

/** Process-wide owner of the team roster and relay connection; the inbox features hang off it. */
export class TeamergeService {
  private identity: TeamIdentity | null = null
  private repoPath: string | null = null
  private team: TeamFile | null = null
  private relay: RelayClient | null = null
  private relayState: { state: RelayConnectionState; error?: string } = { state: 'disconnected' }
  private data: TeamData = emptyTeamData()
  private activity: TeamActivityEvent[] = []
  readonly panes: PaneShareHost
  readonly presence: TeamPresence
  readonly handoffs: TeamHandoffs
  readonly reviews: TeamReviews
  readonly notes: TeamNotes
  readonly messages: TeamMessages
  readonly localRelay = new LocalRelayHost()

  constructor(
    private readonly opts: {
      dataDir: string
      run: GitRunner
      emit: (event: TeamergeEvent) => void
      writePty: (ptyId: string, data: string) => boolean
    }
  ) {
    this.panes = new PaneShareHost(
      (to, payload) => this.relay?.send(to, payload),
      opts.emit,
      opts.writePty,
      join(opts.dataDir, 'pane-audit.jsonl')
    )
    const ctx: TeamContext = {
      run: opts.run,
      data: () => this.data,
      save: () => this.saveData(),
      emit: opts.emit,
      log: (kind, text) => this.log(kind, text),
      send: (to, payload) => this.relay?.send(to, payload),
      identity: () => this.requireIdentity(),
      memberId: () => this.identity?.memberId,
      repoPath: () => this.repoPath,
      teamRepoPath: () => this.requireTeam().repoPath,
      memberName: (id) => this.team?.members.find((m) => m.id === id)?.name ?? 'a teammate',
      writePty: opts.writePty
    }
    this.presence = new TeamPresence(ctx, this.panes)
    this.handoffs = new TeamHandoffs(ctx)
    this.reviews = new TeamReviews(ctx)
    this.notes = new TeamNotes(ctx)
    this.messages = new TeamMessages(ctx)
  }

  private log(kind: TeamActivityEvent['kind'], text: string): void {
    const event = { id: randomUUID(), at: Date.now(), kind, text }
    this.activity = [event, ...this.activity].slice(0, MAX_ACTIVITY)
    this.opts.emit({ type: 'activity', event })
  }

  async init(): Promise<void> {
    this.identity = await loadOrCreateIdentity()
  }

  private requireIdentity(): TeamIdentity {
    if (!this.identity) {
      throw new Error('Teamerge identity is still loading.')
    }
    return this.identity
  }

  private requireTeam(): { team: TeamFile; repoPath: string; identity: TeamIdentity } {
    if (!this.team || !this.repoPath) {
      throw new Error('Open a repository that has a Teamerge team first.')
    }
    return { team: this.team, repoPath: this.repoPath, identity: this.requireIdentity() }
  }

  status(): TeamStatus {
    const identity = this.identity ? publicIdentity(this.identity) : null
    return {
      repoPath: this.repoPath,
      team: this.team,
      identity,
      isMember:
        !!identity && !!this.team?.members.some((member) => member.id === identity.memberId),
      relay: { ...this.relayState, url: this.team?.relayUrl ?? null },
      onlineMemberIds: this.presence.onlineMemberIds()
    }
  }

  private emitStatus(): void {
    this.opts.emit({ type: 'status', status: this.status() })
  }

  async setRepo(path: string | null): Promise<TeamStatus> {
    const top = path ? await repoTopLevel(this.opts.run, path).catch(() => null) : null
    if (top !== this.repoPath) {
      this.disconnect()
      this.repoPath = top
      this.presence.reset()
    }
    await this.reloadTeam()
    return this.status()
  }

  private async reloadTeam(): Promise<void> {
    this.team = this.repoPath ? await readTeamFile(this.repoPath) : null
    this.data = this.team
      ? await loadTeamData(this.opts.dataDir, this.team.teamId)
      : emptyTeamData()
    this.connectIfMember()
    this.emitStatus()
    this.emitAll()
  }

  private connectIfMember(): void {
    if (!this.team || !this.identity || !this.status().isMember || !this.team.relayUrl) {
      this.disconnect()
      return
    }
    if (this.relay) {
      this.relay.updateTeam(this.team)
      return
    }
    this.relay = new RelayClient(this.identity, this.team, {
      onState: (state, error) => {
        this.relayState = { state, error }
        this.emitStatus()
      },
      onPeers: (peers) => {
        this.presence.onPeers(peers)
        this.emitStatus()
      },
      onPayload: (senderId, senderName, payload) => {
        void this.onPayload(senderId, senderName, payload).catch((error) =>
          console.error('[teamerge] payload handling failed', error)
        )
      }
    })
    this.relay.connect()
  }

  private disconnect(): void {
    this.relay?.close()
    this.relay = null
    this.presence.reset()
    this.relayState = { state: 'disconnected' }
  }

  async createTeam(name: string, relayUrl: string): Promise<TeamStatus> {
    if (!this.repoPath) {
      throw new Error('Open a repository first.')
    }
    const team = createTeamFile(this.requireIdentity(), name.trim() || 'Team', relayUrl.trim())
    await writeTeamFile(this.repoPath, team)
    await this.reloadTeam()
    this.log(
      'presence',
      `Created team “${team.name}”. Commit .teamerge/team.json and push to share it.`
    )
    return this.status()
  }

  /** Adds this machine's key to the roster; pushing the change is what grants membership. */
  async joinTeam(): Promise<TeamStatus> {
    const { team, repoPath, identity } = this.requireTeam()
    await writeTeamFile(repoPath, joinTeamFile(team, identity))
    await this.reloadTeam()
    return this.status()
  }

  async updateTeamSettings(patch: { name?: string; relayUrl?: string }): Promise<TeamStatus> {
    const { team, repoPath } = this.requireTeam()
    await writeTeamFile(repoPath, { ...team, ...patch })
    this.disconnect()
    await this.reloadTeam()
    return this.status()
  }

  async removeMember(memberId: string): Promise<TeamStatus> {
    const { team, repoPath } = this.requireTeam()
    await writeTeamFile(repoPath, {
      ...team,
      members: team.members.filter((m) => m.id !== memberId)
    })
    await this.reloadTeam()
    return this.status()
  }

  /** Commits the team file so the roster change can be pushed. */
  async commitTeamFile(): Promise<string> {
    const { repoPath } = this.requireTeam()
    await git(this.opts.run, repoPath, ['add', '--', '.teamerge/team.json'])
    const result = await this.opts.run(
      repoPath,
      ['commit', '-m', 'Update Teamerge team roster', '--', '.teamerge/team.json'],
      { allowFailure: true }
    )
    if (
      result.code !== 0 &&
      !/nothing to commit|no changes added/.test(result.stdout + result.stderr)
    ) {
      throw new Error(result.stderr.trim() || result.stdout.trim())
    }
    return result.code === 0
      ? 'Committed the roster. Push it to share membership.'
      : 'The roster is already committed.'
  }

  async setDisplayName(name: string): Promise<TeamStatus> {
    const identity = this.requireIdentity()
    identity.name = name.trim() || identity.name
    await saveIdentity(identity)
    if (this.team && this.repoPath && this.status().isMember) {
      await writeTeamFile(this.repoPath, joinTeamFile(this.team, identity))
      await this.reloadTeam()
    }
    this.emitStatus()
    return this.status()
  }

  watchPane(ownerId: string, paneId: string): void {
    this.relay?.send(ownerId, { kind: 'pane-subscribe', paneId })
  }

  unwatchPane(ownerId: string, paneId: string): void {
    this.relay?.send(ownerId, { kind: 'pane-unsubscribe', paneId })
  }

  sendKeystrokes(ownerId: string, paneId: string, data: string): void {
    this.relay?.send(ownerId, { kind: 'pane-keys', paneId, data })
  }

  private async onPayload(
    senderId: string,
    senderName: string,
    payload: TeamPayload
  ): Promise<void> {
    const sender = { id: senderId, name: senderName }
    if (routePanePayload(this.panes, this.opts.emit, (k, t) => this.log(k, t), sender, payload)) {
      return
    }
    const handlers: Record<string, () => void | Promise<void>> = {
      presence: () => this.presence.onPresence(senderId, senderName, payload),
      claims: () => this.presence.onClaims(senderId, senderName, payload),
      handoff: () => this.handoffs.onHandoff(senderId, senderName, payload),
      'handoff-status': () => this.handoffs.onStatus(senderId, senderName, payload),
      review: () => this.reviews.onReview(senderId, senderName, payload),
      'review-comment': () => this.reviews.onComment(senderId, senderName, payload),
      'review-status': () => this.reviews.onStatus(senderId, payload),
      note: () => this.notes.onNote(senderId, senderName, payload),
      'note-deleted': () => this.notes.onDeleted(payload),
      message: () => this.messages.onMessage(senderId, senderName, payload)
    }
    // A teammate picks `kind`, so only own keys count (never `constructor` or `__proto__`).
    if (Object.hasOwn(handlers, payload.kind)) {
      await handlers[payload.kind]()
    }
  }

  private async saveData(): Promise<void> {
    if (this.team) {
      await saveTeamData(this.opts.dataDir, this.team.teamId, this.data)
    }
  }

  snapshot(): TeamData & { activity: TeamActivityEvent[]; agents: TeamAgentPresence[] } {
    return { ...this.data, activity: this.activity, agents: this.presence.agents() }
  }

  private emitAll(): void {
    this.opts.emit({ type: 'handoffs', handoffs: this.data.handoffs })
    this.reviews.emit()
    this.opts.emit({ type: 'notes', notes: this.data.notes })
    this.opts.emit({ type: 'messages', messages: this.data.messages })
    this.presence.emit()
  }

  dispose(): void {
    this.disconnect()
    this.panes.dispose()
    void this.localRelay.stop()
  }
}
