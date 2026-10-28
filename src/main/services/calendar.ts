import type { DatabaseSync } from 'node:sqlite'
import type { DayMarks, DaySummary, DayView, EntryKind, TimelineEntry } from '@shared/calendar'
import { parseCapture } from '@shared/capture'
import { addDays, dayKey, dayStart, daysBetween } from '@shared/day'
import { dueDayOf, isTopLevelWork } from '@shared/lists'
import { monthlyDates } from '@shared/monthly'
import { todayEntries } from '@shared/now'
import { projectName } from '@shared/projects'
import { promptTitle } from '@shared/prompt'
import { occurrencesOn } from '@shared/schedule'
import type { Item, TimelineEvent } from '@shared/types'
import { getDayNote } from '../db/dayNotes'
import { appendEvent, deleteEvent, getEvent, listEvents } from '../db/events'
import { createItem, listOpenItems } from '../db/items'
import type { AppSettings } from './settings'

/** Where a manual entry written without a time goes: the middle of that day. */
const NO_TIME_HOUR = 12

const isStep = (e: TimelineEvent): boolean => typeof e.data?.['stepOf'] === 'string'

/** The folder an agent reply came from (migration 9 gave older replies their session's); null when unknown. */
const folderOf = (e: TimelineEvent): string | null => (typeof e.data?.['cwd'] === 'string' ? e.data['cwd'] : null)

/** One timeline event as a line of a day, or null for bookkeeping events (created, reopened). */
export function entryOf(e: TimelineEvent): TimelineEntry | null {
  const base = { id: e.id, at: e.at, title: e.title, detail: null as string | null, hasTime: true, cwd: null as string | null }
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
      case 'power.off':
        return 'power'
      default:
        return null
    }
  })()
  if (!kind) return null
  if (kind === 'done' && isStep(e)) return { ...base, kind, title: `${String(e.data!['stepOf'])} › ${e.title}` }
  if (kind === 'agent' || kind === 'agent-failed') {
    const detail = typeof e.data?.['prompt'] === 'string' ? promptTitle(e.data['prompt']) : null
    return { ...base, kind, detail, cwd: folderOf(e) }
  }
  if (kind === 'focus') return { ...base, kind, detail: `做了 ${Number(e.data?.['minutes'] ?? 0)} 分` }
  if (kind === 'power') return { ...base, kind, detail: typeof e.data?.['reason'] === 'string' ? e.data['reason'] : null }
  if (kind === 'manual') return { ...base, kind, hasTime: e.data?.['noTime'] !== true }
  return { ...base, kind }
}

function summaryOf(events: readonly TimelineEvent[]): DaySummary {
  const projects = new Set<string>()
  let agentReplies = 0
  let done = 0
  let routines = 0
  let focusMinutes = 0
  for (const e of events) {
    if (e.type === 'item.done' && !isStep(e)) done++
    else if (e.type === 'routine.done') routines++
    else if (e.type === 'focus') focusMinutes += Number(e.data?.['minutes'] ?? 0)
    else if (e.type === 'agent.status') {
      agentReplies++
      projects.add(e.title)
    }
  }
  return { done, routines, agentReplies, agentProjects: projects.size, focusMinutes }
}

const eventsOf = (db: DatabaseSync, day: string, s: AppSettings): TimelineEvent[] =>
  listEvents(db, dayStart(day, s.dayStartHour), dayStart(addDays(day, 1), s.dayStartHour))

