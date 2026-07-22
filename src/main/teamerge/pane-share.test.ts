import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PaneShareHost } from './pane-share'
import { teamergeTapPtyOutput } from './pty-tap'
import type { TeamPayload } from './core/relay-client'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'teamerge-pane-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('pane sharing', () => {
  it('writes remote keystrokes only after approval, drops muted ones, and logs every decision', async () => {
    const sent: [string, TeamPayload][] = []
    const written: [string, string][] = []
    const host = new PaneShareHost(
      (to, payload) => sent.push([to, payload]),
      () => {},
      (pty, data) => {
        written.push([pty, data])
        return true
      },
      join(dir, 'audit.jsonl')
    )
    teamergeTapPtyOutput('pty-1', 'hello screen')
    host.setShared('pty-1', true)
    host.onSubscribe('bob', 'Bob', 'pty-1')
    expect(sent[0]).toEqual([
      'bob',
      { kind: 'pane-output', paneId: 'pty-1', data: 'hello screen', replay: true }
    ])

    host.onKeystrokes('bob', 'Bob', 'pty-1', 'ls\r')
    expect(written).toEqual([])
    const [first] = host.list()[0].pending
    host.decide('pty-1', first.id, true)
    expect(written).toEqual([['pty-1', 'ls\r']])

    host.onKeystrokes('bob', 'Bob', 'pty-1', 'rm -rf /\r')
    host.decide('pty-1', host.list()[0].pending[0].id, false)
    host.setMuted('pty-1', 'bob', true)
    host.onKeystrokes('bob', 'Bob', 'pty-1', 'x')
    expect(written).toHaveLength(1)
    expect(host.list()[0].pending).toEqual([])

    await new Promise((resolve) => setTimeout(resolve, 50))
    const audit = await host.readAudit()
    expect(audit.map((e) => [e.keys, e.decision])).toEqual([
      ['x', 'muted'],
      ['rm -rf /⏎', 'rejected'],
      ['ls⏎', 'approved']
    ])
    host.dispose()
  })
})
