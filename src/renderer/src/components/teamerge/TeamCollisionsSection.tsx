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
        `Claimed ${filePath} for ${task.taskName}. Other agents are warned before editing it.`
      )
      void refreshTeamergeNow(tasks)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div>
      <TeamSectionHeader
        title="Collisions"
        subtitle="Files changed by more than one task, here and on teammates’ machines. Red means merging those tasks would conflict."
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
            {refreshing ? 'Checking…' : 'Check Now'}
          </Button>
        }
      />

      {collisions.length === 0 ? (
        <EmptyState
          icon={<Flag />}
          title="No Collisions"
          description="No two tasks are changing the same file right now."
        />
      ) : (
        <GroupedList
          title={`${collisions.length} Shared ${collisions.length === 1 ? 'File' : 'Files'}`}
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
                  {collision.claimedBy ? ` — claimed by ${collision.claimedBy.memberName}` : ''}
                </>
              }
              trailing={
                <>
                  <StatusPill tone={collision.conflict ? 'red' : 'amber'}>
                    {collision.conflict ? 'Conflict' : 'Overlap'}
                  </StatusPill>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="xs" variant="ghost">
                        <Hand />
                        Claim
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
                            For {t.taskName}
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
        title="Claims"
        footer={
          <>
            Agents claim files with <code className="font-mono">teamerge claim &lt;file&gt;</code>.
            The pre-edit hook (<code className="font-mono">teamerge install-hooks</code>) warns an
            agent just before it edits a file another task is changing or has claimed.
          </>
        }
      >
        {claims.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">No files are claimed.</div>
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
                    Release
                  </Button>
                ) : null
              }
            />
          ))
        )}
      </GroupedList>

      <GroupedList title="Ask from Any Agent">
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
