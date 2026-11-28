import React, { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Workflow } from 'lucide-react'
import { useAppStore } from '@/store'
import type { ChildTaskStatus } from '../../../../shared/teamerge/teamerge-types'
import type { TeamergeRepoTasks, TeamergeTask } from './use-teamerge-tasks'
import { asTuiAgent, createTeamergeWorkspace, slugForBranch } from './teamerge-workspaces'
import { HandoffDialog, ReviewRequestDialog, TextPromptDialog } from './team-dialogs'
import { HunkStagingDialog } from './HunkStagingDialog'
import { TaskRow, type TaskAction } from './TaskTreeRow'
import { refreshTeamergeNow } from './use-teamerge-sync'
import { EmptyState, errorMessage, GroupedList, TeamSectionHeader } from './team-ui'
import type { TeamergeMergeOutcome } from '../../../../preload/api/teamerge-api'
import { translate } from '@/i18n/i18n'

function describeOutcome(outcome: TeamergeMergeOutcome, branch: string, parent: string): string {
  if (outcome.ok) {
    return translate(
      'auto.components.teamerge.TeamTasksSection.mergedInto',
      'Merged {{branch}} into {{parent}}.',
      {
        branch,
        parent
      }
    )
  }
  if (outcome.reason === 'conflict') {
    return translate(
      'auto.components.teamerge.TeamTasksSection.wouldConflict',
      '{{branch}} would conflict in {{files}}. Update it from {{parent}} first.',
      { branch, files: outcome.conflicts.join(', '), parent }
    )
  }
  return outcome.message
}

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
        title={translate('auto.components.teamerge.TeamTasksSection.3c146f89d3', 'Task Tree')}
        subtitle={translate(
          'auto.components.teamerge.TeamTasksSection.9ae7495eb2',
          'Child tasks are real branches: they start from their parent, take its updates, and merge back into it.'
        )}
      />
      {tasks.tasks.length === 0 ? (
        <EmptyState
          icon={<Workflow />}
          title={translate('auto.components.teamerge.TeamTasksSection.c53ade5262', 'No Tasks')}
          description={translate(
            'auto.components.teamerge.TeamTasksSection.6a07e2fdb4',
            'Create a workspace from the sidebar to start a task.'
          )}
        />
      ) : (
        <GroupedList footer="Ready means the child has commits and nothing uncommitted. Merges run in the parent’s checkout, which must be clean.">
          {roots.flatMap((root) => renderTree(root, 0))}
        </GroupedList>
      )}

      <TextPromptDialog
        open={!!childOf}
        onOpenChange={(open) => !open && setChildOf(null)}
        title={translate(
          'auto.components.teamerge.TeamTasksSection.de9fa13e88',
          'New Child of “{{value0}}”',
          { value0: childOf?.taskName ?? '' }
        )}
        description={translate(
          'auto.components.teamerge.TeamTasksSection.d2bedc097b',
          'Branches from {{value0}} and merges back into it. An agent starts on the task you describe.',
          { value0: childOf?.branch ?? '' }
        )}
        label={translate(
          'auto.components.teamerge.TeamTasksSection.ff6b476f55',
          'What should the child task do?'
        )}
        confirm="Create Child Task"
        onConfirm={async (description) => {
          if (!childOf || !tasks.repo) {
            return
          }
          const name = `${slugForBranch(childOf.branch.split('/').pop() ?? 'task')}-${slugForBranch(description, 24)}`
          const worktree = await createTeamergeWorkspace({
            repoId: tasks.repo.id,
            name,
            baseBranch: childOf.branch,
            displayName: description.slice(0, 60),
            agent: asTuiAgent(childOf.agent === 'shell' ? 'claude' : childOf.agent),
            prompt: `${description}\n\nThis is a child task of “${childOf.taskName}” (branch ${childOf.branch}). Commit your work when done; it will be merged back into ${childOf.branch}.`,
            parentWorktreeId: childOf.worktreeId
          })
          toast.success(
            translate(
              'auto.components.teamerge.TeamTasksSection.1a7f34271d',
              'Created child task on {{value0}}.',
              { value0: childOf.branch }
            )
          )
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
