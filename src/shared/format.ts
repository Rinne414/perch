import { dayKey, daysBetween } from './day'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const pad = (n: number): string => String(n).padStart(2, '0')

/** "剛剛", "5 分鐘", "3 小時", "2 天" — elapsed time since `ms`. */
export function ago(ms: number, now: number): string {
  const diff = Math.max(0, now - ms)
  if (diff < MINUTE) return '剛剛'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分鐘`
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)} 小時`
  return `${Math.floor(diff / (24 * HOUR))} 天`
}

export const clock = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const monthDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']

/** "9/29 週二" for a YYYY-MM-DD day key. */
export function dayTitle(key: string): { date: string; weekday: string } {
  const [y, m, d] = key.split('-').map(Number)
  return { date: `${m}/${d}`, weekday: WEEKDAYS[new Date(y, m - 1, d).getDay()] }
}

/** "今天", "明天", "昨天", or "10/2 週五" for a day key, relative to `today`. */
export function dayLabel(key: string, today: string): string {
  const diff = Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  const { date, weekday } = dayTitle(key)
  return `${date} ${weekday}`
}

/** "3 天前" style age of a timestamp in whole days, using the app's day boundary. */
export function daysAgoLabel(ms: number, now: number, dayStartHour: number): string {
  const days = daysBetween(dayKey(ms, dayStartHour), dayKey(now, dayStartHour))
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  return `${days} 天前`
}
