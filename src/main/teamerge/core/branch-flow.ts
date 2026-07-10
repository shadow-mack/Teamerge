import type { ChildTaskStatus } from '../../../shared/teamerge/teamerge-types'
import {
  aheadBehind,
  currentBranch,
  git,
  headSha,
  isDirty,
  mergeTreeConflicts,
  worktreeForBranch,
  type GitRunner
} from './git-runner'

export type MergeOutcome =
  | { ok: true; preSha: string; mergeSha: string; fastForward: boolean }
  | { ok: false; reason: 'conflict'; conflicts: string[] }
  | { ok: false; reason: 'dirty-target' | 'nothing-to-merge' | 'error'; message: string }

/**
 * Merges `source` into `target` without disturbing unrelated checkouts.
 * When `target` is checked out somewhere, the merge runs there (it must be clean);
 * otherwise the merge commit is built in the object store and the ref is moved.
 */
export async function mergeBranchInto(
  run: GitRunner,
  cwd: string,
  source: string,
  target: string,
  message: string
): Promise<MergeOutcome> {
  try {
    const preSha = await headSha(run, cwd, target)
    const sourceSha = await headSha(run, cwd, source)
    const { ahead } = await aheadBehind(run, cwd, target, source)
    if (ahead === 0) {
      return { ok: false, reason: 'nothing-to-merge', message: `${source} has no new commits.` }
    }
    const conflicts = await mergeTreeConflicts(run, cwd, target, source)
    if (conflicts.length > 0) {
      return { ok: false, reason: 'conflict', conflicts }
    }
    const checkout = await worktreeForBranch(run, cwd, target)
    if (checkout) {
      if (await isDirty(run, checkout)) {
        return {
          ok: false,
          reason: 'dirty-target',
          message: `${target} has uncommitted changes in ${checkout}. Commit or stash them first.`
        }
      }
      await git(run, checkout, ['merge', '--no-ff', '--no-edit', '-m', message, source])
      return { ok: true, preSha, mergeSha: await headSha(run, checkout), fastForward: false }
    }
    const tree = (
      await git(run, cwd, ['merge-tree', '--write-tree', '--no-messages', target, source])
    )
      .split('\n')[0]
      .trim()
    const mergeSha = (
      await git(run, cwd, ['commit-tree', tree, '-p', preSha, '-p', sourceSha, '-m', message])
    ).trim()
    await git(run, cwd, ['update-ref', `refs/heads/${target}`, mergeSha, preSha])
    return { ok: true, preSha, mergeSha, fastForward: false }
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Rewinds `target` to `preSha` only if nothing landed on top of `mergeSha` since. */
export async function undoMerge(
  run: GitRunner,
  cwd: string,
  target: string,
  preSha: string,
  mergeSha: string
): Promise<void> {
  const current = await headSha(run, cwd, target)
  if (current !== mergeSha) {
    throw new Error(`${target} moved after this merge. Undo the later merges first.`)
  }
  const checkout = await worktreeForBranch(run, cwd, target)
  if (checkout) {
    if (await isDirty(run, checkout)) {
      throw new Error(`${target} has uncommitted changes in ${checkout}.`)
    }
    await git(run, checkout, ['reset', '--keep', preSha])
    return
  }
  await git(run, cwd, ['update-ref', `refs/heads/${target}`, preSha, mergeSha])
}

export async function childTaskStatus(
  run: GitRunner,
  childPath: string,
  parentBranch: string
): Promise<ChildTaskStatus> {
  const branch = await currentBranch(run, childPath)
  const { ahead, behind } = await aheadBehind(run, childPath, parentBranch, branch)
  const dirty = await isDirty(run, childPath)
  return {
    worktreePath: childPath,
    branch,
    parentBranch,
    ahead,
    behind,
    dirty,
    ready: ahead > 0 && !dirty
  }
}

export type UpdateFromParentOutcome =
  | { ok: true; updated: boolean }
  | { ok: false; conflicts: string[]; message: string }

/** Brings parent changes into the child checkout; aborts cleanly on conflict. */
export async function updateFromParent(
  run: GitRunner,
  childPath: string,
  parentBranch: string
): Promise<UpdateFromParentOutcome> {
  const branch = await currentBranch(run, childPath)
  const { behind } = await aheadBehind(run, childPath, parentBranch, branch)
  if (behind === 0) {
    return { ok: true, updated: false }
  }
  if (await isDirty(run, childPath)) {
    return { ok: false, conflicts: [], message: 'Commit or stash the child task’s changes first.' }
  }
  const conflicts = await mergeTreeConflicts(run, childPath, branch, parentBranch)
  if (conflicts.length > 0) {
    return {
      ok: false,
      conflicts,
      message: `Updating from ${parentBranch} would conflict in ${conflicts.length} file(s).`
    }
  }
  await git(run, childPath, ['merge', '--no-edit', parentBranch])
  return { ok: true, updated: true }
}

export async function mergeChildIntoParent(
  run: GitRunner,
  childPath: string,
  parentBranch: string
): Promise<MergeOutcome> {
  const branch = await currentBranch(run, childPath)
  if (await isDirty(run, childPath)) {
    return {
      ok: false,
      reason: 'dirty-target',
      message: `${branch} has uncommitted changes. Commit them before merging into ${parentBranch}.`
    }
  }
  return mergeBranchInto(
    run,
    childPath,
    branch,
    parentBranch,
    `Merge child task ${branch} into ${parentBranch}`
  )
}

export type MergeAllResult = { branch: string; outcome: MergeOutcome }[]

/** Merges every ready child into the parent in order; a failing child doesn't stop the rest. */
export async function mergeAllReady(
  run: GitRunner,
  children: { worktreePath: string }[],
  parentBranch: string
): Promise<MergeAllResult> {
  const results: MergeAllResult = []
  for (const child of children) {
    const status = await childTaskStatus(run, child.worktreePath, parentBranch)
    if (!status.ready) {
      continue
    }
    results.push({
      branch: status.branch,
      outcome: await mergeChildIntoParent(run, child.worktreePath, parentBranch)
    })
  }
  return results
}
