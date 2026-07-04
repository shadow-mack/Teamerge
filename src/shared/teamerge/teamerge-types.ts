/** Teamerge: team collaboration layer shared by main, preload, renderer and the `teamerge` CLI. */

export const TEAMERGE_DIR = '.teamerge'
export const TEAMERGE_TEAM_FILE = '.teamerge/team.json'
export const TEAMERGE_NOTES_DIR = '.teamerge/notes'

export type TeamMember = {
  /** Fingerprint of the signing key; stable member id. */
  id: string
  name: string
  /** base64 Ed25519 public key. */
  signPublicKey: string
  /** base64 X25519 public key. */
  boxPublicKey: string
  addedAt: string
}

/** Committed to the repo: anyone who can push can add themselves, so push access is team membership. */
export type TeamFile = {
  version: 1
  teamId: string
  name: string
  relayUrl: string
  members: TeamMember[]
}

export type TeamIdentityPublic = {
  memberId: string
  name: string
  signPublicKey: string
  boxPublicKey: string
}

export type RelayConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export type TeamStatus = {
  repoPath: string | null
  team: TeamFile | null
  identity: TeamIdentityPublic | null
  isMember: boolean
  relay: { state: RelayConnectionState; url: string | null; error?: string }
  onlineMemberIds: string[]
}

export type TeamAgentState = 'working' | 'waiting' | 'idle' | 'done'

/** One agent pane, as announced by its owner's machine. */
export type TeamAgentPresence = {
  memberId: string
  memberName: string
  taskId: string
  taskName: string
  branch: string
  agent: string
  state: TeamAgentState
  paneId: string | null
  /** Owner opted in to live viewing of this pane. */
  shared: boolean
  changedFiles: string[]
  updatedAt: number
}

export type LocalTaskAnnouncement = Omit<TeamAgentPresence, 'memberId' | 'memberName' | 'updatedAt'>

export type KeystrokeRequestStatus = 'pending' | 'approved' | 'rejected' | 'muted'

export type KeystrokeRequest = {
  id: string
  paneId: string
  fromMemberId: string
  fromName: string
  data: string
  at: number
  status: KeystrokeRequestStatus
}

export type PaneAuditEntry = {
  at: number
  paneId: string
  memberId: string
  memberName: string
  /** Printable rendering of the keystrokes. */
  keys: string
  decision: 'approved' | 'rejected' | 'muted'
}

export type PaneShareState = {
  paneId: string
  shared: boolean
  mutedMemberIds: string[]
  viewers: { memberId: string; name: string }[]
  pending: KeystrokeRequest[]
}

export type HandoffStatus = 'sent' | 'taken' | 'declined'

export type TeamHandoff = {
  id: string
  fromMemberId: string
  fromName: string
  toMemberId: string
  title: string
  branch: string
  baseBranch: string
  brief: string
  agent: string
  createdAt: number
  status: HandoffStatus
  direction: 'incoming' | 'outgoing'
}

export type ReviewStatus = 'requested' | 'in-review' | 'done'

export type TeamReviewRequest = {
  id: string
  fromMemberId: string
  fromName: string
  toMemberId: string
  title: string
  branch: string
  /** Unified diff of the task against its base at request time. */
  diff: string
  paneId: string | null
  createdAt: number
  status: ReviewStatus
  direction: 'incoming' | 'outgoing'
}

export type TeamReviewComment = {
  id: string
  reviewId: string
  filePath: string
  line: number
  body: string
  authorId: string
  authorName: string
  createdAt: number
  /** Comment was typed into the requester's agent pane. */
  delivered: boolean
}

export type TeamNote = {
  id: string
  title: string
  body: string
  authorId: string
  authorName: string
  updatedAt: number
}

export type TeamAgentMessage = {
  id: string
  fromMemberId: string
  fromName: string
  fromTask: string | null
  toMemberId: string
  toTask: string | null
  body: string
  at: number
}

export type FileClaim = {
  path: string
  taskId: string
  branch: string
  memberId: string
  memberName: string
  claimedAt: number
  note?: string
}

export type CollisionTask = {
  taskId: string
  taskName: string
  branch: string
  memberName: string
  local: boolean
}

export type FileCollision = {
  filePath: string
  tasks: CollisionTask[]
  /** True when a three-way merge of the involved branches conflicts on this file. */
  conflict: boolean
  claimedBy?: FileClaim
}

export type TaskCollisionSummary = {
  taskId: string
  overlapping: number
  conflicting: number
  collisions: FileCollision[]
}

export type LandingStatus = 'queued' | 'landing' | 'landed' | 'skipped' | 'failed' | 'undone'

export type LandingItem = {
  id: string
  worktreePath: string
  taskName: string
  branch: string
  targetBranch: string
  status: LandingStatus
  reason?: string
  preSha?: string
  mergeSha?: string
  updatedAt: number
}

export type LandingQueueState = {
  repoPath: string
  items: LandingItem[]
  running: boolean
}

export type RaceAttempt = {
  worktreePath: string
  branch: string
  label: string
  agent: string
}

export type RaceGroup = {
  id: string
  title: string
  baseRef: string
  attempts: RaceAttempt[]
  createdAt: number
  winnerBranch?: string
}

export type RaceFileComparison = {
  filePath: string
  /** Per attempt: added/removed line counts, or null when the attempt left the file untouched. */
  perAttempt: ({ added: number; removed: number } | null)[]
  identical: boolean
}

export type DiffHunk = {
  /** Stable id: sha of file + header + body. */
  id: string
  filePath: string
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export type FileHunks = {
  filePath: string
  staged: boolean
  hunks: DiffHunk[]
  /** Raw file header lines (diff --git, index, ---, +++). */
  fileHeader: string[]
}

export type HunkUndoEntry = {
  id: string
  worktreePath: string
  kind: 'stage' | 'unstage' | 'discard'
  filePath: string
  patch: string
  at: number
}

export type ChildTaskStatus = {
  worktreePath: string
  branch: string
  parentBranch: string
  ahead: number
  behind: number
  /** Committed and has no uncommitted changes. */
  ready: boolean
  dirty: boolean
}

export type TeamActivityEvent = {
  id: string
  at: number
  kind:
    | 'handoff'
    | 'review'
    | 'comment'
    | 'note'
    | 'claim'
    | 'landing'
    | 'race'
    | 'keystrokes'
    | 'message'
    | 'presence'
  text: string
}

export type TeamergeEvent =
  | { type: 'status'; status: TeamStatus }
  | { type: 'presence'; agents: TeamAgentPresence[] }
  | { type: 'pane-share'; share: PaneShareState }
  | { type: 'pane-output'; ownerId: string; paneId: string; data: string; replay?: boolean }
  | { type: 'pane-control'; ownerId: string; paneId: string; muted: boolean; ended?: boolean }
  | { type: 'handoffs'; handoffs: TeamHandoff[] }
  | { type: 'reviews'; reviews: TeamReviewRequest[]; comments: TeamReviewComment[] }
  | { type: 'notes'; notes: TeamNote[] }
  | { type: 'messages'; messages: TeamAgentMessage[] }
  | { type: 'claims'; claims: FileClaim[] }
  | { type: 'landing'; queue: LandingQueueState }
  | { type: 'activity'; event: TeamActivityEvent }

export const TEAMERGE_EVENT_CHANNEL = 'teamerge:event'
