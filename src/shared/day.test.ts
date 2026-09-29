import { describe, expect, test } from 'vitest'
import { addDays, dayKey, daysBetween, dayStart, moveToDay } from './day'

describe('dayKey', () => {
  test('work after midnight but before the day start belongs to the previous day', () => {
    const oneAm = new Date(2026, 8, 30, 1, 0).getTime()

    expect(dayKey(oneAm, 4)).toBe('2026-09-29')
    expect(dayKey(oneAm, 0)).toBe('2026-09-30')
  })

  test('dayStart is the inverse boundary of dayKey', () => {
    const start = dayStart('2026-09-29', 4)

    expect(dayKey(start, 4)).toBe('2026-09-29')
    expect(dayKey(start - 1, 4)).toBe('2026-09-28')
  })
})

describe('calendar math', () => {
  test('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  test('daysBetween counts whole days', () => {
    expect(daysBetween('2026-09-20', '2026-09-29')).toBe(9)
    expect(daysBetween('2026-09-29', '2026-09-29')).toBe(0)
  })
})

describe('moveToDay', () => {
  const at = (d: number, h: number): number => new Date(2026, 8, d, h).getTime()

  test('keeps the time of day', () => {
    expect(moveToDay(at(27, 14), '2026-09-30', 4)).toBe(at(30, 14))
  })

  test('a time after midnight stays in the late part of the target day', () => {
    // 2 a.m. on the 28th belongs to the 27th; moved to the 30th it becomes 2 a.m. on the 1st.
    expect(moveToDay(at(28, 2), '2026-09-30', 4)).toBe(new Date(2026, 9, 1, 2).getTime())
  })
})

