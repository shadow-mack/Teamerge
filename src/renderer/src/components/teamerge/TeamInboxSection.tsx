import React, { useState } from 'react'
import { toast } from 'sonner'
import { ArrowRightLeft, Eye, FileSearch, Inbox, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import type { TeamHandoff } from '../../../../shared/teamerge/teamerge-types'
import { relativeTime, useTeamergeStore } from './teamerge-store'
import type { TeamergeRepoTasks, TeamergeTask } from './use-teamerge-tasks'
import { asTuiAgent, createTeamergeWorkspace } from './teamerge-workspaces'
import { HandoffDialog, ReviewRequestDialog } from './team-dialogs'
import { ReviewDiffView } from './ReviewDiffView'
import {
  BranchLabel,
  EmptyState,
  errorMessage,
  GroupedList,
  GroupedRow,
  MemberAvatar,
  StatusPill,
  TeamSectionHeader
} from './team-ui'
import { translate } from '@/i18n/i18n'

function TaskMenu({
  label,
  icon,
  tasks,
  onPick
}: {
  label: string
  icon: React.ReactNode
  tasks: TeamergeTask[]
  onPick: (task: TeamergeTask) => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={tasks.length === 0}>
          {icon}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {tasks.map((task) => (
          <DropdownMenuItem key={task.taskId} onSelect={() => onPick(task)}>
            <span className="truncate">{task.taskName}</span>
            <span className="ml-auto pl-3 font-mono text-2xs text-muted-foreground">
              {task.branch}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TeamInboxSection({ tasks }: { tasks: TeamergeRepoTasks }): React.JSX.Element {
  const handoffs = useTeamergeStore((s) => s.handoffs)
  const reviews = useTeamergeStore((s) => s.reviews)
  const comments = useTeamergeStore((s) => s.comments)
  const openReviewId = useTeamergeStore((s) => s.openReviewId)
  const setOpenReviewId = useTeamergeStore((s) => s.setOpenReviewId)
  const setActiveWorktree = useAppStore((s) => s.setActiveWorktree)
  const closeTeamPage = useAppStore((s) => s.closeTeamPage)
  const [handoffTask, setHandoffTask] = useState<TeamergeTask | null>(null)
  const [reviewTask, setReviewTask] = useState<TeamergeTask | null>(null)
  const [taking, setTaking] = useState<string | null>(null)
  const workTasks = tasks.tasks.filter((task) => !task.isMain)

  const openReview = reviews.find((review) => review.id === openReviewId)
  if (openReview) {
    return <ReviewDiffView review={openReview} onBack={() => setOpenReviewId(null)} />
  }

  const take = async (handoff: TeamHandoff): Promise<void> => {
    if (!tasks.repo) {
      return
    }
    setTaking(handoff.id)
    try {
      const { branch } = await window.api.teamerge.prepareHandoffBranch(handoff.id)
      const prompt = `${handoff.fromName} handed this task to you.\n\n${handoff.brief}`
      const worktree = await createTeamergeWorkspace({
        repoId: tasks.repo.id,
        name: branch.replace(/\//g, '-'),
        displayName: handoff.title,
        existingBranch: branch,
        agent: asTuiAgent(handoff.agent),
        prompt
      })
      await window.api.teamerge.setHandoffStatus({ id: handoff.id, status: 'taken' })
      toast.success(
        translate(
          'auto.components.teamerge.TeamInboxSection.013ac7d750',
          'Took “{{value0}}”. The agent is picking it up.',
          { value0: handoff.title }
        )
      )
      closeTeamPage()
      setActiveWorktree(worktree.id, worktree.hostId)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setTaking(null)
    }
  }

  const incomingHandoffs = handoffs.filter((h) => h.direction === 'incoming')
  const outgoingHandoffs = handoffs.filter((h) => h.direction === 'outgoing')
  const incomingReviews = reviews.filter((r) => r.direction === 'incoming')
  const outgoingReviews = reviews.filter((r) => r.direction === 'outgoing')
  const empty = handoffs.length === 0 && reviews.length === 0

  return (
    <div>
      <TeamSectionHeader
        title={translate('auto.components.teamerge.TeamInboxSection.56d7325dcd', 'Inbox')}
        subtitle={translate(
          'auto.components.teamerge.TeamInboxSection.360e785e9c',
          'Hand work to a teammate with a brief, or ask for a review whose line comments go straight to your agent.'
        )}
        actions={
          <>
            <TaskMenu
              label={translate(
                'auto.components.teamerge.TeamInboxSection.7a0978bc64',
                'Request Review'
              )}
              icon={<FileSearch className="size-4" />}
              tasks={workTasks}
              onPick={setReviewTask}
            />
            <TaskMenu
              label={translate('auto.components.teamerge.TeamInboxSection.b5f2202123', 'Hand Off')}
              icon={<ArrowRightLeft className="size-4" />}
              tasks={workTasks}
              onPick={setHandoffTask}
            />
          </>
        }
      />
      {empty ? (
        <EmptyState
          icon={<Inbox />}
          title={translate(
            'auto.components.teamerge.TeamInboxSection.36765cdef1',
            'Nothing Waiting'
          )}
          description={translate(
            'auto.components.teamerge.TeamInboxSection.d34c7467ee',
            'Handoffs and review requests from teammates show up here.'
          )}
        />
      ) : null}

      {incomingHandoffs.length ? (
        <GroupedList
          title={translate('auto.components.teamerge.TeamInboxSection.8b921de47e', 'Handed to You')}
        >
          {incomingHandoffs.map((handoff) => (
            <div key={handoff.id}>
              <GroupedRow
                leading={<MemberAvatar memberId={handoff.fromMemberId} name={handoff.fromName} />}
                title={
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{handoff.title}</span>
                    {handoff.status !== 'sent' ? (
                      <StatusPill tone={handoff.status === 'taken' ? 'green' : 'neutral'}>
                        {handoff.status === 'taken'
                          ? translate(
                              'auto.components.teamerge.TeamInboxSection.0fb4c61b50',
                              'Taken'
                            )
                          : translate(
                              'auto.components.teamerge.TeamInboxSection.d554203dcb',
                              'Declined'
                            )}
                      </StatusPill>
                    ) : null}
                  </span>
                }
                subtitle={
                  <>
                    {handoff.fromName} · <BranchLabel branch={handoff.branch} /> ·{' '}
                    {relativeTime(handoff.createdAt)}
                  </>
                }
                trailing={
                  handoff.status === 'sent' ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void window.api.teamerge.setHandoffStatus({
                            id: handoff.id,
                            status: 'declined'
                          })
                        }
                      >
                        {translate(
                          'auto.components.teamerge.TeamInboxSection.03c9847c91',
                          'Decline'
                        )}
                      </Button>
                      <Button
                        size="sm"
                        disabled={taking === handoff.id}
                        onClick={() => void take(handoff)}
                      >
                        {taking === handoff.id
                          ? translate(
                              'auto.components.teamerge.TeamInboxSection.a6847544e0',
                              'Taking…'
                            )
                          : translate(
                              'auto.components.teamerge.TeamInboxSection.1af12c8b6a',
                              'Take'
                            )}
                      </Button>
                    </>
                  ) : null
                }
              />
              {handoff.status === 'sent' ? (
                <pre className="mx-3.5 mb-3 max-h-40 overflow-auto scrollbar-sleek rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground/85">
                  {handoff.brief}
                </pre>
              ) : null}
            </div>
          ))}
        </GroupedList>
      ) : null}

      {incomingReviews.length ? (
        <GroupedList
          title={translate(
            'auto.components.teamerge.TeamInboxSection.49397fba9d',
            'Reviews for You'
          )}
        >
          {incomingReviews.map((review) => (
            <GroupedRow
              key={review.id}
              onClick={() => setOpenReviewId(review.id)}
              leading={<MemberAvatar memberId={review.fromMemberId} name={review.fromName} />}
              title={<span className="font-medium">{review.title}</span>}
              subtitle={
                <>
                  {review.fromName} · <BranchLabel branch={review.branch} /> ·{' '}
                  {relativeTime(review.createdAt)}
                </>
              }
              trailing={
                <>
                  <StatusPill
                    tone={
                      review.status === 'done'
                        ? 'green'
                        : review.status === 'in-review'
                          ? 'blue'
                          : 'amber'
                    }
                  >
                    {review.status === 'done'
                      ? translate(
                          'auto.components.teamerge.TeamInboxSection.c270cea026',
                          'Reviewed'
                        )
                      : review.status === 'in-review'
                        ? translate(
                            'auto.components.teamerge.TeamInboxSection.7cb322331d',
                            'In review'
                          )
                        : translate('auto.components.teamerge.TeamInboxSection.d2aa8a4784', 'New')}
                  </StatusPill>
                  <Eye className="size-4 text-muted-foreground" />
                </>
              }
            />
          ))}
        </GroupedList>
      ) : null}

      {outgoingHandoffs.length || outgoingReviews.length ? (
        <GroupedList
          title={translate('auto.components.teamerge.TeamInboxSection.f4225bb43a', 'Sent')}
        >
          {outgoingHandoffs.map((handoff) => (
            <GroupedRow
              key={handoff.id}
              leading={<Send className="size-4 text-muted-foreground" />}
              title={translate(
                'auto.components.teamerge.TeamInboxSection.0cd679c150',
                'Handed off “{{value0}}”',
                { value0: handoff.title }
              )}
              subtitle={relativeTime(handoff.createdAt)}
              trailing={
                <StatusPill
                  tone={
                    handoff.status === 'taken'
                      ? 'green'
                      : handoff.status === 'declined'
                        ? 'red'
                        : 'neutral'
                  }
                >
                  {handoff.status === 'sent'
                    ? translate('auto.components.teamerge.TeamInboxSection.df3cac26f2', 'Waiting')
                    : handoff.status === 'taken'
                      ? translate('auto.components.teamerge.TeamInboxSection.0fb4c61b50', 'Taken')
                      : translate(
                          'auto.components.teamerge.TeamInboxSection.d554203dcb',
                          'Declined'
                        )}
                </StatusPill>
              }
            />
          ))}
          {outgoingReviews.map((review) => {
            const count = comments.filter((c) => c.reviewId === review.id).length
            return (
              <GroupedRow
                key={review.id}
                onClick={() => setOpenReviewId(review.id)}
                leading={<FileSearch className="size-4 text-muted-foreground" />}
                title={translate(
                  'auto.components.teamerge.TeamInboxSection.00c04103fc',
                  'Review of “{{value0}}”',
                  { value0: review.title }
                )}
                subtitle={`${count} ${count === 1 ? 'comment' : 'comments'} · ${relativeTime(review.createdAt)}`}
                trailing={
                  <StatusPill tone={review.status === 'done' ? 'green' : 'blue'}>
                    {review.status === 'done'
                      ? translate(
                          'auto.components.teamerge.TeamInboxSection.c270cea026',
                          'Reviewed'
                        )
                      : translate(
                          'auto.components.teamerge.TeamInboxSection.df3cac26f2',
                          'Waiting'
                        )}
                  </StatusPill>
                }
              />
            )
          })}
        </GroupedList>
      ) : null}

      <HandoffDialog
        task={handoffTask}
        open={!!handoffTask}
        onOpenChange={(open) => !open && setHandoffTask(null)}
      />
      <ReviewRequestDialog
        task={reviewTask}
        open={!!reviewTask}
        onOpenChange={(open) => !open && setReviewTask(null)}
      />
    </div>
  )
}
