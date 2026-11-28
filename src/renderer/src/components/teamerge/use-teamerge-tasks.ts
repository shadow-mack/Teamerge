import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { branchName } from '@/lib/git-utils'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { TeamAgentState } from '../../../../shared/teamerge/teamerge-types'

export type TeamergeTask = {
  taskId: string
  taskName: string
  worktreeId: string
  worktreePath: string
  branch: string
  baseRef: string
  parentWorktreeId: string | null
  parentBranch: string | null
  isMain: boolean
  agent: string
  agentState: TeamAgentState
  paneId: string | null
  hostId: Worktree['hostId']
  worktree: Worktree
}

export type TeamergeRepoTasks = {
  repo: Repo | null
  repoPath: string | null
  mainBranch: string
  tasks: TeamergeTask[]
}

function mapAgentState(state: string | undefined): TeamAgentState {
  if (state === 'working') {
    return 'working'
  }
  if (state === 'blocked' || state === 'waiting') {
    return 'waiting'
  }
  if (state === 'done') {
    return 'done'
  }
  return 'idle'
}

/** Projects the active repo's workspaces into Teamerge tasks (branch, base, parent, agent pane). */
export function useTeamergeTasks(): TeamergeRepoTasks {
  const {
    repos,
    worktreesByRepo,
    activeWorktreeId,
    tabsByWorktree,
    agentStatusByPaneKey,
    lineage
  } = useAppStore(
    useShallow((s) => ({
      repos: s.repos,
      worktreesByRepo: selectWorktreesByRepo(s),
      activeWorktreeId: s.activeWorktreeId,
      tabsByWorktree: s.tabsByWorktree,
      agentStatusByPaneKey: s.agentStatusByPaneKey,
      lineage: s.worktreeLineageById
    }))
  )

  return useMemo(() => {
    const gitRepos = repos.filter((repo) => repo.kind !== 'folder' && !repo.connectionId)
    const activeRepoId = activeWorktreeId?.split('::')[0]
    const repo = gitRepos.find((r) => r.id === activeRepoId) ?? gitRepos[0] ?? null
    if (!repo) {
      return { repo: null, repoPath: null, mainBranch: 'main', tasks: [] }
    }
    const worktrees = (worktreesByRepo[repo.id] ?? []).filter(
      (wt) => !wt.isArchived && !wt.isBare && wt.branch
    )
    const main = worktrees.find((wt) => wt.isMainWorktree)
    const mainBranch = main ? branchName(main.branch) : 'main'
    const byId = new Map(worktrees.map((wt) => [wt.id, wt]))
    const agentsByWorktree = new Map<
      string,
      { agent: string; state: TeamAgentState; tabId?: string }
    >()
    for (const entry of Object.values(agentStatusByPaneKey)) {
      if (!entry.worktreeId) {
        continue
      }
      const state = mapAgentState(entry.state)
      const existing = agentsByWorktree.get(entry.worktreeId)
      if (
        !existing ||
        state === 'working' ||
        (state === 'waiting' && existing.state !== 'working')
      ) {
        agentsByWorktree.set(entry.worktreeId, {
          agent: entry.agentType ?? 'agent',
          state,
          tabId: entry.tabId
        })
      }
    }
    const tasks = worktrees.map((wt): TeamergeTask => {
      const parentId = lineage[wt.id]?.parentWorktreeId ?? null
      const parent = parentId ? byId.get(parentId) : undefined
      const agent = agentsByWorktree.get(wt.id)
      const tabs = tabsByWorktree[wt.id] ?? []
      const agentTab =
        (agent?.tabId && tabs.find((tab) => tab.id === agent.tabId)) ||
        tabs.find((tab) => tab.ptyId)
      const branch = branchName(wt.branch)
      return {
        taskId: wt.path,
        taskName: wt.displayName || branch,
        worktreeId: wt.id,
        worktreePath: wt.path,
        branch,
        baseRef: parent ? branchName(parent.branch) : wt.baseRef || mainBranch,
        parentWorktreeId: parent ? parent.id : null,
        parentBranch: parent ? branchName(parent.branch) : null,
        isMain: wt.isMainWorktree,
        agent: agent?.agent ?? 'shell',
        agentState: agent?.state ?? 'idle',
        paneId: agentTab?.ptyId ?? null,
        hostId: wt.hostId,
        worktree: wt
      }
    })
    return { repo, repoPath: main?.path ?? repo.path, mainBranch, tasks }
  }, [repos, worktreesByRepo, activeWorktreeId, tabsByWorktree, agentStatusByPaneKey, lineage])
}
