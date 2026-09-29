import * as chrono from 'chrono-node'
import { dayKey } from './day'

export interface ParsedCapture {
  readonly title: string
  readonly dueAt: number | null
  readonly dueHasTime: boolean
  /** The words that were read as a date, for showing "→ 9/30 15:00" while typing. */
  readonly matchedText: string | null
}

const HOUR = 3_600_000
const CJK = /[㐀-鿿]/
/** "10/2" on its own, not part of a longer number or a full date like 2026/10/2. */
const MONTH_DAY = /(?<![\d/])(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])(?![\d/])/g
const PART_OF_DAY = /凌晨|清晨|早上|上午|中午|下午|傍晚|晚上/g

/**
 * The Chinese parser does not know "10/2", so in a line that mixes it with
 * Chinese ("10/2 下午5點") it reads only the time and lands on today.
 * Rewriting it as "10月2日" lets one parser see the whole date.
 */
const withChineseMonthDay = (line: string): string =>
  CJK.test(line) ? line.replace(MONTH_DAY, (_m, month: string, day: string) => `${Number(month)}月${Number(day)}日`) : line

/**
 * chrono's Chinese parser turns "週六下午" (a weekday plus a part of day, no
 * hour) into this afternoon. When the weekday it read does not match the date
 * it produced, the weekday alone decides the day.
 */
function correctedDate(result: chrono.ParsedResult, ref: Date, forwardDate: boolean): Date {
  const date = result.start.date()
  const weekday = result.start.get('weekday')
  if (!result.start.isCertain('weekday') || weekday === null || date.getDay() === weekday) return date
  const dayOnly = chrono.zh.hant.parse(result.text.replace(PART_OF_DAY, ''), ref, { forwardDate })[0]
  if (!dayOnly) return date
  const day = dayOnly.start.date()
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), date.getHours(), date.getMinutes())
}

interface Reading {
  /** The line the parser saw (month/day may have been rewritten). */
  readonly line: string
  readonly result: chrono.ParsedResult
  readonly at: Date
}

/** `forwardDate` reads "週五" as the coming Friday; without it chrono takes the nearest one. */
function readAt(text: string, ref: Date, forwardDate = true): Reading | null {
  const chinese = withChineseMonthDay(text)
  const zh = chrono.zh.hant.parse(chinese, ref, { forwardDate })[0]
  if (zh) return { line: chinese, result: zh, at: correctedDate(zh, ref, forwardDate) }
  const en = chrono.parse(text, ref, { forwardDate })[0]
  return en ? { line: text, result: en, at: en.start.date() } : null
}

/**
 * Before `dayStartHour` the reference time is moved back, so "明天" typed at
 * 1 a.m. still means the day after the one the user is living in. That shift
 * must not push clock times ("今天下午3點", "30分鐘後") into the past, so a
 * reading that lands before now is taken again from the real clock.
 */
function read(text: string, now: number, dayStartHour: number): Reading | null {
  if (new Date(now).getHours() >= dayStartHour) return readAt(text, new Date(now))
  const shifted = readAt(text, new Date(now - dayStartHour * HOUR))
  if (!shifted) return null
  const passed = shifted.result.start.isCertain('hour')
    ? shifted.at.getTime() < now
    : dayKey(shifted.at.getTime(), dayStartHour) < dayKey(now, dayStartHour)
  return passed ? (readAt(text, new Date(now)) ?? shifted) : shifted
}

/**
 * Reads a date out of one line of text. Parsing is a bonus: when nothing
 * matches, the whole line is kept as the title and no date is set.
 */
export function parseCapture(text: string, now: number, dayStartHour: number): ParsedCapture {
  const trimmed = text.trim()
  const reading = read(trimmed, now, dayStartHour)
  if (!reading) return { title: trimmed, dueAt: null, dueHasTime: false, matchedText: null }

  const { line, result, at } = reading
  const title = (line.slice(0, result.index) + ' ' + line.slice(result.index + result.text.length))
    .replace(/\s+/g, ' ')
    .trim()
  return {
    title: title || trimmed,
    dueAt: at.getTime(),
    dueHasTime: result.start.isCertain('hour'),
    matchedText: result.text.trim(),
  }
}

/**
 * Reads a moment that already happened ("昨天", "前天晚上", "9/27 下午3點"), for
 * recording something done earlier. Null when there is no date or it lies ahead;
 * a bare day that is today counts as now.
 */
export function parsePast(text: string, now: number, dayStartHour: number): number | null {
  const early = new Date(now).getHours() < dayStartHour
  const reading = readAt(text.trim(), new Date(early ? now - dayStartHour * HOUR : now), false)
  if (!reading) return null
  const at = reading.at.getTime()
  if (at <= now) return at
  const sameDay = dayKey(at, dayStartHour) === dayKey(now, dayStartHour)
  return !reading.result.start.isCertain('hour') && sameDay ? now : null
}
