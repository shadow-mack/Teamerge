import { networkInterfaces } from 'node:os'
import { RELAY_DEFAULT_PORT } from './core/relay-protocol'
import { startRelayServer, type RelayServerHandle } from './core/relay-server'

/** The bundled relay, run on this machine so a team needs no server of its own. */
export class LocalRelayHost {
  private relay: RelayServerHandle | null = null

  /** Starts the relay and returns URLs teammates can reach. */
  async start(port = RELAY_DEFAULT_PORT): Promise<{ port: number; urls: string[] }> {
    this.relay ??= await startRelayServer({
      port,
      log: (line) => console.log(`[teamerge-relay] ${line}`)
    })
    const urls = [`ws://localhost:${this.relay.port}`]
    for (const list of Object.values(networkInterfaces())) {
      for (const address of list ?? []) {
        if (address.family === 'IPv4' && !address.internal) {
          urls.push(`ws://${address.address}:${this.relay.port}`)
        }
      }
    }
    return { port: this.relay.port, urls }
  }

  async stop(): Promise<void> {
    await this.relay?.close()
    this.relay = null
  }

  status(): { running: boolean; port: number | null; peers: number } {
    return {
      running: !!this.relay,
      port: this.relay?.port ?? null,
      peers: this.relay?.stats().peers ?? 0
    }
  }
}
