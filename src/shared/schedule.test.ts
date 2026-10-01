import { describe, expect, test } from 'vitest'
import { dueReminders, nextOccurrence, occurrencesOn, parseSchedule, untilLabel } from './schedule'
import type { Item, RoutineSchedule } from './types'

const at = (m: number, d: number, h: number, min = 0): number => new Date(2026, m - 1, d, h, min).getTime()

// 2026-09-30 is a Wednesday.
const WORK: RoutineSchedule = {
  slots: [
    { weekday: 3, start: '16:00', end: '19:00' },
    { weekday: 4, start: '18:30', end: '21:30' },
  ],
  remindMinutes: 30,
}

function routine(schedule: RoutineSchedule | null, over: Partial<Item> = {}): Item {
  return {
    id: 'r1',
    kind: 'routine',
    title: '上班',
    notes: null,
    parentId: null,
    sortOrder: 0,
    priority: null,
    createdAt: at(9, 1, 9),
    updatedAt: at(9, 1, 9),
    dueAt: null,
    dueHasTime: false,
    plannedFor: null,
    doneAt: null,
    droppedAt: null,
    postponeCount: 0,
    intervalDays: null,
    lastDoneAt: null,
    notifiedAt: null,
    source: 'user',
    schedule,
    project: null,
    ...over,
  }
}

describe('occurrencesOn', () => {
  test('lists the slots of that weekday with real start and end times', () => {
    const [wed] = occurrencesOn([routine(WORK)], '2026-09-30')
    expect(wed).toMatchObject({ startAt: at(9, 30, 16), endAt: at(9, 30, 19) })
    expect(occurrencesOn([routine(WORK)], '2026-10-01')[0].startAt).toBe(at(10, 1, 18, 30))
    expect(occurrencesOn([routine(WORK)], '2026-10-02')).toEqual([])
  })

  test('a slot that ends after midnight ends the next day', () => {
    const late = routine({ slots: [{ weekday: 3, start: '22:00', end: '02:00' }], remindMinutes: null })
    expect(occurrencesOn([late], '2026-09-30')[0].endAt).toBe(at(10, 1, 2))
  })

  test('ignores routines without a schedule and finished items', () => {
    expect(occurrencesOn([routine(null), routine(WORK, { doneAt: 1 })], '2026-09-30')).toEqual([])
  })
})

describe('nextOccurrence', () => {
  test('is the one still going on, or the next start', () => {
    expect(nextOccurrence(routine(WORK), at(9, 30, 17))?.startAt).toBe(at(9, 30, 16))
    expect(nextOccurrence(routine(WORK), at(9, 30, 20))?.startAt).toBe(at(10, 1, 18, 30))
    expect(nextOccurrence(routine(WORK), at(10, 2, 9))?.startAt).toBe(at(10, 7, 16))
  })
})

describe('dueReminders', () => {
  test('fires inside the reminder window before the start, not after it', () => {
    expect(dueReminders([routine(WORK)], at(9, 30, 15, 29))).toEqual([])
    expect(dueReminders([routine(WORK)], at(9, 30, 15, 30)).map((o) => o.startAt)).toEqual([at(9, 30, 16)])
    expect(dueReminders([routine(WORK)], at(9, 30, 16, 0))).toEqual([])
  })

  test('a reminder that falls before midnight for a slot right after it still fires', () => {
    const early = routine({ slots: [{ weekday: 4, start: '00:15', end: '01:00' }], remindMinutes: 30 })
    expect(dueReminders([early], at(9, 30, 23, 50)).map((o) => o.startAt)).toEqual([at(10, 1, 0, 15)])
  })

  test('no reminder when it is switched off', () => {
    expect(dueReminders([routine({ ...WORK, remindMinutes: null })], at(9, 30, 15, 45))).toEqual([])
  })
})

describe('parseSchedule', () => {
  test('accepts a valid schedule and normalises the times', () => {
    expect(parseSchedule({ slots: [{ weekday: 3, start: '9:05', end: '1000' }], remindMinutes: 15 })).toEqual({
      slots: [{ weekday: 3, start: '09:05', end: '10:00' }],
      remindMinutes: 15,
    })
  })

  test('refuses anything else', () => {
    expect(() => parseSchedule({ slots: [], remindMinutes: 30 })).toThrow()
    expect(() => parseSchedule({ slots: [{ weekday: 7, start: '09:00', end: '10:00' }], remindMinutes: 30 })).toThrow()
    expect(() => parseSchedule({ slots: [{ weekday: 1, start: '25:00', end: '10:00' }], remindMinutes: 30 })).toThrow()
    expect(() => parseSchedule({ slots: [{ weekday: 1, start: '10:00', end: '10:00' }], remindMinutes: 30 })).toThrow()
    expect(() => parseSchedule({ slots: [{ weekday: 1, start: '09:00', end: '10:00' }], remindMinutes: -5 })).toThrow()
    expect(() => parseSchedule('nope')).toThrow()
  })
})

describe('untilLabel', () => {
  test('says how long until something starts', () => {
    expect(untilLabel(25 * 60_000)).toBe('還有 25 分鐘')
    expect(untilLabel(80 * 60_000)).toBe('還有 1 小時 20 分')
    expect(untilLabel(120 * 60_000)).toBe('還有 2 小時')
    expect(untilLabel(20_000)).toBe('馬上開始')
  })
})
