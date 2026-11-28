import type {
  FileClaim,
  ReviewStatus,
  TeamAgentMessage,
  TeamAgentPresence,
  TeamAgentState,
  TeamHandoff,
  TeamNote,
  TeamReviewComment,
  TeamReviewRequest
} from '../../../shared/teamerge/teamerge-types'
import {
  isSafeBranchName,
  isTeamergeId,
  toTypeableLine,
  withoutControlChars
} from './teammate-input'

/** Builds typed records from what a teammate sent, field by field; anything malformed is dropped. */

type Sender = { id: string; name: string }
type Fields = Record<string, unknown>

const AGENT_STATES: readonly TeamAgentState[] = ['working', 'waiting', 'idle', 'done']
const REVIEW_STATUSES: readonly ReviewStatus[] = ['requested', 'in-review', 'done']
const MAX_REVIEW_DIFF_CHARS = 2 * 1024 * 1024

export function fieldsOf(value: unknown): Fields | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return Object.fromEntries(Object.entries(value))
}

function time(fields: Fields, key: string): number {
  const value = fields[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now()
}

function optionalLine(fields: Fields, key: string, maxLength: number): string | null {
  const value = toTypeableLine(fields[key] ?? '', maxLength)
  return value || null
}

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return REVIEW_STATUSES.some((status) => status === value)
}

export function parseHandoff(value: unknown, sender: Sender, me: string): TeamHandoff | null {
  const f = fieldsOf(value)
  if (
    !f ||
    !isTeamergeId(f.id) ||
    f.fromMemberId !== sender.id ||
    f.toMemberId !== me ||
    !isSafeBranchName(f.branch) ||
    !isSafeBranchName(f.baseBranch)
  ) {
    return null
  }
  return {
    id: f.id,
    fromMemberId: sender.id,
    fromName: sender.name,
    toMemberId: me,
    title: toTypeableLine(f.title, 200),
    branch: f.branch,
    baseBranch: f.baseBranch,
    brief: withoutControlChars(f.brief),
    agent: toTypeableLine(f.agent, 64),
    createdAt: time(f, 'createdAt'),
    status: 'sent',
    direction: 'incoming'
  }
}

export function parseReview(value: unknown, sender: Sender, me: string): TeamReviewRequest | null {
  const f = fieldsOf(value)
  if (
    !f ||
    !isTeamergeId(f.id) ||
    f.fromMemberId !== sender.id ||
    typeof f.diff !== 'string' ||
    f.diff.length > MAX_REVIEW_DIFF_CHARS
  ) {
    return null
  }
  return {
    id: f.id,
    fromMemberId: sender.id,
    fromName: sender.name,
    toMemberId: me,
    title: toTypeableLine(f.title, 200),
    branch: toTypeableLine(f.branch, 200),
    diff: f.diff,
    // The requester's pane id means nothing on this machine.
    paneId: null,
    createdAt: time(f, 'createdAt'),
    status: 'requested',
    direction: 'incoming'
  }
}

export function parseComment(
  value: unknown,
  sender: Sender,
  reviewId: string
): TeamReviewComment | null {
  const f = fieldsOf(value)
  if (!f || !isTeamergeId(f.id) || f.reviewId !== reviewId) {
    return null
  }
  const line = f.line
  return {
    id: f.id,
    reviewId,
    filePath: toTypeableLine(f.filePath, 1000),
    line: typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : 0,
    body: withoutControlChars(f.body, 8000).trim(),
    authorId: sender.id,
    authorName: sender.name,
    createdAt: time(f, 'createdAt'),
    delivered: false
  }
}

export function parseNote(value: unknown, sender: Sender): TeamNote | null {
  const f = fieldsOf(value)
  if (!f || !isTeamergeId(f.id)) {
    return null
  }
  return {
    id: f.id,
    title: toTypeableLine(f.title, 200) || 'Untitled',
    body: withoutControlChars(f.body),
    authorId: sender.id,
    authorName: sender.name,
    updatedAt: time(f, 'updatedAt')
  }
}

export function parseMessage(value: unknown, sender: Sender, me: string): TeamAgentMessage | null {
  const f = fieldsOf(value)
  if (!f || !isTeamergeId(f.id)) {
    return null
  }
  return {
    id: f.id,
    fromMemberId: sender.id,
    fromName: sender.name,
    fromTask: optionalLine(f, 'fromTask', 200),
    toMemberId: me,
    toTask: optionalLine(f, 'toTask', 200),
    body: withoutControlChars(f.body, 16_000),
    at: time(f, 'at')
  }
}

export function parsePresence(value: unknown, sender: Sender): TeamAgentPresence[] {
  const tasks = Array.isArray(value) ? value.slice(0, 64) : []
  return tasks.flatMap((task): TeamAgentPresence[] => {
    const f = fieldsOf(task)
    if (!f || !isSafeBranchName(f.branch)) {
      return []
    }
    const state = AGENT_STATES.find((candidate) => candidate === f.state) ?? 'idle'
    const changedFiles = Array.isArray(f.changedFiles) ? f.changedFiles : []
    return [
      {
        memberId: sender.id,
        memberName: sender.name,
        taskId: toTypeableLine(f.taskId, 200),
        taskName: toTypeableLine(f.taskName, 200),
        branch: f.branch,
        agent: toTypeableLine(f.agent, 64),
        state,
        paneId: optionalLine(f, 'paneId', 200),
        shared: f.shared === true,
        changedFiles: changedFiles
          .filter((file): file is string => typeof file === 'string')
          .slice(0, 2000),
        updatedAt: Date.now()
      }
    ]
  })
}

export function parseClaims(value: unknown, sender: Sender): FileClaim[] {
  const claims = Array.isArray(value) ? value.slice(0, 5000) : []
  return claims.flatMap((claim): FileClaim[] => {
    const f = fieldsOf(claim)
    if (!f || !isSafeBranchName(f.branch) || typeof f.path !== 'string') {
      return []
    }
    return [
      {
        path: f.path,
        taskId: toTypeableLine(f.taskId, 200),
        branch: f.branch,
        memberId: sender.id,
        memberName: sender.name,
        claimedAt: time(f, 'claimedAt'),
        note: optionalLine(f, 'note', 500) ?? undefined
      }
    ]
  })
}
