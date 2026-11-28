import type { RaceAttempt, TeamergeEvent } from '../../../shared/teamerge/teamerge-types'
import {
  childTaskStatus,
  mergeAllReady,
  mergeChildIntoParent,
  updateFromParent
} from '../../teamerge/core/branch-flow'
import {
  assessEditRisk,
  claimFiles,
  computeCollisions,
  releaseClaims,
  summarizeByTask,
  type LocalTaskInput
} from '../../teamerge/core/collisions'
import { nodeGitRunner as run, worktreeChangedFiles } from '../../teamerge/core/git-runner'
import { HunkStager, readFileHunks } from '../../teamerge/core/hunks'
import {
  clearFinishedLanding,
  enqueueForLanding,
  landAll,
  readLandingQueue,
  removeFromLanding,
  undoLanding
} from '../../teamerge/core/landing-queue'
import { readRepoState, updateRepoState } from '../../teamerge/core/local-state'
import {
  compareRace,
  createRace,
  listRaces,
  pickRaceWinner,
  raceFileDiffs,
  removeRace
} from '../../teamerge/core/races'
import type { TeamergeService } from '../../teamerge/teamerge-service'

export type TeamergeHandle = <A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R> | R
) => void

/** Git-backed channels: collisions, claims, child tasks, landing, races and hunks. */
export function registerTeamergeRepoHandlers({
  handle,
  allowed,
  svc,
  broadcast
}: {
  handle: TeamergeHandle
  /** Throws unless the path is inside a registered repo or workspace. */
  allowed: (path: string) => Promise<string>
  svc: () => Promise<TeamergeService>
  broadcast: (event: TeamergeEvent) => void
}): void {
  const stager = new HunkStager(run)
  const allowedTasks = (tasks: LocalTaskInput[]): Promise<LocalTaskInput[]> =>
    Promise.all(
      tasks.map(async (task) => ({ ...task, worktreePath: await allowed(task.worktreePath) }))
    )

  // collisions and claims
  handle(
    'collisions',
    async (args: { repoPath: string; tasks: LocalTaskInput[]; memberName: string }) => {
      const collisions = await computeCollisions(
        run,
        await allowed(args.repoPath),
        await allowedTasks(args.tasks),
        (await svc()).presence.agents(),
        args.memberName
      )
      return { collisions, byTask: summarizeByTask(collisions) }
    }
  )
  handle(
    'claimFiles',
    async (args: {
      repoPath: string
      taskId: string
      branch: string
      paths: string[]
      note?: string
    }) => {
      const status = (await svc()).status()
      const claims = await claimFiles(
        run,
        await allowed(args.repoPath),
        {
          taskId: args.taskId,
          branch: args.branch,
          memberId: status.identity?.memberId ?? 'local',
          memberName: status.identity?.name ?? 'me',
          note: args.note
        },
        args.paths
      )
      await (await svc()).presence.broadcastClaims()
      return claims
    }
  )
  handle('releaseClaims', async (args: { repoPath: string; taskId: string; paths?: string[] }) => {
    const claims = await releaseClaims(run, await allowed(args.repoPath), args.taskId, args.paths)
    await (await svc()).presence.broadcastClaims()
    return claims
  })
  handle('listClaims', async (repoPath: string) => {
    const state = await readRepoState(run, await allowed(repoPath))
    return [...state.claims, ...state.remoteClaims]
  })
  handle(
    'assessEditRisk',
    async (args: {
      repoPath: string
      filePath: string
      selfTaskId: string | null
      tasks: LocalTaskInput[]
    }) =>
      assessEditRisk(
        run,
        await allowed(args.repoPath),
        args.filePath,
        args.selfTaskId,
        await allowedTasks(args.tasks)
      )
  )
  handle(
    'recordTasks',
    async (args: {
      repoPath: string
      tasks: Record<string, { taskName: string; parentBranch?: string; baseRef?: string }>
    }) =>
      updateRepoState(run, await allowed(args.repoPath), (state) => {
        state.tasks = args.tasks
      })
  )

  handle('taskChangedFiles', async (args: { worktreePath: string; baseRef: string }) =>
    worktreeChangedFiles(run, await allowed(args.worktreePath), args.baseRef).catch(
      (): string[] => []
    )
  )

  // child tasks
  handle('childStatus', async (args: { worktreePath: string; parentBranch: string }) =>
    childTaskStatus(run, await allowed(args.worktreePath), args.parentBranch)
  )
  handle('updateFromParent', async (args: { worktreePath: string; parentBranch: string }) =>
    updateFromParent(run, await allowed(args.worktreePath), args.parentBranch)
  )
  handle('mergeIntoParent', async (args: { worktreePath: string; parentBranch: string }) =>
    mergeChildIntoParent(run, await allowed(args.worktreePath), args.parentBranch)
  )
  handle('mergeAllReady', async (args: { worktreePaths: string[]; parentBranch: string }) =>
    mergeAllReady(
      run,
      await Promise.all(
        args.worktreePaths.map(async (worktreePath) => ({
          worktreePath: await allowed(worktreePath)
        }))
      ),
      args.parentBranch
    )
  )

  // landing queue
  const emitLanding = (queue: Awaited<ReturnType<typeof readLandingQueue>>): void =>
    broadcast({ type: 'landing', queue })
  handle('landingQueue', async (repoPath: string) => readLandingQueue(run, await allowed(repoPath)))
  handle(
    'enqueueLanding',
    async (args: {
      repoPath: string
      worktreePath: string
      taskName: string
      targetBranch: string
    }) => {
      const repoPath = await allowed(args.repoPath)
      const item = await enqueueForLanding(run, repoPath, {
        ...args,
        worktreePath: await allowed(args.worktreePath)
      })
      emitLanding(await readLandingQueue(run, repoPath))
      return item
    }
  )
  handle('removeLanding', async (args: { repoPath: string; id: string }) => {
    const repoPath = await allowed(args.repoPath)
    await removeFromLanding(run, repoPath, args.id)
    emitLanding(await readLandingQueue(run, repoPath))
  })
  handle('clearLanding', async (unchecked: string) => {
    const repoPath = await allowed(unchecked)
    await clearFinishedLanding(run, repoPath)
    emitLanding(await readLandingQueue(run, repoPath))
  })
  handle('landAll', async (unchecked: string) => {
    const repoPath = await allowed(unchecked)
    const queue = await landAll(run, repoPath, emitLanding)
    emitLanding(queue)
    return queue
  })
  handle('undoLanding', async (args: { repoPath: string; id: string }) => {
    const repoPath = await allowed(args.repoPath)
    const item = await undoLanding(run, repoPath, args.id)
    emitLanding(await readLandingQueue(run, repoPath))
    return item
  })

  // races
  handle('listRaces', async (repoPath: string) => listRaces(run, await allowed(repoPath)))
  handle(
    'createRace',
    async (args: { repoPath: string; title: string; baseRef: string; attempts: RaceAttempt[] }) =>
      createRace(run, await allowed(args.repoPath), {
        ...args,
        attempts: await Promise.all(
          args.attempts.map(async (attempt) => ({
            ...attempt,
            worktreePath: await allowed(attempt.worktreePath)
          }))
        )
      })
  )
  handle('compareRace', async (args: { repoPath: string; raceId: string }) => {
    const race = (await listRaces(run, await allowed(args.repoPath))).find(
      (entry) => entry.id === args.raceId
    )
    if (!race) {
      throw new Error('This race no longer exists.')
    }
    return compareRace(run, race)
  })
  handle('raceFileDiffs', async (args: { repoPath: string; raceId: string; filePath: string }) => {
    const race = (await listRaces(run, await allowed(args.repoPath))).find(
      (entry) => entry.id === args.raceId
    )
    if (!race) {
      throw new Error('This race no longer exists.')
    }
    return raceFileDiffs(run, race, args.filePath)
  })
  handle(
    'pickRaceWinner',
    async (args: { repoPath: string; raceId: string; winnerBranch: string }) =>
      pickRaceWinner(run, await allowed(args.repoPath), args.raceId, args.winnerBranch)
  )
  handle('removeRace', async (args: { repoPath: string; raceId: string }) =>
    removeRace(run, await allowed(args.repoPath), args.raceId)
  )

  // hunks
  handle('fileHunks', async (args: { worktreePath: string; filePath: string; staged: boolean }) =>
    readFileHunks(run, await allowed(args.worktreePath), args.filePath, args.staged)
  )
  handle('stageHunk', async (args: { worktreePath: string; filePath: string; hunkId: string }) =>
    stager.stage(await allowed(args.worktreePath), args.filePath, args.hunkId)
  )
  handle('unstageHunk', async (args: { worktreePath: string; filePath: string; hunkId: string }) =>
    stager.unstage(await allowed(args.worktreePath), args.filePath, args.hunkId)
  )
  handle('discardHunk', async (args: { worktreePath: string; filePath: string; hunkId: string }) =>
    stager.discard(await allowed(args.worktreePath), args.filePath, args.hunkId)
  )
  handle('undoHunk', async (worktreePath: string) => stager.undoLast(await allowed(worktreePath)))
  handle('hunkHistory', async (worktreePath: string) => stager.history(await allowed(worktreePath)))
}
