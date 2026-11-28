import React, { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Flag, GitCompareArrows, Hand, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { relativeTime, useTeamergeStore } from './teamerge-store'
import type { TeamergeRepoTasks } from './use-teamerge-tasks'
import { refreshTeamergeNow } from './use-teamerge-sync'
import {
  EmptyState,
  errorMessage,
  GroupedList,
  GroupedRow,
  StatusPill,
  TeamSectionHeader
} from './team-ui'
import { translate } from '@/i18n/i18n'

export function TeamCollisionsSection({ tasks }: { tasks: TeamergeRepoTasks }): React.JSX.Element {
  const collisions = useTeamergeStore((s) => s.collisions)
  const claims = useTeamergeStore((s) => s.claims)
  const [refreshing, setRefreshing] = useState(false)
  const workTasks = tasks.tasks.filter((t) => !t.isMain)

  const claim = async (filePath: string, taskId: string): Promise<void> => {
    const task = workTasks.find((t) => t.taskId === taskId)
    if (!task || !tasks.repoPath) {
      return
    }
    try {
      await window.api.teamerge.claimFiles({
        repoPath: tasks.repoPath,
        taskId,
        branch: task.branch,
        paths: [filePath]
      })
      toast.success(
        translate(
          'auto.components.teamerge.TeamCollisionsSection.3cdf8300d2',
          'Claimed {{value0}} for {{value1}}. Other agents are warned before editing it.',
          { value0: filePath, value1: task.taskName }
        )
      )
      void refreshTeamergeNow(tasks)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div>
      <TeamSectionHeader
        title={translate('auto.components.teamerge.TeamCollisionsSection.56d10148d5', 'Collisions')}
        subtitle={translate(
          'auto.components.teamerge.TeamCollisionsSection.df9a943e7a',
          'Files changed by more than one task, here and on teammates’ machines. Red means merging those tasks would conflict.'
        )}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true)
              void refreshTeamergeNow(tasks).finally(() => setRefreshing(false))
            }}
          >
            {refreshing
              ? translate('auto.components.teamerge.TeamCollisionsSection.1f403840bb', 'Checking…')
              : translate('auto.components.teamerge.TeamCollisionsSection.7875fcf854', 'Check Now')}
          </Button>
        }
      />

      {collisions.length === 0 ? (
        <EmptyState
          icon={<Flag />}
          title={translate(
            'auto.components.teamerge.TeamCollisionsSection.2f5e7f6ed3',
            'No Collisions'
          )}
          description={translate(
            'auto.components.teamerge.TeamCollisionsSection.e7fbb9a309',
            'No two tasks are changing the same file right now.'
          )}
        />
      ) : (
        <GroupedList
          title={translate(
            'auto.components.teamerge.TeamCollisionsSection.1dfc4d4f8c',
            '{{count}} Shared Files',
            { count: collisions.length, defaultValue_one: '{{count}} Shared File' }
          )}
        >
          {collisions.map((collision) => (
            <GroupedRow
              key={collision.filePath}
              leading={
                collision.conflict ? (
                  <AlertTriangle className="size-4 text-collision-conflict" />
                ) : (
                  <GitCompareArrows className="size-4 text-collision-overlap" />
                )
              }
              title={<span className="font-mono text-[12.5px]">{collision.filePath}</span>}
              subtitle={
                <>
                  {collision.tasks
                    .map((t) => (t.local ? t.taskName : `${t.memberName} / ${t.taskName}`))
                    .join(' · ')}
                  {collision.claimedBy
                    ? translate(
                        'auto.components.teamerge.TeamCollisionsSection.c2ae577f1f',
                        ' — claimed by {{value0}}',
                        { value0: collision.claimedBy.memberName }
                      )
                    : ''}
                </>
              }
              trailing={
                <>
                  <StatusPill tone={collision.conflict ? 'red' : 'amber'}>
                    {collision.conflict
                      ? translate(
                          'auto.components.teamerge.TeamCollisionsSection.e2e6e53215',
                          'Conflict'
                        )
                      : translate(
                          'auto.components.teamerge.TeamCollisionsSection.4ce6a43877',
                          'Overlap'
                        )}
                  </StatusPill>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="xs" variant="ghost">
                        <Hand />
                        {translate(
                          'auto.components.teamerge.TeamCollisionsSection.0f55823ce2',
                          'Claim'
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {collision.tasks
                        .filter((t) => t.local)
                        .map((t) => (
                          <DropdownMenuItem
                            key={t.taskId}
                            onSelect={() => void claim(collision.filePath, t.taskId)}
                          >
                            {translate(
                              'auto.components.teamerge.TeamCollisionsSection.6695e0757f',
                              'For'
                            )}{' '}
                            {t.taskName}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }
            />
          ))}
        </GroupedList>
      )}

      <GroupedList
        title={translate('auto.components.teamerge.TeamCollisionsSection.06d5ec57ee', 'Claims')}
        footer={
          <>
            {translate(
              'auto.components.teamerge.TeamCollisionsSection.2a2317012f',
              'Agents claim files with'
            )}{' '}
            <code className="font-mono">
              {translate(
                'auto.components.teamerge.TeamCollisionsSection.61ea903cfe',
                'teamerge claim &lt;file&gt;'
              )}
            </code>
            {translate(
              'auto.components.teamerge.TeamCollisionsSection.edca8d6165',
              '. The pre-edit hook ('
            )}
            <code className="font-mono">
              {translate(
                'auto.components.teamerge.TeamCollisionsSection.252ab7a4a8',
                'teamerge install-hooks'
              )}
            </code>
            {translate(
              'auto.components.teamerge.TeamCollisionsSection.f2a5e03a80',
              ') warns an agent just before it edits a file another task is changing or has claimed.'
            )}
          </>
        }
      >
        {claims.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            {translate(
              'auto.components.teamerge.TeamCollisionsSection.8184d0c773',
              'No files are claimed.'
            )}
          </div>
        ) : (
          claims.map((c) => (
            <GroupedRow
              key={`${c.taskId}:${c.path}`}
              leading={<Hand className="size-4 text-team-accent" />}
              title={<span className="font-mono text-[12.5px]">{c.path}</span>}
              subtitle={`${c.memberName} · ${c.branch}${c.note ? ` · ${c.note}` : ''} · ${relativeTime(c.claimedAt)}`}
              trailing={
                workTasks.some((t) => t.taskId === c.taskId) && tasks.repoPath ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      void window.api.teamerge
                        .releaseClaims({
                          repoPath: tasks.repoPath as string,
                          taskId: c.taskId,
                          paths: [c.path]
                        })
                        .then(() => refreshTeamergeNow(tasks))
                    }
                  >
                    {translate(
                      'auto.components.teamerge.TeamCollisionsSection.dd34db5f7d',
                      'Release'
                    )}
                  </Button>
                ) : null
              }
            />
          ))
        )}
      </GroupedList>

      <GroupedList
        title={translate(
          'auto.components.teamerge.TeamCollisionsSection.fa125621ab',
          'Ask from Any Agent'
        )}
      >
        {[
          ['teamerge context', 'Who else is working on what, and where your task overlaps'],
          [
            'teamerge why <file>',
            'Who is changing or has claimed a file, with the commits behind it'
          ],
          ['teamerge risk', 'Whether merging your task would conflict with anyone’s']
        ].map(([cmd, text]) => (
          <GroupedRow
            key={cmd}
            leading={<Terminal className="size-4 text-muted-foreground" />}
            title={<code className="font-mono text-[12.5px]">{cmd}</code>}
            subtitle={text}
          />
        ))}
      </GroupedList>
    </div>
  )
}
