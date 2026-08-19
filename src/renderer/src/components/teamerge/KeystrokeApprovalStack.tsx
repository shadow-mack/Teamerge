import React from 'react'
import { Keyboard, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTeamergeStore } from './teamerge-store'
import { MemberAvatar } from './team-ui'

function printable(data: string): string {
  return [...data]
    .map((ch) => {
      if (ch === '\r' || ch === '\n') {
        return '⏎'
      }
      if (ch === '\x7f') {
        return '⌫'
      }
      if (ch === '\x1b') {
        return '⎋'
      }
      const code = ch.charCodeAt(0)
      return code < 32 ? `^${String.fromCharCode(code + 64)}` : ch
    })
    .join('')
}

/** Owner-side approval cards for remote keystrokes, shown wherever the owner is in the app. */
export function KeystrokeApprovalStack(): React.JSX.Element | null {
  const shares = useTeamergeStore((s) => s.shares)
  const pending = Object.values(shares).flatMap((share) => share.pending)
  if (pending.length === 0) {
    return null
  }
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-12 z-50 flex w-[340px] flex-col gap-2"
      aria-live="polite"
    >
      {pending.slice(0, 4).map((request) => (
        <div
          key={request.id}
          role="alertdialog"
          aria-label={`${request.fromName} wants to type`}
          className="pointer-events-auto rounded-2xl border border-border bg-floating-surface p-3 shadow-floating backdrop-blur-xl reduce-effects:bg-popover"
        >
          <div className="flex items-center gap-2.5">
            <MemberAvatar memberId={request.fromMemberId} name={request.fromName} size={26} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{request.fromName} wants to type</div>
              <div className="flex items-center gap-1 text-2xs text-muted-foreground">
                <Keyboard className="size-3" />
                Into your shared agent pane
              </div>
            </div>
          </div>
          <pre className="mt-2 max-h-24 overflow-auto scrollbar-sleek rounded-lg bg-muted px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap break-all">
            {printable(request.data)}
          </pre>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void window.api.teamerge.setViewerMuted({
                  paneId: request.paneId,
                  memberId: request.fromMemberId,
                  muted: true
                })
              }
            >
              <VolumeX />
              Mute
            </Button>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void window.api.teamerge.decideKeystrokes({
                    paneId: request.paneId,
                    requestId: request.id,
                    approve: false
                  })
                }
              >
                Reject
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  void window.api.teamerge.decideKeystrokes({
                    paneId: request.paneId,
                    requestId: request.id,
                    approve: true
                  })
                }
              >
                Approve
              </Button>
            </div>
          </div>
        </div>
      ))}
      {pending.length > 4 ? (
        <div className="pointer-events-auto self-end rounded-full bg-muted px-2.5 py-1 text-2xs text-muted-foreground">
          {pending.length - 4} more waiting
        </div>
      ) : null}
    </div>
  )
}
