import React, { useEffect } from 'react'
import {
  ArrowDownToLine,
  Flag,
  GitMerge,
  Inbox,
  MessagesSquare,
  NotebookPen,
  Settings2,
  Swords,
  Users,
  Workflow,
  X
} from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useTeamergeStore, type TeamSection } from './teamerge-store'
import { useTeamergeTasks } from './use-teamerge-tasks'
import { TeamOnboarding } from './TeamOnboarding'
import { TeamPeopleSection } from './TeamPeopleSection'
import { TeamInboxSection } from './TeamInboxSection'
import { TeamNotesSection } from './TeamNotesSection'
import { TeamMessagesSection } from './TeamMessagesSection'
import { TeamTasksSection } from './TeamTasksSection'
import { TeamCollisionsSection } from './TeamCollisionsSection'
import { TeamLandingSection } from './TeamLandingSection'
import { TeamRacesSection } from './TeamRacesSection'
import { TeamSettingsSection } from './TeamSettingsSection'
import { RemotePaneViewer } from './RemotePaneViewer'

type NavItem = { id: TeamSection; label: string; icon: React.ComponentType<{ className?: string }> }

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Team',
    items: [
      { id: 'people', label: 'People', icon: Users },
      { id: 'inbox', label: 'Inbox', icon: Inbox },
      { id: 'messages', label: 'Agent Messages', icon: MessagesSquare },
      { id: 'notes', label: 'Notes', icon: NotebookPen }
    ]
  },
  {
    label: 'Work',
    items: [
      { id: 'tasks', label: 'Task Tree', icon: Workflow },
      { id: 'collisions', label: 'Collisions', icon: Flag },
      { id: 'landing', label: 'Landing Queue', icon: ArrowDownToLine },
      { id: 'races', label: 'Races', icon: Swords }
    ]
  }
]

function useBadges(): Partial<Record<TeamSection, { count: number; tone: 'red' | 'blue' }>> {
  const handoffs = useTeamergeStore((s) => s.handoffs)
  const reviews = useTeamergeStore((s) => s.reviews)
  const collisions = useTeamergeStore((s) => s.collisions)
  const landing = useTeamergeStore((s) => s.landing)
  const inbox =
    handoffs.filter((h) => h.direction === 'incoming' && h.status === 'sent').length +
    reviews.filter((r) => r.direction === 'incoming' && r.status !== 'done').length
  const conflicts = collisions.filter((c) => c.conflict).length
  const queued = landing?.items.filter((i) => i.status === 'queued').length ?? 0
  return {
    inbox: inbox ? { count: inbox, tone: 'blue' } : undefined,
    collisions: conflicts ? { count: conflicts, tone: 'red' } : undefined,
    landing: queued ? { count: queued, tone: 'blue' } : undefined
  }
}

function RelayIndicator(): React.JSX.Element | null {
  const status = useTeamergeStore((s) => s.status)
  if (!status?.team) {
    return null
  }
  const { state } = status.relay
  const online = status.onlineMemberIds.length
  const label =
    state === 'connected'
      ? online === 0
        ? 'Connected · no teammates online'
        : `Connected · ${online} online`
      : state === 'connecting'
        ? 'Connecting to relay…'
        : state === 'error'
          ? 'Relay unreachable'
          : 'Offline'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card px-2.5 py-1 text-xs text-muted-foreground">
      <span
        className={cn(
          'size-1.5 rounded-full',
          state === 'connected'
            ? 'bg-presence-online'
            : state === 'connecting'
              ? 'bg-collision-overlap animate-pulse motion-reduce:animate-none'
              : 'bg-collision-conflict'
        )}
      />
      {label}
    </span>
  )
}

