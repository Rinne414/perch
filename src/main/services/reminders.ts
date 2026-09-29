import { agentName, STATUS_LABEL } from '@shared/agents'
import { clock } from '@shared/format'
import { needsAttention } from '@shared/now'
import type { AgentSession, Item } from '@shared/types'
import type { AppSettings } from './settings'

export interface Alert {
  readonly title: string
  readonly body: string
}

/** Time to notify about a due item: its exact time, or the morning of a date-only due. */
export function remindAt(item: Item, settings: AppSettings): number | null {
  if (item.dueAt === null) return null
  if (item.dueHasTime) return item.dueAt
  const d = new Date(item.dueAt)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), settings.morningHour).getTime()
}

export function dueItemsToNotify(items: readonly Item[], now: number, settings: AppSettings): Item[] {
  return items.filter((i) => {
    if (i.doneAt !== null || i.notifiedAt !== null || i.kind === 'routine') return false
    const when = remindAt(i, settings)
    return when !== null && when <= now
  })
}

const MAX_LISTED = 3

/** One notification, however many items came due, so a long absence does not end in a flood. */
export function dueAlert(items: readonly Item[]): Alert | null {
  if (items.length === 0) return null
  if (items.length === 1) {
    const [i] = items
    return { title: `到期：${i.title}`, body: i.dueHasTime && i.dueAt !== null ? clock(i.dueAt) : '今天' }
  }
  const listed = items.slice(0, MAX_LISTED).map((i) => i.title).join('、')
  const more = items.length > MAX_LISTED ? ` 等 ${items.length} 件` : ''
  return { title: `有 ${items.length} 件事到期`, body: listed + more }
}

/** How long a state must last before it is worth interrupting for (the person may be watching). */
const GRACE_MS = { needs_input: 15_000, done: 60_000, failed: 30_000 } as const
const TOO_OLD_MS = 3_600_000

/**
 * Sessions whose current attention episode has lasted past its grace period and has
 * not been announced yet. `announced` maps session id to the attentionAt already sent.
 */
export function agentsToNotify(
  sessions: readonly AgentSession[],
  announced: ReadonlyMap<string, number>,
  now: number,
): AgentSession[] {
  return sessions.filter((s) => {
    if (!needsAttention(s) || s.attentionAt === null) return false
    if (announced.get(s.id) === s.attentionAt) return false
    const waited = now - s.attentionAt
    const grace = GRACE_MS[s.status as keyof typeof GRACE_MS] ?? 60_000
    return waited >= grace && waited < TOO_OLD_MS
  })
}

export function agentAlert(s: AgentSession): Alert {
  const project = s.cwd?.split(/[\\/]/).filter(Boolean).at(-1)
  const title = `${agentName(s.agent)} ${STATUS_LABEL[s.status]}${project ? ` · ${project}` : ''}`
  return { title, body: s.detail ?? s.title ?? '' }
}
