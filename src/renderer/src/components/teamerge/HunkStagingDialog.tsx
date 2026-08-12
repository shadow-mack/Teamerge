import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Minus, Plus, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { DiffHunk, FileHunks } from '../../../../shared/teamerge/teamerge-types'
import { errorMessage } from './team-ui'

function HunkBlock({
  hunk,
  staged,
  busy,
  onStage,
  onDiscard
}: {
  hunk: DiffHunk
  staged: boolean
  busy: boolean
  onStage: () => void
  onDiscard?: () => void
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-border/80">
      <div className="flex items-center gap-2 bg-muted/60 px-3 py-1.5">
        <span className="flex-1 truncate font-mono text-2xs text-muted-foreground">
          {hunk.header}
        </span>
        {onDiscard ? (
          <Button size="xs" variant="ghost" disabled={busy} onClick={onDiscard}>
            <Trash2 />
            Discard
          </Button>
        ) : null}
        <Button
          size="xs"
          variant={staged ? 'outline' : 'default'}
          disabled={busy}
          onClick={onStage}
        >
          {staged ? <Minus /> : <Plus />}
          {staged ? 'Unstage Hunk' : 'Stage Hunk'}
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto scrollbar-sleek font-mono text-[12px] leading-5">
        {hunk.lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              'px-3 whitespace-pre',
              line.startsWith('+') && 'bg-[var(--diff-added-background)]',
              line.startsWith('-') && 'bg-[var(--diff-removed-background)]',
              line.startsWith('\\') && 'text-muted-foreground'
            )}
          >
            {line}
          </div>
        ))}
      </pre>
    </div>
  )
}

/** Stage or discard individual hunks of a task's changes, with Undo for each step. */
export function HunkStagingDialog({
  worktreePath,
  title,
  open,
  onOpenChange
}: {
  worktreePath: string | null
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [unstaged, setUnstaged] = useState<FileHunks | null>(null)
  const [staged, setStaged] = useState<FileHunks | null>(null)
  const [undoCount, setUndoCount] = useState(0)
  const [busy, setBusy] = useState(false)

  const loadFiles = useCallback(async () => {
    if (!worktreePath) {
      return
    }
    const list = await window.api.teamerge.taskChangedFiles({ worktreePath, baseRef: 'HEAD' })
    setFiles(list)
    setSelected((current) => (current && list.includes(current) ? current : (list[0] ?? null)))
    setUndoCount((await window.api.teamerge.hunkHistory(worktreePath)).length)
  }, [worktreePath])

  const loadHunks = useCallback(async () => {
    if (!worktreePath || !selected) {
      setUnstaged(null)
      setStaged(null)
      return
    }
    const [u, s] = await Promise.all([
      window.api.teamerge.fileHunks({ worktreePath, filePath: selected, staged: false }),
      window.api.teamerge.fileHunks({ worktreePath, filePath: selected, staged: true })
    ])
    setUnstaged(u)
    setStaged(s)
  }, [worktreePath, selected])

  useEffect(() => {
    if (open) {
      void loadFiles()
    }
  }, [open, loadFiles])

  useEffect(() => {
    if (open) {
      void loadHunks()
    }
  }, [open, loadHunks])

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      await loadFiles()
      await loadHunks()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const path = worktreePath ?? ''
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[760px] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border/70 px-5 pt-5 pb-3">
          <DialogTitle>Stage by Hunk · {title}</DialogTitle>
          <DialogDescription>
            Stage or discard individual hunks. Every step can be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr]">
          <ul className="overflow-y-auto scrollbar-sleek border-r border-border/70 bg-muted/30 py-1">
            {files.length === 0 ? (
              <li className="px-4 py-3 text-xs text-muted-foreground">No uncommitted changes.</li>
            ) : null}
            {files.map((file) => (
              <li key={file}>
                <button
                  type="button"
                  onClick={() => setSelected(file)}
                  className={cn(
                    'w-full truncate px-4 py-1.5 text-left font-mono text-xs',
                    selected === file
                      ? 'bg-accent text-foreground'
                      : 'text-foreground/80 hover:bg-accent/50'
                  )}
                >
                  {file}
                </button>
              </li>
            ))}
          </ul>
          <div className="min-h-0 space-y-5 overflow-y-auto scrollbar-sleek p-4">
            {selected ? (
              <>
                <section className="space-y-2">
                  <h3 className="text-[13px] font-semibold">Unstaged</h3>
                  {unstaged?.hunks.length ? (
                    unstaged.hunks.map((hunk) => (
                      <HunkBlock
                        key={hunk.id}
                        hunk={hunk}
                        staged={false}
                        busy={busy}
                        onStage={() =>
                          void act(() =>
                            window.api.teamerge.stageHunk({
                              worktreePath: path,
                              filePath: selected,
                              hunkId: hunk.id
                            })
                          )
                        }
                        onDiscard={() =>
                          void act(() =>
                            window.api.teamerge.discardHunk({
                              worktreePath: path,
                              filePath: selected,
                              hunkId: hunk.id
                            })
                          )
                        }
                      />
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No unstaged hunks
                      {files.includes(selected)
                        ? ' (new files are staged whole from Source Control)'
                        : ''}
                      .
                    </p>
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-[13px] font-semibold">Staged</h3>
                  {staged?.hunks.length ? (
                    staged.hunks.map((hunk) => (
                      <HunkBlock
                        key={hunk.id}
                        hunk={hunk}
                        staged
                        busy={busy}
                        onStage={() =>
                          void act(() =>
                            window.api.teamerge.unstageHunk({
                              worktreePath: path,
                              filePath: selected,
                              hunkId: hunk.id
                            })
                          )
                        }
                      />
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">Nothing staged in this file.</p>
                  )}
                </section>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border/70 px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || undoCount === 0}
            onClick={() =>
              void act(async () => {
                const undone = await window.api.teamerge.undoHunk(path)
                if (undone) {
                  toast(`Undid ${undone.kind} in ${undone.filePath}.`)
                }
              })
            }
          >
            <Undo2 className="size-4" />
            Undo{undoCount ? ` (${undoCount})` : ''}
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
