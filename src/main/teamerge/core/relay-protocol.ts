import type { SealedEnvelope } from './identity'

/** Wire format between clients and the relay. Content is always a sealed envelope the relay can't read. */
export type ClientToRelay =
  | { t: 'hello'; teamId: string; memberId: string; signPublicKey: string; ts: number; sig: string }
  | { t: 'send'; to: string; env: SealedEnvelope }
  | { t: 'ping' }

export type RelayToClient =
  | { t: 'welcome'; peers: string[] }
  | { t: 'peers'; peers: string[] }
  | { t: 'msg'; from: string; env: SealedEnvelope }
  | { t: 'error'; message: string }
  | { t: 'pong' }

export const RELAY_DEFAULT_PORT = 7787
/** Clock skew window for signed hellos. */
export const RELAY_HELLO_MAX_SKEW_MS = 5 * 60 * 1000
/** Hard cap so a client can't use the relay to push unbounded blobs. */
export const RELAY_MAX_FRAME_BYTES = 4 * 1024 * 1024
