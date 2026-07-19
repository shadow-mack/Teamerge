/** Keeps recent output per PTY so a teammate who starts watching sees the current screen, not a blank one. */
const RING_LIMIT = 192 * 1024
const rings = new Map<string, string>()
const listeners = new Set<(ptyId: string, data: string) => void>()

export function teamergeTapPtyOutput(ptyId: string, data: string): void {
  if (!data) {
    return
  }
  const next = (rings.get(ptyId) ?? '') + data
  rings.set(ptyId, next.length > RING_LIMIT ? next.slice(next.length - RING_LIMIT) : next)
  for (const listener of listeners) {
    listener(ptyId, data)
  }
}

export function teamergeForgetPty(ptyId: string): void {
  rings.delete(ptyId)
}

export function recentPtyOutput(ptyId: string): string {
  return rings.get(ptyId) ?? ''
}

export function onPtyOutput(listener: (ptyId: string, data: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
