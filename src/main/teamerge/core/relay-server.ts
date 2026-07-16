import { createServer, type Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { verifyHello } from './identity'
import {
  RELAY_DEFAULT_PORT,
  RELAY_HELLO_MAX_SKEW_MS,
  RELAY_MAX_FRAME_BYTES,
  type ClientToRelay,
  type RelayToClient
} from './relay-protocol'

type Peer = { socket: WebSocket; teamId: string; memberId: string }

export type RelayServerHandle = {
  port: number
  close: () => Promise<void>
  stats: () => { teams: number; peers: number }
}

/**
 * The team-hosted relay: authenticates a signing key per connection and forwards sealed envelopes
 * between members of the same team id. It never holds keys that could open the envelopes.
 */
export function startRelayServer(
  options: { port?: number; host?: string; log?: (line: string) => void } = {}
): Promise<RelayServerHandle> {
  const log = options.log ?? (() => {})
  const rooms = new Map<string, Map<string, Set<Peer>>>()
  const http: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('teamerge relay\n')
  })
  const wss = new WebSocketServer({ server: http, maxPayload: RELAY_MAX_FRAME_BYTES })

  const send = (socket: WebSocket, message: RelayToClient): void => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }

  const peersOf = (teamId: string): string[] => [...(rooms.get(teamId)?.keys() ?? [])]

  const broadcastPeers = (teamId: string): void => {
    const peers = peersOf(teamId)
    for (const sockets of rooms.get(teamId)?.values() ?? []) {
      for (const peer of sockets) {
        send(peer.socket, { t: 'peers', peers })
      }
    }
  }

  wss.on('connection', (socket) => {
    let self: Peer | null = null
    const helloTimer = setTimeout(() => socket.close(4001, 'hello timeout'), 10_000)

    socket.on('message', (raw) => {
      let message: ClientToRelay
      try {
        message = JSON.parse(String(raw)) as ClientToRelay
      } catch {
        return
      }
      if (message.t === 'ping') {
        send(socket, { t: 'pong' })
        return
      }
      if (message.t === 'hello') {
        if (self) {
          return
        }
        const fresh = Math.abs(Date.now() - message.ts) < RELAY_HELLO_MAX_SKEW_MS
        if (
          !fresh ||
          !verifyHello(
            message.teamId,
            message.memberId,
            message.signPublicKey,
            message.ts,
            message.sig
          )
        ) {
          send(socket, { t: 'error', message: 'Signature check failed.' })
          socket.close(4003, 'unauthorized')
          return
        }
        clearTimeout(helloTimer)
        self = { socket, teamId: message.teamId, memberId: message.memberId }
        const room = rooms.get(self.teamId) ?? new Map<string, Set<Peer>>()
        rooms.set(self.teamId, room)
        const sockets = room.get(self.memberId) ?? new Set<Peer>()
        sockets.add(self)
        room.set(self.memberId, sockets)
        send(socket, { t: 'welcome', peers: peersOf(self.teamId) })
        broadcastPeers(self.teamId)
        log(`member ${self.memberId} joined team ${self.teamId.slice(0, 8)}`)
        return
      }
      if (message.t === 'send' && self) {
        // The sender id comes from the authenticated socket, never from the frame.
        if (message.env?.from !== self.memberId) {
          return
        }
        for (const peer of rooms.get(self.teamId)?.get(message.to) ?? []) {
          send(peer.socket, { t: 'msg', from: self.memberId, env: message.env })
        }
      }
    })

    socket.on('close', () => {
      clearTimeout(helloTimer)
      if (!self) {
        return
      }
      const room = rooms.get(self.teamId)
      const sockets = room?.get(self.memberId)
      sockets?.delete(self)
      if (sockets && sockets.size === 0) {
        room?.delete(self.memberId)
      }
      if (room && room.size === 0) {
        rooms.delete(self.teamId)
      } else {
        broadcastPeers(self.teamId)
      }
    })
  })

  return new Promise((resolve, reject) => {
    http.once('error', reject)
    http.listen(options.port ?? RELAY_DEFAULT_PORT, options.host ?? '0.0.0.0', () => {
      const address = http.address()
      const port =
        typeof address === 'object' && address ? address.port : (options.port ?? RELAY_DEFAULT_PORT)
      log(`teamerge relay listening on ${options.host ?? '0.0.0.0'}:${port}`)
      resolve({
        port,
        stats: () => ({
          teams: rooms.size,
          peers: [...rooms.values()].reduce((sum, room) => sum + room.size, 0)
        }),
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) {
              client.terminate()
            }
            wss.close(() => http.close(() => done()))
          })
      })
    })
  })
}
