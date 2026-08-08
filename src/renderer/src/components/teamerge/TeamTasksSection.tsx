import React, { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDownToLine,
  ArrowRightLeft,
  CornerDownRight,
  FileSearch,
  GitBranchPlus,
  GitMerge,
  GitPullRequestArrow,
  Layers,
  MoreHorizontal,
  RefreshCw,
  Workflow
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import type { ChildTaskStatus } from '../../../../shared/teamerge/teamerge-types'
import type { TeamergeRepoTasks, TeamergeTask } from './use-teamerge-tasks'
import { asTuiAgent, createTeamergeWorkspace, slugForBranch } from './teamerge-workspaces'
import { HandoffDialog, ReviewRequestDialog, TextPromptDialog } from './team-dialogs'
import { HunkStagingDialog } from './HunkStagingDialog'
import { CollisionChip } from './CollisionChip'
import { refreshTeamergeNow } from './use-teamerge-sync'
import {
  agentStateLabel,
  agentStateTone,
  BranchLabel,
  EmptyState,
  errorMessage,
  GroupedList,
  StatusPill,
  TeamSectionHeader
} from './team-ui'
import type { TeamergeMergeOutcome } from '../../../../preload/api/teamerge-api'

function describeOutcome(outcome: TeamergeMergeOutcome, branch: string, parent: string): string {
  if (outcome.ok) {
    return `Merged ${branch} into ${parent}.`
  }
  if (outcome.reason === 'conflict') {
    return `${branch} would conflict in ${outcome.conflicts.join(', ')}. Update it from ${parent} first.`
  }
  return outcome.message
}

function TaskRow({
  task,
  depth,
  childStatus,
  hasChildren,
  onAction
}: {
  task: TeamergeTask
  depth: number
  childStatus?: ChildTaskStatus
  hasChildren: boolean
  onAction: (action: TaskAction, task: TeamergeTask) => void
}): React.JSX.Element {
  return (
    <div
      className="flex min-h-12 items-center gap-3 px-3.5 py-2"
      style={{ paddingLeft: 14 + depth * 22 }}
    >
      {depth > 0 ? (
        <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground/60" />
      ) : (
        <Workflow className="size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{task.taskName}</span>
          {task.agentState !== 'idle' ? (
            <StatusPill tone={agentStateTone(task.agentState)}>
              {agentStateLabel(task.agentState)}
            </StatusPill>
          ) : null}
          <CollisionChip taskId={task.taskId} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BranchLabel branch={task.branch} />
          {childStatus ? (
            <>
              <span>·</span>
              <span>
                {childStatus.ahead} ahead, {childStatus.behind} behind {childStatus.parentBranch}
              </span>
              {childStatus.dirty ? (
                <StatusPill tone="amber">Uncommitted</StatusPill>
              ) : childStatus.ready ? (
                <StatusPill tone="green">Ready</StatusPill>
              ) : null}
            </>
          ) : (
            <>
              <span>·</span>
              <span>from {task.baseRef}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {childStatus && childStatus.behind > 0 ? (
          <Button size="xs" variant="outline" onClick={() => onAction('update-from-parent', task)}>
            <RefreshCw />
            Update from Parent
          </Button>
        ) : null}
        {childStatus?.ready ? (
          <Button size="xs" onClick={() => onAction('merge-into-parent', task)}>
            <GitMerge />
            Merge into Parent
          </Button>
        ) : null}
        {hasChildren ? (
          <Button size="xs" variant="outline" onClick={() => onAction('merge-all-ready', task)}>
            <Layers />
            Merge All Ready
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${task.taskName}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onAction('new-child', task)}>
              <GitBranchPlus />
              New Child Task…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction('hunks', task)}>
              <GitPullRequestArrow />
              Stage by Hunk…
            </DropdownMenuItem>
            {!task.isMain ? (
              <>
                <DropdownMenuItem onSelect={() => onAction('land', task)}>
                  <ArrowDownToLine />
                  Ready to Land
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onAction('handoff', task)}>
                  <ArrowRightLeft />
                  Hand Off…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction('review', task)}>
                  <FileSearch />
                  Request Review…
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

type TaskAction =
  | 'new-child'
  | 'update-from-parent'
  | 'merge-into-parent'
  | 'merge-all-ready'
  | 'hunks'
  | 'land'
  | 'handoff'
  | 'review'

export function TeamTasksSection({ tasks }: { tasks: TeamergeRepoTasks }): React.JSX.Element {
  const setActiveWorktree = useAppStore((s) => s.setActiveWorktree)
  const [statusByPath, setStatusByPath] = useState<Record<string, ChildTaskStatus>>({})
  const [childOf, setChildOf] = useState<TeamergeTask | null>(null)
  const [hunksFor, setHunksFor] = useState<TeamergeTask | null>(null)
  const [handoffTask, setHandoffTask] = useState<TeamergeTask | null>(null)
  const [reviewTask, setReviewTask] = useState<TeamergeTask | null>(null)

  const children = tasks.tasks.filter((task) => task.parentBranch)
  const childKey = children.map((c) => `${c.worktreePath}:${c.parentBranch}`).join('|')
  const childrenRef = useRef(children)
  childrenRef.current = children
  const refreshStatus = useCallback(async () => {
    const entries = await Promise.all(
      childrenRef.current.map(async (child) => {
        try {
          return [
            child.worktreePath,
            await window.api.teamerge.childStatus({
              worktreePath: child.worktreePath,
              parentBranch: child.parentBranch as string
            })
          ] as const
        } catch {
          return null
        }
      })
    )
    setStatusByPath(
      Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => e !== null))
    )
  }, [])

  useEffect(() => {
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 10_000)
    return () => window.clearInterval(timer)
  }, [refreshStatus, childKey])

  const run = async (fn: () => Promise<string>): Promise<void> => {
    try {
      toast(await fn())
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      await refreshStatus()
      void refreshTeamergeNow(tasks)
    }
  }

  const onAction = (action: TaskAction, task: TeamergeTask): void => {
    const parent = task.parentBranch as string
    switch (action) {
      case 'new-child':
        setChildOf(task)
        return
      case 'hunks':
        setHunksFor(task)
        return
      case 'handoff':
        setHandoffTask(task)
        return
      case 'review':
        setReviewTask(task)
        return
      case 'update-from-parent':
        void run(async () => {
          const result = await window.api.teamerge.updateFromParent({
            worktreePath: task.worktreePath,
            parentBranch: parent
          })
          if (!result.ok) {
            throw new Error(result.message)
          }
          return result.updated
            ? `Brought ${parent} into ${task.branch}.`
            : `${task.branch} is already up to date.`
        })
        return
      case 'merge-into-parent':
        void run(async () => {
          const outcome = await window.api.teamerge.mergeIntoParent({
            worktreePath: task.worktreePath,
            parentBranch: parent
          })
          if (!outcome.ok) {
            throw new Error(describeOutcome(outcome, task.branch, parent))
          }
          return describeOutcome(outcome, task.branch, parent)
        })
        return
      case 'merge-all-ready':
        void run(async () => {
          const kids = tasks.tasks.filter((t) => t.parentWorktreeId === task.worktreeId)
          const results = await window.api.teamerge.mergeAllReady({
            worktreePaths: kids.map((k) => k.worktreePath),
            parentBranch: task.branch
          })
          if (results.length === 0) {
            return 'No child task is ready yet. A child is ready when it has commits and no uncommitted changes.'
          }
          const merged = results.filter((r) => r.outcome.ok).length
          const failed = results.filter((r) => !r.outcome.ok)
          if (failed.length) {
            toast.error(
              failed.map((f) => describeOutcome(f.outcome, f.branch, task.branch)).join('\n')
            )
          }
          return `Merged ${merged} of ${results.length} ready child ${results.length === 1 ? 'task' : 'tasks'} into ${task.branch}.`
        })
        return
      case 'land':
        void run(async () => {
          await window.api.teamerge.enqueueLanding({
            repoPath: tasks.repoPath as string,
            worktreePath: task.worktreePath,
            taskName: task.taskName,
            targetBranch: task.parentBranch ?? tasks.mainBranch
          })
          return `Queued ${task.taskName} to land on ${task.parentBranch ?? tasks.mainBranch}.`
        })
        break
      default:
    }
  }

  const roots = tasks.tasks.filter(
    (task) =>
      !task.parentWorktreeId || !tasks.tasks.some((t) => t.worktreeId === task.parentWorktreeId)
  )
  const renderTree = (task: TeamergeTask, depth: number): React.ReactNode[] => {
    const kids = tasks.tasks.filter((t) => t.parentWorktreeId === task.worktreeId)
    return [
      <TaskRow
        key={task.taskId}
        task={task}
        depth={depth}
        hasChildren={kids.length > 0}
        childStatus={statusByPath[task.worktreePath]}
        onAction={onAction}
      />,
      ...kids.flatMap((kid) => renderTree(kid, depth + 1))
    ]
  }

  return (
    <div>
      <TeamSectionHeader
        title="Task Tree"
        subtitle="Child tasks are real branches: they start from their parent, take its updates, and merge back into it."
      />
      {tasks.tasks.length === 0 ? (
        <EmptyState
          icon={<Workflow />}
          title="No Tasks"
          description="Create a workspace from the sidebar to start a task."
        />
      ) : (
        <GroupedList footer="Ready means the child has commits and nothing uncommitted. Merges run in the parent’s checkout, which must be clean.">
          {roots.flatMap((root) => renderTree(root, 0))}
        </GroupedList>
      )}

      <TextPromptDialog
        open={!!childOf}
        onOpenChange={(open) => !open && setChildOf(null)}
        title={`New Child of “${childOf?.taskName ?? ''}”`}
        description={`Branches from ${childOf?.branch ?? ''} and merges back into it. An agent starts on the task you describe.`}
        label="What should the child task do?"
        confirm="Create Child Task"
        onConfirm={async (description) => {
          if (!childOf || !tasks.repo) {
            return
          }
          const name = `${slugForBranch(childOf.branch.split('/').pop() ?? 'task')}-${slugForBranch(description).slice(0, 24)}`
          const worktree = await createTeamergeWorkspace({
            repoId: tasks.repo.id,
            name,
            baseBranch: childOf.branch,
            displayName: description.slice(0, 60),
            agent: asTuiAgent(childOf.agent === 'shell' ? 'claude' : childOf.agent),
            prompt: `${description}\n\nThis is a child task of “${childOf.taskName}” (branch ${childOf.branch}). Commit your work when done; it will be merged back into ${childOf.branch}.`,
            parentWorktreeId: childOf.worktreeId
          })
          toast.success(`Created child task on ${childOf.branch}.`)
          setActiveWorktree(worktree.id, worktree.hostId)
        }}
      />
      <HunkStagingDialog
        worktreePath={hunksFor?.worktreePath ?? null}
        title={hunksFor?.taskName ?? ''}
        open={!!hunksFor}
        onOpenChange={(open) => !open && setHunksFor(null)}
      />
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
