import { addDays } from './day'
import type { Item, RoutineSchedule, ScheduleSlot } from './types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** A week plus a day covers every weekly slot, whatever today is. */
const LOOKAHEAD_DAYS = 8
const MAX_SLOTS = 14
const MAX_REMIND_MINUTES = 24 * 60

/** One weekly slot on one date, as real times. */
export interface Occurrence {
  readonly item: Item
  readonly slot: ScheduleSlot
  readonly startAt: number
  /** After the start; a slot like 22:00–02:00 ends the next morning. */
  readonly endAt: number
}

const pad = (n: number): string => String(n).padStart(2, '0')
const minutesOf = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** "9:05", "0905", "09:05" → "09:05"; null when it is not a time of day. */
export function normaliseTime(text: string): string | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(text.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null
}

/** Validates a schedule coming from the renderer; throws on anything unusable. */
export function parseSchedule(raw: unknown): RoutineSchedule {
  if (typeof raw !== 'object' || raw === null) throw new Error('Schedule must be an object')
  const { slots, remindMinutes } = raw as Record<string, unknown>
  if (!Array.isArray(slots) || slots.length === 0 || slots.length > MAX_SLOTS) throw new Error('Schedule needs 1-14 slots')
  const parsed = slots.map((s: unknown): ScheduleSlot => {
    const { weekday, start, end } = (s ?? {}) as Record<string, unknown>
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new Error('Weekday must be 0-6')
    }
    const from = typeof start === 'string' ? normaliseTime(start) : null
    const to = typeof end === 'string' ? normaliseTime(end) : null
    if (!from || !to || from === to) throw new Error('A slot needs two different times of day')
    return { weekday, start: from, end: to }
  })
  const remind =
    remindMinutes === null
      ? null
      : typeof remindMinutes === 'number' && Number.isInteger(remindMinutes) && remindMinutes >= 0 && remindMinutes <= MAX_REMIND_MINUTES
        ? remindMinutes
        : undefined
  if (remind === undefined) throw new Error('Reminder must be off or 0-1440 minutes')
  return { slots: parsed, remindMinutes: remind }
}

function occurrence(item: Item, slot: ScheduleSlot, day: string): Occurrence {
  const [y, m, d] = day.split('-').map(Number)
  const startAt = new Date(y, m - 1, d, 0, minutesOf(slot.start)).getTime()
  const endMinutes = minutesOf(slot.end)
  const endAt = new Date(y, m - 1, d + (endMinutes <= minutesOf(slot.start) ? 1 : 0), 0, endMinutes).getTime()
  return { item, slot, startAt, endAt }
}

const weekdayOf = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** Every slot of every open scheduled routine on one calendar date (YYYY-MM-DD), earliest first. */
export function occurrencesOn(items: readonly Item[], day: string): Occurrence[] {
  const weekday = weekdayOf(day)
  return items
    .filter((i) => i.schedule !== null && i.doneAt === null)
    .flatMap((i) => i.schedule!.slots.filter((s) => s.weekday === weekday).map((s) => occurrence(i, s, day)))
    .sort((a, b) => a.startAt - b.startAt)
}

const calendarDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The slot going on now, or else the next one to start; null for a routine without a schedule. */
export function nextOccurrence(item: Item, now: number): Occurrence | null {
  if (!item.schedule) return null
  const start = addDays(calendarDay(now), -1)
  for (let i = 0; i <= LOOKAHEAD_DAYS; i++) {
    const found = occurrencesOn([item], addDays(start, i)).find((o) => o.endAt > now)
    if (found) return found
  }
  return null
}

/** Slots whose reminder window (remindMinutes before the start) contains now. */
export function dueReminders(items: readonly Item[], now: number): Occurrence[] {
  const today = calendarDay(now)
  return [today, addDays(today, 1)]
    .flatMap((day) => occurrencesOn(items, day))
    .filter((o) => {
      const remind = o.item.schedule?.remindMinutes
      return remind !== null && remind !== undefined && o.startAt - remind * MINUTE <= now && now < o.startAt
    })
}

/** "還有 1 小時 20 分", "還有 25 分鐘", "馬上開始". */
export function untilLabel(ms: number): string {
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 1) return '馬上開始'
  if (ms < HOUR) return `還有 ${minutes} 分鐘`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `還有 ${h} 小時 ${m} 分` : `還有 ${h} 小時`
}

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

/** "週三 16:00–19:00 · 週四 18:30–21:30" */
export function scheduleLabel(schedule: RoutineSchedule): string {
  return [...schedule.slots]
    .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))
    .map((s) => `週${WEEKDAY_NAMES[s.weekday]} ${s.start}–${s.end}`)
    .join(' · ')
}
