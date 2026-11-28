import WebSocket from 'ws'
import type { RelayConnectionState, TeamFile } from '../../../shared/teamerge/teamerge-types'
import { ENVELOPE_MAX_AGE_MS, helloSignature, open, seal, type TeamIdentity } from './identity'
import type { ClientToRelay, RelayToClient } from './relay-protocol'

export type TeamPayload = { kind: string } & Record<string, unknown>

function isTeamPayload(value: unknown): value is TeamPayload {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'
  )
}

export type RelayClientEvents = {
  onState: (state: RelayConnectionState, error?: string) => void
  onPeers: (memberIds: string[]) => void
  onPayload: (senderId: string, senderName: string, payload: TeamPayload) => void
}

/** End-to-end encrypted connection to the team relay, with reconnect backoff. */
export class RelayClient {
  private socket: WebSocket | null = null
  private closed = false
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private peers: string[] = []
  /** Nonces opened within the envelope age window; a repeat is a replay. */
  private seenNonces = new Map<string, number>()

  constructor(
    private readonly identity: TeamIdentity,
    private team: TeamFile,
    private readonly events: RelayClientEvents
  ) {}

  updateTeam(team: TeamFile): void {
    this.team = team
  }

  get onlinePeers(): string[] {
    return this.peers
  }

  connect(): void {
    this.closed = false
    this.open()
  }

  private open(): void {
    if (this.closed) {
      return
    }
    this.events.onState('connecting')
    let socket: WebSocket
    try {
      socket = new WebSocket(this.team.relayUrl, { handshakeTimeout: 10_000 })
    } catch (error) {
      this.events.onState('error', error instanceof Error ? error.message : String(error))
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.on('open', () => {
      const ts = Date.now()
      this.raw({
        t: 'hello',
        teamId: this.team.teamId,
        memberId: this.identity.memberId,
        signPublicKey: this.identity.signPublicKey,
        ts,
        sig: helloSignature(this.identity, this.team.teamId, ts)
      })
    })
    socket.on('message', (data) => {
      let message: RelayToClient
      try {
        message = JSON.parse(String(data)) as RelayToClient
      } catch {
        return
      }
      if (message.t === 'welcome' || message.t === 'peers') {
        if (message.t === 'welcome') {
          this.retry = 0
          this.events.onState('connected')
          this.pingTimer = setInterval(() => this.raw({ t: 'ping' }), 25_000)
        }
        this.peers = message.peers.filter((id) => id !== this.identity.memberId)
        this.events.onPeers(this.peers)
      } else if (message.t === 'msg') {
        const opened = open(this.identity, this.team, message.env)
        if (
          opened &&
          opened.sender.id === message.from &&
          isTeamPayload(opened.payload) &&
          this.firstSighting(message.env.nonce)
        ) {
          this.events.onPayload(opened.sender.id, opened.sender.name, opened.payload)
        }
      } else if (message.t === 'error') {
        this.events.onState('error', message.message)
      }
    })
    socket.on('error', (error) => {
      this.events.onState('error', error.message)
    })
    socket.on('close', () => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer)
        this.pingTimer = null
      }
      this.socket = null
      this.peers = []
      this.events.onPeers([])
      if (!this.closed) {
        this.events.onState('connecting')
        this.scheduleReconnect()
      } else {
        this.events.onState('disconnected')
      }
    })
  }

  private firstSighting(nonce: string): boolean {
    const now = Date.now()
    if (this.seenNonces.has(nonce)) {
      return false
    }
    for (const [seen, at] of this.seenNonces) {
      if (now - at <= ENVELOPE_MAX_AGE_MS * 2) {
        break
      }
      this.seenNonces.delete(seen)
    }
    this.seenNonces.set(nonce, now)
    return true
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retryTimer) {
      return
    }
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.open()
    }, delay)
  }

  private raw(message: ClientToRelay): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }

  /** Seals separately for each recipient so only that member can read it. */
  send(to: string | 'everyone', payload: TeamPayload): void {
    const recipients =
      to === 'everyone'
        ? this.team.members.filter(
            (member) => member.id !== this.identity.memberId && this.peers.includes(member.id)
          )
        : this.team.members.filter((member) => member.id === to)
    for (const member of recipients) {
      this.raw({ t: 'send', to: member.id, env: seal(this.identity, this.team, member, payload) })
    }
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  close(): void {
    this.closed = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.socket?.close()
    this.socket = null
  }
}
