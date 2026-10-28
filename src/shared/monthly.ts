import { addDays, daysBetween } from './day'
import type { MonthlyRule } from './types'

/** The longest a monthly routine may start showing before its date. */
export const MAX_LEAD_DAYS = 14
const MAX_DAY = 31
/** Far enough back and ahead to always find the dates around a day: gaps are at most 31 days, leads 14. */
const SPAN_DAYS = 62

const pad = (n: number): string => String(n).padStart(2, '0')

/** Validates a monthly rule coming from the renderer; throws on anything unusable. */
export function parseMonthly(raw: unknown): MonthlyRule {
  if (typeof raw !== 'object' || raw === null) throw new Error('Monthly rule must be an object')
  const { days, leadDays } = raw as Record<string, unknown>
  if (!Array.isArray(days) || days.length === 0 || days.length > MAX_DAY) throw new Error('Pick 1-31 days of the month')
  // Array.from turns holes into undefined, so a sparse array from a crafted request is checked too.
  const picked = Array.from(days as unknown[]).map((d) => {
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > MAX_DAY) throw new Error('Day of month must be 1-31')
    return d
  })
  if (typeof leadDays !== 'number' || !Number.isInteger(leadDays) || leadDays < 0 || leadDays > MAX_LEAD_DAYS) {
    throw new Error(`Lead must be 0-${MAX_LEAD_DAYS} days`)
  }
  return { days: [...new Set(picked)].sort((a, b) => a - b), leadDays }
}

/** Day `day` of a month as a day key; a day the month lacks (31 in April) becomes its last day. */
function dateIn(year: number, month: number, day: number): string {
  const last = new Date(year, month, 0).getDate()
  return `${year}-${pad(month)}-${pad(Math.min(day, last))}`
}

/** Every date of the rule from `from` to `to` (day keys, inclusive), earliest first. */
export function monthlyDates(rule: MonthlyRule, from: string, to: string): string[] {
  const found = new Set<string>()
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  const endYear = Number(to.slice(0, 4))
  const endMonth = Number(to.slice(5, 7))
  while (year < endYear || (year === endYear && month <= endMonth)) {
    for (const d of rule.days) {
      const key = dateIn(year, month, d)
      if (key >= from && key <= to) found.add(key)
    }
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }
  return [...found].sort()
}

export interface MonthlyState {
  /** The date it is due for; when nothing is due, the next date. */
  readonly dueOn: string
  readonly isDue: boolean
  /** Days from the date before `dueOn` to `dueOn`, for sorting and the progress bar. */
  readonly cycleDays: number
}

/**
 * A date's turn opens `leadDays` before it; from then on it is due until done, and a completion
 * from that day on counts for it. A date before the routine existed is not owed.
 */
export function monthlyState(rule: MonthlyRule, createdDay: string, lastDoneDay: string | null, day: string): MonthlyState {
  const dates = monthlyDates(rule, addDays(day, -SPAN_DAYS), addDays(day, SPAN_DAYS))
  const opens = (date: string): string => addDays(date, -rule.leadDays)
  let open = -1
  dates.forEach((date, i) => {
    if (opens(date) <= day) open = i
  })
  const current = open >= 0 ? dates[open] : null
  const settled = current !== null && (current < createdDay || (lastDoneDay !== null && lastDoneDay >= opens(current)))
  const isDue = current !== null && !settled
  const index = isDue ? open : open + 1
  const dueOn = dates[index]
  const before = index > 0 ? dates[index - 1] : addDays(dueOn, -30)
  return { dueOn, isDue, cycleDays: daysBetween(before, dueOn) }
}

/** "每月 5 號", "每月 1、15 號 · 前 3 天提醒" */
export function monthlyLabel(rule: MonthlyRule): string {
  const lead = rule.leadDays > 0 ? ` · 前 ${rule.leadDays} 天提醒` : ''
  return `每月 ${rule.days.join('、')} 號${lead}`
}

/** Where a monthly routine stands: "11/5", "今天", "還有 2 天", "晚了 3 天". */
export function monthlyWhen(dueOn: string, isDue: boolean, day: string): string {
  const date = `${Number(dueOn.slice(5, 7))}/${Number(dueOn.slice(8))}`
  if (!isDue) return `下次 ${date}`
  const diff = daysBetween(day, dueOn)
  if (diff > 0) return `${date} · 還有 ${diff} 天`
  return diff === 0 ? `${date} 今天` : `${date} · 晚了 ${-diff} 天`
}
