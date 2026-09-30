import type { DatabaseSync } from 'node:sqlite'
import { parseCapture } from '@shared/capture'
import { liveWindows, type QuotaSnapshot } from '@shared/quota'
import { addDays, dayKey, dayStart, moveToDay } from '@shared/day'
import type { BatchTarget, FocusState, MainPayload, PlanTarget } from '@shared/ipc'
import { buildMainView } from '@shared/mainView'
import { isRunning, needsAttention } from '@shared/now'
import type { Item, ItemPatch, RoutineSchedule } from '@shared/types'
import { listAgentSessions } from '../db/agents'
import {
  createItem,
  dropItem,
  getItem,
  listDoneItems,
  listOpenItems,
  listStepsOfOpenItems,
  reopenItem,
  restoreItem,
  takeItem,
  updateItem,
  type ItemSnapshot,
} from '../db/items'
import { transaction } from '../db/transaction'
import type { AppSettings } from './settings'

const AGENT_WINDOW_MS = 7 * 86_400_000
/** Enough for a busy week without making the Agent tab a log file. */
const RECENT_AGENTS = 60
export const MAX_INTERVAL_DAYS = 3650

export function getMainPayload(
  db: DatabaseSync,
  now: number,
  settings: AppSettings,
  focus: FocusState | null = null,
  quota: QuotaSnapshot | null = null,
): MainPayload {
  const today = dayKey(now, settings.dayStartHour)
  const view = buildMainView(
    listOpenItems(db),
    listStepsOfOpenItems(db),
    listDoneItems(db, dayStart(today, settings.dayStartHour), now + 1),
    now,
    settings,
  )
  const sessions = listAgentSessions(db, now - AGENT_WINDOW_MS)
  const attention = sessions.filter(needsAttention).sort((a, b) => b.attentionAt! - a.attentionAt!)
  const running = sessions.filter((s) => isRunning(s, now))
  const recentAgents = sessions
    .filter((s) => !needsAttention(s) && !isRunning(s, now))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENT_AGENTS)
  const live = liveWindows(quota, now)
  return {
    view,
    attention,
    running,
    recentAgents,
    dayStartHour: settings.dayStartHour,
    staleDays: settings.staleDays,
    focus,
    quota: quota && live.length ? { ...quota, windows: live } : null,
  }
}

function requireItem(db: DatabaseSync, id: string): Item {
  const item = getItem(db, id)
  if (!item) throw new Error(`Item not found: ${id}`)
  return item
}

/** An idea that gets a day or a deadline has become something to do. */
const promoted = (item: Item, patch: ItemPatch): ItemPatch => (item.kind === 'idea' ? { ...patch, kind: 'task' } : patch)

export function planItem(db: DatabaseSync, id: string, target: PlanTarget, now: number, settings: AppSettings): Item {
  const item = requireItem(db, id)
  const today = dayKey(now, settings.dayStartHour)
  if (target === 'none') return updateItem(db, id, { plannedFor: null }, now)
  const plannedFor = target === 'today' ? today : addDays(today, 1)
  return updateItem(db, id, promoted(item, { plannedFor }), now)
}

/** Sets the deadline from typed text ("週五", "10/3", "明天下午3點"), or clears it with null. */
export function setDue(db: DatabaseSync, id: string, text: string | null, now: number, settings: AppSettings): Item {
  const item = requireItem(db, id)
  if (text === null) return updateItem(db, id, { dueAt: null, dueHasTime: false, notifiedAt: null }, now)
  const parsed = parseCapture(text, now, settings.dayStartHour)
  if (parsed.dueAt === null) throw new Error('No date found in the text')
  return updateItem(db, id, promoted(item, { dueAt: parsed.dueAt, dueHasTime: parsed.dueHasTime, notifiedAt: null }), now)
}

export function renameItem(db: DatabaseSync, id: string, title: string, now: number): Item {
  return updateItem(db, id, { title }, now)
}

export function addStep(db: DatabaseSync, parentId: string, title: string, now: number): Item {
  const parent = requireItem(db, parentId)
  if (parent.parentId !== null || parent.kind === 'routine') throw new Error('Steps belong to a task or idea')
  return createItem(db, { kind: 'task', title, parentId }, now)
}

function checkInterval(days: number | null): void {
  if (days === null) return
  if (!Number.isInteger(days) || days < 1 || days > MAX_INTERVAL_DAYS) {
    throw new Error(`Interval must be 1-${MAX_INTERVAL_DAYS} days`)
  }
}

