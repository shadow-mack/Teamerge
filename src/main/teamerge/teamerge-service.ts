/* oxlint-disable eslint/max-lines */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import {
  TEAMERGE_NOTES_DIR,
  type FileClaim,
  type LocalTaskAnnouncement,
  type RelayConnectionState,
  type TeamActivityEvent,
  type TeamAgentMessage,
  type TeamAgentPresence,
  type TeamergeEvent,
  type TeamFile,
  type TeamHandoff,
  type TeamNote,
  type TeamReviewComment,
  type TeamReviewRequest,
  type TeamStatus
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
import { readRepoState, updateRepoState } from './core/local-state'
import { RelayClient, type TeamPayload } from './core/relay-client'
import { startRelayServer, type RelayServerHandle } from './core/relay-server'
import { RELAY_DEFAULT_PORT } from './core/relay-protocol'
import { PaneShareHost } from './pane-share'

type TeamData = {
  handoffs: TeamHandoff[]
  reviews: TeamReviewRequest[]
  comments: TeamReviewComment[]
  notes: TeamNote[]
  messages: TeamAgentMessage[]
}

const EMPTY_DATA: TeamData = { handoffs: [], reviews: [], comments: [], notes: [], messages: [] }
const PRESENCE_TTL_MS = 2 * 60 * 1000

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'note'
  )
}

