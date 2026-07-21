import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  KeystrokeRequest,
  PaneAuditEntry,
  PaneShareState,
  TeamergeEvent
} from '../../shared/teamerge/teamerge-types'
import type { TeamPayload } from './core/relay-client'
import { onPtyOutput, recentPtyOutput } from './pty-tap'

type Send = (to: string, payload: TeamPayload) => void
type Emit = (event: TeamergeEvent) => void
type WritePty = (ptyId: string, data: string) => boolean

/** Printable form of raw keystrokes for the approval card and the audit log. */
export function describeKeys(data: string): string {
  return [...data]
    .map((ch) => {
      const code = ch.charCodeAt(0)
      if (ch === '\r' || ch === '\n') {
        return '⏎'
      }
      if (ch === '\t') {
        return '⇥'
      }
      if (ch === '\x7f') {
        return '⌫'
      }
      if (ch === '\x1b') {
        return '⎋'
      }
      if (code < 32) {
        return `^${String.fromCharCode(code + 64)}`
      }
      return ch
    })
    .join('')
}

/**
 * Owner side of live pane sharing: streams a pane to approved watchers and holds every remote
 * keystroke for the owner's approval. Remote input is never written without that approval.
 */
export class PaneShareHost {
  private readonly shares = new Map<string, PaneShareState>()
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly pendingOutput = new Map<string, string>()
  private auditChain: Promise<void> = Promise.resolve()
  private readonly unsubscribe: () => void

  constructor(
    private readonly send: Send,
    private readonly emit: Emit,
    private readonly writePty: WritePty,
    private readonly auditPath: string
  ) {
    this.unsubscribe = onPtyOutput((ptyId, data) => this.onOutput(ptyId, data))
  }

