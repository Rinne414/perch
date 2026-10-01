import { dayKey, daysBetween } from './day'
import { ago, daysAgoLabel } from './format'
import { isRunning } from './now'
import type { AgentSession, Item } from './types'

/** A folder agents worked in, as the 專案 tab lists it. */
export interface ProjectSummary {
  /** The folder itself; it is the project's key. */
  readonly cwd: string
  readonly name: string
  readonly firstAt: number
  readonly lastAt: number
  readonly sessionCount: number
  /** The session that reported last. */
  readonly latest: AgentSession
  /** Open tasks and ideas that belong to this project. */
  readonly openItems: number
  /** "不再列出": a one-off folder the person asked not to see. */
  readonly hidden: boolean
}

/** One project opened on the right: its latest sessions and its open work. */
export interface ProjectDetail {
  readonly project: ProjectSummary
  /** Newest first. */
  readonly sessions: readonly AgentSession[]
  readonly items: readonly Item[]
}

export interface ProjectGroups {
  readonly recent: readonly ProjectSummary[]
  readonly resting: readonly ProjectSummary[]
  readonly old: readonly ProjectSummary[]
  readonly hidden: readonly ProjectSummary[]
}

/** Untouched this many days, a project is "放了一陣子" and its age turns the wait colour. */
export const RESTING_DAYS = 3
/** Untouched this many days, a project folds away under "超過 30 天的". */
export const OLD_DAYS = 30

export const projectName = (cwd: string | null): string | null =>
  cwd ? (cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? null) : null

const daysUntouched = (p: ProjectSummary, now: number, dayStartHour: number): number =>
  daysBetween(dayKey(p.lastAt, dayStartHour), dayKey(now, dayStartHour))

/** "現在", "2 分鐘前", "昨天", "2 天前", then "5 天沒碰". */
export function projectAgeLabel(p: ProjectSummary, now: number, dayStartHour: number): string {
  if (isRunning(p.latest, now)) return '現在'
  const days = daysUntouched(p, now, dayStartHour)
  if (days >= RESTING_DAYS) return `${days} 天沒碰`
  if (days >= 1) return daysAgoLabel(p.lastAt, now, dayStartHour)
  const since = ago(p.lastAt, now)
  return since === '剛剛' ? since : `${since}前`
}

export const isResting = (p: ProjectSummary, now: number, dayStartHour: number): boolean =>
  !isRunning(p.latest, now) && daysUntouched(p, now, dayStartHour) >= RESTING_DAYS

/** These days, resting, long untouched and hidden; each newest first. */
export function groupProjects(projects: readonly ProjectSummary[], now: number, dayStartHour: number): ProjectGroups {
  const sorted = [...projects].sort((a, b) => b.lastAt - a.lastAt)
  const shown = sorted.filter((p) => !p.hidden)
  const days = (p: ProjectSummary): number => daysUntouched(p, now, dayStartHour)
  return {
    recent: shown.filter((p) => !isResting(p, now, dayStartHour)),
    resting: shown.filter((p) => isResting(p, now, dayStartHour) && days(p) < OLD_DAYS),
    old: shown.filter((p) => days(p) >= OLD_DAYS),
    hidden: sorted.filter((p) => p.hidden),
  }
}
