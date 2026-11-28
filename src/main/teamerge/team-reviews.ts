import { randomUUID } from 'node:crypto'
import type { TeamReviewComment, TeamReviewRequest } from '../../shared/teamerge/teamerge-types'
import { git } from './core/git-runner'
import type { TeamPayload } from './core/relay-client'
import { toTypeableLine } from './core/teammate-input'
import { fieldsOf, isReviewStatus, parseComment, parseReview } from './core/teammate-payloads'
import type { TeamContext } from './team-data'

const MAX_REVIEW_DIFF_BYTES = 2 * 1024 * 1024

/** Review requests whose line comments are typed straight into the requester's agent. */
export class TeamReviews {
  constructor(private readonly ctx: TeamContext) {}

  emit(): void {
    const data = this.ctx.data()
    this.ctx.emit({ type: 'reviews', reviews: data.reviews, comments: data.comments })
  }

  async request(input: {
    toMemberId: string
    title: string
    worktreePath: string
    baseRef: string
    paneId: string | null
  }): Promise<TeamReviewRequest> {
    this.ctx.teamRepoPath()
    const identity = this.ctx.identity()
    const run = this.ctx.run
    const branch = (
      await git(run, input.worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    ).trim()
    const mergeBase = (
      await git(run, input.worktreePath, ['merge-base', input.baseRef, 'HEAD'])
    ).trim()
    const diff = await git(run, input.worktreePath, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      mergeBase
    ])
    if (!diff.trim()) {
      throw new Error('This task has no changes to review yet.')
    }
    if (diff.length > MAX_REVIEW_DIFF_BYTES) {
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
    this.ctx.send(input.toMemberId, {
      kind: 'review',
      review: { ...review, direction: 'incoming' }
    })
    const data = this.ctx.data()
    data.reviews = [review, ...data.reviews]
    await this.ctx.save()
    this.ctx.log(
      'review',
      `Asked ${this.ctx.memberName(input.toMemberId)} to review “${review.title}”.`
    )
    this.emit()
    return review
  }

  async addComment(input: {
    reviewId: string
    filePath: string
    line: number
    body: string
  }): Promise<TeamReviewComment> {
    const identity = this.ctx.identity()
    const data = this.ctx.data()
    const review = data.reviews.find((entry) => entry.id === input.reviewId)
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
    data.comments.push(comment)
    if (review.status === 'requested') {
      review.status = 'in-review'
    }
    this.ctx.send(review.fromMemberId, { kind: 'review-comment', comment })
    await this.ctx.save()
    this.emit()
    return comment
  }

  async setStatus(reviewId: string, status: TeamReviewRequest['status']): Promise<void> {
    const review = this.ctx.data().reviews.find((entry) => entry.id === reviewId)
    if (!review) {
      return
    }
    review.status = status
    const other = review.direction === 'incoming' ? review.fromMemberId : review.toMemberId
    this.ctx.send(other, { kind: 'review-status', id: reviewId, status })
    await this.ctx.save()
    this.emit()
  }

  /** Types a review comment into the task's agent pane so the agent acts on it. */
  private deliverToAgent(review: TeamReviewRequest, comment: TeamReviewComment): boolean {
    if (!review.paneId) {
      return false
    }
    const line = toTypeableLine(
      `Review comment from ${comment.authorName} on ${comment.filePath}:${comment.line} — ${comment.body}`
    )
    return this.ctx.writePty(review.paneId, `${line}\r`)
  }

  async redeliver(commentId: string, paneId: string): Promise<boolean> {
    const data = this.ctx.data()
    const comment = data.comments.find((entry) => entry.id === commentId)
    const review = comment && data.reviews.find((entry) => entry.id === comment.reviewId)
    if (!comment || !review) {
      return false
    }
    review.paneId = paneId
    comment.delivered = this.deliverToAgent(review, comment)
    await this.ctx.save()
    this.emit()
    return comment.delivered
  }

  async onReview(senderId: string, senderName: string, payload: TeamPayload): Promise<void> {
    const me = this.ctx.memberId()
    const review = me ? parseReview(payload.review, { id: senderId, name: senderName }, me) : null
    const data = this.ctx.data()
    if (!review || data.reviews.some((entry) => entry.id === review.id)) {
      return
    }
    data.reviews = [review, ...data.reviews]
    await this.ctx.save()
    this.ctx.log('review', `${senderName} asked you to review “${review.title}”.`)
    this.emit()
  }

  async onComment(senderId: string, senderName: string, payload: TeamPayload): Promise<void> {
    const data = this.ctx.data()
    const review = data.reviews.find(
      (entry) =>
        entry.direction === 'outgoing' &&
        entry.toMemberId === senderId &&
        entry.id === fieldsOf(payload.comment)?.reviewId
    )
    const comment = review
      ? parseComment(payload.comment, { id: senderId, name: senderName }, review.id)
      : null
    if (!review || !comment || data.comments.some((entry) => entry.id === comment.id)) {
      return
    }
    comment.delivered = this.deliverToAgent(review, comment)
    data.comments.push(comment)
    review.status = review.status === 'requested' ? 'in-review' : review.status
    await this.ctx.save()
    this.ctx.log(
      'comment',
      `${senderName} commented on ${comment.filePath}:${comment.line}${comment.delivered ? ' — sent to your agent' : ''}.`
    )
    this.emit()
  }

  async onStatus(senderId: string, payload: TeamPayload): Promise<void> {
    const review = this.ctx.data().reviews.find((entry) => entry.id === payload.id)
    const status = payload.status
    if (
      !review ||
      !isReviewStatus(status) ||
      (review.fromMemberId !== senderId && review.toMemberId !== senderId)
    ) {
      return
    }
    review.status = status
    await this.ctx.save()
    this.emit()
  }
}
