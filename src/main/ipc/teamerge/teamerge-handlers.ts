/* oxlint-disable eslint/max-lines */
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import {
  TEAMERGE_EVENT_CHANNEL,
  type LocalTaskAnnouncement,
  type RaceAttempt,
  type TeamergeEvent
} from '../../../shared/teamerge/teamerge-types'
import { tryGetProviderForPty } from '../pty/provider/registry'
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
import { nodeGitRunner, worktreeChangedFiles } from '../../teamerge/core/git-runner'
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
import { TeamergeService } from '../../teamerge/teamerge-service'

const run = nodeGitRunner
let service: TeamergeService | null = null

function broadcast(event: TeamergeEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(TEAMERGE_EVENT_CHANNEL, event)
    }
  }
}

function writePty(ptyId: string, data: string): boolean {
  const provider = tryGetProviderForPty(ptyId)
  if (!provider) {
    return false
  }
  try {
    return provider.write(ptyId, data) !== false
  } catch (error) {
    console.error('[teamerge] pty write failed', error)
    return false
  }
}

export function getTeamergeService(): TeamergeService | null {
  return service
}

/** Registers every `teamerge:*` channel. The renderer reaches them through `window.api.teamerge`. */
export function registerTeamergeHandlers(): void {
  service = new TeamergeService({
    dataDir: join(app.getPath('userData'), 'teamerge'),
    run,
    emit: broadcast,
    writePty
  })
  const ready = service.init().catch((error) => console.error('[teamerge] init failed', error))
  const svc = async (): Promise<TeamergeService> => {
    await ready
    return service as TeamergeService
  }
  const stager = new HunkStager(run)
  app.on('will-quit', () => service?.dispose())

  const handle = <A extends unknown[], R>(
    channel: string,
    fn: (...args: A) => Promise<R> | R
  ): void => {
    ipcMain.handle(`teamerge:${channel}`, async (_event, ...args) => fn(...(args as A)))
  }

  // team, identity and relay
  handle('status', async () => (await svc()).status())
  handle('setRepo', async (repoPath: string | null) => (await svc()).setRepo(repoPath))
  handle('createTeam', async (args: { name: string; relayUrl: string }) =>
    (await svc()).createTeam(args.name, args.relayUrl)
  )
  handle('joinTeam', async () => (await svc()).joinTeam())
  handle('updateTeamSettings', async (patch: { name?: string; relayUrl?: string }) =>
    (await svc()).updateTeamSettings(patch)
  )
  handle('removeMember', async (memberId: string) => (await svc()).removeMember(memberId))
  handle('commitTeamFile', async () => (await svc()).commitTeamFile())
  handle('setDisplayName', async (name: string) => (await svc()).setDisplayName(name))
  handle('startLocalRelay', async (port?: number) => (await svc()).startLocalRelay(port))
  handle('stopLocalRelay', async () => (await svc()).stopLocalRelay())
  handle('localRelayStatus', async () => (await svc()).localRelayStatus())
  handle('snapshot', async () => (await svc()).snapshot())

  // presence and live panes
  handle('announceTasks', async (tasks: LocalTaskAnnouncement[]) =>
    (await svc()).announceTasks(tasks)
  )
  handle('setPaneShared', async (args: { paneId: string; shared: boolean }) =>
    (await svc()).setPaneShared(args.paneId, args.shared)
  )
  handle('listPaneShares', async () => (await svc()).panes.list())
  handle('setViewerMuted', async (args: { paneId: string; memberId: string; muted: boolean }) =>
    (await svc()).panes.setMuted(args.paneId, args.memberId, args.muted)
  )
  handle(
    'decideKeystrokes',
    async (args: { paneId: string; requestId: string; approve: boolean }) =>
      (await svc()).panes.decide(args.paneId, args.requestId, args.approve)
  )
  handle('readPaneAudit', async () => (await svc()).panes.readAudit())
  handle('watchPane', async (args: { ownerId: string; paneId: string }) =>
    (await svc()).watchPane(args.ownerId, args.paneId)
  )
  handle('unwatchPane', async (args: { ownerId: string; paneId: string }) =>
    (await svc()).unwatchPane(args.ownerId, args.paneId)
  )
  handle('sendKeystrokes', async (args: { ownerId: string; paneId: string; data: string }) =>
    (await svc()).sendKeystrokes(args.ownerId, args.paneId, args.data)
  )

  // handoffs, reviews, notes, messages
  handle('sendHandoff', async (args: Parameters<TeamergeService['sendHandoff']>[0]) =>
    (await svc()).sendHandoff(args)
  )
  handle('prepareHandoffBranch', async (id: string) => (await svc()).prepareHandoffBranch(id))
  handle('setHandoffStatus', async (args: { id: string; status: 'taken' | 'declined' }) =>
    (await svc()).setHandoffStatus(args.id, args.status)
  )
  handle('requestReview', async (args: Parameters<TeamergeService['requestReview']>[0]) =>
    (await svc()).requestReview(args)
  )
  handle('addReviewComment', async (args: Parameters<TeamergeService['addReviewComment']>[0]) =>
    (await svc()).addReviewComment(args)
  )
  handle(
    'setReviewStatus',
    async (args: { id: string; status: 'requested' | 'in-review' | 'done' }) =>
      (await svc()).setReviewStatus(args.id, args.status)
  )
  handle('redeliverComment', async (args: { commentId: string; paneId: string }) =>
    (await svc()).redeliverComment(args.commentId, args.paneId)
  )
  handle('saveNote', async (args: { id?: string; title: string; body: string }) =>
    (await svc()).saveNote(args)
  )
  handle('deleteNote', async (id: string) => (await svc()).deleteNote(id))
  handle('sendMessage', async (args: Parameters<TeamergeService['sendMessage']>[0]) =>
    (await svc()).sendMessage(args)
  )

  // collisions and claims
  handle(
    'collisions',
    async (args: { repoPath: string; tasks: LocalTaskInput[]; memberName: string }) => {
      const collisions = await computeCollisions(
        run,
        args.repoPath,
        args.tasks,
        (await svc()).presence(),
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
        args.repoPath,
        {
          taskId: args.taskId,
          branch: args.branch,
          memberId: status.identity?.memberId ?? 'local',
          memberName: status.identity?.name ?? 'me',
          note: args.note
        },
        args.paths
      )
      await (await svc()).broadcastClaims()
      return claims
    }
  )
  handle('releaseClaims', async (args: { repoPath: string; taskId: string; paths?: string[] }) => {
    const claims = await releaseClaims(run, args.repoPath, args.taskId, args.paths)
    await (await svc()).broadcastClaims()
    return claims
  })
  handle('listClaims', async (repoPath: string) => {
    const state = await readRepoState(run, repoPath)
    return [...state.claims, ...state.remoteClaims]
  })
  handle(
    'assessEditRisk',
    async (args: {
      repoPath: string
      filePath: string
      selfTaskId: string | null
      tasks: LocalTaskInput[]
    }) => assessEditRisk(run, args.repoPath, args.filePath, args.selfTaskId, args.tasks)
  )
  handle(
    'recordTasks',
    async (args: {
      repoPath: string
      tasks: Record<string, { taskName: string; parentBranch?: string; baseRef?: string }>
    }) =>
      updateRepoState(run, args.repoPath, (state) => {
        state.tasks = args.tasks
      })
  )

  handle('taskChangedFiles', async (args: { worktreePath: string; baseRef: string }) =>
    worktreeChangedFiles(run, args.worktreePath, args.baseRef).catch((): string[] => [])
  )

  // child tasks
  handle('childStatus', async (args: { worktreePath: string; parentBranch: string }) =>
    childTaskStatus(run, args.worktreePath, args.parentBranch)
  )
  handle('updateFromParent', async (args: { worktreePath: string; parentBranch: string }) =>
    updateFromParent(run, args.worktreePath, args.parentBranch)
  )
  handle('mergeIntoParent', async (args: { worktreePath: string; parentBranch: string }) =>
    mergeChildIntoParent(run, args.worktreePath, args.parentBranch)
  )
  handle('mergeAllReady', async (args: { worktreePaths: string[]; parentBranch: string }) =>
    mergeAllReady(
      run,
      args.worktreePaths.map((worktreePath) => ({ worktreePath })),
      args.parentBranch
    )
  )

  // landing queue
  const emitLanding = (queue: Awaited<ReturnType<typeof readLandingQueue>>): void =>
    broadcast({ type: 'landing', queue })
  handle('landingQueue', async (repoPath: string) => readLandingQueue(run, repoPath))
  handle(
    'enqueueLanding',
    async (args: {
      repoPath: string
      worktreePath: string
      taskName: string
      targetBranch: string
    }) => {
      const item = await enqueueForLanding(run, args.repoPath, args)
      emitLanding(await readLandingQueue(run, args.repoPath))
      return item
    }
  )
  handle('removeLanding', async (args: { repoPath: string; id: string }) => {
    await removeFromLanding(run, args.repoPath, args.id)
    emitLanding(await readLandingQueue(run, args.repoPath))
  })
  handle('clearLanding', async (repoPath: string) => {
    await clearFinishedLanding(run, repoPath)
    emitLanding(await readLandingQueue(run, repoPath))
  })
  handle('landAll', async (repoPath: string) => {
    const queue = await landAll(run, repoPath, emitLanding)
    emitLanding(queue)
    return queue
  })
  handle('undoLanding', async (args: { repoPath: string; id: string }) => {
    const item = await undoLanding(run, args.repoPath, args.id)
    emitLanding(await readLandingQueue(run, args.repoPath))
    return item
  })

  // races
  handle('listRaces', async (repoPath: string) => listRaces(run, repoPath))
  handle(
    'createRace',
    async (args: { repoPath: string; title: string; baseRef: string; attempts: RaceAttempt[] }) =>
      createRace(run, args.repoPath, args)
  )
  handle('compareRace', async (args: { repoPath: string; raceId: string }) => {
    const race = (await listRaces(run, args.repoPath)).find((entry) => entry.id === args.raceId)
    if (!race) {
      throw new Error('This race no longer exists.')
    }
    return compareRace(run, race)
  })
  handle('raceFileDiffs', async (args: { repoPath: string; raceId: string; filePath: string }) => {
    const race = (await listRaces(run, args.repoPath)).find((entry) => entry.id === args.raceId)
    if (!race) {
      throw new Error('This race no longer exists.')
    }
    return raceFileDiffs(run, race, args.filePath)
  })
  handle(
    'pickRaceWinner',
    async (args: { repoPath: string; raceId: string; winnerBranch: string }) =>
      pickRaceWinner(run, args.repoPath, args.raceId, args.winnerBranch)
  )
  handle('removeRace', async (args: { repoPath: string; raceId: string }) =>
    removeRace(run, args.repoPath, args.raceId)
  )

  // hunks
  handle('fileHunks', async (args: { worktreePath: string; filePath: string; staged: boolean }) =>
    readFileHunks(run, args.worktreePath, args.filePath, args.staged)
  )
  handle('stageHunk', async (args: { worktreePath: string; filePath: string; hunkId: string }) =>
    stager.stage(args.worktreePath, args.filePath, args.hunkId)
  )
  handle('unstageHunk', async (args: { worktreePath: string; filePath: string; hunkId: string }) =>
    stager.unstage(args.worktreePath, args.filePath, args.hunkId)
  )
  handle('discardHunk', async (args: { worktreePath: string; filePath: string; hunkId: string }) =>
    stager.discard(args.worktreePath, args.filePath, args.hunkId)
  )
  handle('undoHunk', async (worktreePath: string) => stager.undoLast(worktreePath))
  handle('hunkHistory', async (worktreePath: string) => stager.history(worktreePath))
}
