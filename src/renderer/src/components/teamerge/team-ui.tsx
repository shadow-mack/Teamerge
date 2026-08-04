import React from 'react'
import { cn } from '@/lib/utils'
import { memberHue, memberInitials } from './teamerge-store'

/** Page section: large title, quiet subtitle, trailing toolbar. */
export function TeamSectionHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 pb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** Inset grouped list, the macOS settings-style container. */
export function GroupedList({
  title,
  footer,
  trailing,
  children,
  className
}: {
  title?: React.ReactNode
  footer?: React.ReactNode
  trailing?: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={cn('mb-6', className)}>
      {title || trailing ? (
        <div className="mb-1.5 flex items-center justify-between px-1">
          {title ? (
            <h2 className="text-[13px] font-semibold text-foreground/85">{title}</h2>
          ) : (
            <span />
          )}
          {trailing}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--shadow-card)] divide-y divide-border/70">
        {children}
      </div>
      {footer ? (
        <p className="mt-1.5 px-1 text-xs leading-4 text-muted-foreground">{footer}</p>
      ) : null}
    </section>
  )
}

export function GroupedRow({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  className,
  selected
}: {
  leading?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  trailing?: React.ReactNode
  onClick?: () => void
  className?: string
  selected?: boolean
}): React.JSX.Element {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 px-3.5 py-2 text-left',
        onClick &&
          'transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none',
        selected && 'bg-accent/70',
        className
      )}
    >
      {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] leading-5 text-foreground">{title}</div>
        {subtitle ? (
          <div className="truncate text-xs leading-4 text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
    </Comp>
  )
}

export function MemberAvatar({
  memberId,
  name,
  size = 28,
  online
}: {
  memberId: string
  name: string
  size?: number
  online?: boolean
}): React.JSX.Element {
  const hue = memberHue(memberId)
  return (
    <span className="relative inline-flex shrink-0" title={name}>
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-full font-semibold text-white select-none"
        style={{
          width: size,
          height: size,
          fontSize: Math.max(10, Math.round(size * 0.38)),
          background: `linear-gradient(145deg, hsl(${hue} 70% 58%), hsl(${(hue + 28) % 360} 62% 44%))`
        }}
      >
        {memberInitials(name)}
      </span>
      {online !== undefined ? (
        <span
          aria-label={online ? 'Online' : 'Offline'}
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card',
            online ? 'bg-presence-online' : 'bg-muted-foreground/40'
          )}
        />
      ) : null}
    </span>
  )
}

export type PillTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'indigo'

const PILL_TONES: Record<PillTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  blue: 'bg-primary/12 text-primary dark:bg-primary/25 dark:text-[#64aaff]',
  green: 'bg-status-success/12 text-status-success',
  amber:
    'bg-collision-overlap/14 text-[color-mix(in_srgb,var(--collision-overlap)_75%,var(--foreground))]',
  red: 'bg-collision-conflict/12 text-collision-conflict',
  indigo: 'bg-team-accent/12 text-team-accent'
}

export function StatusPill({
  tone = 'neutral',
  children,
  icon,
  className
}: {
  tone?: PillTone
  children: React.ReactNode
  icon?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-2xs font-medium whitespace-nowrap [&_svg]:size-3',
        PILL_TONES[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: React.ReactNode
  title: string
  description: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <div className="text-[15px] font-semibold text-foreground">{title}</div>
      <p className="mt-1 max-w-sm text-[13px] leading-5 text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function BranchLabel({
  branch,
  className
}: {
  branch: string
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('font-mono text-[11.5px] text-muted-foreground', className)}>{branch}</span>
  )
}

export function agentStateTone(state: string): PillTone {
  if (state === 'working') {
    return 'blue'
  }
  if (state === 'waiting') {
    return 'amber'
  }
  if (state === 'done') {
    return 'green'
  }
  return 'neutral'
}

export function agentStateLabel(state: string): string {
  return state === 'waiting' ? 'Needs input' : state.charAt(0).toUpperCase() + state.slice(1)
}

export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  // IPC wraps main-process errors; show only the part people can act on.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
