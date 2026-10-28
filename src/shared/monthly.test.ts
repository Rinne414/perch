import { describe, expect, test } from 'vitest'
import { monthlyDates, monthlyLabel, monthlyState, monthlyWhen, parseMonthly } from './monthly'

describe('parseMonthly', () => {
  test('sorts the days and drops repeats', () => {
    expect(parseMonthly({ days: [15, 1, 15], leadDays: 3 })).toEqual({ days: [1, 15], leadDays: 3 })
  })

  test('refuses what the form never sends', () => {
    expect(() => parseMonthly(null)).toThrow()
    expect(() => parseMonthly({ days: [], leadDays: 0 })).toThrow()
    expect(() => parseMonthly({ days: [0], leadDays: 0 })).toThrow()
    expect(() => parseMonthly({ days: [32], leadDays: 0 })).toThrow()
    expect(() => parseMonthly({ days: [1.5], leadDays: 0 })).toThrow()
    expect(() => parseMonthly({ days: [5], leadDays: 15 })).toThrow()
    expect(() => parseMonthly({ days: [5], leadDays: -1 })).toThrow()
  })
})

describe('monthlyDates', () => {
  test('a day a month lacks becomes its last day', () => {
    expect(monthlyDates({ days: [31], leadDays: 0 }, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  test('30 and 31 in a 30-day month give one date', () => {
    expect(monthlyDates({ days: [30, 31], leadDays: 0 }, '2026-04-01', '2026-04-30')).toEqual(['2026-04-30'])
  })

  test('crosses the new year and keeps to the range', () => {
    expect(monthlyDates({ days: [1, 15], leadDays: 0 }, '2026-12-10', '2027-01-20')).toEqual([
      '2026-12-15',
      '2027-01-01',
      '2027-01-15',
    ])
  })
})

describe('monthlyState', () => {
  const RENT = { days: [5], leadDays: 0 }

  test('due on its date until done, then waits for the next month', () => {
    expect(monthlyState(RENT, '2026-09-01', '2026-09-05', '2026-10-04')).toMatchObject({ dueOn: '2026-10-05', isDue: false })
    expect(monthlyState(RENT, '2026-09-01', '2026-09-05', '2026-10-05')).toMatchObject({ dueOn: '2026-10-05', isDue: true })
    expect(monthlyState(RENT, '2026-09-01', '2026-09-05', '2026-10-28')).toMatchObject({ dueOn: '2026-10-05', isDue: true })
    expect(monthlyState(RENT, '2026-09-01', '2026-10-07', '2026-10-28')).toMatchObject({ dueOn: '2026-11-05', isDue: false })
  })

  test('done before the date opens does not count for it', () => {
    expect(monthlyState(RENT, '2026-09-01', '2026-10-01', '2026-10-05')).toMatchObject({ dueOn: '2026-10-05', isDue: true })
  })

  test('a lead opens it early, and doing it in that window counts', () => {
    const early = { days: [5], leadDays: 3 }
    expect(monthlyState(early, '2026-09-01', '2026-09-03', '2026-10-01')).toMatchObject({ dueOn: '2026-10-05', isDue: false })
    expect(monthlyState(early, '2026-09-01', '2026-09-03', '2026-10-02')).toMatchObject({ dueOn: '2026-10-05', isDue: true })
    expect(monthlyState(early, '2026-09-01', '2026-10-03', '2026-10-04')).toMatchObject({ dueOn: '2026-11-05', isDue: false })
  })

  test('a date before the routine existed is not owed', () => {
    expect(monthlyState(RENT, '2026-10-06', null, '2026-10-28')).toMatchObject({ dueOn: '2026-11-05', isDue: false })
    expect(monthlyState(RENT, '2026-10-05', null, '2026-10-05')).toMatchObject({ dueOn: '2026-10-05', isDue: true })
  })

  test('several days a month take turns', () => {
    const twice = { days: [1, 15], leadDays: 0 }
    expect(monthlyState(twice, '2026-09-01', '2026-10-01', '2026-10-10')).toMatchObject({ dueOn: '2026-10-15', isDue: false, cycleDays: 14 })
    expect(monthlyState(twice, '2026-09-01', '2026-10-01', '2026-10-16')).toMatchObject({ dueOn: '2026-10-15', isDue: true })
  })

  test('the cycle is the gap to the date before', () => {
    expect(monthlyState(RENT, '2026-09-01', '2026-10-05', '2026-10-06').cycleDays).toBe(31)
  })
})

describe('labels', () => {
  test('monthlyLabel lists the days and the lead', () => {
    expect(monthlyLabel({ days: [5], leadDays: 0 })).toBe('每月 5 號')
    expect(monthlyLabel({ days: [1, 15], leadDays: 3 })).toBe('每月 1、15 號 · 前 3 天提醒')
  })

  test('monthlyWhen says how far off or how late', () => {
    expect(monthlyWhen('2026-11-05', false, '2026-10-28')).toBe('下次 11/5')
    expect(monthlyWhen('2026-10-30', true, '2026-10-28')).toBe('10/30 · 還有 2 天')
    expect(monthlyWhen('2026-10-28', true, '2026-10-28')).toBe('10/28 今天')
    expect(monthlyWhen('2026-10-05', true, '2026-10-28')).toBe('10/5 · 晚了 23 天')
  })
})

describe('monthlyState when months are missed', () => {
  test('a date left undone stays due, as the latest one', () => {
    expect(monthlyState({ days: [5], leadDays: 0 }, '2026-08-01', '2026-08-05', '2026-10-28')).toMatchObject({
      dueOn: '2026-10-05',
      isDue: true,
    })
  })
})

describe('parseMonthly against a crafted request', () => {
  test('a sparse array is refused, not stored as [null]', () => {
    expect(() => parseMonthly({ days: new Array(31), leadDays: 0 })).toThrow()
    expect(() => parseMonthly({ days: [5, , 7], leadDays: 0 })).toThrow()
  })
})
