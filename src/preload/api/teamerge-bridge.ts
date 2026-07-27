import { ipcRenderer } from 'electron'
import { TEAMERGE_EVENT_CHANNEL, type TeamergeEvent } from '../../shared/teamerge/teamerge-types'
import type { TeamergeApi } from './teamerge-api'

const call =
  (channel: string) =>
  (...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(`teamerge:${channel}`, ...args)

const CHANNELS = [
  'status',
  'setRepo',
  'createTeam',
  'joinTeam',
  'updateTeamSettings',
  'removeMember',
  'commitTeamFile',
  'setDisplayName',
  'startLocalRelay',
  'stopLocalRelay',
  'localRelayStatus',
  'snapshot',
  'announceTasks',
  'setPaneShared',
  'listPaneShares',
  'setViewerMuted',
  'decideKeystrokes',
  'readPaneAudit',
  'watchPane',
  'unwatchPane',
  'sendKeystrokes',
  'sendHandoff',
  'prepareHandoffBranch',
  'setHandoffStatus',
  'requestReview',
  'addReviewComment',
  'setReviewStatus',
  'redeliverComment',
  'saveNote',
  'deleteNote',
  'sendMessage',
  'collisions',
  'claimFiles',
  'releaseClaims',
  'listClaims',
  'recordTasks',
  'taskChangedFiles',
  'childStatus',
  'updateFromParent',
  'mergeIntoParent',
  'mergeAllReady',
  'landingQueue',
  'enqueueLanding',
  'removeLanding',
  'clearLanding',
  'landAll',
  'undoLanding',
  'listRaces',
  'createRace',
  'compareRace',
  'raceFileDiffs',
  'pickRaceWinner',
  'removeRace',
  'fileHunks',
  'stageHunk',
  'unstageHunk',
  'discardHunk',
  'undoHunk',
  'hunkHistory'
] as const satisfies readonly Exclude<keyof TeamergeApi, 'onEvent'>[]

export const teamergeApi: TeamergeApi = {
  ...(Object.fromEntries(CHANNELS.map((channel) => [channel, call(channel)])) as unknown as Omit<
    TeamergeApi,
    'onEvent'
  >),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TeamergeEvent): void =>
      listener(payload)
    ipcRenderer.on(TEAMERGE_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(TEAMERGE_EVENT_CHANNEL, handler)
  }
}
