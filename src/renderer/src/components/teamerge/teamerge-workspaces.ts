import { useAppStore } from '@/store'
import { buildAgentStartupPlan } from '../../../../shared/agent-launch/startup/tui-agent-startup'
import { TUI_AGENT_CONFIG } from '../../../../shared/agent-launch/catalog/tui-agent-config'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import type { WorktreeStartupLaunch } from '../../../../shared/worktree/launch-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { toWorktreeRemovalTarget } from '../../../../shared/worktree/removal'

export const RACE_AGENT_CHOICES: { id: TuiAgent; label: string }[] = (
  [
    ['claude', 'Claude Code'],
    ['codex', 'Codex'],
    ['gemini', 'Gemini'],
    ['opencode', 'OpenCode'],
    ['cursor', 'Cursor'],
    ['copilot', 'Copilot']
  ] as const
)
  .filter(([id]) => id in TUI_AGENT_CONFIG)
  .map(([id, label]) => ({ id: id as TuiAgent, label }))

function hostPlatform(): NodeJS.Platform {
  const ua = navigator.userAgent
  return ua.includes('Mac') ? 'darwin' : ua.includes('Windows') ? 'win32' : 'linux'
}

export function asTuiAgent(agent: string | null | undefined): TuiAgent {
  return agent && agent in TUI_AGENT_CONFIG ? (agent as TuiAgent) : 'claude'
}

/** Launch plan for an agent that starts working on `prompt` as soon as the workspace opens. */
export function buildAgentStartup(
  agent: TuiAgent,
  prompt: string
): WorktreeStartupLaunch | undefined {
  const settings = useAppStore.getState().settings
  const plan = buildAgentStartupPlan({
    agent,
    prompt,
    cmdOverrides: settings?.agentCmdOverrides ?? {},
    platform: hostPlatform(),
    allowEmptyPromptLaunch: true
  })
  if (!plan) {
    return undefined
  }
  return {
    command: plan.launchCommand,
    env: plan.env,
    launchConfig: plan.launchConfig,
    launchToken: plan.launchToken,
    launchAgent: agent,
    startupCommandDelivery: plan.startupCommandDelivery
  }
}

export async function createTeamergeWorkspace(args: {
  repoId: string
  name: string
  baseBranch?: string
  displayName?: string
  agent?: TuiAgent
  prompt?: string
  existingBranch?: string
  parentWorktreeId?: string
}): Promise<Worktree> {
  const store = useAppStore.getState()
  const startup = args.agent ? buildAgentStartup(args.agent, args.prompt ?? '') : undefined
  const result = await store.createWorktree(
    args.repoId,
    args.name,
    args.baseBranch,
    undefined,
    undefined,
    undefined,
    args.displayName,
    undefined,
    undefined,
    undefined,
    args.agent,
    undefined,
    args.existingBranch,
    undefined,
    undefined,
    undefined,
    startup,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    args.existingBranch ? { branchIntent: 'open-existing-v2' } : undefined
  )
  const worktree = result.worktree
  if (args.parentWorktreeId) {
    await store.updateWorktreeLineage(worktree.id, { parentWorktreeId: args.parentWorktreeId })
  }
  return worktree
}

export async function removeTeamergeWorkspace(worktree: Worktree): Promise<void> {
  const result = await useAppStore
    .getState()
    .removeWorktree(toWorktreeRemovalTarget(worktree), true)
  if (!result.ok) {
    throw new Error(result.error)
  }
}

/** Branch-safe slug of at most `maxLength` characters, cut at a word boundary so names stay readable. */
export function slugForBranch(text: string, maxLength = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (slug.length <= maxLength) {
    return slug || 'task'
  }
  const cut = slug.slice(0, maxLength + 1)
  const boundary = cut.lastIndexOf('-')
  return (boundary > 0 ? cut.slice(0, boundary) : slug.slice(0, maxLength)) || 'task'
}
