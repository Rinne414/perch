import type { DatabaseSync } from 'node:sqlite'
import type { RoutineHistory } from '@shared/ipc'
import type { Item } from '@shared/types'
import { appendEvent, deleteEvent, getEvent, listItemEvents } from '../db/events'
import { getItem } from '../db/items'
import { transaction } from '../db/transaction'

const DAY_MS = 86_400_000
const HISTORY_LIMIT = 20
/** Two gaps are the least that says something about a habit. */
const MIN_RECORDS_FOR_AVERAGE = 3
/** A few seconds of clock drift between typing and saving is not "the future". */
const FUTURE_SLACK_MS = 60_000

function requireRoutine(db: DatabaseSync, id: string): Item {
  const item = getItem(db, id)
  if (!item || item.kind !== 'routine') throw new Error(`Routine not found: ${id}`)
  return item
}

const setLastDone = (db: DatabaseSync, id: string, at: number | null, now: number): void => {
  db.prepare('UPDATE items SET last_done_at = ?, updated_at = ? WHERE id = ?').run(at, now, id)
}

/** Average days between completions, from newest-first times; null until there are enough. */
export function averageInterval(timesNewestFirst: readonly number[]): number | null {
  if (timesNewestFirst.length < MIN_RECORDS_FOR_AVERAGE) return null
  const span = timesNewestFirst[0] - timesNewestFirst[timesNewestFirst.length - 1]
  return Math.round((span / DAY_MS / (timesNewestFirst.length - 1)) * 10) / 10
}

export function routineHistory(db: DatabaseSync, id: string): RoutineHistory {
  requireRoutine(db, id)
  const records = listItemEvents(db, id, 'routine.done', HISTORY_LIMIT).map((e) => ({
    id: e.id,
    at: e.at,
    backfilled: e.data?.['backfilled'] === true,
  }))
  return { records, averageDays: averageInterval(records.map((r) => r.at)) }
}

/** Records a completion that happened earlier ("I did it yesterday"). */
export function recordRoutine(db: DatabaseSync, id: string, at: number, now: number): Item {
  if (at > now + FUTURE_SLACK_MS) throw new Error('Cannot record a time in the future')
  return transaction(db, () => {
    const item = requireRoutine(db, id)
    appendEvent(db, { at, type: 'routine.done', title: item.title, itemId: id, source: 'user', data: { backfilled: true } })
    if (item.lastDoneAt === null || at > item.lastDoneAt) setLastDone(db, id, at, now)
    return getItem(db, id)!
  })
}

/** Takes back one wrong record; "last done" falls back to the newest one left. */
export function removeRoutineRecord(db: DatabaseSync, eventId: number, now: number): Item {
  return transaction(db, () => {
    const event = getEvent(db, eventId)
    if (!event || event.type !== 'routine.done' || !event.itemId) throw new Error(`Not a routine record: ${eventId}`)
    const item = requireRoutine(db, event.itemId)
    deleteEvent(db, eventId)
    const newest = listItemEvents(db, item.id, 'routine.done', 1)[0]
    // A "last done" that no record backs (set by an import) stays unless it was this record.
    const fallback = item.lastDoneAt === event.at ? null : item.lastDoneAt
    setLastDone(db, item.id, newest?.at ?? fallback, now)
    return getItem(db, item.id)!
  })
}