export default function TeamPage(): React.JSX.Element {
  const closeTeamPage = useAppStore((s) => s.closeTeamPage)
  const section = useTeamergeStore((s) => s.section)
  const setSection = useTeamergeStore((s) => s.setSection)
  const status = useTeamergeStore((s) => s.status)
  const watching = useTeamergeStore((s) => s.watching)
  const tasks = useTeamergeTasks()
  const badges = useBadges()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"]')
      ) {
        closeTeamPage()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeTeamPage])

  const hasTeam = !!status?.team && status.isMember
  const content = !tasks.repoPath ? (
    <TeamOnboarding noRepo />
  ) : !hasTeam &&
    section !== 'tasks' &&
    section !== 'collisions' &&
    section !== 'landing' &&
    section !== 'races' ? (
    <TeamOnboarding />
  ) : section === 'people' ? (
    <TeamPeopleSection tasks={tasks} />
  ) : section === 'inbox' ? (
    <TeamInboxSection tasks={tasks} />
  ) : section === 'messages' ? (
    <TeamMessagesSection tasks={tasks} />
  ) : section === 'notes' ? (
    <TeamNotesSection />
  ) : section === 'tasks' ? (
    <TeamTasksSection tasks={tasks} />
  ) : section === 'collisions' ? (
    <TeamCollisionsSection tasks={tasks} />
  ) : section === 'landing' ? (
    <TeamLandingSection tasks={tasks} />
  ) : section === 'races' ? (
    <TeamRacesSection tasks={tasks} />
  ) : (
    <TeamSettingsSection />
  )

  return (
    <div className="flex h-full min-h-0 w-full bg-background" data-teamerge-page="">
      <nav
        aria-label="Team sections"
        className="flex w-56 shrink-0 flex-col border-r border-border/70 bg-worktree-sidebar/60 px-2.5 pt-4 pb-3"
      >
        <div className="mb-4 flex items-center gap-2 px-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#5e5ce6] to-[#0071e3] text-white shadow-sm">
            <GitMerge className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold leading-4">
              {status?.team?.name ?? 'Teamerge'}
            </div>
            <div className="truncate text-2xs text-muted-foreground">
              {tasks.repo?.displayName ?? 'No repository'}
            </div>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto scrollbar-sleek">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-2 pb-1 text-2xs font-semibold text-muted-foreground/80">
                {group.label}
              </div>
              <ul className="space-y-px">
                {group.items.map((item) => {
                  const active = section === item.id
                  const badge = badges[item.id]
                  const Icon = item.icon
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setSection(item.id)}
                        className={cn(
                          'flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors',
                          active
                            ? 'bg-worktree-sidebar-accent font-medium text-foreground'
                            : 'text-foreground/80 hover:bg-worktree-sidebar-foreground/6'
                        )}
                      >
                        <Icon
                          className={cn(
                            'size-4 shrink-0',
                            active ? 'text-primary' : 'text-muted-foreground'
                          )}
                        />
                        <span className="flex-1 truncate text-left">{item.label}</span>
                        {badge ? (
                          <span
                            className={cn(
                              'min-w-4.5 rounded-full px-1.5 text-center text-2xs leading-4 font-semibold text-white',
                              badge.tone === 'red' ? 'bg-collision-conflict' : 'bg-primary'
                            )}
                          >
                            {badge.count}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-current={section === 'settings' ? 'page' : undefined}
          onClick={() => setSection('settings')}
          className={cn(
            'mt-2 flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors',
            section === 'settings'
              ? 'bg-worktree-sidebar-accent font-medium'
              : 'text-foreground/80 hover:bg-worktree-sidebar-foreground/6'
          )}
        >
          <Settings2
            className={cn(
              'size-4',
              section === 'settings' ? 'text-primary' : 'text-muted-foreground'
            )}
          />
          Team Settings
        </button>
      </nav>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-end gap-2 border-b border-border/60 px-4">
          <RelayIndicator />
          <Button variant="ghost" size="icon-sm" aria-label="Close Team" onClick={closeTeamPage}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
          <div className="mx-auto w-full max-w-5xl px-8 pt-7 pb-16">{content}</div>
        </div>
        {watching ? <RemotePaneViewer /> : null}
      </main>
    </div>
  )
}
