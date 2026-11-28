import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Crown, Equal, Swords, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { RaceFileComparison, RaceGroup } from '../../../../shared/teamerge/teamerge-types'
import { relativeTime } from './teamerge-store'
import type { TeamergeRepoTasks } from './use-teamerge-tasks'
import { removeTeamergeWorkspace } from './teamerge-workspaces'
import {
  BranchLabel,
  EmptyState,
  errorMessage,
  GroupedList,
  GroupedRow,
  StatusPill,
  TeamSectionHeader
} from './team-ui'
import { NewRaceDialog } from './NewRaceDialog'
import { translate } from '@/i18n/i18n'
import { shortRefName } from '@/lib/git-utils'

const RACE_REFRESH_MS = 4000

function DiffColumn({ diff }: { diff: string }): React.JSX.Element {
  if (!diff.trim()) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
        {translate('auto.components.teamerge.TeamRacesSection.4c6293c5ac', 'Untouched')}
      </div>
    )
  }
  return (
    <pre className="overflow-auto scrollbar-sleek font-mono text-[11.5px] leading-[18px]">
      {diff
        .split('\n')
        .filter((line) => !/^(diff --git|index |--- |\+\+\+ |new file|deleted file)/.test(line))
        .map((line, i) => (
          <div
            key={i}
            className={cn(
              'px-2.5 whitespace-pre',
              line.startsWith('+') && 'bg-[var(--diff-added-background)]',
              line.startsWith('-') && 'bg-[var(--diff-removed-background)]',
              line.startsWith('@@') && 'bg-primary/6 text-muted-foreground'
            )}
          >
            {line || ' '}
          </div>
        ))}
    </pre>
  )
}