/** Process-wide owner of the team connection, presence, pane sharing and team inbox. */
export class TeamergeService {
  private identity: TeamIdentity | null = null
  private repoPath: string | null = null
  private team: TeamFile | null = null
  private relay: RelayClient | null = null
  private relayState: { state: RelayConnectionState; error?: string } = { state: 'disconnected' }
  private peers: string[] = []
  private remoteAgents = new Map<string, TeamAgentPresence[]>()
  private localTasks: LocalTaskAnnouncement[] = []
  private data: TeamData = structuredClone(EMPTY_DATA)
  private activity: TeamActivityEvent[] = []
  private localRelay: RelayServerHandle | null = null
  readonly panes: PaneShareHost

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
  }

  private get run(): GitRunner {
    return this.opts.run
  }

  private emit(event: TeamergeEvent): void {
    this.opts.emit(event)
  }

  private log(kind: TeamActivityEvent['kind'], text: string): void {
    const event = { id: randomUUID(), at: Date.now(), kind, text }
    this.activity = [event, ...this.activity].slice(0, 200)
    this.emit({ type: 'activity', event })
  }

  // --- identity and team --------------------------------------------------------------------

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
      onlineMemberIds: this.peers
    }
  }

  private emitStatus(): void {
    this.emit({ type: 'status', status: this.status() })
  }

  async setRepo(path: string | null): Promise<TeamStatus> {
    const top = path ? await repoTopLevel(this.run, path).catch(() => null) : null
    if (top === this.repoPath) {
      await this.reloadTeam()
      return this.status()
    }
    this.disconnect()
    this.repoPath = top
    this.remoteAgents.clear()
    await this.reloadTeam()
    return this.status()
  }

  async reloadTeam(): Promise<void> {
    this.team = this.repoPath ? await readTeamFile(this.repoPath) : null
    await this.loadData()
    this.connectIfMember()
    this.emitStatus()
    this.emitAll()
  }

  private connectIfMember(): void {
    const status = this.status()
    if (!this.team || !this.identity || !status.isMember || !this.team.relayUrl) {
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
      onPeers: (peers) => this.onPeers(peers),
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
    this.peers = []
    this.relayState = { state: 'disconnected' }
  }

  async createTeam(name: string, relayUrl: string): Promise<TeamStatus> {
    const repoPath = this.repoPath
    if (!repoPath) {
      throw new Error('Open a repository first.')
    }
    const team = createTeamFile(this.requireIdentity(), name.trim() || 'Team', relayUrl.trim())
    await writeTeamFile(repoPath, team)
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
    await git(this.run, repoPath, ['add', '--', '.teamerge/team.json'])
    const result = await this.run(
      repoPath,
      ['commit', '-m', 'Update Teamerge team roster', '--', '.teamerge/team.json'],
      {
        allowFailure: true
      }
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

  /** Runs the bundled relay on this machine and returns URLs teammates can reach. */
  async startLocalRelay(port = RELAY_DEFAULT_PORT): Promise<{ port: number; urls: string[] }> {
    if (!this.localRelay) {
      this.localRelay = await startRelayServer({
        port,
        log: (line) => console.log(`[teamerge-relay] ${line}`)
      })
    }
    const urls = [`ws://localhost:${this.localRelay.port}`]
    for (const list of Object.values(networkInterfaces())) {
      for (const address of list ?? []) {
        if (address.family === 'IPv4' && !address.internal) {
          urls.push(`ws://${address.address}:${this.localRelay.port}`)
        }
      }
    }
    return { port: this.localRelay.port, urls }
  }

  async stopLocalRelay(): Promise<void> {
    await this.localRelay?.close()
    this.localRelay = null
  }

  localRelayStatus(): { running: boolean; port: number | null; peers: number } {
    return {
      running: !!this.localRelay,
      port: this.localRelay?.port ?? null,
      peers: this.localRelay?.stats().peers ?? 0
    }
  }

  // --- presence --------------------------------------------------------------------------------

  private onPeers(peers: string[]): void {
    const joined = peers.filter((id) => !this.peers.includes(id))
    const left = this.peers.filter((id) => !peers.includes(id))
    this.peers = peers
    for (const id of left) {
      this.remoteAgents.delete(id)
      this.panes.onPeerLeft(id)
    }
    if (joined.length > 0) {
      this.broadcastPresence()
      void this.broadcastClaims()
    }
    this.emitStatus()
    this.emitPresence()
  }

  announceTasks(tasks: LocalTaskAnnouncement[]): void {
    this.localTasks = tasks.map((task) => ({
      ...task,
      shared: task.paneId ? this.panes.isShared(task.paneId) : false
    }))
    this.broadcastPresence()
  }

  private broadcastPresence(): void {
    this.relay?.send('everyone', { kind: 'presence', tasks: this.localTasks })
  }

  presence(): TeamAgentPresence[] {
    const now = Date.now()
    return [...this.remoteAgents.values()]
      .flat()
      .filter((agent) => now - agent.updatedAt < PRESENCE_TTL_MS)
  }

  private emitPresence(): void {
    const agents = this.presence()
    this.emit({ type: 'presence', agents })
    if (this.repoPath) {
      void updateRepoState(this.run, this.repoPath, (state) => {
        state.remoteAgents = agents
      }).catch(() => undefined)
    }
  }

  setPaneShared(paneId: string, shared: boolean): void {
    this.panes.setShared(paneId, shared)
    this.localTasks = this.localTasks.map((task) =>
      task.paneId === paneId ? { ...task, shared } : task
    )
    this.broadcastPresence()
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

  // --- claims --------------------------------------------------------------------------------

  async broadcastClaims(): Promise<void> {
    if (!this.repoPath || !this.relay) {
      return
    }
    const { claims } = await readRepoState(this.run, this.repoPath)
    this.relay.send('everyone', { kind: 'claims', claims })
    this.emit({ type: 'claims', claims })
  }

  // --- handoffs ------------------------------------------------------------------------------

  async sendHandoff(input: {
    toMemberId: string
    title: string
    branch: string
    baseBranch: string
    brief: string
    agent: string
    worktreePath: string
    push: boolean
  }): Promise<TeamHandoff> {
    const { identity } = this.requireTeam()
    if (input.push) {
      const pushed = await this.run(input.worktreePath, ['push', '-u', 'origin', input.branch], {
        allowFailure: true
      })
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
    this.relay?.send(input.toMemberId, {
      kind: 'handoff',
      handoff: { ...handoff, direction: 'incoming' }
    })
    this.data.handoffs = [handoff, ...this.data.handoffs]
    await this.saveData()
    this.log('handoff', `Handed off “${handoff.title}” to ${this.memberName(input.toMemberId)}.`)
    this.emit({ type: 'handoffs', handoffs: this.data.handoffs })
    return handoff
  }

  /** Fetches the handed-off branch so the taker can open a workspace on it. */
  async prepareHandoffBranch(handoffId: string): Promise<{ branch: string }> {
    const { repoPath } = this.requireTeam()
    const handoff = this.data.handoffs.find((entry) => entry.id === handoffId)
    if (!handoff) {
      throw new Error('This handoff no longer exists.')
    }
    const fetched = await this.run(
      repoPath,
      ['fetch', 'origin', `${handoff.branch}:refs/remotes/origin/${handoff.branch}`],
      {
        allowFailure: true
      }
    )
    const hasLocal =
      (
        await this.run(
          repoPath,
          ['rev-parse', '--verify', '--quiet', `refs/heads/${handoff.branch}`],
          { allowFailure: true }
        )
      ).code === 0
    if (!hasLocal) {
      if (fetched.code !== 0) {
        throw new Error(`Couldn't fetch ${handoff.branch} from origin: ${fetched.stderr.trim()}`)
      }
      await git(this.run, repoPath, [
        'branch',
        '--track',
        handoff.branch,
        `origin/${handoff.branch}`
      ])
    }
    return { branch: handoff.branch }
  }

  async setHandoffStatus(handoffId: string, status: TeamHandoff['status']): Promise<void> {
    const handoff = this.data.handoffs.find((entry) => entry.id === handoffId)
    if (!handoff) {
      return
    }
    handoff.status = status
    if (handoff.direction === 'incoming') {
      this.relay?.send(handoff.fromMemberId, { kind: 'handoff-status', id: handoffId, status })
    }
    await this.saveData()
    this.log('handoff', `${status === 'taken' ? 'Took' : 'Declined'} “${handoff.title}”.`)
    this.emit({ type: 'handoffs', handoffs: this.data.handoffs })
  }

  // --- reviews -------------------------------------------------------------------------------

  async requestReview(input: {
    toMemberId: string
    title: string
    worktreePath: string
    baseRef: string
    paneId: string | null
  }): Promise<TeamReviewRequest> {
    const { identity } = this.requireTeam()
    const branch = (
      await git(this.run, input.worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    ).trim()
    const mergeBase = (
      await git(this.run, input.worktreePath, ['merge-base', input.baseRef, 'HEAD'])
    ).trim()
    const diff = await git(this.run, input.worktreePath, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      mergeBase
    ])
    if (!diff.trim()) {
      throw new Error('This task has no changes to review yet.')
    }
    if (diff.length > 2 * 1024 * 1024) {
      throw new Error('The diff is larger than 2 MB. Split the task before asking for review.')
    }
    const review: TeamReviewRequest = {
      id: randomUUID(),
      fromMemberId: identity.memberId,
      fromName: identity.name,
      toMemberId: input.toMemberId,
      title: input.title,
      branch,
      diff,
      paneId: input.paneId,
      createdAt: Date.now(),
      status: 'requested',
      direction: 'outgoing'
    }
    this.relay?.send(input.toMemberId, {
      kind: 'review',
      review: { ...review, direction: 'incoming' }
    })
    this.data.reviews = [review, ...this.data.reviews]
    await this.saveData()
    this.log('review', `Asked ${this.memberName(input.toMemberId)} to review “${review.title}”.`)
    this.emitReviews()
    return review
  }

  async addReviewComment(input: {
    reviewId: string
    filePath: string
    line: number
    body: string
  }): Promise<TeamReviewComment> {
    const identity = this.requireIdentity()
    const review = this.data.reviews.find((entry) => entry.id === input.reviewId)
    if (!review) {
      throw new Error('This review no longer exists.')
    }
    const comment: TeamReviewComment = {
      id: randomUUID(),
      reviewId: review.id,
      filePath: input.filePath,
      line: input.line,
      body: input.body.trim(),
      authorId: identity.memberId,
      authorName: identity.name,
      createdAt: Date.now(),
      delivered: false
    }
    this.data.comments.push(comment)
    if (review.status === 'requested') {
      review.status = 'in-review'
    }
    this.relay?.send(review.fromMemberId, { kind: 'review-comment', comment })
    await this.saveData()
    this.emitReviews()
    return comment
  }

  async setReviewStatus(reviewId: string, status: TeamReviewRequest['status']): Promise<void> {
    const review = this.data.reviews.find((entry) => entry.id === reviewId)
    if (!review) {
      return
    }
    review.status = status
    const other = review.direction === 'incoming' ? review.fromMemberId : review.toMemberId
    this.relay?.send(other, { kind: 'review-status', id: reviewId, status })
    await this.saveData()
    this.emitReviews()
  }

  /** Types a review comment into the task's agent pane so the agent acts on it. */
  private deliverCommentToAgent(review: TeamReviewRequest, comment: TeamReviewComment): boolean {
    if (!review.paneId) {
      return false
    }
    const text = `Review comment from ${comment.authorName} on ${comment.filePath}:${comment.line} — ${comment.body.replace(/\s+/g, ' ')}`
    return this.opts.writePty(review.paneId, `${text}\r`)
  }

  async redeliverComment(commentId: string, paneId: string): Promise<boolean> {
    const comment = this.data.comments.find((entry) => entry.id === commentId)
    const review = comment && this.data.reviews.find((entry) => entry.id === comment.reviewId)
    if (!comment || !review) {
      return false
    }
    review.paneId = paneId
    comment.delivered = this.deliverCommentToAgent(review, comment)
    await this.saveData()
    this.emitReviews()
    return comment.delivered
  }

  private emitReviews(): void {
    this.emit({ type: 'reviews', reviews: this.data.reviews, comments: this.data.comments })
  }

  // --- notes ---------------------------------------------------------------------------------

  async saveNote(input: { id?: string; title: string; body: string }): Promise<TeamNote> {
    const identity = this.requireIdentity()
    const existing = input.id ? this.data.notes.find((note) => note.id === input.id) : undefined
    const note: TeamNote = {
      id: existing?.id ?? randomUUID(),
      title: input.title.trim() || 'Untitled',
      body: input.body,
      authorId: identity.memberId,
      authorName: identity.name,
      updatedAt: Date.now()
    }
    this.data.notes = [note, ...this.data.notes.filter((entry) => entry.id !== note.id)]
    this.relay?.send('everyone', { kind: 'note', note })
    await this.saveData()
    await this.writeNoteFile(note, existing)
    this.emit({ type: 'notes', notes: this.data.notes })
    return note
  }

  async deleteNote(id: string): Promise<void> {
    const note = this.data.notes.find((entry) => entry.id === id)
    this.data.notes = this.data.notes.filter((entry) => entry.id !== id)
    this.relay?.send('everyone', { kind: 'note-deleted', id })
    await this.saveData()
    if (note && this.repoPath) {
      await rm(this.noteFilePath(note), { force: true })
    }
    this.emit({ type: 'notes', notes: this.data.notes })
  }

  private noteFilePath(note: TeamNote): string {
    return join(
      this.repoPath ?? '',
      TEAMERGE_NOTES_DIR,
      `${slugify(note.title)}-${note.id.slice(0, 6)}.md`
    )
  }

  /** Mirrors notes into .teamerge/notes so they can also be committed with the repo. */
  private async writeNoteFile(note: TeamNote, previous?: TeamNote): Promise<void> {
    if (!this.repoPath) {
      return
    }
    if (previous && previous.title !== note.title) {
      await rm(this.noteFilePath(previous), { force: true })
    }
    await mkdir(join(this.repoPath, TEAMERGE_NOTES_DIR), { recursive: true })
    await writeFile(this.noteFilePath(note), `# ${note.title}\n\n${note.body.trim()}\n`)
  }

  // --- agent-to-agent messages -----------------------------------------------------------------

  async sendMessage(input: {
    toMemberId: string
    toTask: string | null
    fromTask: string | null
    body: string
  }): Promise<TeamAgentMessage> {
    const identity = this.requireIdentity()
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
      await this.storeMessage(message)
    } else {
      this.relay?.send(input.toMemberId, { kind: 'message', message })
      this.data.messages = [message, ...this.data.messages].slice(0, 500)
      await this.saveData()
      this.emit({ type: 'messages', messages: this.data.messages })
    }
    return message
  }

  private async storeMessage(message: TeamAgentMessage): Promise<void> {
    this.data.messages = [message, ...this.data.messages].slice(0, 500)
    await this.saveData()
    if (this.repoPath) {
      await updateRepoState(this.run, this.repoPath, (state) => {
        state.messages = [message, ...state.messages].slice(0, 500)
      })
    }
    this.log(
      'message',
      `${message.fromName}${message.fromTask ? ` (${message.fromTask})` : ''}: ${message.body.slice(0, 80)}`
    )
    this.emit({ type: 'messages', messages: this.data.messages })
  }

  // --- inbound -------------------------------------------------------------------------------

  private memberName(memberId: string): string {
    return this.team?.members.find((member) => member.id === memberId)?.name ?? 'a teammate'
  }

  private async onPayload(
    senderId: string,
    senderName: string,
    payload: TeamPayload
  ): Promise<void> {
    switch (payload.kind) {
      case 'presence': {
        const tasks = Array.isArray(payload.tasks) ? (payload.tasks as LocalTaskAnnouncement[]) : []
        this.remoteAgents.set(
          senderId,
          tasks.slice(0, 64).map((task) => ({
            ...task,
            changedFiles: Array.isArray(task.changedFiles) ? task.changedFiles.slice(0, 2000) : [],
            memberId: senderId,
            memberName: senderName,
            updatedAt: Date.now()
          }))
        )
        this.emitPresence()
        return
      }
      case 'claims': {
        if (!this.repoPath) {
          return
        }
        const claims = (Array.isArray(payload.claims) ? (payload.claims as FileClaim[]) : []).map(
          (claim) => ({
            ...claim,
            memberId: senderId,
            memberName: senderName
          })
        )
        await updateRepoState(this.run, this.repoPath, (state) => {
          state.remoteClaims = [
            ...state.remoteClaims.filter((claim) => claim.memberId !== senderId),
            ...claims
          ]
        })
        return
      }
      case 'pane-subscribe':
        this.panes.onSubscribe(senderId, senderName, String(payload.paneId))
        return
      case 'pane-unsubscribe':
        this.panes.onUnsubscribe(senderId, String(payload.paneId))
        return
      case 'pane-keys':
        this.panes.onKeystrokes(
          senderId,
          senderName,
          String(payload.paneId),
          payload.data as string
        )
        return
      case 'pane-output':
        this.emit({
          type: 'pane-output',
          ownerId: senderId,
          paneId: String(payload.paneId),
          data: String(payload.data ?? ''),
          replay: payload.replay === true
        })
        return
      case 'pane-control':
        this.emit({
          type: 'pane-control',
          ownerId: senderId,
          paneId: String(payload.paneId),
          muted: payload.muted === true
        })
        return
      case 'pane-ended':
        this.emit({
          type: 'pane-control',
          ownerId: senderId,
          paneId: String(payload.paneId),
          muted: false,
          ended: true
        })
        return
      case 'pane-keys-result':
        this.log('keystrokes', `${senderName} ${String(payload.status)} your keystrokes.`)
        return
      case 'handoff': {
        const handoff = payload.handoff as TeamHandoff
        if (!handoff?.id || handoff.fromMemberId !== senderId) {
          return
        }
        this.data.handoffs = [
          { ...handoff, fromName: senderName, direction: 'incoming', status: 'sent' },
          ...this.data.handoffs
        ]
        await this.saveData()
        this.log('handoff', `${senderName} handed you “${handoff.title}”.`)
        this.emit({ type: 'handoffs', handoffs: this.data.handoffs })
        return
      }
      case 'handoff-status': {
        const handoff = this.data.handoffs.find(
          (entry) => entry.id === payload.id && entry.toMemberId === senderId
        )
        if (handoff && (payload.status === 'taken' || payload.status === 'declined')) {
          handoff.status = payload.status
          await this.saveData()
          this.log(
            'handoff',
            `${senderName} ${payload.status === 'taken' ? 'took' : 'declined'} “${handoff.title}”.`
          )
          this.emit({ type: 'handoffs', handoffs: this.data.handoffs })
        }
        return
      }
      case 'review': {
        const review = payload.review as TeamReviewRequest
        if (!review?.id || review.fromMemberId !== senderId) {
          return
        }
        this.data.reviews = [
          { ...review, fromName: senderName, direction: 'incoming' },
          ...this.data.reviews
        ]
        await this.saveData()
        this.log('review', `${senderName} asked you to review “${review.title}”.`)
        this.emitReviews()
        return
      }
      case 'review-comment': {
        const comment = payload.comment as TeamReviewComment
        const review = this.data.reviews.find(
          (entry) => entry.id === comment?.reviewId && entry.direction === 'outgoing'
        )
        if (!review || review.toMemberId !== senderId) {
          return
        }
        const stored = { ...comment, authorId: senderId, authorName: senderName, delivered: false }
        stored.delivered = this.deliverCommentToAgent(review, stored)
        this.data.comments.push(stored)
        review.status = review.status === 'requested' ? 'in-review' : review.status
        await this.saveData()
        this.log(
          'comment',
          `${senderName} commented on ${stored.filePath}:${stored.line}${stored.delivered ? ' — sent to your agent' : ''}.`
        )
        this.emitReviews()
        return
      }
      case 'review-status': {
        const review = this.data.reviews.find((entry) => entry.id === payload.id)
        if (review && (review.fromMemberId === senderId || review.toMemberId === senderId)) {
          review.status = payload.status as TeamReviewRequest['status']
          await this.saveData()
          this.emitReviews()
        }
        return
      }
      case 'note': {
        const note = payload.note as TeamNote
        if (!note?.id) {
          return
        }
        const previous = this.data.notes.find((entry) => entry.id === note.id)
        const incoming = { ...note, authorId: senderId, authorName: senderName }
        this.data.notes = [incoming, ...this.data.notes.filter((entry) => entry.id !== note.id)]
        await this.saveData()
        await this.writeNoteFile(incoming, previous)
        this.log('note', `${senderName} updated the note “${note.title}”.`)
        this.emit({ type: 'notes', notes: this.data.notes })
        return
      }
      case 'note-deleted': {
        const note = this.data.notes.find((entry) => entry.id === payload.id)
        if (note) {
          this.data.notes = this.data.notes.filter((entry) => entry.id !== note.id)
          await this.saveData()
          if (this.repoPath) {
            await rm(this.noteFilePath(note), { force: true })
          }
          this.emit({ type: 'notes', notes: this.data.notes })
        }
        return
      }
      case 'message': {
        const message = payload.message as TeamAgentMessage
        if (message?.id) {
          await this.storeMessage({ ...message, fromMemberId: senderId, fromName: senderName })
        }
        break
      }
      default:
    }
  }

  // --- persistence -----------------------------------------------------------------------------

  private dataFile(): string | null {
    return this.team ? join(this.opts.dataDir, `${this.team.teamId}.json`) : null
  }

  private async loadData(): Promise<void> {
    const file = this.dataFile()
    if (!file) {
      this.data = structuredClone(EMPTY_DATA)
      return
    }
    try {
      this.data = {
        ...structuredClone(EMPTY_DATA),
        ...(JSON.parse(await readFile(file, 'utf8')) as Partial<TeamData>)
      }
    } catch {
      this.data = structuredClone(EMPTY_DATA)
    }
  }

  private async saveData(): Promise<void> {
    const file = this.dataFile()
    if (!file) {
      return
    }
    await mkdir(this.opts.dataDir, { recursive: true })
    await writeFile(file, JSON.stringify(this.data))
  }

  snapshot(): TeamData & { activity: TeamActivityEvent[]; agents: TeamAgentPresence[] } {
    return { ...this.data, activity: this.activity, agents: this.presence() }
  }

  private emitAll(): void {
    this.emit({ type: 'handoffs', handoffs: this.data.handoffs })
    this.emitReviews()
    this.emit({ type: 'notes', notes: this.data.notes })
    this.emit({ type: 'messages', messages: this.data.messages })
    this.emitPresence()
  }

  dispose(): void {
    this.disconnect()
    this.panes.dispose()
    void this.stopLocalRelay()
  }
}
