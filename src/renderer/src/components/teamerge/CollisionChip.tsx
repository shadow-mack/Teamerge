import React from 'react'
import { AlertTriangle, GitCompareArrows } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTeamergeStore } from './teamerge-store'
import { openTeamSection } from './use-teamerge-sync'

/** Shows when another task touches this task's files; red when merging them would conflict. */
export function CollisionChip({
  taskId,
  className
}: {
  taskId: string
  className?: string
}): React.JSX.Element | null {
  const summary = useTeamergeStore((s) => s.collisionsByTask[taskId])
  if (!summary || summary.overlapping === 0) {
    return null
  }
  const conflict = summary.conflicting > 0
  const others = new Set(
    summary.collisions.flatMap((c) =>
      c.tasks
        .filter((t) => t.taskId !== taskId)
        .map((t) => (t.local ? t.taskName : `${t.memberName}/${t.taskName}`))
    )
  )
  const label = conflict
    ? `${summary.conflicting} conflict${summary.conflicting === 1 ? '' : 's'}`
    : `${summary.overlapping} shared`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            openTeamSection('collisions')
          }}
          className={cn(
            'inline-flex h-4.5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold leading-none',
            conflict
              ? 'bg-collision-conflict/15 text-collision-conflict'
              : 'bg-collision-overlap/15 text-[color-mix(in_srgb,var(--collision-overlap)_80%,var(--foreground))]',
            className
          )}
          aria-label={`${label} with ${[...others].join(', ')}`}
        >
          {conflict ? (
            <AlertTriangle className="size-2.5" />
          ) : (
            <GitCompareArrows className="size-2.5" />
          )}
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {conflict ? 'Would conflict with ' : 'Also changed by '}
        {[...others].slice(0, 3).join(', ')}
        {others.size > 3 ? ` and ${others.size - 3} more` : ''}
      </TooltipContent>
    </Tooltip>
  )
}
