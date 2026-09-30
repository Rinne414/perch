import { dayKey } from './day'
import { bucketOf, firstDayOf, isTopLevelWork, nextSteps, routineState, type ListSettings, type RoutineState } from './lists'
import { todayEntries, type TodayEntry } from './now'
import { occurrencesOn, type Occurrence } from './schedule'
import type { Item } from './types'

export interface UpcomingEntry {
  readonly item: Item
  /** The first day it asks for attention (planned or due, whichever is earlier). */
  readonly day: string
  readonly nextStep: Item | null
}

/** Everything the main window lists. */
export interface MainView {
  readonly day: string
  readonly today: readonly TodayEntry[]
  readonly upcoming: readonly UpcomingEntry[]
  /** Newest first. */
  readonly inbox: readonly Item[]
  /** Undated items nobody touched for a while; most recently touched first. */
  readonly old: readonly Item[]
  /** Finished today, latest first, so a mistaken check can be taken back. */
  readonly doneToday: readonly Item[]
  /** Due ones first (most overdue relative to their interval), then the soonest due, then plain trackers. */
  readonly routines: readonly RoutineState[]
  /** Steps per parent id, open and done, in their order. */
  readonly steps: Readonly<Record<string, readonly Item[]>>
  /** Fixed-time routines of today, including the ones already over. */
  readonly schedule: readonly Occurrence[]
}

/** 0 = due, 1 = waiting for its interval, 2 = tracker without an interval. */
const rank = (r: RoutineState): number => (r.isDue ? 0 : r.dueIn !== null ? 1 : 2)

function byRoutineUrgency(a: RoutineState, b: RoutineState): number {
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  if (a.dueIn === null || b.dueIn === null) {
    // Trackers: the one untouched longest first, never-done ones last.
    return (b.daysSince ?? -1) - (a.daysSince ?? -1) || a.item.title.localeCompare(b.item.title)
  }
  if (a.isDue) return a.dueIn / a.item.intervalDays! - b.dueIn / b.item.intervalDays!
  return a.dueIn - b.dueIn || a.item.title.localeCompare(b.item.title)
}

/**
 * @param open open items as the database lists them (tasks, ideas, open steps, routines)
 * @param steps every step of the open items, including finished ones
 * @param doneToday items finished since the day began
 */
export function buildMainView(
  open: readonly Item[],
  steps: readonly Item[],
  doneToday: readonly Item[],
  now: number,
  settings: ListSettings,
): MainView {
  const day = dayKey(now, settings.dayStartHour)
  const next = nextSteps(open)

  const upcoming: UpcomingEntry[] = []
  const inbox: Item[] = []
  const old: Item[] = []
  for (const item of open.filter(isTopLevelWork)) {
    const bucket = bucketOf(item, day, settings)
    if (bucket === 'upcoming') {
      upcoming.push({ item, day: firstDayOf(item, settings.dayStartHour)!, nextStep: next.get(item.id) ?? null })
    } else if (bucket === 'inbox') inbox.push(item)
    else if (bucket === 'old') old.push(item)
  }
  upcoming.sort((a, b) => a.day.localeCompare(b.day) || (a.item.dueAt ?? Infinity) - (b.item.dueAt ?? Infinity))
  inbox.sort((a, b) => b.createdAt - a.createdAt)
  old.sort((a, b) => b.updatedAt - a.updatedAt)

  const grouped: Record<string, Item[]> = {}
  for (const step of steps) (grouped[step.parentId!] ??= []).push(step)

  return {
    day,
    today: todayEntries(open, day, settings),
    upcoming,
    inbox,
    old,
    doneToday: doneToday.filter((i) => i.parentId === null && i.kind !== 'routine').sort((a, b) => b.doneAt! - a.doneAt!),
    routines: open
      .filter((i) => i.kind === 'routine' && i.parentId === null)
      .map((i) => routineState(i, day, settings.dayStartHour))
      .sort(byRoutineUrgency),
    steps: grouped,
    schedule: occurrencesOn(open, day),
  }
}
