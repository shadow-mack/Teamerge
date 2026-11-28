import React from 'react'
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
import { translate } from '@/i18n/i18n'
import type { ChildTaskStatus } from '../../../../shared/teamerge/teamerge-types'
import type { TeamergeTask } from './use-teamerge-tasks'
import { CollisionChip } from './CollisionChip'
import { agentStateLabel, agentStateTone, BranchLabel, StatusPill } from './team-ui'
import { shortRefName } from '@/lib/git-utils'

/** One task in the task tree, with its child-task status and actions. */
export function TaskRow({
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
                {childStatus.ahead}{' '}
                {translate('auto.components.teamerge.TeamTasksSection.d47d70239a', 'ahead,')}{' '}
                {childStatus.behind}{' '}
                {translate('auto.components.teamerge.TeamTasksSection.812b7c0b12', 'behind')}{' '}
                {childStatus.parentBranch}
              </span>
              {childStatus.dirty ? (
                <StatusPill tone="amber">
                  {translate('auto.components.teamerge.TeamTasksSection.f69b0c71be', 'Uncommitted')}
                </StatusPill>
              ) : childStatus.ready ? (
                <StatusPill tone="green">
                  {translate('auto.components.teamerge.TeamTasksSection.71278748cc', 'Ready')}
                </StatusPill>
              ) : null}
            </>
          ) : (
            <>
              <span>·</span>
              <span>
                {translate('auto.components.teamerge.TeamTasksSection.4c41ca6fa6', 'from')}{' '}
                {shortRefName(task.baseRef)}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {childStatus && childStatus.behind > 0 ? (
          <Button size="xs" variant="outline" onClick={() => onAction('update-from-parent', task)}>
            <RefreshCw />
            {translate(
              'auto.components.teamerge.TeamTasksSection.a723433cff',
              'Update from Parent'
            )}
          </Button>
        ) : null}
        {childStatus?.ready ? (
          <Button size="xs" onClick={() => onAction('merge-into-parent', task)}>
            <GitMerge />
            {translate('auto.components.teamerge.TeamTasksSection.c281475c56', 'Merge into Parent')}
          </Button>
        ) : null}
        {hasChildren ? (
          <Button size="xs" variant="outline" onClick={() => onAction('merge-all-ready', task)}>
            <Layers />
            {translate('auto.components.teamerge.TeamTasksSection.1a89fc4eb2', 'Merge All Ready')}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={translate(
                'auto.components.teamerge.TeamTasksSection.8371b1520a',
                'Actions for {{value0}}',
                { value0: task.taskName }
              )}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onAction('new-child', task)}>
              <GitBranchPlus />
              {translate('auto.components.teamerge.TeamTasksSection.c0213f4508', 'New Child Task…')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction('hunks', task)}>
              <GitPullRequestArrow />
              {translate('auto.components.teamerge.TeamTasksSection.58befee728', 'Stage by Hunk…')}
            </DropdownMenuItem>
            {!task.isMain ? (
              <>
                <DropdownMenuItem onSelect={() => onAction('land', task)}>
                  <ArrowDownToLine />
                  {translate(
                    'auto.components.teamerge.TeamTasksSection.9a27711b63',
                    'Ready to Land'
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onAction('handoff', task)}>
                  <ArrowRightLeft />
                  {translate('auto.components.teamerge.TeamTasksSection.9b17150469', 'Hand Off…')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction('review', task)}>
                  <FileSearch />
                  {translate(
                    'auto.components.teamerge.TeamTasksSection.ff18563f40',
                    'Request Review…'
                  )}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export type TaskAction =
  | 'new-child'
  | 'update-from-parent'
  | 'merge-into-parent'
  | 'merge-all-ready'
  | 'hunks'
  | 'land'
  | 'handoff'
  | 'review'