/** Marks for every day from `from` to `to` (inclusive). */
export function monthMarks(db: DatabaseSync, from: string, to: string, s: AppSettings): DayMarks[] {
  const days = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i))
  const open = listOpenItems(db)
  const done = new Map<string, number>()
  const projects = new Map<string, Map<string, number>>()
  for (const e of listEvents(db, dayStart(from, s.dayStartHour), dayStart(addDays(to, 1), s.dayStartHour))) {
    const day = dayKey(e.at, s.dayStartHour)
    if (e.type === 'item.done' && !isStep(e)) done.set(day, (done.get(day) ?? 0) + 1)
    if (e.type !== 'agent.status') continue
    const name = projectName(folderOf(e))
    if (!name) continue
    const counts = projects.get(day) ?? new Map<string, number>()
    counts.set(name, (counts.get(name) ?? 0) + 1)
    projects.set(day, counts)
  }
  const monthly = new Map<string, string[]>()
  for (const item of open.filter((i) => i.kind === 'routine' && i.monthly)) {
    // Not on dates before the routine existed, so the past shows only what was really there.
    const since = dayKey(item.createdAt, s.dayStartHour)
    for (const day of monthlyDates(item.monthly!, since > from ? since : from, to)) {
      monthly.set(day, [...(monthly.get(day) ?? []), item.title])
    }
  }
  const dues = new Map<string, string[]>()
  for (const item of open.filter(isTopLevelWork)) {
    const day = dueDayOf(item, s.dayStartHour)
    if (day) dues.set(day, [...(dues.get(day) ?? []), item.title])
  }
  return days.map((day) => ({
    day,
    done: done.get(day) ?? 0,
    schedules: [...new Set([...occurrencesOn(open, day).map((o) => o.item.title), ...(monthly.get(day) ?? [])])],
    dues: dues.get(day) ?? [],
    projects: [...(projects.get(day) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([name]) => name),
  }))
}

/** Whether a routine is expected on a future day: an every-N-days one by its interval, a monthly one on its date. */
function comesDueOn(item: Item, day: string, today: string, s: AppSettings): boolean {
  if (item.kind !== 'routine' || item.schedule) return false
  if (item.monthly) return monthlyDates(item.monthly, day, day).length > 0
  if (item.intervalDays === null) return false
  const next = addDays(dayKey(item.lastDoneAt ?? item.createdAt, s.dayStartHour), item.intervalDays)
  return next > today && next === day
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
    routinesDue: relation === 'future' ? open.filter((i) => comesDueOn(i, day, today, s)) : [],
    note: getDayNote(db, day),
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

/** Where a date-only deadline sits within its day. */
const DATE_ONLY_HOUR = 12

/**
 * "這天截止" on a calendar day: due that day, at the time the line names (下午3點) or as a
 * date-only deadline. Without a time the whole line stays the title.
 */
function dueThatDay(text: string, day: string, s: AppSettings): Pick<Item, 'title' | 'dueAt' | 'dueHasTime'> {
  const [y, m, d] = day.split('-').map(Number)
  const parsed = parseCapture(text, new Date(y, m - 1, d, DATE_ONLY_HOUR).getTime(), s.dayStartHour)
  if (parsed.dueHasTime && parsed.dueAt !== null) {
    const time = new Date(parsed.dueAt)
    // 凌晨1點 on a day that starts at 4 a.m. is the late night of that day: the next calendar date.
    const late = time.getHours() < s.dayStartHour ? 1 : 0
    return { title: parsed.title, dueAt: new Date(y, m - 1, d + late, time.getHours(), time.getMinutes()).getTime(), dueHasTime: true }
  }
  return { title: text.trim(), dueAt: new Date(y, m - 1, d, DATE_ONLY_HOUR).getTime(), dueHasTime: false }
}

/**
 * A line typed on a day in the calendar: with `due`, a deadline on that day; otherwise its own
 * date wins, and without one it is planned for that day.
 */
export function captureOn(db: DatabaseSync, text: string, day: string, now: number, s: AppSettings, due = false): Item {
  if (due) return createItem(db, { kind: 'task', ...dueThatDay(text, day, s) }, now)
  const parsed = parseCapture(text, now, s.dayStartHour)
  if (parsed.dueAt !== null) {
    return createItem(db, { kind: 'task', title: parsed.title, dueAt: parsed.dueAt, dueHasTime: parsed.dueHasTime }, now)
  }
  return createItem(db, { kind: 'task', title: parsed.title, plannedFor: day }, now)
}
