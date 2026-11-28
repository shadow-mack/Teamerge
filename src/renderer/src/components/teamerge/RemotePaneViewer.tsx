import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { Keyboard, ShieldAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { subscribePaneStream, useTeamergeStore } from './teamerge-store'
import { MemberAvatar, StatusPill } from './team-ui'
import { translate } from '@/i18n/i18n'

const KEY_BATCH_MS = 250

/** A teammate's agent pane, live. Typing sends keystroke requests the owner approves one batch at a time. */
export function RemotePaneViewer(): React.JSX.Element | null {
  const watching = useTeamergeStore((s) => s.watching)
  const setWatching = useTeamergeStore((s) => s.setWatching)
  const hostRef = useRef<HTMLDivElement>(null)
  const [typing, setTyping] = useState(false)
  const typingRef = useRef(false)
  typingRef.current = typing
  const [sent, setSent] = useState(0)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (typing) {
      termRef.current?.focus()
    }
  }, [typing])

  const ownerId = watching?.ownerId
  const paneId = watching?.paneId
  useEffect(() => {
    if (!ownerId || !paneId || !hostRef.current) {
      return
    }
    const dark = document.documentElement.classList.contains('dark')
    const term = new Terminal({
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace',
      fontSize: 12.5,
      cursorBlink: false,
      disableStdin: false,
      convertEol: false,
      scrollback: 5000,
      theme: dark
        ? { background: '#161618', foreground: '#e5e5ea', cursor: '#0a84ff' }
        : {
            background: '#ffffff',
            foreground: '#1d1d1f',
            cursor: '#0071e3',
            selectionBackground: '#b3d7ff'
          }
    })
    term.open(hostRef.current)
    termRef.current = term
    const fit = (): void => {
      const el = hostRef.current
      if (!el) {
        return
      }
      const cell = (
        term as unknown as {
          _core?: {
            _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } }
          }
        }
      )._core?._renderService?.dimensions?.css?.cell
      if (cell?.width && cell.height) {
        term.resize(
          Math.max(20, Math.floor(el.clientWidth / cell.width)),
          Math.max(5, Math.floor(el.clientHeight / cell.height))
        )
      }
    }
    const observer = new ResizeObserver(fit)
    observer.observe(hostRef.current)
    requestAnimationFrame(fit)

    let pending = ''
    let timer: number | null = null
    const flush = (): void => {
      timer = null
      if (pending) {
        void window.api.teamerge.sendKeystrokes({ ownerId, paneId, data: pending })
        setSent((count) => count + 1)
        pending = ''
      }
    }
    const input = term.onData((data) => {
      if (!typingRef.current) {
        return
      }
      pending += data
      // Enter sends the batch at once so a whole command is approved together.
      if (data.includes('\r')) {
        if (timer) {
          window.clearTimeout(timer)
        }
        flush()
      } else if (!timer) {
        timer = window.setTimeout(flush, KEY_BATCH_MS)
      }
    })
    const unsubscribe = subscribePaneStream(ownerId, paneId, (data, replay) => {
      if (replay) {
        term.reset()
      }
      term.write(data)
    })
    void window.api.teamerge.watchPane({ ownerId, paneId })
    return () => {
      void window.api.teamerge.unwatchPane({ ownerId, paneId })
      unsubscribe()
      input.dispose()
      observer.disconnect()
      if (timer) {
        window.clearTimeout(timer)
      }
      termRef.current = null
      term.dispose()
    }
  }, [ownerId, paneId])

  if (!watching) {
    return null
  }
  const close = (): void => setWatching(null)
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col bg-background/70 p-4 backdrop-blur-sm reduce-effects:backdrop-blur-none"
      role="dialog"
      aria-label={translate(
        'auto.components.teamerge.RemotePaneViewer.ddfb7f442a',
        "{{value0}}'s {{value1}}",
        { value0: watching.ownerName, value1: watching.taskName }
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-floating">
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-2.5">
          <MemberAvatar
            memberId={watching.ownerId}
            name={watching.ownerName}
            size={26}
            online={!watching.ended}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">
              {watching.ownerName} · {watching.taskName}
            </div>
            <div className="text-2xs text-muted-foreground">
              {watching.ended
                ? translate('auto.components.teamerge.RemotePaneViewer.34004d8cba', 'Sharing ended')
                : translate(
                    'auto.components.teamerge.RemotePaneViewer.551dd6678d',
                    'Live from their machine · end-to-end encrypted'
                  )}
            </div>
          </div>
          {watching.muted ? (
            <StatusPill tone="red" icon={<ShieldAlert />}>
              {translate('auto.components.teamerge.RemotePaneViewer.6f1e8685aa', 'Muted by owner')}
            </StatusPill>
          ) : (
            <Button
              size="sm"
              variant={typing ? 'default' : 'outline'}
              disabled={watching.ended}
              onClick={() => setTyping((value) => !value)}
              aria-pressed={typing}
            >
              <Keyboard className="size-3.5" />
              {typing
                ? translate(
                    'auto.components.teamerge.RemotePaneViewer.37c1aa01bc',
                    'Typing Requests On'
                  )
                : translate(
                    'auto.components.teamerge.RemotePaneViewer.6a96a8a865',
                    'Request to Type'
                  )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={translate(
              'auto.components.teamerge.RemotePaneViewer.edf9e2c7dc',
              'Stop watching'
            )}
            onClick={close}
          >
            <X className="size-4" />
          </Button>
        </div>
        {typing && !watching.muted ? (
          <div className="border-b border-border/70 bg-primary/8 px-4 py-1.5 text-xs text-foreground/80">
            {translate('auto.components.teamerge.RemotePaneViewer.9233290cac', 'Keystrokes go to')}{' '}
            {watching.ownerName}{' '}
            {translate(
              'auto.components.teamerge.RemotePaneViewer.63e595678d',
              'for approval before they reach the agent.'
            )}{' '}
            {sent > 0
              ? translate(
                  'auto.components.teamerge.RemotePaneViewer.d4367c18e7',
                  '{{value0}} sent.',
                  { value0: sent }
                )
              : ''}
          </div>
        ) : null}
        <div
          ref={hostRef}
          className={cn('min-h-0 flex-1 px-3 py-2', watching.ended && 'opacity-60')}
        />
      </div>
    </div>
  )
}
