import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import {
  TEAMERGE_EVENT_CHANNEL,
  type LocalTaskAnnouncement,
  type TeamergeEvent
} from '../../../shared/teamerge/teamerge-types'
import type { Store } from '../../persistence/loading-store/store'
import { resolveAuthorizedPath } from '../filesystem/access/filesystem-auth'
import { tryGetProviderForPty } from '../pty/provider/registry'
import { nodeGitRunner } from '../../teamerge/core/git-runner'
import { TeamergeService } from '../../teamerge/teamerge-service'
import { registerTeamergeRepoHandlers, type TeamergeHandle } from './teamerge-repo-handlers'

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
export function registerTeamergeHandlers(store: Store): void {
  // A replaced macOS window re-attaches services; IPC channels may only be registered once.
  if (service) {
    return
  }
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
  app.on('will-quit', () => service?.dispose())

  // Every repo or worktree path from the renderer must sit inside a registered repo or workspace.
  const allowed = async (path: string): Promise<string> => {
    await resolveAuthorizedPath(path, store)
    return path
  }

  const handle: TeamergeHandle = (channel, fn) => {
    ipcMain.handle(`teamerge:${channel}`, async (_event, ...args: Parameters<typeof fn>) =>
      fn(...args)
    )
  }

  // team, identity and relay
  handle('status', async () => (await svc()).status())
  handle('setRepo', async (repoPath: string | null) =>
    (await svc()).setRepo(repoPath ? await allowed(repoPath) : null)
  )
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
  handle('startLocalRelay', async (port?: number) => (await svc()).localRelay.start(port))
  handle('stopLocalRelay', async () => (await svc()).localRelay.stop())
  handle('localRelayStatus', async () => (await svc()).localRelay.status())
  handle('snapshot', async () => (await svc()).snapshot())

  // presence and live panes
  handle('announceTasks', async (tasks: LocalTaskAnnouncement[]) =>
    (await svc()).presence.announceTasks(tasks)
  )
  handle('setPaneShared', async (args: { paneId: string; shared: boolean }) =>
    (await svc()).presence.setPaneShared(args.paneId, args.shared)
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
  handle('sendHandoff', async (args: Parameters<TeamergeService['handoffs']['send']>[0]) =>
    (await svc()).handoffs.send({ ...args, worktreePath: await allowed(args.worktreePath) })
  )
  handle('prepareHandoffBranch', async (id: string) => (await svc()).handoffs.prepareBranch(id))
  handle('setHandoffStatus', async (args: { id: string; status: 'taken' | 'declined' }) =>
    (await svc()).handoffs.setStatus(args.id, args.status)
  )
  handle('requestReview', async (args: Parameters<TeamergeService['reviews']['request']>[0]) =>
    (await svc()).reviews.request({ ...args, worktreePath: await allowed(args.worktreePath) })
  )
  handle(
    'addReviewComment',
    async (args: Parameters<TeamergeService['reviews']['addComment']>[0]) =>
      (await svc()).reviews.addComment(args)
  )
  handle(
    'setReviewStatus',
    async (args: { id: string; status: 'requested' | 'in-review' | 'done' }) =>
      (await svc()).reviews.setStatus(args.id, args.status)
  )
  handle('redeliverComment', async (args: { commentId: string; paneId: string }) =>
    (await svc()).reviews.redeliver(args.commentId, args.paneId)
  )
  handle('saveNote', async (args: { id?: string; title: string; body: string }) =>
    (await svc()).notes.save(args)
  )
  handle('deleteNote', async (id: string) => (await svc()).notes.delete(id))
  handle('sendMessage', async (args: Parameters<TeamergeService['messages']['send']>[0]) =>
    (await svc()).messages.send(args)
  )

  registerTeamergeRepoHandlers({ handle, allowed, svc, broadcast })
}
