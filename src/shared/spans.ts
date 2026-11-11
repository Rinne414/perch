import { dayKey, daysBetween } from './day'
import { clock, monthDay } from './format'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export interface DurationPart {
  readonly value: number
  readonly unit: '天' | '小時' | '分'
}

/** "1 小時 28 分" as parts, so the numbers can be set larger than the units. Under a minute is no parts. */
export function durationParts(ms: number): DurationPart[] {
  const total = Math.max(0, ms)
  const parts: DurationPart[] =
    total < HOUR_MS
      ? [{ value: Math.floor(total / MINUTE_MS), unit: '分' }]
      : total < DAY_MS
        ? [
            { value: Math.floor(total / HOUR_MS), unit: '小時' },
            { value: Math.floor((total % HOUR_MS) / MINUTE_MS), unit: '分' },
          ]
        : [
            { value: Math.floor(total / DAY_MS), unit: '天' },
            { value: Math.floor((total % DAY_MS) / HOUR_MS), unit: '小時' },
          ]
  return parts.filter((p) => p.value > 0)
}

/** "3 分", "5 小時 30 分", "2 天 4 小時"; "不到 1 分" for less. */
export function durationLabel(ms: number): string {
  const parts = durationParts(ms)
  return parts.length ? parts.map((p) => `${p.value} ${p.unit}`).join(' ') : '不到 1 分'
}

/** Only the largest unit, for a tight spot: "2 天", "5 小時", "3 分", "不到 1 分". */
export function shortSpan(ms: number): string {
  const [first] = durationParts(ms)
  return first ? `${first.value} ${first.unit}` : '不到 1 分'
}

/** "09:05" today, "昨天 21:40", "11/8 21:40" before that. */
export function stampLabel(ms: number, now: number, dayStartHour: number): string {
  const days = daysBetween(dayKey(ms, dayStartHour), dayKey(now, dayStartHour))
  if (days <= 0) return clock(ms)
  if (days === 1) return `昨天 ${clock(ms)}`
  return `${monthDay(ms)} ${clock(ms)}`
}
