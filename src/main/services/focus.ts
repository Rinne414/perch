import type { DatabaseSync } from 'node:sqlite'
import type { FocusState } from '@shared/ipc'
import { appendEvent } from '../db/events'
import { getItem } from '../db/items'

const MINUTE_MS = 60_000

export interface Focus {
  /** The running timer, or null. Ends it quietly when its task was finished or deleted meanwhile. */
  current(db: DatabaseSync): FocusState | null
  /** Starts on a task (and its next step); a timer already running is stopped and logged first. */
  start(db: DatabaseSync, itemId: string, stepId: string | null, now: number): FocusState
  /** "繼續" at the five-minute mark: keep counting, stop asking. */
  extend(): FocusState | null
  /** Ends the timer and logs it on the timeline; returns whole minutes (0 = too short to keep). */
  stop(db: DatabaseSync, now: number): number
}

/**
 * "先做 5 分鐘": one timer at a time, kept in memory. There is no failed state —
 * stopping early just records the minutes that happened.
 */
export function createFocus(): Focus {
  let state: FocusState | null = null

  const isOpen = (db: DatabaseSync, id: string | null): boolean => {
    if (id === null) return true
    const item = getItem(db, id)
    return item !== null && item.doneAt === null
  }

  const stop = (db: DatabaseSync, now: number): number => {
    const ended = state
    state = null
    if (!ended) return 0
    const minutes = Math.round((now - ended.startedAt) / MINUTE_MS)
    if (minutes < 1 || !getItem(db, ended.itemId)) return minutes
    appendEvent(db, {
      at: ended.startedAt,
      type: 'focus',
      title: ended.title,
      itemId: ended.itemId,
      source: 'user',
      data: { minutes, stepId: ended.stepId },
    })
    return minutes
  }

  return {
    current(db) {
      if (state && !(isOpen(db, state.itemId) && isOpen(db, state.stepId))) state = null
      return state
    },
    start(db, itemId, stepId, now) {
      const item = getItem(db, itemId)
      const step = stepId ? getItem(db, stepId) : null
      if (!item || item.doneAt !== null) throw new Error(`Open item not found: ${itemId}`)
      if (stepId && (!step || step.parentId !== itemId)) throw new Error(`Step not found: ${stepId}`)
      stop(db, now)
      state = { itemId, stepId, title: step?.title ?? item.title, startedAt: now, extended: false }
      return state
    },
    extend() {
      if (state) state = { ...state, extended: true }
      return state
    },
    stop,
  }
}
