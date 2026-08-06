import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useTeamergeStore } from './teamerge-store'
import type { TeamergeTask } from './use-teamerge-tasks'
import { errorMessage } from './team-ui'

function TeammatePicker({
  value,
  onChange
}: {
  value: string
  onChange: (id: string) => void
}): React.JSX.Element {
  const status = useTeamergeStore((s) => s.status)
  const members = (status?.team?.members ?? []).filter((m) => m.id !== status?.identity?.memberId)
  const online = new Set(status?.onlineMemberIds ?? [])
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Choose a teammate" />
      </SelectTrigger>
      <SelectContent>
        {members.map((member) => (
          <SelectItem key={member.id} value={member.id}>
            {member.name}
            {online.has(member.id) ? '' : ' (offline)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

async function draftBrief(task: TeamergeTask): Promise<string> {
  const files = await window.api.teamerge.taskChangedFiles({
    worktreePath: task.worktreePath,
    baseRef: task.baseRef
  })
  return [
    `Continue the task “${task.taskName}” on branch ${task.branch}.`,
    '',
    'Where it stands:',
    `- Started from ${task.baseRef}; last agent: ${task.agent} (${task.agentState}).`,
    files.length
      ? `- Files changed so far (${files.length}): ${files.slice(0, 12).join(', ')}${files.length > 12 ? ', …' : ''}`
      : '- No changes yet.',
    '',
    'What’s left:',
    '- ',
    '',
    'Watch out for:',
    '- '
  ].join('\n')
}

export function HandoffDialog({
  task,
  open,
  onOpenChange
}: {
  task: TeamergeTask | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [to, setTo] = useState('')
  const [brief, setBrief] = useState('')
  const [push, setPush] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && task) {
      setBrief('Drafting brief…')
      void draftBrief(task)
        .then(setBrief)
        .catch(() => setBrief(''))
    }
  }, [open, task])

  const send = async (): Promise<void> => {
    if (!task) {
      return
    }
    setBusy(true)
    try {
      await window.api.teamerge.sendHandoff({
        toMemberId: to,
        title: task.taskName,
        branch: task.branch,
        baseBranch: task.baseRef,
        brief,
        agent: task.agent,
        worktreePath: task.worktreePath,
        push
      })
      toast.success(`Handed off “${task.taskName}”.`)
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
          <DialogTitle>Hand Off “{task?.taskName}”</DialogTitle>
          <DialogDescription>
            Your teammate presses Take and their agent continues from this brief on {task?.branch}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>To</Label>
            <TeammatePicker value={to} onChange={setTo} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="teamerge-brief">Brief</Label>
            <Textarea
              id="teamerge-brief"
              className="min-h-48 font-mono text-xs leading-5"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={push} onCheckedChange={(v) => setPush(v === true)} />
            Push {task?.branch} to origin first
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !to || !brief.trim()} onClick={() => void send()}>
            {busy ? 'Handing Off…' : 'Hand Off'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ReviewRequestDialog({
  task,
  open,
  onOpenChange
}: {
  task: TeamergeTask | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (): Promise<void> => {
    if (!task) {
      return
    }
    setBusy(true)
    try {
      await window.api.teamerge.requestReview({
        toMemberId: to,
        title: task.taskName,
        worktreePath: task.worktreePath,
        baseRef: task.baseRef,
        paneId: task.paneId
      })
      toast.success('Review requested.')
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request Review</DialogTitle>
          <DialogDescription>
            Sends the current diff of “{task?.taskName}”. Line comments from your reviewer go
            straight to{' '}
            {task?.paneId ? 'this task’s agent' : 'this task (start an agent so comments reach it)'}
            .
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>Reviewer</Label>
          <TeammatePicker value={to} onChange={setTo} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !to} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Request Review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TextPromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initial = '',
  confirm,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  label: string
  initial?: string
  confirm: string
  onConfirm: (value: string) => Promise<void> | void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setValue(initial)
    }
  }, [open, initial])
  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await onConfirm(value.trim())
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (value.trim()) {
              void submit()
            }
          }}
        >
          <Label htmlFor="teamerge-text-prompt">{label}</Label>
          <Input
            id="teamerge-text-prompt"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !value.trim()} onClick={() => void submit()}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
