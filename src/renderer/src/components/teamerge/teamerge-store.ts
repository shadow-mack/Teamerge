import { create } from 'zustand'
import { getIntlLocale } from '../../i18n/i18n'
import type {
  FileClaim,
  FileCollision,
  LandingQueueState,
  PaneShareState,
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
} from '../../../../shared/teamerge/teamerge-types'

export type TeamSection =
  | 'people'
  | 'tasks'
  | 'inbox'
  | 'notes'
  | 'landing'
  | 'races'
  | 'collisions'
  | 'messages'
  | 'settings'

export type WatchedPane = {
  ownerId: string
  ownerName: string
  paneId: string
  taskName: string
  muted: boolean
  ended: boolean
}

type PaneStreamListener = (data: string, replay: boolean) => void

type TeamergeState = {
  status: TeamStatus | null
  agents: TeamAgentPresence[]
  shares: Record<string, PaneShareState>
  handoffs: TeamHandoff[]
  reviews: TeamReviewRequest[]
  comments: TeamReviewComment[]
  notes: TeamNote[]
  messages: TeamAgentMessage[]
  activity: TeamActivityEvent[]
  claims: FileClaim[]
  collisions: FileCollision[]
  collisionsByTask: Record<string, TaskCollisionSummary>
  landing: LandingQueueState | null
  section: TeamSection
  watching: WatchedPane | null
  openReviewId: string | null
  setSection: (section: TeamSection) => void
  setWatching: (pane: WatchedPane | null) => void
  setOpenReviewId: (id: string | null) => void
  setCollisions: (collisions: FileCollision[], byTask: Record<string, TaskCollisionSummary>) => void
  setLanding: (queue: LandingQueueState | null) => void
  setClaims: (claims: FileClaim[]) => void
  apply: (event: TeamergeEvent) => void
  hydrate: () => Promise<void>
}

const paneListeners = new Map<string, Set<PaneStreamListener>>()

export function paneStreamKey(ownerId: string, paneId: string): string {
  return `${ownerId}:${paneId}`
}

/** Remote pane output bypasses React state: xterm consumes it directly. */
export function subscribePaneStream(
  ownerId: string,
  paneId: string,
  listener: PaneStreamListener
): () => void {
  const key = paneStreamKey(ownerId, paneId)
  const set = paneListeners.get(key) ?? new Set()
  set.add(listener)
  paneListeners.set(key, set)
  return () => {
    set.delete(listener)
  }
}

export const useTeamergeStore = create<TeamergeState>((set, get) => ({
  status: null,
  agents: [],
  shares: {},
  handoffs: [],
  reviews: [],
  comments: [],
  notes: [],
  messages: [],
  activity: [],
  claims: [],
  collisions: [],
  collisionsByTask: {},
  landing: null,
  section: 'people',
  watching: null,
  openReviewId: null,
  setSection: (section) => set({ section }),
  setWatching: (watching) => set({ watching }),
  setOpenReviewId: (openReviewId) => set({ openReviewId }),
  setCollisions: (collisions, collisionsByTask) => set({ collisions, collisionsByTask }),
  setLanding: (landing) => set({ landing }),
  setClaims: (claims) => set({ claims }),
  apply: (event) => {
    switch (event.type) {
      case 'status':
        set({ status: event.status })
        return
      case 'presence':
        set({ agents: event.agents })
        return
      case 'pane-share':
        set({ shares: { ...get().shares, [event.share.paneId]: event.share } })
        return
      case 'pane-output':
        for (const listener of paneListeners.get(paneStreamKey(event.ownerId, event.paneId)) ??
          []) {
          listener(event.data, event.replay === true)
        }
        return
      case 'pane-control': {
        const watching = get().watching
        if (watching && watching.ownerId === event.ownerId && watching.paneId === event.paneId) {
          set({ watching: { ...watching, muted: event.muted, ended: event.ended === true } })
        }
        return
      }
      case 'handoffs':
        set({ handoffs: event.handoffs })
        return
      case 'reviews':
        set({ reviews: event.reviews, comments: event.comments })
        return
      case 'notes':
        set({ notes: event.notes })
        return
      case 'messages':
        set({ messages: event.messages })
        return
      case 'claims':
        set({ claims: event.claims })
        return
      case 'landing':
        set({ landing: event.queue })
        return
      case 'activity':
        set({ activity: [event.event, ...get().activity].slice(0, 200) })
        break
      default:
    }
  },
  hydrate: async () => {
    const api = window.api?.teamerge
    if (!api) {
      return
    }
    const [status, snapshot, shares] = await Promise.all([
      api.status(),
      api.snapshot(),
      api.listPaneShares()
    ])
    set({
      status,
      agents: snapshot.agents,
      handoffs: snapshot.handoffs,
      reviews: snapshot.reviews,
      comments: snapshot.comments,
      notes: snapshot.notes,
      messages: snapshot.messages,
      activity: snapshot.activity,
      shares: Object.fromEntries(shares.map((share) => [share.paneId, share]))
    })
  }
}))

export function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Stable per-member hue so a teammate keeps one color everywhere. */
export function memberHue(memberId: string): number {
  let hash = 0
  for (const ch of memberId) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 360
  }
  return hash
}

export function relativeTime(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000)
  if (seconds < 45) {
    return 'just now'
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  return new Date(at).toLocaleDateString(getIntlLocale())
}
