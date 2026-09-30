import { dayKey } from './day'
import { clock, dayLabel } from './format'

/** The usage windows Claude Code reports in its status line data (claude.ai Pro and Max plans). */
export type QuotaWindowKey = 'five_hour' | 'seven_day'
export const QUOTA_WINDOWS: readonly QuotaWindowKey[] = ['five_hour', 'seven_day']

export interface QuotaWindow {
  readonly key: QuotaWindowKey
  /** 0-100; the agent's own number, not ours. */
  readonly usedPercent: number
  /** When the window starts over, epoch milliseconds. */
  readonly resetsAt: number
}

/** Stored by the status line command in <inbox>/quota/<agent>.json. */
export interface QuotaSnapshot {
  readonly v: 1
  readonly agent: string
  /** When the agent last reported these numbers. */
  readonly at: number
  readonly windows: readonly QuotaWindow[]
}

/** The 5-hour window at or above this is worth a line in the float. */
export const QUOTA_ALERT_PERCENT = 80

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Reads rate_limits.five_hour / seven_day from Claude Code's status line input; null when absent. */
export function quotaFromStatusline(input: unknown, now: number): QuotaSnapshot | null {
  const limits = record(record(input)?.['rate_limits'])
  if (!limits) return null
  const windows = QUOTA_WINDOWS.flatMap((key): QuotaWindow[] => {
    const w = record(limits[key])
    const used = finite(w?.['used_percentage'])
    const resets = finite(w?.['resets_at'])
    return used === null || resets === null ? [] : [{ key, usedPercent: used, resetsAt: resets * 1000 }]
  })
  return windows.length ? { v: 1, agent: 'claude-code', at: now, windows } : null
}

/** Accepts a stored snapshot only when every field has the right shape. */
export function parseQuota(raw: unknown): QuotaSnapshot | null {
  const r = record(raw)
  const at = finite(r?.['at'])
  if (!r || r['v'] !== 1 || typeof r['agent'] !== 'string' || at === null || !Array.isArray(r['windows'])) return null
  const windows = (r['windows'] as unknown[]).flatMap((w): QuotaWindow[] => {
    const o = record(w)
    const key = o?.['key']
    const used = finite(o?.['usedPercent'])
    const resets = finite(o?.['resetsAt'])
    if (!QUOTA_WINDOWS.includes(key as QuotaWindowKey) || used === null || resets === null) return []
    return [{ key: key as QuotaWindowKey, usedPercent: used, resetsAt: resets }]
  })
  return { v: 1, agent: r['agent'], at, windows }
}

/** Same numbers, whenever they were reported. */
export const sameQuota = (a: QuotaSnapshot, b: QuotaSnapshot): boolean =>
  JSON.stringify(a.windows.map((w) => [w.key, Math.round(w.usedPercent), w.resetsAt])) ===
  JSON.stringify(b.windows.map((w) => [w.key, Math.round(w.usedPercent), w.resetsAt]))

/** Windows that have not started over yet: once reset, an old number says nothing. */
export const liveWindows = (s: QuotaSnapshot | null, now: number): QuotaWindow[] =>
  s ? s.windows.filter((w) => w.resetsAt > now) : []

const SHORT: Readonly<Record<QuotaWindowKey, string>> = { five_hour: '5h', seven_day: '7d' }
export const QUOTA_LABEL: Readonly<Record<QuotaWindowKey, string>> = { five_hour: '5 小時', seven_day: '7 天' }

/** What Claude Code shows under its prompt: "5h 23% · 7d 41%" (empty when there is nothing to say). */
export function statuslineText(s: QuotaSnapshot | null): string {
  return s ? s.windows.map((w) => `${SHORT[w.key]} ${Math.round(w.usedPercent)}%`).join(' · ') : ''
}

/** "16:00 重置", "明天 09:00 重置", "10/3 週六 09:00 重置" */
export function resetLabel(resetsAt: number, now: number): string {
  const day = dayKey(resetsAt, 0)
  const when = day === dayKey(now, 0) ? '' : `${dayLabel(day, dayKey(now, 0))} `
  return `${when}${clock(resetsAt)} 重置`
}

/** The 5-hour window once it is nearly used up, for the float. */
export function quotaAlert(s: QuotaSnapshot | null, now: number): QuotaWindow | null {
  const five = liveWindows(s, now).find((w) => w.key === 'five_hour')
  return five && five.usedPercent >= QUOTA_ALERT_PERCENT ? five : null
}
