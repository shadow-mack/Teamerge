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
import { translate } from '@/i18n/i18n'

/** Agent-to-agent messages; agents send them with `teamerge send` and read them with `teamerge inbox`. */
export function TeamMessagesSection({ tasks }: { tasks: TeamergeRepoTasks }): React.JSX.Element {
  const messages = useTeamergeStore((s) => s.messages)
  const status = useTeamergeStore((s) => s.status)
  const agents = useTeamergeStore((s) => s.agents)
  const [to, setTo] = useState('')
  const [body, setBody] = useState('')
  const me = status?.identity?.memberId ?? ''
  const recipients = [
    ...tasks.tasks
      .filter((t) => !t.isMain)
      .map((t) => ({
        key: `${me}|${t.branch}`,
        label: translate(
          'auto.components.teamerge.TeamMessagesSection.35bc3c7e78',
          '{{value0}} (this machine)',
          { value0: t.taskName }
        )
      })),
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
        title={translate(
          'auto.components.teamerge.TeamMessagesSection.043e5771fb',
          'Agent Messages'
        )}
        subtitle={
          <>
            {translate(
              'auto.components.teamerge.TeamMessagesSection.17612ed4ca',
              'Agents talk to each other across tasks and machines with'
            )}{' '}
            <code className="font-mono text-xs">
              {translate(
                'auto.components.teamerge.TeamMessagesSection.cefd9a8216',
                'teamerge send &lt;task|teammate/task&gt; &quot;…&quot;'
              )}
            </code>{' '}
            {translate('auto.components.teamerge.TeamMessagesSection.2072e1cd5b', 'and read with')}{' '}
            <code className="font-mono text-xs">
              {translate(
                'auto.components.teamerge.TeamMessagesSection.0dcf30f57b',
                'teamerge inbox'
              )}
            </code>
            .
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
              <SelectValue
                placeholder={translate(
                  'auto.components.teamerge.TeamMessagesSection.02f65c6ea2',
                  'To task…'
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {recipients.map((recipient) => (
                <SelectItem key={recipient.key} value={recipient.key}>
                  {recipient.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder={translate(
              'auto.components.teamerge.TeamMessagesSection.8ff8321e5e',
              'Message for the agent'
            )}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button
            type="submit"
            size="icon"
            aria-label={translate(
              'auto.components.teamerge.TeamMessagesSection.bc66b6b501',
              'Send message'
            )}
            disabled={!to || !body.trim()}
          >
            <Send className="size-4" />
          </Button>
        </form>
      </GroupedList>
      {messages.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare />}
          title={translate(
            'auto.components.teamerge.TeamMessagesSection.e140b08b89',
            'No Messages'
          )}
          description={translate(
            'auto.components.teamerge.TeamMessagesSection.f20e6d7c7b',
            'When agents coordinate — “I’m renaming the auth module, hold off on it” — the conversation shows up here.'
          )}
        />
      ) : (
        <GroupedList
          title={translate('auto.components.teamerge.TeamMessagesSection.f10427d5fc', 'Recent')}
        >
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
                  {message.fromTask ? `/${message.fromTask}` : ''} →{' '}
                  {message.toTask ??
                    translate(
                      'auto.components.teamerge.TeamMessagesSection.4f5040888d',
                      'any task'
                    )}{' '}
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
