import type {
  CollisionTask,
  FileClaim,
  FileCollision,
  TaskCollisionSummary,
  TeamAgentPresence
} from '../../../shared/teamerge/teamerge-types'
import {
  mergeTreeConflicts,
  snapshotWorktreeCommit,
  worktreeChangedFiles,
  type GitRunner
} from './git-runner'
import { readRepoState, updateRepoState } from './local-state'

export type LocalTaskInput = {
  taskId: string
  taskName: string
  worktreePath: string
  branch: string
  baseRef: string
}

type TaskFiles = CollisionTask & { files: Set<string>; snapshot: string | null }

/**
 * Finds files touched by more than one task (local worktrees and teammates' announced tasks)
 * and marks the ones where merging the tasks would conflict.
 */
export async function computeCollisions(
  run: GitRunner,
  repoPath: string,
  localTasks: LocalTaskInput[],
  remoteAgents: TeamAgentPresence[],
  memberName: string
): Promise<FileCollision[]> {
  const tasks: TaskFiles[] = []
  for (const task of localTasks) {
    try {
      const files = await worktreeChangedFiles(run, task.worktreePath, task.baseRef)
      if (files.length === 0) {
        continue
      }
      tasks.push({
        taskId: task.taskId,
        taskName: task.taskName,
        branch: task.branch,
        memberName,
        local: true,
        files: new Set(files),
        snapshot: await snapshotWorktreeCommit(run, task.worktreePath)
      })
    } catch {
      // A removed or mid-operation worktree just drops out of this pass.
    }
  }
  for (const agent of remoteAgents) {
    if (agent.changedFiles.length === 0) {
      continue
    }
    const remoteRef = await resolveRemoteRef(run, repoPath, agent.branch)
    tasks.push({
      taskId: agent.taskId,
      taskName: agent.taskName,
      branch: agent.branch,
      memberName: agent.memberName,
      local: false,
      files: new Set(agent.changedFiles),
      snapshot: remoteRef
    })
  }

  const byFile = new Map<string, TaskFiles[]>()
  for (const task of tasks) {
    for (const file of task.files) {
      const list = byFile.get(file) ?? []
      list.push(task)
      byFile.set(file, list)
    }
  }

  const conflictCache = new Map<string, Set<string>>()
  const conflictsBetween = async (a: TaskFiles, b: TaskFiles): Promise<Set<string>> => {
    if (!a.snapshot || !b.snapshot) {
      return new Set()
    }
    const key = [a.snapshot, b.snapshot].sort().join(':')
    let cached = conflictCache.get(key)
    if (!cached) {
      cached = new Set(
        await mergeTreeConflicts(run, repoPath, a.snapshot, b.snapshot).catch(() => [])
      )
      conflictCache.set(key, cached)
    }
    return cached
  }

  const state = await readRepoState(run, repoPath)
  const claims = [...state.claims, ...state.remoteClaims]
  const collisions: FileCollision[] = []
  for (const [filePath, owners] of byFile) {
    if (owners.length < 2) {
      continue
    }
    let conflict = false
    for (let i = 0; i < owners.length && !conflict; i++) {
      for (let j = i + 1; j < owners.length && !conflict; j++) {
        conflict = (await conflictsBetween(owners[i], owners[j])).has(filePath)
      }
    }
    collisions.push({
      filePath,
      tasks: owners.map(({ taskId, taskName, branch, memberName: name, local }) => ({
        taskId,
        taskName,
        branch,
        memberName: name,
        local
      })),
      conflict,
      claimedBy: claims.find((claim) => claim.path === filePath)
    })
  }
  return collisions.sort(
    (a, b) => Number(b.conflict) - Number(a.conflict) || a.filePath.localeCompare(b.filePath)
  )
}

async function resolveRemoteRef(
  run: GitRunner,
  cwd: string,
  branch: string
): Promise<string | null> {
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    const result = await run(cwd, ['rev-parse', '--verify', '--quiet', ref], { allowFailure: true })
    if (result.code === 0) {
      return result.stdout.trim()
    }
  }
  return null
}

export function summarizeByTask(collisions: FileCollision[]): Record<string, TaskCollisionSummary> {
  const summary: Record<string, TaskCollisionSummary> = {}
  for (const collision of collisions) {
    for (const task of collision.tasks) {
      const entry = (summary[task.taskId] ??= {
        taskId: task.taskId,
        overlapping: 0,
        conflicting: 0,
        collisions: []
      })
      entry.overlapping += 1
      entry.conflicting += collision.conflict ? 1 : 0
      entry.collisions.push(collision)
    }
  }
  return summary
}

export async function claimFiles(
  run: GitRunner,
  repoPath: string,
  claim: Omit<FileClaim, 'path' | 'claimedAt'>,
  paths: string[]
): Promise<FileClaim[]> {
  return updateRepoState(run, repoPath, (state) => {
    const now = Date.now()
    for (const path of paths) {
      state.claims = state.claims.filter(
        (existing) => !(existing.path === path && existing.taskId === claim.taskId)
      )
      state.claims.push({ ...claim, path, claimedAt: now })
    }
    return state.claims
  })
}

export async function releaseClaims(
  run: GitRunner,
  repoPath: string,
  taskId: string,
  paths?: string[]
): Promise<FileClaim[]> {
  return updateRepoState(run, repoPath, (state) => {
    state.claims = state.claims.filter(
      (claim) => claim.taskId !== taskId || (paths !== undefined && !paths.includes(claim.path))
    )
    return state.claims
  })
}

export type EditRisk = {
  filePath: string
  level: 'none' | 'overlap' | 'claimed' | 'conflict'
  messages: string[]
}

/**
 * The pre-edit check agents run: who else is changing or has claimed this file.
 * `selfTaskId` is the calling task, so its own claims don't warn.
 */
export async function assessEditRisk(
  run: GitRunner,
  repoPath: string,
  filePath: string,
  selfTaskId: string | null,
  localTasks: LocalTaskInput[]
): Promise<EditRisk> {
  const state = await readRepoState(run, repoPath)
  const messages: string[] = []
  let level: EditRisk['level'] = 'none'
  for (const claim of [...state.claims, ...state.remoteClaims]) {
    if (claim.path === filePath && claim.taskId !== selfTaskId) {
      level = 'claimed'
      messages.push(
        `${claim.memberName} claimed ${filePath} for ${claim.branch}${claim.note ? ` (${claim.note})` : ''}.`
      )
    }
  }
  for (const task of localTasks) {
    if (task.taskId === selfTaskId) {
      continue
    }
    const files = await worktreeChangedFiles(run, task.worktreePath, task.baseRef).catch(
      (): string[] => []
    )
    if (files.includes(filePath)) {
      if (level === 'none') {
        level = 'overlap'
      }
      messages.push(`Task ${task.taskName} (${task.branch}) is also changing ${filePath}.`)
    }
  }
  for (const agent of state.remoteAgents) {
    if (agent.changedFiles.includes(filePath)) {
      if (level === 'none') {
        level = 'overlap'
      }
      messages.push(
        `${agent.memberName}'s task ${agent.taskName} (${agent.branch}) is changing ${filePath}.`
      )
    }
  }
  return { filePath, level, messages }
}
