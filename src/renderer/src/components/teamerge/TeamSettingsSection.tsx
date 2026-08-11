import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { GitCommitHorizontal, Radio, ScrollText, UserMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PaneAuditEntry } from '../../../../shared/teamerge/teamerge-types'
import { relativeTime, useTeamergeStore } from './teamerge-store'
import {
  errorMessage,
  GroupedList,
  GroupedRow,
  MemberAvatar,
  StatusPill,
  TeamSectionHeader
} from './team-ui'

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5">
      <span className="w-32 shrink-0 text-[13px] text-foreground/85">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  )
}

export function TeamSettingsSection(): React.JSX.Element {
  const status = useTeamergeStore((s) => s.status)
  const [name, setName] = useState(status?.team?.name ?? '')
  const [relayUrl, setRelayUrl] = useState(status?.team?.relayUrl ?? '')
  const [displayName, setDisplayName] = useState(status?.identity?.name ?? '')
  const [relay, setRelay] = useState<{ running: boolean; port: number | null; peers: number }>({
    running: false,
    port: null,
    peers: 0
  })
  const [audit, setAudit] = useState<PaneAuditEntry[]>([])

  useEffect(() => {
    void window.api.teamerge.localRelayStatus().then(setRelay)
    void window.api.teamerge.readPaneAudit().then(setAudit)
  }, [])

  useEffect(() => {
    setName(status?.team?.name ?? '')
    setRelayUrl(status?.team?.relayUrl ?? '')
    setDisplayName(status?.identity?.name ?? '')
  }, [status?.team?.name, status?.team?.relayUrl, status?.identity?.name])

  const act = async (fn: () => Promise<unknown>, done?: string): Promise<void> => {
    try {
      const result = await fn()
      toast.success(typeof result === 'string' ? result : (done ?? 'Saved.'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const team = status?.team
  const me = status?.identity?.memberId
  return (
    <div>
      <TeamSectionHeader
        title="Team Settings"
        subtitle="The roster lives in .teamerge/team.json. Commit and push changes to it so every teammate’s app agrees."
      />

      <GroupedList title="You">
        <Field label="Display name">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="max-w-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!displayName.trim() || displayName === status?.identity?.name}
            onClick={() => void act(() => window.api.teamerge.setDisplayName(displayName))}
          >
            Save
          </Button>
        </Field>
        <Field label="Member ID">
          <code className="font-mono text-xs text-muted-foreground">{me}</code>
        </Field>
      </GroupedList>

      {team ? (
        <>
          <GroupedList title="Team">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
            </Field>
            <Field label="Relay URL">
              <Input
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
                className="font-mono text-xs"
              />
            </Field>
            <div className="flex justify-end gap-2 px-4 py-2.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void act(() => window.api.teamerge.commitTeamFile())}
              >
                <GitCommitHorizontal className="size-4" />
                Commit Roster
              </Button>
              <Button
                size="sm"
                disabled={name === team.name && relayUrl === team.relayUrl}
                onClick={() =>
                  void act(() => window.api.teamerge.updateTeamSettings({ name, relayUrl }))
                }
              >
                Save Changes
              </Button>
            </div>
          </GroupedList>

          <GroupedList
            title="Members"
            footer="Removing a member drops their key from the roster. Commit and push to make it stick."
          >
            {team.members.map((member) => (
              <GroupedRow
                key={member.id}
                leading={
                  <MemberAvatar
                    memberId={member.id}
                    name={member.name}
                    online={member.id === me || status.onlineMemberIds.includes(member.id)}
                  />
                }
                title={
                  <span className="flex items-center gap-2">
                    {member.name}
                    {member.id === me ? <StatusPill tone="indigo">You</StatusPill> : null}
                  </span>
                }
                subtitle={<span className="font-mono">{member.id}</span>}
                trailing={
                  member.id !== me ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(`Remove ${member.name} from the team roster?`)) {
                          void act(
                            () => window.api.teamerge.removeMember(member.id),
                            `Removed ${member.name}. Commit the roster to finish.`
                          )
                        }
                      }}
                    >
                      <UserMinus />
                      Remove
                    </Button>
                  ) : null
                }
              />
            ))}
          </GroupedList>
        </>
      ) : null}

      <GroupedList
        title="Relay on This Mac"
        footer="The relay only forwards sealed envelopes between members. You can also run it anywhere with `teamerge relay`."
      >
        <GroupedRow
          leading={
            <Radio
              className={
                relay.running ? 'size-4 text-presence-online' : 'size-4 text-muted-foreground'
              }
            />
          }
          title={relay.running ? `Running on port ${relay.port}` : 'Not running'}
          subtitle={
            relay.running
              ? `${relay.peers} connected ${relay.peers === 1 ? 'member' : 'members'}`
              : 'Host the relay here for teammates on your network.'
          }
          trailing={
            <Button
              size="sm"
              variant={relay.running ? 'outline' : 'default'}
              onClick={() =>
                void (
                  relay.running
                    ? window.api.teamerge.stopLocalRelay()
                    : window.api.teamerge.startLocalRelay()
                )
                  .then(() => window.api.teamerge.localRelayStatus())
                  .then(setRelay)
                  .catch((error) => toast.error(errorMessage(error)))
              }
            >
              {relay.running ? 'Stop Relay' : 'Start Relay'}
            </Button>
          }
        />
      </GroupedList>

      <GroupedList
        title="Remote Keystroke Log"
        footer="Every keystroke a teammate sends to your shared panes, with your decision."
      >
        {audit.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">No remote keystrokes yet.</div>
        ) : (
          audit
            .slice(0, 50)
            .map((entry, index) => (
              <GroupedRow
                key={index}
                leading={<ScrollText className="size-4 text-muted-foreground" />}
                title={<code className="font-mono text-xs">{entry.keys}</code>}
                subtitle={`${entry.memberName} · ${relativeTime(entry.at)}`}
                trailing={
                  <StatusPill
                    tone={
                      entry.decision === 'approved'
                        ? 'green'
                        : entry.decision === 'muted'
                          ? 'neutral'
                          : 'red'
                    }
                  >
                    {entry.decision}
                  </StatusPill>
                }
              />
            ))
        )}
      </GroupedList>
    </div>
  )
}
