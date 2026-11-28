import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import nacl from 'tweetnacl'
import {
  TEAMERGE_TEAM_FILE,
  type TeamFile,
  type TeamIdentityPublic,
  type TeamMember
} from '../../../shared/teamerge/teamerge-types'

export type TeamIdentity = TeamIdentityPublic & {
  signSecretKey: string
  boxSecretKey: string
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')
export const fromB64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'))

export function memberIdForSignKey(signPublicKey: string): string {
  return createHash('sha256').update(signPublicKey).digest('hex').slice(0, 16)
}

/** One identity per user account, shared by the app and the CLI. No account or server involved. */
export function identityPath(): string {
  return process.env.TEAMERGE_IDENTITY_PATH ?? join(homedir(), '.teamerge', 'identity.json')
}

export function createIdentity(name: string): TeamIdentity {
  const sign = nacl.sign.keyPair()
  const box = nacl.box.keyPair()
  const signPublicKey = b64(sign.publicKey)
  return {
    memberId: memberIdForSignKey(signPublicKey),
    name,
    signPublicKey,
    boxPublicKey: b64(box.publicKey),
    signSecretKey: b64(sign.secretKey),
    boxSecretKey: b64(box.secretKey)
  }
}

export async function loadIdentity(): Promise<TeamIdentity | null> {
  try {
    return JSON.parse(await readFile(identityPath(), 'utf8')) as TeamIdentity
  } catch {
    return null
  }
}

export async function loadOrCreateIdentity(name?: string): Promise<TeamIdentity> {
  const existing = await loadIdentity()
  if (existing) {
    return existing
  }
  const identity = createIdentity(name ?? defaultDisplayName())
  await saveIdentity(identity)
  return identity
}

export async function saveIdentity(identity: TeamIdentity): Promise<void> {
  const file = identityPath()
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, JSON.stringify(identity, null, 2), { mode: 0o600 })
}

export function defaultDisplayName(): string {
  try {
    return userInfo().username
  } catch {
    return 'teammate'
  }
}

export function publicIdentity(identity: TeamIdentity): TeamIdentityPublic {
  const { memberId, name, signPublicKey, boxPublicKey } = identity
  return { memberId, name, signPublicKey, boxPublicKey }
}

export function memberFromIdentity(identity: TeamIdentity): TeamMember {
  return {
    id: identity.memberId,
    name: identity.name,
    signPublicKey: identity.signPublicKey,
    boxPublicKey: identity.boxPublicKey,
    addedAt: new Date().toISOString()
  }
}

export async function readTeamFile(repoPath: string): Promise<TeamFile | null> {
  try {
    const team = JSON.parse(await readFile(join(repoPath, TEAMERGE_TEAM_FILE), 'utf8')) as TeamFile
    // Members whose id doesn't match their key are ignored: ids must not be spoofable by editing the file.
    team.members = team.members.filter(
      (member) => memberIdForSignKey(member.signPublicKey) === member.id
    )
    return team
  } catch {
    return null
  }
}

export async function writeTeamFile(repoPath: string, team: TeamFile): Promise<void> {
  const file = join(repoPath, TEAMERGE_TEAM_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(team, null, 2)}\n`)
}

export function createTeamFile(identity: TeamIdentity, name: string, relayUrl: string): TeamFile {
  return {
    version: 1,
    teamId: randomUUID(),
    name,
    relayUrl,
    members: [memberFromIdentity(identity)]
  }
}

/** Adds (or refreshes) this identity in the team file. Committing and pushing it is what grants membership. */
export function joinTeamFile(team: TeamFile, identity: TeamIdentity): TeamFile {
  const others = team.members.filter((member) => member.id !== identity.memberId)
  return { ...team, members: [...others, memberFromIdentity(identity)] }
}

// --- end-to-end encryption ----------------------------------------------------------------

export type SealedEnvelope = { from: string; nonce: string; box: string }

/** How old a sealed message may be; older ones (and repeated nonces inside it) are treated as replays. */
export const ENVELOPE_MAX_AGE_MS = 5 * 60 * 1000

type SealedBody = { teamId: string; to: string; sentAt: number; payload: unknown }

/** Encrypts and authenticates for one recipient (X25519 + XSalsa20-Poly1305). The relay sees only this. */
export function seal(
  identity: TeamIdentity,
  team: Pick<TeamFile, 'teamId'>,
  recipient: TeamMember,
  payload: unknown,
  now = Date.now()
): SealedEnvelope {
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const body: SealedBody = { teamId: team.teamId, to: recipient.id, sentAt: now, payload }
  const message = new TextEncoder().encode(JSON.stringify(body))
  const box = nacl.box(
    message,
    nonce,
    fromB64(recipient.boxPublicKey),
    fromB64(identity.boxSecretKey)
  )
  return { from: identity.memberId, nonce: b64(nonce), box: b64(box) }
}

function isFreshBodyFor(
  body: unknown,
  teamId: string,
  memberId: string,
  now: number
): body is SealedBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'teamId' in body &&
    body.teamId === teamId &&
    'to' in body &&
    body.to === memberId &&
    'sentAt' in body &&
    typeof body.sentAt === 'number' &&
    Math.abs(now - body.sentAt) <= ENVELOPE_MAX_AGE_MS &&
    'payload' in body
  )
}

/**
 * Opens an envelope only if its sender is on this team's committed roster and it was sealed for
 * this team and this member within the last few minutes. Callers still drop repeated nonces.
 */
export function open(
  identity: TeamIdentity,
  team: TeamFile,
  envelope: SealedEnvelope,
  now = Date.now()
): { sender: TeamMember; payload: unknown } | null {
  const sender = team.members.find((member) => member.id === envelope.from)
  if (!sender) {
    return null
  }
  const opened = nacl.box.open(
    fromB64(envelope.box),
    fromB64(envelope.nonce),
    fromB64(sender.boxPublicKey),
    fromB64(identity.boxSecretKey)
  )
  if (!opened) {
    return null
  }
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(opened))
  } catch {
    return null
  }
  if (!isFreshBodyFor(body, team.teamId, identity.memberId, now)) {
    return null
  }
  return { sender, payload: body.payload }
}

export function helloSignature(identity: TeamIdentity, teamId: string, ts: number): string {
  const message = new TextEncoder().encode(`teamerge-hello:${teamId}:${identity.memberId}:${ts}`)
  return b64(nacl.sign.detached(message, fromB64(identity.signSecretKey)))
}

export function verifyHello(
  teamId: string,
  memberId: string,
  signPublicKey: string,
  ts: number,
  signature: string
): boolean {
  if (memberIdForSignKey(signPublicKey) !== memberId) {
    return false
  }
  const message = new TextEncoder().encode(`teamerge-hello:${teamId}:${memberId}:${ts}`)
  try {
    return nacl.sign.detached.verify(message, fromB64(signature), fromB64(signPublicKey))
  } catch {
    return false
  }
}
