import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  TeamActivityEvent,
  TeamAgentMessage,
  TeamergeEvent,
  TeamHandoff,
  TeamNote,
  TeamReviewComment,
  TeamReviewRequest
} from '../../shared/teamerge/teamerge-types'
import type { GitRunner } from './core/git-runner'
import type { TeamIdentity } from './core/identity'
import type { TeamPayload } from './core/relay-client'

/** Everything the team inbox keeps on this machine, saved per team. */
export type TeamData = {
  handoffs: TeamHandoff[]
  reviews: TeamReviewRequest[]
  comments: TeamReviewComment[]
  notes: TeamNote[]
  messages: TeamAgentMessage[]
}

export function emptyTeamData(): TeamData {
  return { handoffs: [], reviews: [], comments: [], notes: [], messages: [] }
}

export async function loadTeamData(dataDir: string, teamId: string): Promise<TeamData> {
  try {
    const saved: Partial<TeamData> = JSON.parse(
      await readFile(join(dataDir, `${teamId}.json`), 'utf8')
    )
    return { ...emptyTeamData(), ...saved }
  } catch {
    return emptyTeamData()
  }
}

export async function saveTeamData(dataDir: string, teamId: string, data: TeamData): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  await writeFile(join(dataDir, `${teamId}.json`), JSON.stringify(data))
}

/** What each inbox module needs from the service that owns the team connection. */
export type TeamContext = {
  readonly run: GitRunner
  data(): TeamData
  save(): Promise<void>
  emit(event: TeamergeEvent): void
  log(kind: TeamActivityEvent['kind'], text: string): void
  /** `to` is a member id, or 'everyone' for every online teammate. */
  send(to: string, payload: TeamPayload): void
  identity(): TeamIdentity
  /** This machine's member id, if the identity has loaded. */
  memberId(): string | undefined
  repoPath(): string | null
  /** The open repo of a team this machine belongs to; throws otherwise. */
  teamRepoPath(): string
  memberName(memberId: string): string
  writePty(paneId: string, data: string): boolean
}
