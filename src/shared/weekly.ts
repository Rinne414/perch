import type { ScheduleSlot } from './types'

/** A line that describes a fixed weekly time ("每週四 18:30-21:30 上班"), read for a routine. */
export interface WeeklyCapture {
  readonly title: string
  readonly slots: readonly ScheduleSlot[]
}

const DAY_OF: Readonly<Record<string, number>> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const WORKDAYS = [1, 2, 3, 4, 5]
const WEEKEND = [6, 0]
/** A slot typed with only a start time lasts this long. */
const DEFAULT_MINUTES = 60
const DAY_MINUTES = 24 * 60

/** The day words, in the order they are tried: "每週末" before the general "每週X". */
const DAY_PATTERNS: readonly { re: RegExp; days: (m: RegExpExecArray) => number[] }[] = [
  { re: /每個?(?:週|周)末/, days: () => WEEKEND },
  { re: /每天|每日/, days: () => EVERY_DAY },
  { re: /每個?平日|平日/, days: () => WORKDAYS },
  {
    re: /每個?(?:週|周|星期|禮拜|礼拜)\s*([一二三四五六日天](?:[\s、,，和跟及到至~～\-–—週周星期禮拜礼]*[一二三四五六日天])*)/,
    days: (m) => daysOf(m[1]),
  },
]

const PART = '(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上)?'
/** "18:30", "4點", "7點半", "9點15分", each with an optional part of the day. */
const TIME = `${PART}\\s*(\\d{1,2})(?:[:：](\\d{2})|\\s*點(?:\\s*(半)|\\s*(\\d{1,2})\\s*分?)?)`
const TIME_RANGE = new RegExp(`${TIME}(?:\\s*(?:-|–|—|~|～|到|至)\\s*${TIME})?`)

/** Monday first, so "一到五" and "六日" run the way people mean them. */
const order = (d: number): number => (d === 0 ? 7 : d)

function daysOf(spec: string): number[] {
  const out: number[] = []
  let rangeFrom: number | null = null
  for (const ch of spec) {
    if (ch in DAY_OF) {
      const day = DAY_OF[ch]
      const run = rangeFrom === null ? [day] : span(rangeFrom, day)
      for (const d of run) if (!out.includes(d)) out.push(d)
      rangeFrom = null
    } else if (/[到至~～\-–—]/.test(ch) && out.length > 0) {
      rangeFrom = out.pop()!
    }
  }
  return out
}

function span(from: number, to: number): number[] {
  const [a, b] = [order(from), order(to)]
  if (b < a) return [from, to]
  return Array.from({ length: b - a + 1 }, (_, i) => (a + i) % 7)
}

function minutesOf(part: string | undefined, hour: string, colon?: string, half?: string, dotMinutes?: string): number | null {
  let h = Number(hour)
  const m = colon ? Number(colon) : half ? 30 : dotMinutes ? Number(dotMinutes) : 0
  if ((part === '下午' || part === '傍晚' || part === '晚上') && h < 12) h += 12
  if (part === '中午' && h < 11) h += 12
  if (part === '凌晨' && h === 12) h = 0
  return h < 24 && m < 60 ? h * 60 + m : null
}

const hm = (minutes: number): string => {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Start and end of the first time (range) in the line, with the words it used. */
function readTimes(text: string): { start: number; end: number; matched: string } | null {
  const m = TIME_RANGE.exec(text)
  if (!m) return null
  const start = minutesOf(m[1], m[2], m[3], m[4], m[5])
  if (start === null) return null
  if (m[7] === undefined) return { start, end: start + DEFAULT_MINUTES, matched: m[0] }
  // "下午4點到7點": an end without its own part of the day takes the start's, when that keeps it later.
  const own = minutesOf(m[6], m[7], m[8], m[9], m[10])
  const inherited = m[6] === undefined && m[1] !== undefined ? minutesOf(m[1], m[7], m[8], m[9], m[10]) : null
  const end = inherited !== null && inherited > start ? inherited : own
  if (end === null || end === start) return null
  return { start, end, matched: m[0] }
}

/**
 * Reads a fixed weekly time out of a captured line: a recurring day ("每週四", "每週一到五",
 * "每天", "平日", "每週末"), a time or time range, and a name. Null for anything else,
 * which is then read as a one-off date instead.
 */
export function parseWeekly(text: string): WeeklyCapture | null {
  for (const { re, days } of DAY_PATTERNS) {
    const dayMatch = re.exec(text)
    if (!dayMatch) continue
    const weekdays = days(dayMatch)
    const rest = text.replace(dayMatch[0], ' ')
    const times = weekdays.length > 0 ? readTimes(rest) : null
    if (!times) return null
    const title = rest
      .replace(times.matched, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,，、:：-]+|[\s,，、:：-]+$/g, '')
    if (!title) return null
    const [start, end] = [hm(times.start), hm(times.end)]
    return { title, slots: weekdays.map((weekday) => ({ weekday, start, end })) }
  }
  return null
}

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

/** "每週四 18:30–21:30", "每週三、四 …", "每天 …", "平日 …", "每週末 …". */
export function weeklyLabel(slots: readonly ScheduleSlot[]): string {
  const days = slots.map((s) => s.weekday)
  const same = (set: readonly number[]): boolean => days.length === set.length && set.every((d) => days.includes(d))
  const when = same(EVERY_DAY)
    ? '每天'
    : same(WORKDAYS)
      ? '平日'
      : same(WEEKEND)
        ? '每週末'
        : `每週${[...days].sort((a, b) => order(a) - order(b)).map((d) => WEEKDAY_NAMES[d]).join('、')}`
  return `${when} ${slots[0].start}–${slots[0].end}`
}