function RaceDetail({
  race,
  tasks,
  onBack
}: {
  race: RaceGroup
  tasks: TeamergeRepoTasks
  onBack: () => void
}): React.JSX.Element {
  const [rows, setRows] = useState<RaceFileComparison[] | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<string[]>([])
  const [keeping, setKeeping] = useState<string | null>(null)
  const repoPath = tasks.repoPath as string

  // Attempts keep changing while their agents work, so the comparison refreshes while open.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), RACE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.teamerge
      .compareRace({ repoPath, raceId: race.id })
      .then((result) => {
        if (cancelled) {
          return
        }
        setRows(result)
        setFile(
          (current) =>
            current ?? result.find((r) => !r.identical)?.filePath ?? result[0]?.filePath ?? null
        )
      })
      .catch((error) => {
        if (!cancelled && tick === 0) {
          toast.error(errorMessage(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [race.id, repoPath, tick])

  useEffect(() => {
    if (!file) {
      return
    }
    let cancelled = false
    void window.api.teamerge
      .raceFileDiffs({ repoPath, raceId: race.id, filePath: file })
      .then((result) => {
        if (!cancelled) {
          setDiffs(result)
        }
      })
    return () => {
      cancelled = true
    }
  }, [file, race.id, repoPath, tick])

  const totals = race.attempts.map((_, index) =>
    (rows ?? []).reduce(
      (sum, row) => ({
        added: sum.added + (row.perAttempt[index]?.added ?? 0),
        removed: sum.removed + (row.perAttempt[index]?.removed ?? 0),
        files: sum.files + (row.perAttempt[index] ? 1 : 0)
      }),
      { added: 0, removed: 0, files: 0 }
    )
  )

  const keep = async (branch: string): Promise<void> => {
    const losers = race.attempts.filter((a) => a.branch !== branch)
    if (
      !window.confirm(
        translate(
          'auto.components.teamerge.TeamRacesSection.fef5262fb7',
          'Keep {{value0}} and delete the other {{count}} attempts (their workspaces and uncommitted changes)?',
          {
            value0: branch,
            count: losers.length,
            defaultValue_one:
              'Keep {{value0}} and delete the other {{count}} attempt (its workspace and uncommitted changes)?'
          }
        )
      )
    ) {
      return
    }
    setKeeping(branch)
    try {
      await window.api.teamerge.pickRaceWinner({ repoPath, raceId: race.id, winnerBranch: branch })
      for (const loser of losers) {
        const task = tasks.tasks.find((t) => t.worktreePath === loser.worktreePath)
        if (task) {
          await removeTeamergeWorkspace(task.worktree)
        }
      }
      toast.success(
        translate(
          'auto.components.teamerge.TeamRacesSection.ef569fb3a9',
          'Kept {{value0}}. Removed {{count}} other attempts.',
          {
            value0: branch,
            count: losers.length,
            defaultValue_one: 'Kept {{value0}}. Removed {{count}} other attempt.'
          }
        )
      )
      onBack()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setKeeping(null)
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {translate('auto.components.teamerge.TeamRacesSection.eeb093e1c6', 'Races')}
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em]">{race.title}</h1>
          <p className="text-xs text-muted-foreground">
            {translate('auto.components.teamerge.TeamRacesSection.5d75949bef', 'From')}{' '}
            <span className="font-mono">{shortRefName(race.baseRef)}</span> · {race.attempts.length}{' '}
            {translate('auto.components.teamerge.TeamRacesSection.a881df4487', 'attempts')}
          </p>
        </div>
      </div>

      <div
        className="mb-5 grid gap-3"
        style={{ gridTemplateColumns: `repeat(${race.attempts.length}, minmax(0, 1fr))` }}
      >
        {race.attempts.map((attempt, index) => (
          <div
            key={attempt.branch}
            className="rounded-xl border border-border/80 bg-card p-3.5 shadow-[var(--shadow-card)]"
          >
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-2xs font-semibold text-primary-foreground">
                {attempt.label}
              </span>
              <span className="text-[13px] font-semibold">{attempt.agent}</span>
            </div>
            <BranchLabel branch={attempt.branch} className="mt-1 block truncate" />
            <div className="mt-2 text-xs text-muted-foreground">
              {totals[index].files}{' '}
              {translate('auto.components.teamerge.TeamRacesSection.06d187cbd5', 'files ·')}{' '}
              <span className="text-status-success">+{totals[index].added}</span>{' '}
              <span className="text-destructive">−{totals[index].removed}</span>
            </div>
            <Button
              size="sm"
              className="mt-3 w-full"
              disabled={keeping !== null || race.attempts.length < 2}
              onClick={() => void keep(attempt.branch)}
            >
              <Crown className="size-3.5" />
              {keeping === attempt.branch
                ? translate('auto.components.teamerge.TeamRacesSection.938daa6b96', 'Keeping…')
                : translate(
                    'auto.components.teamerge.TeamRacesSection.c496ef2677',
                    'Keep This One'
                  )}
            </Button>
          </div>
        ))}
      </div>

      <div className="grid min-h-[420px] grid-cols-[260px_1fr] overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--shadow-card)]">
        <ul className="overflow-y-auto scrollbar-sleek border-r border-border/70 bg-muted/30">
          {rows === null ? (
            <li className="px-3.5 py-3 text-xs text-muted-foreground">
              {translate('auto.components.teamerge.TeamRacesSection.901605a945', 'Comparing…')}
            </li>
          ) : null}
          {rows?.length === 0 ? (
            <li className="px-3.5 py-3 text-xs text-muted-foreground">
              {translate(
                'auto.components.teamerge.TeamRacesSection.1dac21557c',
                'No attempt has changed anything yet.'
              )}
            </li>
          ) : null}
          {rows?.map((row) => (
            <li key={row.filePath}>
              <button
                type="button"
                onClick={() => setFile(row.filePath)}
                className={cn(
                  'w-full px-3.5 py-2 text-left',
                  file === row.filePath ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-xs">{row.filePath}</span>
                  {row.identical ? (
                    <Equal
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-label={translate(
                        'auto.components.teamerge.TeamRacesSection.f1a1d26a94',
                        'Identical in every attempt'
                      )}
                    />
                  ) : null}
                </div>
                <div className="mt-0.5 flex gap-2 text-2xs text-muted-foreground">
                  {row.perAttempt.map((stat, i) => (
                    <span key={i}>
                      {race.attempts[i]?.label} {stat ? `+${stat.added}/−${stat.removed}` : '—'}
                    </span>
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div
          className="grid min-w-0 divide-x divide-border/70"
          style={{ gridTemplateColumns: `repeat(${race.attempts.length}, minmax(0, 1fr))` }}
        >
          {race.attempts.map((attempt, index) => (
            <div key={attempt.branch} className="flex min-w-0 flex-col">
              <div className="border-b border-border/70 px-2.5 py-1.5 text-2xs font-semibold text-muted-foreground">
                {attempt.label} · {attempt.agent}
              </div>
              <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
                <DiffColumn diff={diffs[index] ?? ''} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function TeamRacesSection({ tasks }: { tasks: TeamergeRepoTasks }): React.JSX.Element {
  const [races, setRaces] = useState<RaceGroup[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const repoPath = tasks.repoPath

  const load = useCallback(async () => {
    if (repoPath) {
      setRaces(await window.api.teamerge.listRaces(repoPath))
    }
  }, [repoPath])

  useEffect(() => {
    void load()
  }, [load])

  const open = races.find((race) => race.id === openId)
  if (open) {
    return (
      <RaceDetail
        race={open}
        tasks={tasks}
        onBack={() => {
          setOpenId(null)
          void load()
        }}
      />
    )
  }

  return (
    <div>
      <TeamSectionHeader
        title={translate('auto.components.teamerge.TeamRacesSection.eeb093e1c6', 'Races')}
        subtitle={translate(
          'auto.components.teamerge.TeamRacesSection.89ff8a35f6',
          'Give the same task to several agents at once, compare their runs side by side, and keep the winner.'
        )}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Swords className="size-4" />
            {translate('auto.components.teamerge.TeamRacesSection.e7b7a1d429', 'New Race')}
          </Button>
        }
      />
      {races.length === 0 ? (
        <EmptyState
          icon={<Swords />}
          title={translate('auto.components.teamerge.TeamRacesSection.1a11c72448', 'No Races')}
          description={translate(
            'auto.components.teamerge.TeamRacesSection.e3ab1ba70a',
            'Start a race when a task has more than one good approach and you want to see each one.'
          )}
          action={
            <Button onClick={() => setCreating(true)}>
              {translate('auto.components.teamerge.TeamRacesSection.e7b7a1d429', 'New Race')}
            </Button>
          }
        />
      ) : (
        <GroupedList>
          {races.map((race) => (
            <GroupedRow
              key={race.id}
              onClick={() => setOpenId(race.id)}
              leading={<Swords className="size-4 text-team-accent" />}
              title={<span className="font-medium">{race.title}</span>}
              subtitle={`${race.attempts.map((a) => `${a.label} ${a.agent}`).join(' · ')} · ${relativeTime(race.createdAt)}`}
              trailing={
                <>
                  {race.winnerBranch ? (
                    <StatusPill tone="green" icon={<Crown />}>
                      {translate('auto.components.teamerge.TeamRacesSection.4f4d3cac9b', 'Kept')}{' '}
                      {race.winnerBranch}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="blue">
                      {translate('auto.components.teamerge.TeamRacesSection.50b10eaf66', 'Running')}
                    </StatusPill>
                  )}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={translate(
                      'auto.components.teamerge.TeamRacesSection.08c1b7c8e7',
                      'Forget race {{value0}}',
                      { value0: race.title }
                    )}
                    onClick={(event) => {
                      event.stopPropagation()
                      void window.api.teamerge
                        .removeRace({ repoPath: repoPath as string, raceId: race.id })
                        .then(load)
                    }}
                  >
                    <Trash2 />
                  </Button>
                </>
              }
            />
          ))}
        </GroupedList>
      )}
      <NewRaceDialog
        tasks={tasks}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(race) => {
          void load()
          setOpenId(race.id)
        }}
      />
    </div>
  )
}
