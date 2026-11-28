import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { childTaskStatus, mergeAllReady, updateFromParent } from './branch-flow'
import { assessEditRisk, claimFiles, computeCollisions } from './collisions'
import { git, nodeGitRunner as run } from './git-runner'
import { HunkStager, readFileHunks } from './hunks'
import { createIdentity, createTeamFile, joinTeamFile, open, seal } from './identity'
import { enqueueForLanding, landAll, undoLanding } from './landing-queue'
import { compareRace, createRace, pickRaceWinner } from './races'
import { RelayClient, type TeamPayload } from './relay-client'
import { startRelayServer } from './relay-server'
import { isSafeBranchName, toTypeableLine, withoutControlChars } from './teammate-input'

let root: string
let repo: string

async function sh(cwd: string, ...args: string[]): Promise<string> {
  return git(run, cwd, args)
}

async function commitFile(
  cwd: string,
  file: string,
  content: string,
  message: string
): Promise<void> {
  await writeFile(join(cwd, file), content)
  await sh(cwd, 'add', file)
  await sh(cwd, 'commit', '-qm', message)
}

async function addWorktree(name: string, base: string): Promise<string> {
  const path = join(root, name)
  await sh(repo, 'worktree', 'add', '-q', '-b', name, path, base)
  return path
}

const lines = (n: number, edit: Record<number, string> = {}): string =>
  `${Array.from({ length: n }, (_, i) => edit[i + 1] ?? `line ${i + 1}`).join('\n')}\n`

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'teamerge-'))
  repo = join(root, 'repo')
  await sh(root, 'init', '-q', '-b', 'main', repo)
  await sh(repo, 'config', 'user.email', 't@example.com')
  await sh(repo, 'config', 'user.name', 'T')
  await commitFile(repo, 'a.txt', lines(30), 'init')
  await commitFile(repo, 'b.txt', 'b\n', 'b')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('hunk staging', () => {
  it('stages one hunk, discards another, and undoes both', async () => {
    await writeFile(join(repo, 'a.txt'), lines(30, { 2: 'TOP', 28: 'BOTTOM' }))
    const file = await readFileHunks(run, repo, 'a.txt', false)
    expect(file?.hunks).toHaveLength(2)
    const stager = new HunkStager(run)
    await stager.stage(repo, 'a.txt', file!.hunks[0].id)
    expect(await sh(repo, 'diff', '--cached', '--name-only')).toBe('a.txt\n')
    expect((await readFileHunks(run, repo, 'a.txt', true))?.hunks[0].lines).toContain('+TOP')
    const remaining = await readFileHunks(run, repo, 'a.txt', false)
    expect(remaining?.hunks).toHaveLength(1)
    await stager.discard(repo, 'a.txt', remaining!.hunks[0].id)
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe(lines(30, { 2: 'TOP' }))
    await stager.undoLast(repo)
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe(lines(30, { 2: 'TOP', 28: 'BOTTOM' }))
    await stager.undoLast(repo)
    expect(await sh(repo, 'diff', '--cached', '--name-only')).toBe('')
  })
})

describe('child tasks', () => {
  it('updates from parent and merges all ready children back', async () => {
    const parent = await addWorktree('parent', 'main')
    const childA = await addWorktree('child-a', 'parent')
    const childB = await addWorktree('child-b', 'parent')
    await commitFile(parent, 'p.txt', 'p\n', 'parent work')
    expect((await childTaskStatus(run, childA, 'parent')).behind).toBe(1)
    expect(await updateFromParent(run, childA, 'parent')).toEqual({ ok: true, updated: true })
    await commitFile(childA, 'ca.txt', 'a\n', 'child a')
    await commitFile(childB, 'cb.txt', 'b\n', 'child b')
    const results = await mergeAllReady(
      run,
      [{ worktreePath: childA }, { worktreePath: childB }],
      'parent'
    )
    expect(results.map((r) => r.outcome.ok)).toEqual([true, true])
    const files = await sh(parent, 'ls-files')
    expect(files).toContain('ca.txt')
    expect(files).toContain('cb.txt')
  })
})

describe('landing queue', () => {
  it('lands clean tasks in order, skips a conflicting one, and undoes the last landing', async () => {
    const one = await addWorktree('one', 'main')
    const two = await addWorktree('two', 'main')
    const three = await addWorktree('three', 'main')
    await commitFile(one, 'a.txt', lines(30, { 5: 'one' }), 'one')
    await commitFile(two, 'a.txt', lines(30, { 5: 'two' }), 'two')
    await commitFile(three, 'c.txt', 'c\n', 'three')
    for (const [path, name] of [
      [one, 'one'],
      [two, 'two'],
      [three, 'three']
    ]) {
      await enqueueForLanding(run, repo, {
        worktreePath: path,
        taskName: name,
        targetBranch: 'main'
      })
    }
    const queue = await landAll(run, repo)
    expect(queue.items.map((i) => i.status)).toEqual(['landed', 'skipped', 'landed'])
    expect(queue.items[1].reason).toContain('a.txt')
    const before = await sh(repo, 'rev-parse', 'HEAD')
    await undoLanding(run, repo, queue.items[2].id)
    expect(await sh(repo, 'rev-parse', 'HEAD')).not.toBe(before)
    expect(await sh(repo, 'ls-files')).not.toContain('c.txt')
    await expect(undoLanding(run, repo, queue.items[2].id)).rejects.toThrow()
  })
})

