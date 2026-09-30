import { addDays } from './day'
import type { Occurrence } from './schedule'
import type { Item } from './types'

/** What a month-grid cell shows. */
export interface DayMarks {
  readonly day: string
  /** Tasks and ideas finished that day (steps not counted). */
  readonly done: number
  /** Fixed-time routines that happen that day. */
  readonly schedules: readonly string[]
  /** Open work whose deadline falls on that day. */
  readonly dues: readonly string[]
}

export type EntryKind = 'done' | 'routine' | 'agent' | 'agent-failed' | 'focus' | 'dropped' | 'manual'

/** One line of a day's timeline. */
export interface TimelineEntry {
  readonly id: number
  readonly at: number
  readonly kind: EntryKind
  readonly title: string
  readonly detail: string | null
  /** False for a manual entry written without a time. */
  readonly hasTime: boolean
}

export interface DaySummary {
  readonly done: number
  readonly routines: number
  /** Agent turns that finished or failed that day. */
  readonly agentReplies: number
  /** How many agent + project pairs those replies came from. */
  readonly agentProjects: number
  readonly focusMinutes: number
}

/** A line of a day's timeline: one event, or every reply of one agent in one project that day. */
export type TimelineLine =
  | { readonly kind: 'entry'; readonly entry: TimelineEntry }
  | { readonly kind: 'agent-group'; readonly title: string; readonly replies: readonly TimelineEntry[] }

const isAgentReply = (e: TimelineEntry): boolean => e.kind === 'agent' || e.kind === 'agent-failed'

/**
 * Folds a day's agent replies into one line per agent and project (the entry title,
 * "Claude Code · perch"), placed where the first reply was. A single reply stays a plain entry.
 */
export function groupTimeline(entries: readonly TimelineEntry[]): TimelineLine[] {
  const replies = new Map<string, TimelineEntry[]>()
  for (const e of entries) {
    if (!isAgentReply(e)) continue
    const list = replies.get(e.title) ?? []
    list.push(e)
    replies.set(e.title, list)
  }
  return entries.flatMap((e): TimelineLine[] => {
    if (!isAgentReply(e)) return [{ kind: 'entry', entry: e }]
    const group = replies.get(e.title)!
    if (group[0] !== e) return []
    return [group.length === 1 ? { kind: 'entry', entry: e } : { kind: 'agent-group', title: e.title, replies: group }]
  })
}

export interface DayView {
  readonly day: string
  readonly relation: 'past' | 'today' | 'future'
  readonly summary: DaySummary
  /** What happened, oldest first (past days and today). */
  readonly timeline: readonly TimelineEntry[]
  readonly schedule: readonly Occurrence[]
  /** Today: everything on today's list. Future: what is planned for that day. */
  readonly planned: readonly Item[]
  /** Open work due that day (today and later). */
  readonly dues: readonly Item[]
  /** Future days: every-N-days routines expected to come due that day. */
  readonly routinesDue: readonly Item[]
  /** The person's note for the day (the diary); empty when none. */
  readonly note: string
}

/**
 * The day keys of a month view, Sunday first like the Windows calendar:
 * whole weeks from the Sunday on or before the 1st to the Saturday on or after the last day.
 */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const key = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const start = addDays(key(first), -first.getDay())
  const cells = first.getDay() + last.getDate() + (6 - last.getDay())
  return Array.from({ length: cells }, (_, i) => addDays(start, i))
}
