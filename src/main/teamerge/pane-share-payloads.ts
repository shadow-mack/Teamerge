import type { TeamActivityEvent, TeamergeEvent } from '../../shared/teamerge/teamerge-types'
import type { TeamPayload } from './core/relay-client'
import type { PaneShareHost } from './pane-share'

const KEYSTROKE_RESULTS = new Set(['approved', 'rejected', 'muted'])

/** Routes live-pane payloads: viewer requests go to the host, owner output goes to the viewer. Returns false for other kinds. */
export function routePanePayload(
  panes: PaneShareHost,
  emit: (event: TeamergeEvent) => void,
  log: (kind: TeamActivityEvent['kind'], text: string) => void,
  sender: { id: string; name: string },
  payload: TeamPayload
): boolean {
  const paneId = typeof payload.paneId === 'string' ? payload.paneId : ''
  switch (payload.kind) {
    case 'pane-subscribe':
      panes.onSubscribe(sender.id, sender.name, paneId)
      return true
    case 'pane-unsubscribe':
      panes.onUnsubscribe(sender.id, paneId)
      return true
    case 'pane-keys':
      if (typeof payload.data === 'string') {
        panes.onKeystrokes(sender.id, sender.name, paneId, payload.data)
      }
      return true
    case 'pane-output':
      emit({
        type: 'pane-output',
        ownerId: sender.id,
        paneId,
        data: typeof payload.data === 'string' ? payload.data : '',
        replay: payload.replay === true
      })
      return true
    case 'pane-control':
      emit({ type: 'pane-control', ownerId: sender.id, paneId, muted: payload.muted === true })
      return true
    case 'pane-ended':
      emit({ type: 'pane-control', ownerId: sender.id, paneId, muted: false, ended: true })
      return true
    case 'pane-keys-result':
      if (typeof payload.status === 'string' && KEYSTROKE_RESULTS.has(payload.status)) {
        log('keystrokes', `${sender.name} ${payload.status} your keystrokes.`)
      }
      return true
    default:
      return false
  }
}
