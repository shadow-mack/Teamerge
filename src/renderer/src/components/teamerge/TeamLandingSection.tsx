import React, { useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDownToLine,
  CheckCircle2,
  CircleDashed,
  Loader2,
  RotateCcw,
  SkipForward,
  X,
  XCircle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { LandingItem } from '../../../../shared/teamerge/teamerge-types'
import { relativeTime, useTeamergeStore } from './teamerge-store'
import type { TeamergeRepoTasks } from './use-teamerge-tasks'
import {
  BranchLabel,
  EmptyState,
  errorMessage,
  GroupedList,
  GroupedRow,
  StatusPill,
  TeamSectionHeader,
  type PillTone
} from './team-ui'

const STATUS: Record<
  LandingItem['status'],
  { label: string; tone: PillTone; icon: React.ReactNode }
> = {
  queued: {
    label: 'Queued',
    tone: 'neutral',
    icon: <CircleDashed className="size-4 text-muted-foreground" />
  },
  landing: {
    label: 'Landing',
    tone: 'blue',
    icon: <Loader2 className="size-4 animate-spin text-primary motion-reduce:animate-none" />
  },
  landed: {
    label: 'Landed',
    tone: 'green',
    icon: <CheckCircle2 className="size-4 text-status-success" />
  },
  skipped: {
    label: 'Skipped',
    tone: 'amber',
    icon: <SkipForward className="size-4 text-collision-overlap" />
  },
  failed: {
    label: 'Failed',
    tone: 'red',
    icon: <XCircle className="size-4 text-collision-conflict" />
  },
  undone: {
    label: 'Undone',
    tone: 'neutral',
    icon: <RotateCcw className="size-4 text-muted-foreground" />
  }
}

export function TeamLandingSection({ tasks }: { tasks: TeamergeRepoTasks }): React.JSX.Element {
  const landing = useTeamergeStore((s) => s.landing)
  const [running, setRunning] = useState(false)
  const repoPath = tasks.repoPath
  const items = landing?.items ?? []
  const pending = items.filter((i) => i.status === 'queued' || i.status === 'skipped').length
  const lastLandedByTarget = new Map<string, string>()
  for (const item of [...items].sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (item.status === 'landed') {
      lastLandedByTarget.set(item.targetBranch, item.id)
    }
  }
  const candidates = tasks.tasks.filter(
    (t) =>
      !t.isMain &&
      !items.some((i) => i.branch === t.branch && (i.status === 'queued' || i.status === 'landing'))
  )

  const landAll = async (): Promise<void> => {
    if (!repoPath) {
      return
    }
    setRunning(true)
    try {
      const queue = await window.api.teamerge.landAll(repoPath)
      const landed = queue.items.filter((i) => i.status === 'landed').length
      const skipped = queue.items.filter((i) => i.status === 'skipped').length
      toast(
        skipped
          ? `Landed ${landed}, skipped ${skipped}. Skipped tasks say why.`
          : `Landed ${landed} ${landed === 1 ? 'task' : 'tasks'}.`
      )
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <TeamSectionHeader
        title="Landing Queue"
        subtitle="Finished tasks land one after another. A task that would conflict is skipped with the reason, and the rest keep going. Local merges can be undone."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={candidates.length === 0}>
                  Ready to Land…
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {candidates.map((task) => (
                  <DropdownMenuItem
                    key={task.taskId}
                    onSelect={() =>
                      void window.api.teamerge
                        .enqueueLanding({
                          repoPath: repoPath as string,
                          worktreePath: task.worktreePath,
                          taskName: task.taskName,
                          targetBranch: task.parentBranch ?? tasks.mainBranch
                        })
                        .catch((error) => toast.error(errorMessage(error)))
                    }
                  >
                    <span className="truncate">{task.taskName}</span>
                    <span className="ml-auto pl-3 font-mono text-2xs text-muted-foreground">
                      → {task.parentBranch ?? tasks.mainBranch}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" disabled={running || pending === 0} onClick={() => void landAll()}>
              {running ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <ArrowDownToLine className="size-4" />
              )}
              {running ? 'Landing…' : `Land All${pending ? ` (${pending})` : ''}`}
            </Button>
          </>
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<ArrowDownToLine />}
          title="Nothing Queued"
          description="Mark finished tasks Ready to Land, then land them all in one go."
        />
      ) : (
        <GroupedList
          trailing={
            items.some(
              (i) => i.status === 'landed' || i.status === 'undone' || i.status === 'failed'
            ) && repoPath ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void window.api.teamerge.clearLanding(repoPath)}
              >
                Clear Finished
              </Button>
            ) : null
          }
          title="Queue"
        >
          {items.map((item) => {
            const meta = STATUS[item.status]
            const canUndo =
              item.status === 'landed' && lastLandedByTarget.get(item.targetBranch) === item.id
            return (
              <GroupedRow
                key={item.id}
                leading={meta.icon}
                title={<span className="font-medium">{item.taskName}</span>}
                subtitle={
                  <span className="block truncate">
                    <BranchLabel branch={item.branch} /> →{' '}
                    <BranchLabel branch={item.targetBranch} /> · {relativeTime(item.updatedAt)}
                    {item.reason ? (
                      <span className="text-foreground/75"> · {item.reason}</span>
                    ) : null}
                  </span>
                }
                trailing={
                  <>
                    <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                    {canUndo ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          void window.api.teamerge
                            .undoLanding({ repoPath: repoPath as string, id: item.id })
                            .then(() => toast(`Undid the landing of ${item.taskName}.`))
                            .catch((error) => toast.error(errorMessage(error)))
                        }
                      >
                        <RotateCcw />
                        Undo
                      </Button>
                    ) : null}
                    {item.status === 'queued' || item.status === 'skipped' ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${item.taskName} from the queue`}
                        onClick={() =>
                          void window.api.teamerge.removeLanding({
                            repoPath: repoPath as string,
                            id: item.id
                          })
                        }
                      >
                        <X />
                      </Button>
                    ) : null}
                  </>
                }
              />
            )
          })}
        </GroupedList>
      )}
    </div>
  )
}
