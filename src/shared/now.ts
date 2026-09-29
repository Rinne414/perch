import { ATTENTION_STATUSES } from './agents'
import { dayKey, daysBetween } from './day'
import { bucketOf, dueDayOf, isTopLevelWork, nextSteps, routineState, type ListSettings } from './lists'
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
  readonly inboxCount: number
  readonly staleCount: number
}

/** A session that stopped reporting this long ago is treated as gone, not running. */
const RUNNING_TTL_MS = 12 * 3_600_000

export const isRunning = (s: AgentSession, now: number): boolean =>
  s.status === 'running' && now - s.updatedAt < RUNNING_TTL_MS

export const needsAttention = (s: AgentSession): boolean =>
  ATTENTION_STATUSES.has(s.status) &&
  s.attentionAt !== null &&
  (s.acknowledgedAt === null || s.acknowledgedAt < s.attentionAt)

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
    attention: sessions.filter(needsAttention).sort((a, b) => b.attentionAt! - a.attentionAt!),
    running: sessions.filter((s) => isRunning(s, now)),
    today: todayEntries(items, day, settings),
    routines,
    inboxCount,
    staleCount,
  }
}
