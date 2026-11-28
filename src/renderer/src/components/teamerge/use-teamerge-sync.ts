import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useTeamergeStore } from './teamerge-store'
import { useTeamergeTasks, type TeamergeRepoTasks } from './use-teamerge-tasks'
import { translate } from '@/i18n/i18n'

const SYNC_INTERVAL_MS = 15_000

async function syncOnce(snapshot: TeamergeRepoTasks): Promise<void> {
  const api = window.api.teamerge
  const store = useTeamergeStore.getState()
  if (!snapshot.repoPath) {
    return
  }
  const workTasks = snapshot.tasks.filter((task) => !task.isMain)
  const changed = await Promise.all(
    workTasks.map((task) =>
      api.taskChangedFiles({ worktreePath: task.worktreePath, baseRef: task.baseRef })
    )
  )
  await api.announceTasks(
    workTasks.map((task, index) => ({
      taskId: task.taskId,
      taskName: task.taskName,
      branch: task.branch,
      agent: task.agent,
      state: task.agentState,
      paneId: task.paneId,
      shared: false,
      changedFiles: changed[index] ?? []
    }))
  )
  await api.recordTasks({
    repoPath: snapshot.repoPath,
    tasks: Object.fromEntries(
      snapshot.tasks.map((task) => [
        task.worktreePath,
        {
          taskName: task.taskName,
          parentBranch: task.parentBranch ?? undefined,
          baseRef: task.baseRef
        }
      ])
    )
  })
  const { collisions, byTask } = await api.collisions({
    repoPath: snapshot.repoPath,
    tasks: workTasks.map(({ taskId, taskName, worktreePath, branch, baseRef }) => ({
      taskId,
      taskName,
      worktreePath,
      branch,
      baseRef
    })),
    memberName: store.status?.identity?.name ?? 'me'
  })
  store.setCollisions(collisions, byTask)
  store.setClaims(await api.listClaims(snapshot.repoPath))
  store.setLanding(await api.landingQueue(snapshot.repoPath))
}

/** Keeps Teamerge pointed at the active repo, announces this machine's tasks, and refreshes collision state. */
export function useTeamergeSync(): void {
  const snapshot = useTeamergeTasks()
  const latest = useRef(snapshot)
  latest.current = snapshot
  const running = useRef(false)

  useEffect(() => {
    const api = window.api?.teamerge
    if (!api) {
      return
    }
    const store = useTeamergeStore.getState()
    void store.hydrate()
    // Toast only items that arrive while the app is open, not ones restored on launch or repo switch.
    const seen = new Set<string>()
    const isFresh = (id: string, createdAt: number): boolean => {
      const fresh = !seen.has(id) && Date.now() - createdAt < 30_000
      seen.add(id)
      return fresh
    }
    const off = api.onEvent((event) => {
      useTeamergeStore.getState().apply(event)
      if (event.type === 'handoffs') {
        for (const h of event.handoffs) {
          if (h.direction === 'incoming' && h.status === 'sent' && isFresh(h.id, h.createdAt)) {
            toast(`${h.fromName} handed you “${h.title}”`, {
              action: {
                label: translate('auto.components.teamerge.use.teamerge.sync.9cc0cae9b8', 'Open'),
                onClick: () => openTeamSection('inbox')
              }
            })
          }
        }
      }
      if (event.type === 'reviews') {
        for (const r of event.reviews) {
          if (
            r.direction === 'incoming' &&
            r.status === 'requested' &&
            isFresh(r.id, r.createdAt)
          ) {
            toast(`${r.fromName} asked you to review “${r.title}”`, {
              action: {
                label: translate('auto.components.teamerge.use.teamerge.sync.4fbc4cee37', 'Review'),
                onClick: () => openTeamSection('inbox')
              }
            })
          }
        }
      }
    })
    return off
  }, [])

  const repoPath = snapshot.repoPath
  useEffect(() => {
    void window.api?.teamerge?.setRepo(repoPath)
  }, [repoPath])

  const signature = snapshot.tasks.map((t) => `${t.taskId}:${t.agentState}:${t.paneId}`).join('|')
  useEffect(() => {
    const tick = (): void => {
      if (running.current || !window.api?.teamerge) {
        return
      }
      running.current = true
      void syncOnce(latest.current)
        .catch((error) => console.warn('[teamerge] sync failed', error))
        .finally(() => {
          running.current = false
        })
    }
    tick()
    const timer = window.setInterval(tick, SYNC_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [signature, repoPath])
}

export function refreshTeamergeNow(snapshot: TeamergeRepoTasks): Promise<void> {
  return syncOnce(snapshot)
}

export function openTeamSection(
  section: Parameters<ReturnType<typeof useTeamergeStore.getState>['setSection']>[0]
): void {
  useTeamergeStore.getState().setSection(section)
  window.dispatchEvent(new CustomEvent('teamerge:open'))
}
