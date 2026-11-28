import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TEAMERGE_NOTES_DIR, type TeamNote } from '../../shared/teamerge/teamerge-types'
import type { TeamPayload } from './core/relay-client'
import { parseNote } from './core/teammate-payloads'
import type { TeamContext } from './team-data'

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'note'
  )
}

/** Shared markdown notes, mirrored into .teamerge/notes so they can be committed with the repo. */
export class TeamNotes {
  constructor(private readonly ctx: TeamContext) {}

  private emit(): void {
    this.ctx.emit({ type: 'notes', notes: this.ctx.data().notes })
  }

  async save(input: { id?: string; title: string; body: string }): Promise<TeamNote> {
    const identity = this.ctx.identity()
    const data = this.ctx.data()
    const existing = input.id ? data.notes.find((note) => note.id === input.id) : undefined
    const note: TeamNote = {
      id: existing?.id ?? randomUUID(),
      title: input.title.trim() || 'Untitled',
      body: input.body,
      authorId: identity.memberId,
      authorName: identity.name,
      updatedAt: Date.now()
    }
    data.notes = [note, ...data.notes.filter((entry) => entry.id !== note.id)]
    this.ctx.send('everyone', { kind: 'note', note })
    await this.ctx.save()
    await this.writeFile(note, existing)
    this.emit()
    return note
  }

  async delete(id: string): Promise<void> {
    this.ctx.send('everyone', { kind: 'note-deleted', id })
    await this.remove(id)
  }

  private async remove(id: string): Promise<void> {
    const data = this.ctx.data()
    const note = data.notes.find((entry) => entry.id === id)
    if (!note) {
      return
    }
    data.notes = data.notes.filter((entry) => entry.id !== id)
    await this.ctx.save()
    const file = this.filePath(note)
    if (file) {
      await rm(file, { force: true })
    }
    this.emit()
  }

  async onNote(senderId: string, senderName: string, payload: TeamPayload): Promise<void> {
    const note = parseNote(payload.note, { id: senderId, name: senderName })
    if (!note) {
      return
    }
    const data = this.ctx.data()
    const previous = data.notes.find((entry) => entry.id === note.id)
    data.notes = [note, ...data.notes.filter((entry) => entry.id !== note.id)]
    await this.ctx.save()
    await this.writeFile(note, previous)
    this.ctx.log('note', `${senderName} updated the note “${note.title}”.`)
    this.emit()
  }

  async onDeleted(payload: TeamPayload): Promise<void> {
    if (typeof payload.id === 'string') {
      await this.remove(payload.id)
    }
  }

  private filePath(note: TeamNote): string | null {
    const repoPath = this.ctx.repoPath()
    return repoPath
      ? join(repoPath, TEAMERGE_NOTES_DIR, `${slugify(note.title)}-${note.id.slice(0, 6)}.md`)
      : null
  }

  private async writeFile(note: TeamNote, previous?: TeamNote): Promise<void> {
    const repoPath = this.ctx.repoPath()
    const file = this.filePath(note)
    if (!repoPath || !file) {
      return
    }
    const previousFile = previous && previous.title !== note.title && this.filePath(previous)
    if (previousFile) {
      await rm(previousFile, { force: true })
    }
    await mkdir(join(repoPath, TEAMERGE_NOTES_DIR), { recursive: true })
    await writeFile(file, `# ${note.title}\n\n${note.body.trim()}\n`)
  }
}
