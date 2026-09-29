/**
 * A "day" starts at `dayStartHour` local time, so work done at 1 a.m. still
 * belongs to the previous day for people who stay up late.
 */

const pad = (n: number): string => String(n).padStart(2, '0')

export function dayKey(ms: number, dayStartHour: number): string {
  const d = new Date(ms - dayStartHour * 3_600_000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function dayStart(key: string, dayStartHour: number): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, dayStartHour).getTime()
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const next = new Date(y, m - 1, d + days)
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
}

/** Whole days between two day keys (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/**
 * Moves a timestamp to another day while keeping its place within its own day,
 * so a 2 a.m. deadline (the late part of the evening before) stays late at night.
 */
export function moveToDay(ms: number, day: string, dayStartHour: number): number {
  return dayStart(day, dayStartHour) + (ms - dayStart(dayKey(ms, dayStartHour), dayStartHour))
}