  dispose(): void {
    this.unsubscribe()
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer)
    }
  }

  list(): PaneShareState[] {
    return [...this.shares.values()]
  }

  isShared(paneId: string): boolean {
    return this.shares.get(paneId)?.shared === true
  }

  setShared(paneId: string, shared: boolean): PaneShareState {
    const share = this.shares.get(paneId) ?? {
      paneId,
      shared,
      mutedMemberIds: [],
      viewers: [],
      pending: []
    }
    share.shared = shared
    if (!shared) {
      for (const viewer of share.viewers) {
        this.send(viewer.memberId, { kind: 'pane-ended', paneId })
      }
      share.viewers = []
      share.pending = []
    }
    this.shares.set(paneId, share)
    this.emit({ type: 'pane-share', share })
    return share
  }

  setMuted(paneId: string, memberId: string, muted: boolean): void {
    const share = this.shares.get(paneId)
    if (!share) {
      return
    }
    share.mutedMemberIds = muted
      ? [...new Set([...share.mutedMemberIds, memberId])]
      : share.mutedMemberIds.filter((id) => id !== memberId)
    if (muted) {
      for (const request of share.pending.filter((r) => r.fromMemberId === memberId)) {
        void this.audit(request, 'muted')
      }
      share.pending = share.pending.filter((r) => r.fromMemberId !== memberId)
    }
    this.send(memberId, { kind: 'pane-control', paneId, muted })
    this.emit({ type: 'pane-share', share })
  }

  onSubscribe(memberId: string, name: string, paneId: string): void {
    const share = this.shares.get(paneId)
    if (!share?.shared) {
      this.send(memberId, { kind: 'pane-ended', paneId })
      return
    }
    if (!share.viewers.some((viewer) => viewer.memberId === memberId)) {
      share.viewers.push({ memberId, name })
    }
    this.send(memberId, {
      kind: 'pane-output',
      paneId,
      data: recentPtyOutput(paneId),
      replay: true
    })
    this.send(memberId, {
      kind: 'pane-control',
      paneId,
      muted: share.mutedMemberIds.includes(memberId)
    })
    this.emit({ type: 'pane-share', share })
  }

  onUnsubscribe(memberId: string, paneId: string): void {
    const share = this.shares.get(paneId)
    if (share) {
      share.viewers = share.viewers.filter((viewer) => viewer.memberId !== memberId)
      this.emit({ type: 'pane-share', share })
    }
  }

  onPeerLeft(memberId: string): void {
    for (const share of this.shares.values()) {
      const before = share.viewers.length
      share.viewers = share.viewers.filter((viewer) => viewer.memberId !== memberId)
      if (share.viewers.length !== before) {
        this.emit({ type: 'pane-share', share })
      }
    }
  }

  onKeystrokes(memberId: string, name: string, paneId: string, data: string): void {
    const share = this.shares.get(paneId)
    if (!share?.shared || typeof data !== 'string' || data.length === 0 || data.length > 4096) {
      return
    }
    const request: KeystrokeRequest = {
      id: randomUUID(),
      paneId,
      fromMemberId: memberId,
      fromName: name,
      data,
      at: Date.now(),
      status: 'pending'
    }
    if (share.mutedMemberIds.includes(memberId)) {
      request.status = 'muted'
      void this.audit(request, 'muted')
      this.send(memberId, {
        kind: 'pane-keys-result',
        paneId,
        requestId: request.id,
        status: 'muted'
      })
      return
    }
    share.pending.push(request)
    this.emit({ type: 'pane-share', share })
  }

  decide(paneId: string, requestId: string, approve: boolean): void {
    const share = this.shares.get(paneId)
    const request = share?.pending.find((r) => r.id === requestId)
    if (!share || !request) {
      return
    }
    share.pending = share.pending.filter((r) => r.id !== requestId)
    const written = approve ? this.writePty(paneId, request.data) : false
    const status = approve && written ? 'approved' : 'rejected'
    void this.audit(request, status)
    this.send(request.fromMemberId, { kind: 'pane-keys-result', paneId, requestId, status })
    this.emit({ type: 'pane-share', share })
  }

  private async audit(
    request: KeystrokeRequest,
    decision: PaneAuditEntry['decision']
  ): Promise<void> {
    const entry: PaneAuditEntry = {
      at: Date.now(),
      paneId: request.paneId,
      memberId: request.fromMemberId,
      memberName: request.fromName,
      keys: describeKeys(request.data),
      decision
    }
    // Serialize appends so the log keeps decision order.
    this.auditChain = this.auditChain.then(async () => {
      try {
        await mkdir(dirname(this.auditPath), { recursive: true })
        await appendFile(this.auditPath, `${JSON.stringify(entry)}\n`)
      } catch (error) {
        console.error('[teamerge] audit write failed', error)
      }
    })
    await this.auditChain
    this.emit({
      type: 'activity',
      event: {
        id: randomUUID(),
        at: entry.at,
        kind: 'keystrokes',
        text: `${entry.memberName}'s keystrokes “${entry.keys.slice(0, 40)}” were ${decision}.`
      }
    })
  }

  async readAudit(limit = 200): Promise<PaneAuditEntry[]> {
    await this.auditChain
    try {
      const lines = (await readFile(this.auditPath, 'utf8')).split('\n').filter(Boolean)
      return lines
        .slice(-limit)
        .map((line) => JSON.parse(line) as PaneAuditEntry)
        .toReversed()
    } catch {
      return []
    }
  }

  private onOutput(ptyId: string, data: string): void {
    const share = this.shares.get(ptyId)
    if (!share?.shared || share.viewers.length === 0) {
      return
    }
    this.pendingOutput.set(ptyId, (this.pendingOutput.get(ptyId) ?? '') + data)
    if (this.flushTimers.has(ptyId)) {
      return
    }
    // Batch output so a chatty agent doesn't turn into thousands of relay frames.
    this.flushTimers.set(
      ptyId,
      setTimeout(() => {
        this.flushTimers.delete(ptyId)
        const chunk = this.pendingOutput.get(ptyId) ?? ''
        this.pendingOutput.delete(ptyId)
        for (const viewer of this.shares.get(ptyId)?.viewers ?? []) {
          this.send(viewer.memberId, { kind: 'pane-output', paneId: ptyId, data: chunk })
        }
      }, 60)
    )
  }
}
