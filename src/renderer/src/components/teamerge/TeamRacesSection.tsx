/* oxlint-disable eslint/max-lines */
import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Crown, Equal, Minus, Plus, Swords, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type {
  RaceAttempt,
  RaceFileComparison,
  RaceGroup
} from '../../../../shared/teamerge/teamerge-types'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { relativeTime } from './teamerge-store'
import type { TeamergeRepoTasks } from './use-teamerge-tasks'
import {
  createTeamergeWorkspace,
  RACE_AGENT_CHOICES,
  removeTeamergeWorkspace,
  slugForBranch
} from './teamerge-workspaces'
import {
  BranchLabel,
  EmptyState,
  errorMessage,
  GroupedList,
  GroupedRow,
  StatusPill,
  TeamSectionHeader
} from './team-ui'

const LABELS = ['A', 'B', 'C', 'D']

function NewRaceDialog({
  tasks,
  open,
  onOpenChange,
  onCreated
}: {
  tasks: TeamergeRepoTasks
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (race: RaceGroup) => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [base, setBase] = useState(tasks.mainBranch)
  const [agents, setAgents] = useState<TuiAgent[]>(
    ['claude', 'codex'].filter((a) => RACE_AGENT_CHOICES.some((c) => c.id === a)) as TuiAgent[]
  )
  const [busy, setBusy] = useState(false)
  const bases = [...new Set([tasks.mainBranch, ...tasks.tasks.map((t) => t.branch)])]

  const start = async (): Promise<void> => {
    if (!tasks.repo || !tasks.repoPath) {
      return
    }
    setBusy(true)
    try {
      const slug = slugForBranch(title)
      const stamp = Date.now().toString(36).slice(-4)
      const attempts: RaceAttempt[] = []
      for (const [index, agent] of agents.entries()) {
        const label = LABELS[index]
        const worktree = await createTeamergeWorkspace({
          repoId: tasks.repo.id,
          name: `race-${slug}-${stamp}-${label.toLowerCase()}`,
          baseBranch: base,
          displayName: `${title} · ${label} (${agent})`,
          agent,
          prompt
        })
        attempts.push({
          worktreePath: worktree.path,
          branch: worktree.branch.replace(/^refs\/heads\//, ''),
          label,
          agent
        })
      }
      const race = await window.api.teamerge.createRace({
        repoPath: tasks.repoPath,
        title,
        baseRef: base,
        attempts
      })
      toast.success(`Started ${attempts.length} attempts at “${title}”.`)
      onCreated(race)
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Race</DialogTitle>
          <DialogDescription>
            Run the same task with several agents in parallel, compare their changes file by file,
            and keep the best one.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="race-title">Name</Label>
            <Input
              id="race-title"
              placeholder="Speed up search indexing"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="race-prompt">Task for every agent</Label>
            <Textarea
              id="race-prompt"
              className="min-h-24"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Start from</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger className="w-full font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bases.map((b) => (
                  <SelectItem key={b} value={b} className="font-mono text-xs">
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Attempts</Label>
            <div className="space-y-2">
              {agents.map((agent, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-muted text-2xs font-semibold">
                    {LABELS[index]}
                  </span>
                  <Select
                    value={agent}
                    onValueChange={(value) =>
                      setAgents(agents.map((a, i) => (i === index ? (value as TuiAgent) : a)))
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RACE_AGENT_CHOICES.map((choice) => (
                        <SelectItem key={choice.id} value={choice.id}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove attempt"
                    disabled={agents.length <= 2}
                    onClick={() => setAgents(agents.filter((_, i) => i !== index))}
                  >
                    <Minus className="size-4" />
                  </Button>
                </div>
              ))}
              {agents.length < 4 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAgents([...agents, agents.at(-1) ?? 'claude'])}
                >
                  <Plus className="size-4" />
                  Add Attempt
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !title.trim() || !prompt.trim()} onClick={() => void start()}>
            {busy ? 'Starting…' : `Start ${agents.length} Attempts`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DiffColumn({ diff }: { diff: string }): React.JSX.Element {
  if (!diff.trim()) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
        Untouched
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

  useEffect(() => {
    void window.api.teamerge
      .compareRace({ repoPath, raceId: race.id })
      .then((result) => {
        setRows(result)
        setFile(
          (current) =>
            current ?? result.find((r) => !r.identical)?.filePath ?? result[0]?.filePath ?? null
        )
      })
      .catch((error) => toast.error(errorMessage(error)))
  }, [race.id, repoPath])

  useEffect(() => {
    if (file) {
      void window.api.teamerge
        .raceFileDiffs({ repoPath, raceId: race.id, filePath: file })
        .then(setDiffs)
    }
  }, [file, race.id, repoPath])

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
        `Keep ${branch} and delete the other ${losers.length} ${losers.length === 1 ? 'attempt' : 'attempts'} (their workspaces and uncommitted changes)?`
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
        `Kept ${branch}. Removed ${losers.length} other ${losers.length === 1 ? 'attempt' : 'attempts'}.`
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
          Races
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em]">{race.title}</h1>
          <p className="text-xs text-muted-foreground">
            From <span className="font-mono">{race.baseRef}</span> · {race.attempts.length} attempts
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
              {totals[index].files} files ·{' '}
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
              {keeping === attempt.branch ? 'Keeping…' : 'Keep This One'}
            </Button>
          </div>
        ))}
      </div>

      <div className="grid min-h-[420px] grid-cols-[260px_1fr] overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--shadow-card)]">
        <ul className="overflow-y-auto scrollbar-sleek border-r border-border/70 bg-muted/30">
          {rows === null ? (
            <li className="px-3.5 py-3 text-xs text-muted-foreground">Comparing…</li>
          ) : null}
          {rows?.length === 0 ? (
            <li className="px-3.5 py-3 text-xs text-muted-foreground">
              No attempt has changed anything yet.
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
                      aria-label="Identical in every attempt"
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
        title="Races"
        subtitle="Give the same task to several agents at once, compare their runs side by side, and keep the winner."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Swords className="size-4" />
            New Race
          </Button>
        }
      />
      {races.length === 0 ? (
        <EmptyState
          icon={<Swords />}
          title="No Races"
          description="Start a race when a task has more than one good approach and you want to see each one."
          action={<Button onClick={() => setCreating(true)}>New Race</Button>}
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
                      Kept {race.winnerBranch}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="blue">Running</StatusPill>
                  )}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Forget race ${race.title}`}
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
