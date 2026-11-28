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
import { translate } from '@/i18n/i18n'

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
      toast.success(
        typeof result === 'string'
          ? result
          : (done ?? translate('auto.components.teamerge.TeamSettingsSection.744b91a065', 'Saved.'))
      )
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const team = status?.team
  const me = status?.identity?.memberId
  return (
    <div>
      <TeamSectionHeader
        title={translate(
          'auto.components.teamerge.TeamSettingsSection.c7ed6cd8a9',
          'Team Settings'
        )}
        subtitle={translate(
          'auto.components.teamerge.TeamSettingsSection.ec41a0c6de',
          'The roster lives in .teamerge/team.json. Commit and push changes to it so every teammate’s app agrees.'
        )}
      />

      <GroupedList
        title={translate('auto.components.teamerge.TeamSettingsSection.54b32f2062', 'You')}
      >
        <Field
          label={translate(
            'auto.components.teamerge.TeamSettingsSection.c6c70aa3e1',
            'Display name'
          )}
        >
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
            {translate('auto.components.teamerge.TeamSettingsSection.1b7885893c', 'Save')}
          </Button>
        </Field>
        <Field
          label={translate('auto.components.teamerge.TeamSettingsSection.c8a428b20a', 'Member ID')}
        >
          <code className="font-mono text-xs text-muted-foreground">{me}</code>
        </Field>
      </GroupedList>

      {team ? (
        <>
          <GroupedList
            title={translate('auto.components.teamerge.TeamSettingsSection.41563c5114', 'Team')}
          >
            <Field
              label={translate('auto.components.teamerge.TeamSettingsSection.11a4cd082d', 'Name')}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
            </Field>
            <Field
              label={translate(
                'auto.components.teamerge.TeamSettingsSection.e7047539e6',
                'Relay URL'
              )}
            >
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
                {translate(
                  'auto.components.teamerge.TeamSettingsSection.558d7b541f',
                  'Commit Roster'
                )}
              </Button>
              <Button
                size="sm"
                disabled={name === team.name && relayUrl === team.relayUrl}
                onClick={() =>
                  void act(() => window.api.teamerge.updateTeamSettings({ name, relayUrl }))
                }
              >
                {translate(
                  'auto.components.teamerge.TeamSettingsSection.4805cc70b3',
                  'Save Changes'
                )}
              </Button>
            </div>
          </GroupedList>

          <GroupedList
            title={translate('auto.components.teamerge.TeamSettingsSection.e2b43839e5', 'Members')}
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
                    {member.id === me ? (
                      <StatusPill tone="indigo">
                        {translate(
                          'auto.components.teamerge.TeamSettingsSection.54b32f2062',
                          'You'
                        )}
                      </StatusPill>
                    ) : null}
                  </span>
                }
                subtitle={<span className="font-mono">{member.id}</span>}
                trailing={
                  member.id !== me ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        if (
                          window.confirm(
                            translate(
                              'auto.components.teamerge.TeamSettingsSection.dbf2b0fe63',
                              'Remove {{value0}} from the team roster?',
                              { value0: member.name }
                            )
                          )
                        ) {
                          void act(
                            () => window.api.teamerge.removeMember(member.id),
                            `Removed ${member.name}. Commit the roster to finish.`
                          )
                        }
                      }}
                    >
                      <UserMinus />
                      {translate(
                        'auto.components.teamerge.TeamSettingsSection.3c7b8371f8',
                        'Remove'
                      )}
                    </Button>
                  ) : null
                }
              />
            ))}
          </GroupedList>
        </>
      ) : null}

      <GroupedList
        title={translate(
          'auto.components.teamerge.TeamSettingsSection.9251448fcc',
          'Relay on This Mac'
        )}
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
          title={
            relay.running
              ? translate(
                  'auto.components.teamerge.TeamSettingsSection.102be969b1',
                  'Running on port {{value0}}',
                  { value0: relay.port }
                )
              : translate('auto.components.teamerge.TeamSettingsSection.fc78deb481', 'Not running')
          }
          subtitle={
            relay.running
              ? translate(
                  'auto.components.teamerge.TeamSettingsSection.585e8fca95',
                  '{{count}} connected members',
                  { count: relay.peers, defaultValue_one: '{{count}} connected member' }
                )
              : translate(
                  'auto.components.teamerge.TeamSettingsSection.dd479fe166',
                  'Host the relay here for teammates on your network.'
                )
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
              {relay.running
                ? translate('auto.components.teamerge.TeamSettingsSection.139a3de806', 'Stop Relay')
                : translate(
                    'auto.components.teamerge.TeamSettingsSection.2f13c832b4',
                    'Start Relay'
                  )}
            </Button>
          }
        />
      </GroupedList>

      <GroupedList
        title={translate(
          'auto.components.teamerge.TeamSettingsSection.7c21711f3e',
          'Remote Keystroke Log'
        )}
        footer="Every keystroke a teammate sends to your shared panes, with your decision."
      >
        {audit.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            {translate(
              'auto.components.teamerge.TeamSettingsSection.96bc425a6c',
              'No remote keystrokes yet.'
            )}
          </div>
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
