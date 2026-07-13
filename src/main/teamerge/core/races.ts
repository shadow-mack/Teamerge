import { randomUUID } from 'node:crypto'
import type {
  RaceAttempt,
  RaceFileComparison,
  RaceGroup
} from '../../../shared/teamerge/teamerge-types'
import { git, type GitRunner } from './git-runner'
import { readRepoState, updateRepoState } from './local-state'

export async function listRaces(run: GitRunner, repoPath: string): Promise<RaceGroup[]> {
  return (await readRepoState(run, repoPath)).races
}

export async function createRace(
  run: GitRunner,
  repoPath: string,
  input: { title: string; baseRef: string; attempts: RaceAttempt[] }
): Promise<RaceGroup> {
  const race: RaceGroup = { id: randomUUID(), createdAt: Date.now(), ...input }
  await updateRepoState(run, repoPath, (state) => {
    state.races.push(race)
  })
  return race
}

export async function addRaceAttempt(
  run: GitRunner,
  repoPath: string,
  raceId: string,
  attempt: RaceAttempt
): Promise<void> {
  await updateRepoState(run, repoPath, (state) => {
    state.races.find((race) => race.id === raceId)?.attempts.push(attempt)
  })
}

type AttemptStats = Map<string, { added: number; removed: number; blob: string | null }>

/** Changes of one attempt against the race base, including uncommitted and untracked work. */
async function attemptStats(
  run: GitRunner,
  attempt: RaceAttempt,
  baseRef: string
): Promise<AttemptStats> {
  const stats: AttemptStats = new Map()
  const mergeBase = (await git(run, attempt.worktreePath, ['merge-base', baseRef, 'HEAD'])).trim()
  const numstat = await git(run, attempt.worktreePath, ['diff', '--numstat', mergeBase])
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [added, removed, ...rest] = line.split('\t')
    stats.set(rest.join('\t'), {
      added: Number(added) || 0,
      removed: Number(removed) || 0,
      blob: null
    })
  }
  const untracked = await git(run, attempt.worktreePath, [
    'ls-files',
    '--others',
    '--exclude-standard'
  ])
  for (const file of untracked.split('\n').filter(Boolean)) {
    const lines = await git(
      run,
      attempt.worktreePath,
      ['diff', '--no-index', '--numstat', '/dev/null', file],
      { allowFailure: true }
    ).catch(() => '')
    const added = Number(lines.split('\t')[0]) || 0
    stats.set(file, { added, removed: 0, blob: null })
  }
  for (const [file, entry] of stats) {
    const hash = await run(attempt.worktreePath, ['hash-object', '--', file], {
      allowFailure: true
    })
    entry.blob = hash.code === 0 ? hash.stdout.trim() : 'deleted'
  }
  return stats
}

export async function compareRace(run: GitRunner, race: RaceGroup): Promise<RaceFileComparison[]> {
  const perAttempt = await Promise.all(
    race.attempts.map((attempt) => attemptStats(run, attempt, race.baseRef))
  )
  const files = new Set<string>()
  for (const stats of perAttempt) {
    for (const file of stats.keys()) {
      files.add(file)
    }
  }
  return [...files].sort().map((filePath) => {
    const entries = perAttempt.map((stats) => stats.get(filePath) ?? null)
    const blobs = new Set(entries.map((entry) => entry?.blob ?? 'untouched'))
    return {
      filePath,
      perAttempt: entries.map((entry) =>
        entry ? { added: entry.added, removed: entry.removed } : null
      ),
      identical: blobs.size === 1
    }
  })
}

/** One file's diff for each attempt, for the side-by-side view. */
export async function raceFileDiffs(
  run: GitRunner,
  race: RaceGroup,
  filePath: string
): Promise<string[]> {
  return Promise.all(
    race.attempts.map(async (attempt) => {
      const mergeBase = (
        await git(run, attempt.worktreePath, ['merge-base', race.baseRef, 'HEAD'])
      ).trim()
      const tracked = await git(run, attempt.worktreePath, [
        'diff',
        '--no-color',
        mergeBase,
        '--',
        filePath
      ])
      if (tracked) {
        return tracked
      }
      const untracked = await run(
        attempt.worktreePath,
        ['diff', '--no-color', '--no-index', '/dev/null', filePath],
        { allowFailure: true }
      )
      return untracked.stdout
    })
  )
}

/** Records the winner; the caller removes the losing worktrees through the normal workspace removal. */
export async function pickRaceWinner(
  run: GitRunner,
  repoPath: string,
  raceId: string,
  winnerBranch: string
): Promise<{ race: RaceGroup; losers: RaceAttempt[] }> {
  return updateRepoState(run, repoPath, (state) => {
    const race = state.races.find((entry) => entry.id === raceId)
    if (!race) {
      throw new Error('This race no longer exists.')
    }
    race.winnerBranch = winnerBranch
    const losers = race.attempts.filter((attempt) => attempt.branch !== winnerBranch)
    race.attempts = race.attempts.filter((attempt) => attempt.branch === winnerBranch)
    return { race: structuredClone(race), losers }
  })
}

export async function removeRace(run: GitRunner, repoPath: string, raceId: string): Promise<void> {
  await updateRepoState(run, repoPath, (state) => {
    state.races = state.races.filter((race) => race.id !== raceId)
  })
}
