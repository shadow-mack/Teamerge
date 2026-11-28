import React, { useState } from 'react'
import { toast } from 'sonner'
import { Minus, Plus } from 'lucide-react'
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
import type { RaceAttempt, RaceGroup } from '../../../../shared/teamerge/teamerge-types'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import type { TeamergeRepoTasks } from './use-teamerge-tasks'
import { createTeamergeWorkspace, RACE_AGENT_CHOICES, slugForBranch } from './teamerge-workspaces'
import { errorMessage } from './team-ui'
import { translate } from '@/i18n/i18n'

const RACE_LABELS = ['A', 'B', 'C', 'D']

export function NewRaceDialog({
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
        const label = RACE_LABELS[index]
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
      toast.success(
        translate(
          'auto.components.teamerge.NewRaceDialog.ab13529dbf',
          'Started {{value0}} attempts at “{{value1}}”.',
          { value0: attempts.length, value1: title }
        )
      )
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
          <DialogTitle>
            {translate('auto.components.teamerge.NewRaceDialog.ee51e4f0b5', 'New Race')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.teamerge.NewRaceDialog.942d815900',
              'Run the same task with several agents in parallel, compare their changes file by file, and keep the best one.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="race-title">
              {translate('auto.components.teamerge.NewRaceDialog.7f299b0a0a', 'Name')}
            </Label>
            <Input
              id="race-title"
              placeholder={translate(
                'auto.components.teamerge.NewRaceDialog.f5562a8127',
                'Speed up search indexing'
              )}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="race-prompt">
              {translate(
                'auto.components.teamerge.NewRaceDialog.c4f80ea75f',
                'Task for every agent'
              )}
            </Label>
            <Textarea
              id="race-prompt"
              className="min-h-24"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="race-base">
              {translate('auto.components.teamerge.NewRaceDialog.65a0dfd208', 'Start from')}
            </Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger id="race-base" className="w-full">
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
            <Label>
              {translate('auto.components.teamerge.NewRaceDialog.104af2b621', 'Attempts')}
            </Label>
            <div className="space-y-2">
              {agents.map((agent, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-muted text-2xs font-semibold">
                    {RACE_LABELS[index]}
                  </span>
                  <Select
                    value={agent}
                    onValueChange={(value) =>
                      setAgents(agents.map((a, i) => (i === index ? (value as TuiAgent) : a)))
                    }
                  >
                    <SelectTrigger
                      className="flex-1"
                      aria-label={translate(
                        'auto.components.teamerge.NewRaceDialog.attemptAgent',
                        'Agent for attempt {{label}}',
                        { label: RACE_LABELS[index] }
                      )}
                    >
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
                    aria-label={translate(
                      'auto.components.teamerge.NewRaceDialog.7d02c14238',
                      'Remove attempt'
                    )}
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
                  {translate('auto.components.teamerge.NewRaceDialog.e55c780f72', 'Add Attempt')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('auto.components.teamerge.NewRaceDialog.deb12786fe', 'Cancel')}
          </Button>
          <Button disabled={busy || !title.trim() || !prompt.trim()} onClick={() => void start()}>
            {busy
              ? translate('auto.components.teamerge.NewRaceDialog.77693720fb', 'Starting…')
              : translate(
                  'auto.components.teamerge.NewRaceDialog.a2f212a4c8',
                  'Start {{value0}} Attempts',
                  { value0: agents.length }
                )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
