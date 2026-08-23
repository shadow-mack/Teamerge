import React from 'react'
import { Users } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { useTeamergeStore } from './teamerge-store'
import { MemberAvatar } from './team-ui'

/** Sidebar entry for the Team hub: who's online, plus a count of things waiting on you. */
export function SidebarTeamButton(): React.JSX.Element {
  const openTeamPage = useAppStore((s) => s.openTeamPage)
  const active = useAppStore((s) => s.activeView === 'team')
  const status = useTeamergeStore((s) => s.status)
  const handoffs = useTeamergeStore((s) => s.handoffs)
  const reviews = useTeamergeStore((s) => s.reviews)
  const shares = useTeamergeStore((s) => s.shares)
  const online = (status?.team?.members ?? []).filter((m) => status?.onlineMemberIds.includes(m.id))
  const waiting =
    handoffs.filter((h) => h.direction === 'incoming' && h.status === 'sent').length +
    reviews.filter((r) => r.direction === 'incoming' && r.status === 'requested').length +
    Object.values(shares).reduce((sum, share) => sum + share.pending.length, 0)

  return (
    <button
      type="button"
      onClick={openTeamPage}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        active
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <Users
        className={cn(
          'size-4 shrink-0',
          active ? 'text-primary' : 'text-worktree-sidebar-foreground/30'
        )}
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1">Team</span>
      {online.length ? (
        <span className="flex -space-x-1" aria-label={`${online.length} online`}>
          {online.slice(0, 3).map((member) => (
            <MemberAvatar key={member.id} memberId={member.id} name={member.name} size={16} />
          ))}
        </span>
      ) : null}
      {waiting ? (
        <span className="min-w-4 rounded-full bg-primary px-1.5 text-center text-[10px] leading-4 font-semibold text-primary-foreground">
          {waiting}
        </span>
      ) : null}
    </button>
  )
}
