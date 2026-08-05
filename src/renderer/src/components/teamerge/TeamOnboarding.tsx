import React, { useState } from 'react'
import { toast } from 'sonner'
import { FolderGit2, KeyRound, Lock, Radio, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTeamergeStore } from './teamerge-store'
import {
  EmptyState,
  errorMessage,
  GroupedList,
  GroupedRow,
  MemberAvatar,
  TeamSectionHeader
} from './team-ui'

function Feature({
  icon,
  title,
  text
}: {
  icon: React.ReactNode
  title: string
  text: string
}): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
        {icon}
      </div>
      <div>
        <div className="text-[13px] font-semibold">{title}</div>
        <p className="text-xs leading-4.5 text-muted-foreground">{text}</p>
      </div>
    </div>
  )
}

/** First run: create a team in this repo, or join the one committed to it. No account. */
export function TeamOnboarding({ noRepo = false }: { noRepo?: boolean }): React.JSX.Element {
  const status = useTeamergeStore((s) => s.status)
  const [name, setName] = useState('')
  const [relayUrl, setRelayUrl] = useState('')
  const [busy, setBusy] = useState(false)

  if (noRepo) {
    return (
      <EmptyState
        icon={<FolderGit2 />}
        title="Add a Git Repository"
        description="Teamerge keeps the team roster in the repository itself. Add a repository from the sidebar to set up your team."
      />
    )
  }

  const hostRelay = async (): Promise<void> => {
    setBusy(true)
    try {
      const { urls } = await window.api.teamerge.startLocalRelay()
      setRelayUrl(urls.find((url) => !url.includes('localhost')) ?? urls[0])
      toast.success(
        'Relay running on this Mac. Teammates on your network can reach it at the URL shown.'
      )
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const run = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const team = status?.team
  return (
    <div>
      <TeamSectionHeader
        title={team ? `Join ${team.name}` : 'Work Together, Machine to Machine'}
        subtitle="Your teammates’ agents show up here, live, from their own laptops. Identity is a key in the repository and traffic is end‑to‑end encrypted through a relay your team hosts."
      />
      <div className="mb-8 grid gap-5 sm:grid-cols-3">
        <Feature
          icon={<KeyRound />}
          title="No Account"
          text="Your key lives on this Mac. The roster lives in .teamerge/team.json — anyone who can push is on the team."
        />
        <Feature
          icon={<Lock />}
          title="End‑to‑End Encrypted"
          text="Messages are sealed for each teammate. The relay forwards ciphertext and can’t read it."
        />
        <Feature
          icon={<ShieldCheck />}
          title="You Stay in Control"
          text="Teammates can watch shared panes, but every keystroke waits for your approval and is logged."
        />
      </div>

      {team ? (
        <GroupedList
          title="Members"
          footer="Joining adds your public key to the roster. Commit and push it so teammates’ apps accept your messages."
        >
          {team.members.map((member) => (
            <GroupedRow
              key={member.id}
              leading={<MemberAvatar memberId={member.id} name={member.name} />}
              title={member.name}
              subtitle={member.id}
            />
          ))}
          <div className="flex justify-end px-3.5 py-2.5">
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  () => window.api.teamerge.joinTeam(),
                  `Joined ${team.name}. Commit and push the roster to finish.`
                )
              }
            >
              <Users className="size-4" />
              Join Team
            </Button>
          </div>
        </GroupedList>
      ) : (
        <GroupedList
          title="Create a Team"
          footer="Creates .teamerge/team.json in this repository with you as the first member."
        >
          <div className="grid gap-4 px-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="teamerge-team-name">Team name</Label>
              <Input
                id="teamerge-team-name"
                placeholder="Platform"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="teamerge-relay">Relay URL</Label>
              <div className="flex gap-2">
                <Input
                  id="teamerge-relay"
                  className="font-mono text-xs"
                  placeholder="wss://relay.your-team.dev"
                  value={relayUrl}
                  onChange={(e) => setRelayUrl(e.target.value)}
                />
                <Button variant="outline" disabled={busy} onClick={() => void hostRelay()}>
                  <Radio className="size-4" />
                  Host on This Mac
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Run <code className="font-mono">teamerge relay</code> on any server your team can
                reach, or host it here for a local network.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                disabled={busy || !name.trim() || !relayUrl.trim()}
                onClick={() =>
                  void run(
                    () => window.api.teamerge.createTeam({ name, relayUrl }),
                    'Team created. Commit .teamerge/team.json and push it to invite teammates.'
                  )
                }
              >
                Create Team
              </Button>
            </div>
          </div>
        </GroupedList>
      )}
      {status?.identity ? (
        <p className="px-1 text-xs text-muted-foreground">
          This Mac is <span className="font-medium text-foreground">{status.identity.name}</span> ·{' '}
          <span className="font-mono">{status.identity.memberId}</span>
        </p>
      ) : null}
    </div>
  )
}
