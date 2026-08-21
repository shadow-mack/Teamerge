import React, { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Check, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type {
  TeamReviewComment,
  TeamReviewRequest
} from '../../../../shared/teamerge/teamerge-types'
import { relativeTime, useTeamergeStore } from './teamerge-store'
import { errorMessage, MemberAvatar, StatusPill } from './team-ui'

type DiffLine = {
  kind: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
  oldLine: number | null
  newLine: number | null
}
type DiffFile = { path: string; lines: DiffLine[] }

function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let oldLine = 0
  let newLine = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      file = { path: /b\/(.+)$/.exec(raw)?.[1] ?? raw, lines: [] }
      files.push(file)
      continue
    }
    if (
      !file ||
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file')
    ) {
      continue
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      file.lines.push({ kind: 'hunk', text: raw, oldLine: null, newLine: null })
    } else if (raw.startsWith('+')) {
      file.lines.push({ kind: 'add', text: raw.slice(1), oldLine: null, newLine: newLine++ })
    } else if (raw.startsWith('-')) {
      file.lines.push({ kind: 'del', text: raw.slice(1), oldLine: oldLine++, newLine: null })
    } else if (raw.startsWith(' ')) {
      file.lines.push({ kind: 'ctx', text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ })
    }
  }
  return files
}

function CommentBubble({ comment }: { comment: TeamReviewComment }): React.JSX.Element {
  return (
    <div className="mx-3 my-1.5 flex gap-2 rounded-xl border border-border/80 bg-card px-3 py-2 font-sans shadow-[var(--shadow-card)]">
      <MemberAvatar memberId={comment.authorId} name={comment.authorName} size={22} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold">{comment.authorName}</span>
          <span className="text-muted-foreground">{relativeTime(comment.createdAt)}</span>
          {comment.delivered ? <StatusPill tone="green">Sent to agent</StatusPill> : null}
        </div>
        <p className="mt-0.5 text-[13px] leading-5 whitespace-pre-wrap">{comment.body}</p>
      </div>
    </div>
  )
}

/** Line-by-line review of a teammate's task; comments travel straight to their agent. */
export function ReviewDiffView({
  review,
  onBack
}: {
  review: TeamReviewRequest
  onBack: () => void
}): React.JSX.Element {
  const allComments = useTeamergeStore((s) => s.comments)
  const comments = useMemo(
    () => allComments.filter((c) => c.reviewId === review.id),
    [allComments, review.id]
  )
  const files = useMemo(() => parseDiff(review.diff), [review.diff])
  const [draftAt, setDraftAt] = useState<{ file: string; line: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const canComment = review.direction === 'incoming' && review.status !== 'done'

  const submit = async (): Promise<void> => {
    if (!draftAt || !draft.trim()) {
      return
    }
    setBusy(true)
    try {
      await window.api.teamerge.addReviewComment({
        reviewId: review.id,
        filePath: draftAt.file,
        line: draftAt.line,
        body: draft
      })
      setDraft('')
      setDraftAt(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Inbox
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em]">{review.title}</h1>
          <p className="text-xs text-muted-foreground">
            {review.direction === 'incoming' ? `From ${review.fromName}` : 'Your request'} ·{' '}
            <span className="font-mono">{review.branch}</span> · {files.length}{' '}
            {files.length === 1 ? 'file' : 'files'} · {comments.length}{' '}
            {comments.length === 1 ? 'comment' : 'comments'}
          </p>
        </div>
        {review.direction === 'incoming' && review.status !== 'done' ? (
          <Button
            onClick={() =>
              void window.api.teamerge.setReviewStatus({ id: review.id, status: 'done' })
            }
          >
            <Check className="size-4" />
            Finish Review
          </Button>
        ) : (
          <StatusPill tone={review.status === 'done' ? 'green' : 'blue'}>
            {review.status === 'done' ? 'Reviewed' : 'In review'}
          </StatusPill>
        )}
      </div>
      {canComment ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Click a line number to comment. Comments are typed into {review.fromName}’s agent as they
          arrive.
        </p>
      ) : null}
      <div className="space-y-4">
        {files.map((file) => (
          <section
            key={file.path}
            className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--shadow-card)]"
          >
            <div className="sticky top-0 z-10 border-b border-border/70 bg-card/95 px-3.5 py-2 font-mono text-xs font-medium backdrop-blur">
              {file.path}
            </div>
            <div className="overflow-x-auto font-mono text-[12px] leading-5">
              {file.lines.map((line, index) => {
                const lineNo = line.newLine ?? line.oldLine ?? 0
                const lineComments =
                  line.kind === 'hunk'
                    ? []
                    : comments.filter((c) => c.filePath === file.path && c.line === lineNo)
                const drafting =
                  draftAt?.file === file.path && draftAt.line === lineNo && line.kind !== 'hunk'
                return (
                  <React.Fragment key={index}>
                    {line.kind === 'hunk' ? (
                      <div className="bg-primary/6 px-3 py-0.5 text-muted-foreground">
                        {line.text}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          'group flex min-w-max',
                          line.kind === 'add' && 'bg-[var(--diff-added-background)]',
                          line.kind === 'del' && 'bg-[var(--diff-removed-background)]'
                        )}
                      >
                        <button
                          type="button"
                          disabled={!canComment}
                          aria-label={`Comment on line ${lineNo}`}
                          onClick={() => setDraftAt({ file: file.path, line: lineNo })}
                          className="relative w-12 shrink-0 pr-2 text-right text-muted-foreground/70 select-none enabled:hover:text-primary"
                        >
                          {canComment ? (
                            <MessageSquarePlus className="absolute top-1/2 left-1 size-3.5 -translate-y-1/2 text-primary opacity-0 group-hover:opacity-100" />
                          ) : null}
                          {line.oldLine ?? ''}
                        </button>
                        <span className="w-12 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">
                          {line.newLine ?? ''}
                        </span>
                        <span
                          className={cn(
                            'w-4 shrink-0 select-none',
                            line.kind === 'add'
                              ? 'text-status-success'
                              : line.kind === 'del'
                                ? 'text-destructive'
                                : 'text-muted-foreground/50'
                          )}
                        >
                          {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                        </span>
                        <span className="pr-4 whitespace-pre">{line.text}</span>
                      </div>
                    )}
                    {lineComments.map((comment) => (
                      <CommentBubble key={comment.id} comment={comment} />
                    ))}
                    {drafting ? (
                      <div className="mx-3 my-1.5 rounded-xl border border-primary/40 bg-card p-2 font-sans shadow-[var(--shadow-card)]">
                        <Textarea
                          autoFocus
                          placeholder={`Comment on ${file.path}:${lineNo}`}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              void submit()
                            }
                          }}
                          className="min-h-16 text-[13px]"
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setDraftAt(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy || !draft.trim()}
                            onClick={() => void submit()}
                          >
                            Comment
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </React.Fragment>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
