import { ATTENTION_STATUSES } from './agents'
import { dayKey, daysBetween } from './day'
import { bucketOf, dueDayOf, isTopLevelWork, nextSteps, routineState, type ListSettings } from './lists'
import { occurrencesOn, type Occurrence } from './schedule'
import type { AgentSession, Item } from './types'

export type NowSettings = ListSettings

export interface TodayEntry {
  readonly item: Item
  /** Days past the due date; 0 when not overdue. */
  readonly overdueDays: number
  readonly nextStep: Item | null
}

export interface RoutineEntry {
  readonly item: Item
  /** Null when the routine has never been done. */
  readonly daysSince: number | null
  /** Days beyond the wanted interval (0 = due today). */
  readonly overdueBy: number
}

export interface NowView {
  readonly day: string
  readonly attention: readonly AgentSession[]
  readonly running: readonly AgentSession[]
  readonly today: readonly TodayEntry[]
  readonly routines: readonly RoutineEntry[]
  /** Fixed-time routines of today that have not ended yet. */
  readonly schedule: readonly Occurrence[]
  readonly inboxCount: number
  readonly staleCount: number
}

/** A session that stopped reporting this long ago is treated as gone, not running. */
const RUNNING_TTL_MS = 12 * 3_600_000

/*
 * `cutoff` is the last restart (or sign-in): a session that last reported before it lost its
 * terminal then, so it is neither running nor waiting, whatever it said last.
 */

export const isRunning = (s: AgentSession, now: number, cutoff = 0): boolean =>
  s.status === 'running' && now - s.updatedAt < RUNNING_TTL_MS && s.updatedAt >= cutoff

/** Waiting on the person: still open, and not marked as seen since it started waiting. */
export const needsAttention = (s: AgentSession, cutoff = 0): boolean =>
  ATTENTION_STATUSES.has(s.status) &&
  s.attentionAt !== null &&
  s.endedAt === null &&
  s.updatedAt >= cutoff &&
  (s.acknowledgedAt === null || s.acknowledgedAt < s.attentionAt)

/** Finished, failed, stopped or closed, and nobody needs to look at it any more. */
export const isSettled = (s: AgentSession, now: number, cutoff = 0): boolean =>
  !needsAttention(s, cutoff) && !isRunning(s, now, cutoff)

/**
 * How a session that is no longer open went away. One last seen before the restart went with
 * it, even when Perch marked it closed later (這次都不要, a folder that was gone).
 */
export function endLabel(s: AgentSession, cutoff: number): '已關' | '關機時斷掉' | null {
  const lastActive = Math.max(s.updatedAt, s.reopenedAt ?? 0)
  if (lastActive < cutoff && (s.endedAt === null || s.endedAt >= cutoff)) return '關機時斷掉'
  return s.endedAt !== null ? '已關' : null
}

/** Closed this soon after its last answer... */
const ONE_SHOT_CLOSE_MS = 60_000
/** ...and this soon after it started. */
const ONE_SHOT_SPAN_MS = 10 * 60_000

/**
 * A run another program started for one answer (`claude -p`, scripts calling grok): it closed
 * within a minute of answering, less than ten minutes after it began.
 */
export const isOneShot = (s: AgentSession): boolean =>
  s.endedAt !== null && s.endedAt - s.updatedAt < ONE_SHOT_CLOSE_MS && s.endedAt - s.startedAt < ONE_SHOT_SPAN_MS

export function byUrgency(a: TodayEntry, b: TodayEntry): number {
  if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays
  const at = a.item.dueHasTime ? (a.item.dueAt ?? Infinity) : Infinity
  const bt = b.item.dueHasTime ? (b.item.dueAt ?? Infinity) : Infinity
  if (at !== bt) return at - bt
  const ap = a.item.priority ?? 1
  const bp = b.item.priority ?? 1
  if (ap !== bp) return ap - bp
  return a.item.createdAt - b.item.createdAt
}

/** Today's work, most urgent first, each with its next step. */
export function todayEntries(items: readonly Item[], day: string, settings: ListSettings): TodayEntry[] {
  const next = nextSteps(items)
  return items
    .filter((i) => isTopLevelWork(i) && bucketOf(i, day, settings) === 'today')
    .map((item) => {
      const dueDay = dueDayOf(item, settings.dayStartHour)
      const overdueDays = dueDay !== null && dueDay < day ? daysBetween(dueDay, day) : 0
      return { item, overdueDays, nextStep: next.get(item.id) ?? null }
    })
    .sort(byUrgency)
}

/** What the float shows: only things that concern today. */
export function buildNow(
  items: readonly Item[],
  sessions: readonly AgentSession[],
  now: number,
  settings: NowSettings,
  /** The last restart; sessions from before it are gone (see `isRunning`). */
  cutoff = 0,
): NowView {
  const day = dayKey(now, settings.dayStartHour)

  let inboxCount = 0
  let staleCount = 0
  for (const item of items.filter(isTopLevelWork)) {
    const bucket = bucketOf(item, day, settings)
    if (bucket === 'inbox') inboxCount++
    else if (bucket === 'old') staleCount++
  }

  const routines: RoutineEntry[] = []
  for (const item of items) {
    if (item.kind !== 'routine' || item.parentId !== null || item.intervalDays === null) continue
    const state = routineState(item, day, settings.dayStartHour)
    if (!state.isDue) continue
    routines.push({ item, daysSince: state.daysSince, overdueBy: -state.dueIn! })
  }
  routines.sort((a, b) => b.overdueBy / b.item.intervalDays! - a.overdueBy / a.item.intervalDays!)

  return {
    day,
    attention: sessions.filter((s) => needsAttention(s, cutoff)).sort((a, b) => b.attentionAt! - a.attentionAt!),
    running: sessions.filter((s) => isRunning(s, now, cutoff)),
    today: todayEntries(items, day, settings),
    routines,
    schedule: occurrencesOn(items, day).filter((o) => o.endAt > now),
    inboxCount,
    staleCount,
  }
}
