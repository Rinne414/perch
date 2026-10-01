import type { DatabaseSync } from 'node:sqlite'
import { parseCapture } from '@shared/capture'
import { quotaAlert, type QuotaSnapshot } from '@shared/quota'
import { addDays, dayKey, dayStart, moveToDay } from '@shared/day'
import type { CaptureTarget, FocusState, NowPayload } from '@shared/ipc'
import { buildMainView } from '@shared/mainView'
import { buildNow, isSettled } from '@shared/now'
import { buildRecap } from '@shared/recap'
import { DEFAULT_REMIND_MINUTES } from '@shared/schedule'
import { parseWeekly } from '@shared/weekly'
import type { Item } from '@shared/types'
import { listAgentSessions } from '../db/agents'
import { listEvents } from '../db/events'
import { createItem, getItem, listDoneItems, listOpenItems, updateItem } from '../db/items'
import { getSetting, setSetting } from '../db/settings'
import { createRoutine } from './manage'
import type { AppSettings } from './settings'

const DAY_MS = 86_400_000
const AGENT_WINDOW_MS = 7 * DAY_MS
const RECAP_DISMISSED = 'recapDismissedDay'
/** The float shows the start of each list; the main window has the rest. */
const FLOAT_UPCOMING = 5
const FLOAT_IDEAS = 3
const FLOAT_RECENT_AGENTS = 4

export function getNowPayload(
  db: DatabaseSync,
  now: number,
  settings: AppSettings,
  pinned: boolean,
  focus: FocusState | null = null,
  quota: QuotaSnapshot | null = null,
): NowPayload {
  const open = listOpenItems(db)
  const sessions = listAgentSessions(db, now - AGENT_WINDOW_MS)
  const view = buildNow(open, sessions, now, settings)
  const today = dayStart(view.day, settings.dayStartHour)
  const lists = buildMainView(open, [], listDoneItems(db, today, now + 1), now, settings)
  const dismissed = getSetting<string | null>(db, RECAP_DISMISSED, null) === view.day
  const yesterday = addDays(view.day, -1)
  const recap = dismissed
    ? null
    : buildRecap(yesterday, listEvents(db, dayStart(yesterday, settings.dayStartHour), today))
  return {
    view,
    recap,
    pinned,
    dayStartHour: settings.dayStartHour,
    focus,
    quotaAlert: quotaAlert(quota, now),
    upcoming: lists.upcoming.slice(0, FLOAT_UPCOMING),
    upcomingCount: lists.upcoming.length,
    ideas: lists.inbox.slice(0, FLOAT_IDEAS),
    doneToday: lists.doneToday.filter((i) => i.droppedAt === null),
    recentAgents: sessions.filter((s) => isSettled(s, now)).slice(0, FLOAT_RECENT_AGENTS),
  }
}

/**
 * One typed line becomes an item. A fixed weekly time ("每週四 18:30-21:30 上班") makes a
 * routine; a line with a date is a task due then; without one it goes to today (typed in
 * the float) or the inbox (typed anywhere else).
 */
export function captureText(
  db: DatabaseSync,
  text: string,
  target: CaptureTarget,
  now: number,
  settings: AppSettings,
): Item {
  const weekly = parseWeekly(text)
  if (weekly) {
    return createRoutine(db, weekly.title, null, now, { slots: weekly.slots, remindMinutes: DEFAULT_REMIND_MINUTES })
  }
  const parsed = parseCapture(text, now, settings.dayStartHour)
  if (parsed.dueAt !== null) {
    return createItem(db, { kind: 'task', title: parsed.title, dueAt: parsed.dueAt, dueHasTime: parsed.dueHasTime }, now)
  }
  if (target === 'today') {
    return createItem(db, { kind: 'task', title: parsed.title, plannedFor: dayKey(now, settings.dayStartHour) }, now)
  }
  return createItem(db, { kind: 'idea', title: parsed.title }, now)
}

/**
 * "Not today": a planned item moves to tomorrow; a dated one moves its due date a
 * day past today and reminds again. A deliberate choice, so it is not counted as
 * a postponement.
 */
export function postponeItem(db: DatabaseSync, id: string, now: number, settings: AppSettings): Item {
  const item = getItem(db, id)
  if (!item) throw new Error(`Item not found: ${id}`)
  const today = dayKey(now, settings.dayStartHour)
  const tomorrow = addDays(today, 1)
  if (item.dueAt === null) return updateItem(db, id, { plannedFor: tomorrow }, now)

  const moved = moveToDay(item.dueAt, tomorrow, settings.dayStartHour)
  const plannedFor = item.plannedFor !== null && item.plannedFor <= today ? tomorrow : item.plannedFor
  return updateItem(db, id, { dueAt: moved, notifiedAt: null, plannedFor }, now)
}

export function dismissRecap(db: DatabaseSync, now: number, settings: AppSettings): void {
  setSetting(db, RECAP_DISMISSED, dayKey(now, settings.dayStartHour))
}
