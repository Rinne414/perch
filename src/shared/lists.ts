import { dayKey, daysBetween } from './day'
import { monthlyState } from './monthly'
import type { Item } from './types'

export interface ListSettings {
  readonly dayStartHour: number
  /** Undated items untouched this many days leave the inbox count and move to "old". */
  readonly staleDays: number
}

/** Where an open top-level task or idea belongs on a given day. */
export type Bucket = 'today' | 'upcoming' | 'inbox' | 'old'

export const isTopLevelWork = (i: Item): boolean => i.parentId === null && i.kind !== 'routine' && i.doneAt === null

/** Day key of the due date, or null when the item has none. */
export const dueDayOf = (item: Item, dayStartHour: number): string | null =>
  item.dueAt !== null ? dayKey(item.dueAt, dayStartHour) : null

export function bucketOf(item: Item, day: string, settings: ListSettings): Bucket {
  const dueDay = dueDayOf(item, settings.dayStartHour)
  if ((dueDay !== null && dueDay <= day) || (item.plannedFor !== null && item.plannedFor <= day)) return 'today'
  if (dueDay !== null || item.plannedFor !== null) return 'upcoming'
  return daysBetween(dayKey(item.updatedAt, settings.dayStartHour), day) >= settings.staleDays ? 'old' : 'inbox'
}

/** The first day an upcoming item asks for attention: its planned day or its due day, whichever comes first. */
export function firstDayOf(item: Item, dayStartHour: number): string | null {
  const days = [item.plannedFor, dueDayOf(item, dayStartHour)].filter((d): d is string => d !== null)
  return days.length ? days.sort()[0] : null
}

/** The open step with the lowest sort order per parent: the parent's "next step". */
export function nextSteps(items: readonly Item[]): Map<string, Item> {
  const next = new Map<string, Item>()
  for (const i of items) {
    if (i.parentId === null || i.doneAt !== null) continue
    const current = next.get(i.parentId)
    if (!current || i.sortOrder < current.sortOrder) next.set(i.parentId, i)
  }
  return next
}

export interface RoutineState {
  readonly item: Item
  /** Null when the routine has never been done. */
  readonly daysSince: number | null
  /**
   * Days until it is due again; 0 or less means due, negative is how late. A monthly routine
   * with a reminder lead is due a few days early, with a positive count to its date.
   * Null for a tracker without an interval: it only remembers when it last happened.
   */
  readonly dueIn: number | null
  readonly isDue: boolean
  /** The wanted gap: the interval, or the days between two dates of a monthly routine; null for a tracker. */
  readonly cycleDays: number | null
  /** Monthly routines: the date it is due for, or the next one; null otherwise. */
  readonly dueOn: string | null
}

/** A routine that was never done counts from the day it was created. */
export function routineState(item: Item, day: string, dayStartHour: number): RoutineState {
  const lastDone = item.lastDoneAt === null ? null : dayKey(item.lastDoneAt, dayStartHour)
  const created = dayKey(item.createdAt, dayStartHour)
  const since = daysBetween(lastDone ?? created, day)
  const daysSince = lastDone === null ? null : since
  if (item.monthly) {
    const m = monthlyState(item.monthly, created, lastDone, day)
    return { item, daysSince, dueIn: daysBetween(day, m.dueOn), isDue: m.isDue, cycleDays: m.cycleDays, dueOn: m.dueOn }
  }
  const dueIn = item.intervalDays === null ? null : item.intervalDays - since
  return { item, daysSince, dueIn, isDue: dueIn !== null && dueIn <= 0, cycleDays: item.intervalDays, dueOn: null }
}
