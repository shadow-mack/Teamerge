import React, { useMemo } from 'react'
import { Eye, Radio, Users, VolumeX, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTeamergeStore } from './teamerge-store'
import type { TeamergeRepoTasks } from './use-teamerge-tasks'
import {
  agentStateLabel,
  agentStateTone,
  BranchLabel,
  EmptyState,
  GroupedList,
  GroupedRow,
  MemberAvatar,
  StatusPill,
  TeamSectionHeader
} from './team-ui'

export function TeamPeopleSection({ tasks }: { tasks: TeamergeRepoTasks }): React.JSX.Element {
  const status = useTeamergeStore((s) => s.status)
  const agents = useTeamergeStore((s) => s.agents)
  const shares = useTeamergeStore((s) => s.shares)
  const setWatching = useTeamergeStore((s) => s.setWatching)
  const team = status?.team
  const me = status?.identity?.memberId
  const online = new Set(status?.onlineMemberIds ?? [])
  const teammates = useMemo(() => (team?.members ?? []).filter((m) => m.id !== me), [team, me])
  const myPanes = tasks.tasks.filter((task) => task.paneId && !task.isMain)

  return (
    <div>
      <TeamSectionHeader
        title="People"
        subtitle="Teammates’ agents running on their own machines. Open a shared pane to watch it live; typing into it asks the owner first."
      />

      {teammates.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Just You So Far"
          description="Commit and push .teamerge/team.json, then ask teammates to open this repository in Teamerge and choose Join Team."
        />
      ) : (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {teammates.map((member) => {
            const theirs = agents.filter((agent) => agent.memberId === member.id)
            const isOnline = online.has(member.id)
            return (
              <section
                key={member.id}
                className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--shadow-card)]"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <MemberAvatar
                    memberId={member.id}
                    name={member.name}
                    size={34}
                    online={isOnline}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{member.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {isOnline
                        ? `${theirs.length} ${theirs.length === 1 ? 'task' : 'tasks'}`
                        : 'Offline'}
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-border/70 border-t border-border/70">
                  {theirs.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-muted-foreground">
                      {isOnline
                        ? 'No agents running.'
                        : 'Their agents appear here when they come online.'}
                    </div>
                  ) : (
                    theirs.map((agent) => (
                      <GroupedRow
                        key={agent.taskId}
                        title={
                          <span className="flex items-center gap-2">
                            <span className="truncate font-medium">{agent.taskName}</span>
                            <StatusPill tone={agentStateTone(agent.state)}>
                              {agentStateLabel(agent.state)}
                            </StatusPill>
                          </span>
                        }
                        subtitle={
                          <span className="flex items-center gap-1.5">
                            <BranchLabel branch={agent.branch} />
                            <span>·</span>
                            <span>{agent.agent}</span>
                            <span>·</span>
                            <span>
                              {agent.changedFiles.length}{' '}
                              {agent.changedFiles.length === 1 ? 'file' : 'files'}
                            </span>
                          </span>
                        }
                        trailing={
                          agent.shared && agent.paneId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setWatching({
                                  ownerId: member.id,
                                  ownerName: member.name,
                                  paneId: agent.paneId as string,
                                  taskName: agent.taskName,
                                  muted: false,
                                  ended: false
                                })
                              }
                            >
                              <Eye className="size-3.5" />
                              Watch
                            </Button>
                          ) : (
                            <span className="text-2xs text-muted-foreground">Not shared</span>
                          )
                        }
                      />
                    ))
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <GroupedList
        title="Your Shared Panes"
        footer="Sharing streams a pane to teammates who open it. Their keystrokes wait for your approval, muted teammates can only watch, and every remote keystroke is logged."
      >
        {myPanes.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            Start an agent in a workspace to share its pane.
          </div>
        ) : (
          myPanes.map((task) => {
            const share = task.paneId ? shares[task.paneId] : undefined
            const shared = share?.shared === true
            return (
              <div key={task.taskId}>
                <GroupedRow
                  leading={
                    <Radio
                      className={
                        shared ? 'size-4 text-presence-online' : 'size-4 text-muted-foreground'
                      }
                    />
                  }
                  title={<span className="font-medium">{task.taskName}</span>}
                  subtitle={
                    <span className="flex items-center gap-1.5">
                      <BranchLabel branch={task.branch} />
                      <span>·</span>
                      <span>{task.agent}</span>
                    </span>
                  }
                  trailing={
                    <>
                      {share?.viewers.length ? (
                        <span className="mr-1 flex -space-x-1.5">
                          {share.viewers.map((viewer) => (
                            <MemberAvatar
                              key={viewer.memberId}
                              memberId={viewer.memberId}
                              name={viewer.name}
                              size={20}
                            />
                          ))}
                        </span>
                      ) : null}
                      <Switch
                        aria-label={`Share ${task.taskName} live`}
                        checked={shared}
                        onCheckedChange={(checked) =>
                          void window.api.teamerge.setPaneShared({
                            paneId: task.paneId as string,
                            shared: checked
                          })
                        }
                      />
                    </>
                  }
                />
                {shared && share && share.viewers.length > 0 ? (
                  <div className="flex flex-wrap gap-2 bg-muted/40 px-4 py-2">
                    {share.viewers.map((viewer) => {
                      const muted = share.mutedMemberIds.includes(viewer.memberId)
                      return (
                        <Tooltip key={viewer.memberId}>
                          <TooltipTrigger asChild>
                            <Button
                              size="xs"
                              variant={muted ? 'destructive-chip' : 'outline'}
                              onClick={() =>
                                void window.api.teamerge.setViewerMuted({
                                  paneId: share.paneId,
                                  memberId: viewer.memberId,
                                  muted: !muted
                                })
                              }
                            >
                              {muted ? <VolumeX /> : <Volume2 />}
                              {viewer.name}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={4}>
                            {muted ? `Unmute ${viewer.name}` : `Mute ${viewer.name}`}
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </GroupedList>
    </div>
  )
}
