import type { DatabaseSync } from 'node:sqlite'
import type { DayMarks, DaySummary, DayView, EntryKind, TimelineEntry } from '@shared/calendar'
import { parseCapture } from '@shared/capture'
import { addDays, dayKey, dayStart, daysBetween } from '@shared/day'
import { dueDayOf, isTopLevelWork } from '@shared/lists'
import { todayEntries } from '@shared/now'
import { occurrencesOn } from '@shared/schedule'
import type { Item, TimelineEvent } from '@shared/types'
import { appendEvent, deleteEvent, getEvent, listEvents } from '../db/events'
import { createItem, listOpenItems } from '../db/items'
import type { AppSettings } from './settings'

/** Where a manual entry written without a time goes: the middle of that day. */
const NO_TIME_HOUR = 12

const isStep = (e: TimelineEvent): boolean => typeof e.data?.['stepOf'] === 'string'

/** One timeline event as a line of a day, or null for bookkeeping events (created, reopened). */
export function entryOf(e: TimelineEvent): TimelineEntry | null {
  const base = { id: e.id, at: e.at, title: e.title, detail: null as string | null, hasTime: true }
  const kind = ((): EntryKind | null => {
    switch (e.type) {
      case 'item.done':
        return 'done'
      case 'routine.done':
        return 'routine'
      case 'agent.status':
        return e.data?.['status'] === 'failed' ? 'agent-failed' : 'agent'
      case 'focus':
        return 'focus'
      case 'item.dropped':
        return 'dropped'
      case 'manual':
        return 'manual'
      default:
        return null
    }
  })()
  if (!kind) return null
  if (kind === 'done' && isStep(e)) return { ...base, kind, title: `${String(e.data!['stepOf'])} › ${e.title}` }
  if (kind === 'agent' || kind === 'agent-failed') {
    return { ...base, kind, detail: typeof e.data?.['prompt'] === 'string' ? e.data['prompt'] : null }
  }
  if (kind === 'focus') return { ...base, kind, detail: `做了 ${Number(e.data?.['minutes'] ?? 0)} 分` }
  if (kind === 'manual') return { ...base, kind, hasTime: e.data?.['noTime'] !== true }
  return { ...base, kind }
}

function summaryOf(events: readonly TimelineEvent[]): DaySummary {
  const agents = new Set<string>()
  let done = 0
  let routines = 0
  let focusMinutes = 0
  for (const e of events) {
    if (e.type === 'item.done' && !isStep(e)) done++
    else if (e.type === 'routine.done') routines++
    else if (e.type === 'focus') focusMinutes += Number(e.data?.['minutes'] ?? 0)
    else if (e.type === 'agent.status' && e.data?.['status'] === 'done' && e.agentSessionId) agents.add(e.agentSessionId)
  }
  return { done, routines, agents: agents.size, focusMinutes }
}

const eventsOf = (db: DatabaseSync, day: string, s: AppSettings): TimelineEvent[] =>
  listEvents(db, dayStart(day, s.dayStartHour), dayStart(addDays(day, 1), s.dayStartHour))

/** Marks for every day from `from` to `to` (inclusive). */
export function monthMarks(db: DatabaseSync, from: string, to: string, s: AppSettings): DayMarks[] {
  const days = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i))
  const open = listOpenItems(db)
  const done = new Map<string, number>()
  for (const e of listEvents(db, dayStart(from, s.dayStartHour), dayStart(addDays(to, 1), s.dayStartHour))) {
    if (e.type !== 'item.done' || isStep(e)) continue
    const day = dayKey(e.at, s.dayStartHour)
    done.set(day, (done.get(day) ?? 0) + 1)
  }
  const dues = new Map<string, string[]>()
  for (const item of open.filter(isTopLevelWork)) {
    const day = dueDayOf(item, s.dayStartHour)
    if (day) dues.set(day, [...(dues.get(day) ?? []), item.title])
  }
  return days.map((day) => ({
    day,
    done: done.get(day) ?? 0,
    schedules: [...new Set(occurrencesOn(open, day).map((o) => o.item.title))],
    dues: dues.get(day) ?? [],
  }))
}

/** When an every-N-days routine next comes due, if that is after today. */
function expectedDay(item: Item, today: string, s: AppSettings): string | null {
  if (item.kind !== 'routine' || item.intervalDays === null || item.schedule) return null
  const day = addDays(dayKey(item.lastDoneAt ?? item.createdAt, s.dayStartHour), item.intervalDays)
  return day > today ? day : null
}

export function dayView(db: DatabaseSync, day: string, now: number, s: AppSettings): DayView {
  const today = dayKey(now, s.dayStartHour)
  const relation = day < today ? 'past' : day === today ? 'today' : 'future'
  const open = listOpenItems(db)
  const events = relation === 'future' ? [] : eventsOf(db, day, s)
  const work = open.filter(isTopLevelWork)
  return {
    day,
    relation,
    summary: summaryOf(events),
    timeline: events.map(entryOf).filter((e): e is TimelineEntry => e !== null),
    schedule: occurrencesOn(open, day),
    planned:
      relation === 'today'
        ? todayEntries(open, day, s).map((e) => e.item)
        : relation === 'future'
          ? work.filter((i) => i.plannedFor === day && dueDayOf(i, s.dayStartHour) !== day)
          : [],
    // Today's deadlines are already on today's list above.
    dues: relation === 'future' ? work.filter((i) => dueDayOf(i, s.dayStartHour) === day) : [],
    routinesDue: relation === 'future' ? open.filter((i) => expectedDay(i, today, s) === day) : [],
  }
}

/** "下午3點 跟客戶開會" on a past day: a timeline entry at that time; without a time, midday. */
export function addManualEntry(db: DatabaseSync, day: string, text: string, now: number, s: AppSettings): TimelineEvent {
  const [y, m, d] = day.split('-').map(Number)
  const parsed = parseCapture(text, new Date(y, m - 1, d, NO_TIME_HOUR).getTime(), s.dayStartHour)
  const time = parsed.dueHasTime && parsed.dueAt !== null ? new Date(parsed.dueAt) : null
  const at = new Date(y, m - 1, d, time ? time.getHours() : NO_TIME_HOUR, time ? time.getMinutes() : 0).getTime()
  if (at > now) throw new Error('Cannot fill in the future')
  const title = (time ? parsed.title : text).trim()
  if (!title) throw new Error('Entry needs some words')
  return appendEvent(db, { at, type: 'manual', title, source: 'user', data: time ? null : { noTime: true } })
}

export function removeManualEntry(db: DatabaseSync, eventId: number): void {
  if (getEvent(db, eventId)?.type !== 'manual') throw new Error('Only manual entries can be removed')
  deleteEvent(db, eventId)
}

/** A line typed on a day in the calendar: its own date wins, otherwise it is planned for that day. */
export function captureOn(db: DatabaseSync, text: string, day: string, now: number, s: AppSettings): Item {
  const parsed = parseCapture(text, now, s.dayStartHour)
  if (parsed.dueAt !== null) {
    return createItem(db, { kind: 'task', title: parsed.title, dueAt: parsed.dueAt, dueHasTime: parsed.dueHasTime }, now)
  }
  return createItem(db, { kind: 'task', title: parsed.title, plannedFor: day }, now)
}