describe('collisions and claims', () => {
  it('flags overlapping files and turns red only when the merge conflicts', async () => {
    const x = await addWorktree('x', 'main')
    const y = await addWorktree('y', 'main')
    await writeFile(join(x, 'a.txt'), lines(30, { 1: 'x-top' }))
    await writeFile(join(y, 'a.txt'), lines(30, { 30: 'y-bottom' }))
    await writeFile(join(x, 'b.txt'), 'x\n')
    await writeFile(join(y, 'b.txt'), 'y\n')
    const tasks = [
      { taskId: 'x', taskName: 'X', worktreePath: x, branch: 'x', baseRef: 'main' },
      { taskId: 'y', taskName: 'Y', worktreePath: y, branch: 'y', baseRef: 'main' }
    ]
    const collisions = await computeCollisions(run, repo, tasks, [], 'me')
    expect(collisions.map((c) => [c.filePath, c.conflict])).toEqual([
      ['b.txt', true],
      ['a.txt', false]
    ])
    await claimFiles(run, repo, { taskId: 'y', branch: 'y', memberId: 'm', memberName: 'Sam' }, [
      'b.txt'
    ])
    const risk = await assessEditRisk(run, repo, 'b.txt', 'x', tasks)
    expect(risk.level).toBe('claimed')
    expect(risk.messages.join(' ')).toContain('Sam claimed b.txt')
  })
})

describe('races', () => {
  it('compares attempts file by file and keeps the winner', async () => {
    const r1 = await addWorktree('r1', 'main')
    const r2 = await addWorktree('r2', 'main')
    await writeFile(join(r1, 'b.txt'), 'same\n')
    await writeFile(join(r2, 'b.txt'), 'same\n')
    await writeFile(join(r2, 'new.txt'), 'n\n')
    const race = await createRace(run, repo, {
      title: 'Fix',
      baseRef: 'main',
      attempts: [
        { worktreePath: r1, branch: 'r1', label: 'A', agent: 'claude' },
        { worktreePath: r2, branch: 'r2', label: 'B', agent: 'codex' }
      ]
    })
    const comparison = await compareRace(run, race)
    expect(comparison).toEqual([
      {
        filePath: 'b.txt',
        perAttempt: [
          { added: 1, removed: 1 },
          { added: 1, removed: 1 }
        ],
        identical: true
      },
      { filePath: 'new.txt', perAttempt: [null, { added: 1, removed: 0 }], identical: false }
    ])
    const { losers } = await pickRaceWinner(run, repo, race.id, 'r2')
    expect(losers.map((l) => l.branch)).toEqual(['r1'])
  })
})

describe('end-to-end encryption and relay', () => {
  it('delivers sealed payloads only to roster members, and the relay sees ciphertext', async () => {
    const alice = createIdentity('Alice')
    const bob = createIdentity('Bob')
    const mallory = createIdentity('Mallory')
    const team = joinTeamFile(createTeamFile(alice, 'Team', ''), bob)
    const bobMember = team.members.find((m) => m.id === bob.memberId)!
    const env = seal(alice, team, bobMember, { kind: 'x', secret: 's3cret' })
    expect(JSON.stringify(env)).not.toContain('s3cret')
    expect(open(bob, team, env)?.payload).toEqual({ kind: 'x', secret: 's3cret' })
    expect(open(mallory, team, env)).toBeNull()

    const sentAt = 1_000_000
    const old = seal(alice, team, bobMember, { kind: 'x' }, sentAt)
    expect(open(bob, team, old, sentAt + 60_000)).not.toBeNull()
    expect(open(bob, team, old, sentAt + 10 * 60_000)).toBeNull()
    const otherTeam = seal(alice, { teamId: 'another-team' }, bobMember, { kind: 'x' })
    expect(open(bob, team, otherTeam)).toBeNull()

    const relay = await startRelayServer({ port: 0, host: '127.0.0.1' })
    team.relayUrl = `ws://127.0.0.1:${relay.port}`
    const received: TeamPayload[] = []
    const a = new RelayClient(alice, team, {
      onState: () => {},
      onPeers: () => {},
      onPayload: () => {}
    })
    const b = new RelayClient(bob, team, {
      onState: () => {},
      onPeers: () => {},
      onPayload: (_id, name, payload) => received.push({ ...payload, name })
    })
    a.connect()
    b.connect()
    await vi.waitFor(() => {
      expect(a.onlinePeers).toHaveLength(1)
      expect(b.onlinePeers).toHaveLength(1)
    })
    a.send('everyone', { kind: 'hello', text: 'hi bob' })
    await vi.waitFor(() =>
      expect(received).toEqual([{ kind: 'hello', text: 'hi bob', name: 'Alice' }])
    )
    a.close()
    b.close()
    await relay.close()
  })
})

describe('teammate input', () => {
  it('rejects branch names git could read as options and strips control keys', () => {
    expect(isSafeBranchName('feature/login-fix')).toBe(true)
    for (const bad of ['--upload-pack=touch /tmp/x', '-x', 'a..b', 'a b', 'a:b', 'x.lock', '']) {
      expect(isSafeBranchName(bad)).toBe(false)
    }
    expect(toTypeableLine('fix it\x1b[2J\x03 now\r\nplease')).toBe('fix it now please')
    expect(withoutControlChars('line one\r\n\tline\x1b two\x1b[31m red\x1b]0;title\x07')).toBe(
      'line one\n\tline two red'
    )
  })
})
