import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  FileClaim,
  LandingItem,
  RaceGroup,
  TeamAgentMessage,
  TeamAgentPresence
} from '../../../shared/teamerge/teamerge-types'
import { commonGitDir, type GitRunner } from './git-runner'

/** Per-repo coordination state, kept in the shared git dir so every worktree and the CLI see it. */
export type TeamergeRepoState = {
  claims: FileClaim[]
  landing: LandingItem[]
  races: RaceGroup[]
  /** worktree path -> task metadata recorded by Teamerge. */
  tasks: Record<string, { taskName: string; parentBranch?: string; baseRef?: string }>
  /** Mirror of teammates' presence for the CLI; written by the app. */
  remoteAgents: TeamAgentPresence[]
  remoteClaims: FileClaim[]
  messages: TeamAgentMessage[]
}

const EMPTY: TeamergeRepoState = {
  claims: [],
  landing: [],
  races: [],
  tasks: {},
  remoteAgents: [],
  remoteClaims: [],
  messages: []
}

export async function teamergeStateDir(run: GitRunner, cwd: string): Promise<string> {
  return join(await commonGitDir(run, cwd), 'teamerge')
}

const writeChains = new Map<string, Promise<unknown>>()

export async function readRepoState(run: GitRunner, cwd: string): Promise<TeamergeRepoState> {
  const file = join(await teamergeStateDir(run, cwd), 'state.json')
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<TeamergeRepoState>
    return { ...EMPTY, ...parsed }
  } catch {
    return structuredClone(EMPTY)
  }
}

/** Serialized read-modify-write so concurrent IPC calls can't drop each other's updates. */
export async function updateRepoState<T>(
  run: GitRunner,
  cwd: string,
  mutate: (state: TeamergeRepoState) => T
): Promise<T> {
  const dir = await teamergeStateDir(run, cwd)
  const prior = writeChains.get(dir) ?? Promise.resolve()
  const next = prior
    .catch(() => undefined)
    .then(async () => {
      const state = await readRepoState(run, cwd)
      const result = mutate(state)
      await mkdir(dir, { recursive: true })
      const tmp = join(dir, `state.${process.pid}.${Date.now()}.tmp`)
      await writeFile(tmp, JSON.stringify(state, null, 2))
      await rename(tmp, join(dir, 'state.json'))
      return result
    })
  writeChains.set(dir, next)
  return next
}
