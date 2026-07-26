import type {
  ChildTaskStatus,
  FileClaim,
  FileCollision,
  FileHunks,
  HunkUndoEntry,
  LandingItem,
  LandingQueueState,
  LocalTaskAnnouncement,
  PaneAuditEntry,
  PaneShareState,
  RaceAttempt,
  RaceFileComparison,
  RaceGroup,
  TaskCollisionSummary,
  TeamActivityEvent,
  TeamAgentMessage,
  TeamAgentPresence,
  TeamergeEvent,
  TeamHandoff,
  TeamNote,
  TeamReviewComment,
  TeamReviewRequest,
  TeamStatus
} from '../../shared/teamerge/teamerge-types'

export type TeamergeLocalTask = {
  taskId: string
  taskName: string
  worktreePath: string
  branch: string
  baseRef: string
}

export type TeamergeMergeOutcome =
  | { ok: true; preSha: string; mergeSha: string; fastForward: boolean }
  | { ok: false; reason: 'conflict'; conflicts: string[] }
  | { ok: false; reason: 'dirty-target' | 'nothing-to-merge' | 'error'; message: string }

export type TeamergeApi = {
  onEvent: (listener: (event: TeamergeEvent) => void) => () => void
  status: () => Promise<TeamStatus>
  setRepo: (repoPath: string | null) => Promise<TeamStatus>
  createTeam: (args: { name: string; relayUrl: string }) => Promise<TeamStatus>
  joinTeam: () => Promise<TeamStatus>
  updateTeamSettings: (patch: { name?: string; relayUrl?: string }) => Promise<TeamStatus>
  removeMember: (memberId: string) => Promise<TeamStatus>
  commitTeamFile: () => Promise<string>
  setDisplayName: (name: string) => Promise<TeamStatus>
  startLocalRelay: (port?: number) => Promise<{ port: number; urls: string[] }>
  stopLocalRelay: () => Promise<void>
  localRelayStatus: () => Promise<{ running: boolean; port: number | null; peers: number }>
  snapshot: () => Promise<{
    handoffs: TeamHandoff[]
    reviews: TeamReviewRequest[]
    comments: TeamReviewComment[]
    notes: TeamNote[]
    messages: TeamAgentMessage[]
    activity: TeamActivityEvent[]
    agents: TeamAgentPresence[]
  }>

  announceTasks: (tasks: LocalTaskAnnouncement[]) => Promise<void>
  setPaneShared: (args: { paneId: string; shared: boolean }) => Promise<void>
  listPaneShares: () => Promise<PaneShareState[]>
  setViewerMuted: (args: { paneId: string; memberId: string; muted: boolean }) => Promise<void>
  decideKeystrokes: (args: { paneId: string; requestId: string; approve: boolean }) => Promise<void>
  readPaneAudit: () => Promise<PaneAuditEntry[]>
  watchPane: (args: { ownerId: string; paneId: string }) => Promise<void>
  unwatchPane: (args: { ownerId: string; paneId: string }) => Promise<void>
  sendKeystrokes: (args: { ownerId: string; paneId: string; data: string }) => Promise<void>

  sendHandoff: (args: {
    toMemberId: string
    title: string
    branch: string
    baseBranch: string
    brief: string
    agent: string
    worktreePath: string
    push: boolean
  }) => Promise<TeamHandoff>
  prepareHandoffBranch: (id: string) => Promise<{ branch: string }>
  setHandoffStatus: (args: { id: string; status: 'taken' | 'declined' }) => Promise<void>
  requestReview: (args: {
    toMemberId: string
    title: string
    worktreePath: string
    baseRef: string
    paneId: string | null
  }) => Promise<TeamReviewRequest>
  addReviewComment: (args: {
    reviewId: string
    filePath: string
    line: number
    body: string
  }) => Promise<TeamReviewComment>
  setReviewStatus: (args: {
    id: string
    status: 'requested' | 'in-review' | 'done'
  }) => Promise<void>
  redeliverComment: (args: { commentId: string; paneId: string }) => Promise<boolean>
  saveNote: (args: { id?: string; title: string; body: string }) => Promise<TeamNote>
  deleteNote: (id: string) => Promise<void>
  sendMessage: (args: {
    toMemberId: string
    toTask: string | null
    fromTask: string | null
    body: string
  }) => Promise<TeamAgentMessage>

  collisions: (args: {
    repoPath: string
    tasks: TeamergeLocalTask[]
    memberName: string
  }) => Promise<{ collisions: FileCollision[]; byTask: Record<string, TaskCollisionSummary> }>
  claimFiles: (args: {
    repoPath: string
    taskId: string
    branch: string
    paths: string[]
    note?: string
  }) => Promise<FileClaim[]>
  releaseClaims: (args: {
    repoPath: string
    taskId: string
    paths?: string[]
  }) => Promise<FileClaim[]>
  listClaims: (repoPath: string) => Promise<FileClaim[]>
  recordTasks: (args: {
    repoPath: string
    tasks: Record<string, { taskName: string; parentBranch?: string; baseRef?: string }>
  }) => Promise<void>

  taskChangedFiles: (args: { worktreePath: string; baseRef: string }) => Promise<string[]>
  childStatus: (args: { worktreePath: string; parentBranch: string }) => Promise<ChildTaskStatus>
  updateFromParent: (args: {
    worktreePath: string
    parentBranch: string
  }) => Promise<
    { ok: true; updated: boolean } | { ok: false; conflicts: string[]; message: string }
  >
  mergeIntoParent: (args: {
    worktreePath: string
    parentBranch: string
  }) => Promise<TeamergeMergeOutcome>
  mergeAllReady: (args: {
    worktreePaths: string[]
    parentBranch: string
  }) => Promise<{ branch: string; outcome: TeamergeMergeOutcome }[]>

  landingQueue: (repoPath: string) => Promise<LandingQueueState>
  enqueueLanding: (args: {
    repoPath: string
    worktreePath: string
    taskName: string
    targetBranch: string
  }) => Promise<LandingItem>
  removeLanding: (args: { repoPath: string; id: string }) => Promise<void>
  clearLanding: (repoPath: string) => Promise<void>
  landAll: (repoPath: string) => Promise<LandingQueueState>
  undoLanding: (args: { repoPath: string; id: string }) => Promise<LandingItem>

  listRaces: (repoPath: string) => Promise<RaceGroup[]>
  createRace: (args: {
    repoPath: string
    title: string
    baseRef: string
    attempts: RaceAttempt[]
  }) => Promise<RaceGroup>
  compareRace: (args: { repoPath: string; raceId: string }) => Promise<RaceFileComparison[]>
  raceFileDiffs: (args: { repoPath: string; raceId: string; filePath: string }) => Promise<string[]>
  pickRaceWinner: (args: {
    repoPath: string
    raceId: string
    winnerBranch: string
  }) => Promise<{ race: RaceGroup; losers: RaceAttempt[] }>
  removeRace: (args: { repoPath: string; raceId: string }) => Promise<void>

  fileHunks: (args: {
    worktreePath: string
    filePath: string
    staged: boolean
  }) => Promise<FileHunks | null>
  stageHunk: (args: {
    worktreePath: string
    filePath: string
    hunkId: string
  }) => Promise<HunkUndoEntry>
  unstageHunk: (args: {
    worktreePath: string
    filePath: string
    hunkId: string
  }) => Promise<HunkUndoEntry>
  discardHunk: (args: {
    worktreePath: string
    filePath: string
    hunkId: string
  }) => Promise<HunkUndoEntry>
  undoHunk: (worktreePath: string) => Promise<HunkUndoEntry | null>
  hunkHistory: (worktreePath: string) => Promise<HunkUndoEntry[]>
}
