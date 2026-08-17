import React, { useState } from 'react'
import { toast } from 'sonner'
import { MessagesSquare, Send, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { relativeTime, useTeamergeStore } from './teamerge-store'
import type { TeamergeRepoTasks } from './use-teamerge-tasks'
import {
  EmptyState,
  errorMessage,
  GroupedList,
  GroupedRow,
  MemberAvatar,
  TeamSectionHeader
} from './team-ui'

/** Agent-to-agent messages; agents send them with `teamerge send` and read them with `teamerge inbox`. */
export function TeamMessagesSection({ tasks }: { tasks: TeamergeRepoTasks }): React.JSX.Element {
  const messages = useTeamergeStore((s) => s.messages)
  const status = useTeamergeStore((s) => s.status)
  const agents = useTeamergeStore((s) => s.agents)
  const [to, setTo] = useState('')
  const [body, setBody] = useState('')
  const me = status?.identity?.memberId ?? ''
  const targets = [
    ...tasks.tasks
      .filter((t) => !t.isMain)
      .map((t) => ({ key: `${me}|${t.branch}`, label: `${t.taskName} (this machine)` })),
    ...agents.map((a) => ({
      key: `${a.memberId}|${a.branch}`,
      label: `${a.memberName} / ${a.taskName}`
    }))
  ]

  const send = async (): Promise<void> => {
    const [toMemberId, toTask] = to.split('|')
    try {
      await window.api.teamerge.sendMessage({
        toMemberId,
        toTask: toTask || null,
        fromTask: null,
        body
      })
      setBody('')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div>
      <TeamSectionHeader
        title="Agent Messages"
        subtitle={
          <>
            Agents talk to each other across tasks and machines with{' '}
            <code className="font-mono text-xs">
              teamerge send &lt;task|teammate/task&gt; &quot;…&quot;
            </code>{' '}
            and read with <code className="font-mono text-xs">teamerge inbox</code>.
          </>
        }
      />
      <GroupedList>
        <form
          className="flex items-center gap-2 px-3 py-2.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (to && body.trim()) {
              void send()
            }
          }}
        >
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger className="w-56 shrink-0">
              <SelectValue placeholder="To task…" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((target) => (
                <SelectItem key={target.key} value={target.key}>
                  {target.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Message for the agent"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={!to || !body.trim()}
          >
            <Send className="size-4" />
          </Button>
        </form>
      </GroupedList>
      {messages.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare />}
          title="No Messages"
          description="When agents coordinate — “I’m renaming the auth module, hold off on it” — the conversation shows up here."
        />
      ) : (
        <GroupedList title="Recent">
          {messages.map((message) => (
            <GroupedRow
              key={message.id}
              leading={
                <MemberAvatar memberId={message.fromMemberId} name={message.fromName} size={26} />
              }
              title={<span className="whitespace-normal">{message.body}</span>}
              subtitle={
                <span className="flex items-center gap-1">
                  <Terminal className="size-3" />
                  {message.fromName}
                  {message.fromTask ? `/${message.fromTask}` : ''} → {message.toTask ?? 'any task'}{' '}
                  · {relativeTime(message.at)}
                </span>
              }
            />
          ))}
        </GroupedList>
      )}
    </div>
  )
}
