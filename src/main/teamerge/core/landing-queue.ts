import { randomUUID } from 'node:crypto'
import type { LandingItem, LandingQueueState } from '../../../shared/teamerge/teamerge-types'
import { mergeBranchInto, undoMerge } from './branch-flow'
import { currentBranch, isDirty, type GitRunner } from './git-runner'
import { readRepoState, updateRepoState } from './local-state'

export async function readLandingQueue(
  run: GitRunner,
  repoPath: string
): Promise<LandingQueueState> {
  const state = await readRepoState(run, repoPath)
  return { repoPath, items: state.landing, running: false }
}

export async function enqueueForLanding(
  run: GitRunner,
  repoPath: string,
  entry: { worktreePath: string; taskName: string; targetBranch: string }
): Promise<LandingItem> {
  const branch = await currentBranch(run, entry.worktreePath)
  return updateRepoState(run, repoPath, (state) => {
    const existing = state.landing.find(
      (item) => item.branch === branch && (item.status === 'queued' || item.status === 'skipped')
    )
    if (existing) {
      existing.status = 'queued'
      existing.reason = undefined
      existing.targetBranch = entry.targetBranch
      existing.updatedAt = Date.now()
      return existing
    }
    const item: LandingItem = {
      id: randomUUID(),
      worktreePath: entry.worktreePath,
      taskName: entry.taskName,
      branch,
      targetBranch: entry.targetBranch,
      status: 'queued',
      updatedAt: Date.now()
    }
    state.landing.push(item)
    return item
  })
}

export async function removeFromLanding(
  run: GitRunner,
  repoPath: string,
  id: string
): Promise<void> {
  await updateRepoState(run, repoPath, (state) => {
    state.landing = state.landing.filter((item) => item.id !== id)
  })
}

export async function clearFinishedLanding(run: GitRunner, repoPath: string): Promise<void> {
  await updateRepoState(run, repoPath, (state) => {
    state.landing = state.landing.filter(
      (item) => item.status === 'queued' || item.status === 'skipped'
    )
  })
}

async function patchItem(
  run: GitRunner,
  repoPath: string,
  id: string,
  patch: Partial<LandingItem>
): Promise<void> {
  await updateRepoState(run, repoPath, (state) => {
    const item = state.landing.find((entry) => entry.id === id)
    if (item) {
      Object.assign(item, patch, { updatedAt: Date.now() })
    }
  })
}

/**
 * Land All: merges queued tasks one after another into their targets.
 * A task that would conflict (or isn't committed) is skipped with a reason; the queue keeps going.
 */
export async function landAll(
  run: GitRunner,
  repoPath: string,
  onProgress?: (queue: LandingQueueState) => void
): Promise<LandingQueueState> {
  const { items } = await readLandingQueue(run, repoPath)
  for (const item of items.filter(
    (entry) => entry.status === 'queued' || entry.status === 'skipped'
  )) {
    await patchItem(run, repoPath, item.id, { status: 'landing', reason: undefined })
    onProgress?.({ ...(await readLandingQueue(run, repoPath)), running: true })
    let patch: Partial<LandingItem>
    try {
      if (await isDirty(run, item.worktreePath)) {
        patch = {
          status: 'skipped',
          reason: 'Uncommitted changes in the task. Commit them, then land again.'
        }
      } else {
        const outcome = await mergeBranchInto(
          run,
          repoPath,
          item.branch,
          item.targetBranch,
          `Land ${item.taskName} (${item.branch}) into ${item.targetBranch}`
        )
        if (outcome.ok) {
          patch = { status: 'landed', preSha: outcome.preSha, mergeSha: outcome.mergeSha }
        } else if (outcome.reason === 'conflict') {
          patch = {
            status: 'skipped',
            reason: `Would conflict in ${outcome.conflicts.slice(0, 3).join(', ')}${
              outcome.conflicts.length > 3 ? ` and ${outcome.conflicts.length - 3} more` : ''
            }. Update the task from ${item.targetBranch} and resolve.`
          }
        } else if (outcome.reason === 'nothing-to-merge') {
          patch = { status: 'skipped', reason: outcome.message }
        } else {
          patch = {
            status: outcome.reason === 'dirty-target' ? 'skipped' : 'failed',
            reason: outcome.message
          }
        }
      }
    } catch (error) {
      patch = { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
    await patchItem(run, repoPath, item.id, patch)
    onProgress?.({ ...(await readLandingQueue(run, repoPath)), running: true })
  }
  return readLandingQueue(run, repoPath)
}

/** Undoes a local landing merge; only the newest landing on a target can be undone. */
export async function undoLanding(
  run: GitRunner,
  repoPath: string,
  id: string
): Promise<LandingItem> {
  const { items } = await readLandingQueue(run, repoPath)
  const item = items.find((entry) => entry.id === id)
  if (!item || item.status !== 'landed' || !item.preSha || !item.mergeSha) {
    throw new Error('Only a landed task can be undone.')
  }
  await undoMerge(run, repoPath, item.targetBranch, item.preSha, item.mergeSha)
  await patchItem(run, repoPath, id, {
    status: 'undone',
    reason: `Reverted ${item.targetBranch} to ${item.preSha.slice(0, 7)}.`
  })
  return { ...item, status: 'undone' }
}
