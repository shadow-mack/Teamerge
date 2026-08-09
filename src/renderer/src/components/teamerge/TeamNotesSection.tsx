import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { NotebookPen, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { relativeTime, useTeamergeStore } from './teamerge-store'
import { EmptyState, errorMessage, MemberAvatar, TeamSectionHeader } from './team-ui'

const CommentMarkdown = lazyWithRetry(() => import('../sidebar/CommentMarkdown'))

const NEW_NOTE = '__new__'

/** Shared markdown notes, synced to every teammate and mirrored to .teamerge/notes. */
export function TeamNotesSection(): React.JSX.Element {
  const notes = useTeamergeStore((s) => s.notes)
  const [selectedId, setSelectedId] = useState<string | null>(notes[0]?.id ?? null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId]
  )

  useEffect(() => {
    if (selectedId === NEW_NOTE) {
      return
    }
    if (selected && !editing) {
      setTitle(selected.title)
      setBody(selected.body)
    }
  }, [selected, editing, selectedId])

  const startNew = (): void => {
    setSelectedId(NEW_NOTE)
    setTitle('')
    setBody('')
    setEditing(true)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const note = await window.api.teamerge.saveNote({
        id: selectedId && selectedId !== NEW_NOTE ? selectedId : undefined,
        title,
        body
      })
      setSelectedId(note.id)
      setEditing(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <TeamSectionHeader
        title="Notes"
        subtitle="Markdown notes shared with the whole team, end-to-end encrypted. Each note is also written to .teamerge/notes so you can commit it."
        actions={
          <Button size="sm" onClick={startNew}>
            <Plus className="size-4" />
            New Note
          </Button>
        }
      />
      {notes.length === 0 && selectedId !== NEW_NOTE ? (
        <EmptyState
          icon={<NotebookPen />}
          title="No Notes Yet"
          description="Capture decisions, conventions, or the plan for a big change where every teammate — and their agents — can read it."
          action={<Button onClick={startNew}>New Note</Button>}
        />
      ) : (
        <div className="grid min-h-[480px] grid-cols-[240px_1fr] overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--shadow-card)]">
          <ul className="divide-y divide-border/60 overflow-y-auto scrollbar-sleek border-r border-border/70 bg-muted/30">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(note.id)
                    setEditing(false)
                  }}
                  className={cn(
                    'w-full px-3.5 py-2.5 text-left transition-colors',
                    selectedId === note.id ? 'bg-accent' : 'hover:bg-accent/50'
                  )}
                >
                  <div className="truncate text-[13px] font-medium">{note.title}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {note.authorName} · {relativeTime(note.updatedAt)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 flex-col">
            {editing || selectedId === NEW_NOTE ? (
              <>
                <div className="border-b border-border/70 px-5 py-3">
                  <Input
                    autoFocus
                    aria-label="Note title"
                    placeholder="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-auto border-none bg-transparent px-0 text-[17px] font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
                  />
                </div>
                <Textarea
                  aria-label="Note body"
                  placeholder="Write in Markdown…"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="min-h-0 flex-1 resize-none rounded-none border-none px-5 py-4 font-mono text-[13px] leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
                />
                <div className="flex justify-end gap-2 border-t border-border/70 px-4 py-2.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(false)
                      if (selectedId === NEW_NOTE) {
                        setSelectedId(notes[0]?.id ?? null)
                      }
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" disabled={busy || !title.trim()} onClick={() => void save()}>
                    Save and Share
                  </Button>
                </div>
              </>
            ) : selected ? (
              <>
                <div className="flex items-center gap-3 border-b border-border/70 px-5 py-3">
                  <MemberAvatar memberId={selected.authorId} name={selected.authorName} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[17px] font-semibold tracking-[-0.01em]">
                      {selected.title}
                    </div>
                    <div className="text-2xs text-muted-foreground">
                      Last edited by {selected.authorName} · {relativeTime(selected.updatedAt)}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete note"
                    onClick={() => {
                      if (window.confirm(`Delete “${selected.title}” for the whole team?`)) {
                        void window.api.teamerge.deleteNote(selected.id)
                        setSelectedId(null)
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek px-5 py-4 text-[13.5px] leading-6">
                  <Suspense fallback={<pre className="whitespace-pre-wrap">{selected.body}</pre>}>
                    <CommentMarkdown content={selected.body || '_Empty note._'} />
                  </Suspense>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
                Choose a note.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