/** A schedule makes a fixed-time routine; it then has no interval. */
export function createRoutine(
  db: DatabaseSync,
  title: string,
  intervalDays: number | null,
  now: number,
  schedule: RoutineSchedule | null = null,
): Item {
  const days = schedule ? null : intervalDays
  checkInterval(days)
  return createItem(db, { kind: 'routine', title, intervalDays: days, schedule }, now)
}

export function updateRoutine(
  db: DatabaseSync,
  id: string,
  title: string,
  intervalDays: number | null,
  now: number,
  schedule: RoutineSchedule | null = null,
): Item {
  const days = schedule ? null : intervalDays
  checkInterval(days)
  if (requireItem(db, id).kind !== 'routine') throw new Error('Not a routine')
  return updateItem(db, id, { title, intervalDays: days, schedule }, now)
}

/**
 * Handles a pile of past-due work in one go, without judging: move it to today
 * or tomorrow (same time of day), take the dates away (back to the inbox), or let it go.
 */
export function rescheduleOverdue(
  db: DatabaseSync,
  ids: readonly string[],
  target: BatchTarget,
  now: number,
  settings: AppSettings,
): void {
  const today = dayKey(now, settings.dayStartHour)
  const day = target === 'tomorrow' ? addDays(today, 1) : today
  transaction(db, () => {
    for (const id of ids) {
      const item = requireItem(db, id)
      if (target === 'drop') {
        dropItem(db, id, now)
      } else if (target === 'none') {
        updateItem(db, id, { dueAt: null, dueHasTime: false, notifiedAt: null, plannedFor: null }, now)
      } else {
        const plannedFor = item.plannedFor !== null && item.plannedFor <= today ? day : item.plannedFor
        const dueAt = item.dueAt === null ? null : moveToDay(item.dueAt, day, settings.dayStartHour)
        updateItem(db, id, { dueAt, notifiedAt: null, plannedFor }, now)
      }
    }
  })
}

/** How long a deleted item or a batch change can still be taken back. */
const UNDO_MS = 60_000

export interface Trash {
  remove(db: DatabaseSync, id: string): void
  /** False when the undo window has passed. */
  restore(db: DatabaseSync, id: string): boolean
}

/**
 * Deletion with a short undo window. Snapshots live only in memory: an undo is
 * meant for "oops, wrong row", not as a recycle bin.
 */
export function createTrash(clock: () => number = Date.now): Trash {
  const kept = new Map<string, { readonly snapshot: ItemSnapshot; readonly at: number }>()
  const prune = (): void => {
    const cutoff = clock() - UNDO_MS
    for (const [id, entry] of kept) if (entry.at < cutoff) kept.delete(id)
  }
  return {
    remove(db: DatabaseSync, id: string): void {
      prune()
      kept.set(id, { snapshot: takeItem(db, id), at: clock() })
    },
    restore(db: DatabaseSync, id: string): boolean {
      prune()
      const entry = kept.get(id)
      if (!entry) return false
      kept.delete(id)
      const parentId = entry.snapshot[0]?.parent_id
      if (parentId && !getItem(db, parentId)) return false
      restoreItem(db, entry.snapshot)
      return true
    },
  }
}

export interface BatchUndo {
  /** Remembers the items as they are now; returns a token for `restore`. */
  save(db: DatabaseSync, ids: readonly string[]): string
  /** False when the undo window has passed. */
  restore(db: DatabaseSync, token: string, now: number): boolean
}

/** Undo for one batch change: puts dates, plans and open/closed state back as they were. */
export function createBatchUndo(clock: () => number = Date.now): BatchUndo {
  const kept = new Map<string, { readonly items: readonly Item[]; readonly at: number }>()
  let seq = 0
  const prune = (): void => {
    const cutoff = clock() - UNDO_MS
    for (const [token, entry] of kept) if (entry.at < cutoff) kept.delete(token)
  }
  return {
    save(db, ids) {
      prune()
      const token = String(++seq)
      kept.set(token, { items: ids.map((id) => requireItem(db, id)), at: clock() })
      return token
    },
    restore(db, token, now) {
      prune()
      const entry = kept.get(token)
      if (!entry) return false
      kept.delete(token)
      transaction(db, () => {
        for (const before of entry.items) {
          const current = getItem(db, before.id)
          if (!current) continue
          if (before.doneAt === null && current.doneAt !== null) reopenItem(db, before.id, now)
          const { dueAt, dueHasTime, plannedFor, notifiedAt, kind } = before
          updateItem(db, before.id, { dueAt, dueHasTime, plannedFor, notifiedAt, kind }, now)
        }
      })
      return true
    },
  }
}
