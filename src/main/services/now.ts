import type { DatabaseSync } from 'node:sqlite'
import { parseCapture } from '@shared/capture'
import { addDays, dayKey, dayStart, moveToDay } from '@shared/day'
import type { CaptureTarget, FocusState, NowPayload } from '@shared/ipc'
import { buildNow } from '@shared/now'
import { buildRecap } from '@shared/recap'
import type { Item } from '@shared/types'
import { listAgentSessions } from '../db/agents'
import { listEvents } from '../db/events'
import { createItem, getItem, listOpenItems, updateItem } from '../db/items'
import { getSetting, setSetting } from '../db/settings'
import type { AppSettings } from './settings'

const DAY_MS = 86_400_000
const AGENT_WINDOW_MS = 7 * DAY_MS
const RECAP_DISMISSED = 'recapDismissedDay'

export function getNowPayload(
  db: DatabaseSync,
  now: number,
  settings: AppSettings,
  pinned: boolean,
  focus: FocusState | null = null,
): NowPayload {
  const view = buildNow(listOpenItems(db), listAgentSessions(db, now - AGENT_WINDOW_MS), now, settings)
  const dismissed = getSetting<string | null>(db, RECAP_DISMISSED, null) === view.day
  const yesterday = addDays(view.day, -1)
  const recap = dismissed
    ? null
    : buildRecap(
        yesterday,
        listEvents(db, dayStart(yesterday, settings.dayStartHour), dayStart(view.day, settings.dayStartHour)),
      )
  return { view, recap, pinned, dayStartHour: settings.dayStartHour, focus }
}

/**
 * One typed line becomes an item. A line with a date is a task due then; without
 * one it goes to today (typed in the float) or the inbox (typed anywhere else).
 */
export function captureText(
  db: DatabaseSync,
  text: string,
  target: CaptureTarget,
  now: number,
  settings: AppSettings,
): Item {
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
