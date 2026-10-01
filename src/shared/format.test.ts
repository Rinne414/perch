import { describe, expect, test } from 'vitest'
import { dayLabel, daysAgoLabel, shortDayLabel, whenLabel } from './format'

describe('whenLabel', () => {
  const at = (d: number, h: number, m = 0): number => new Date(2026, 9, d, h, m).getTime()

  test('the time today, yesterday with its time, older days by date', () => {
    expect(whenLabel(at(10, 9, 5), at(10, 15), 4)).toBe('09:05')
    expect(whenLabel(at(9, 21, 40), at(10, 15), 4)).toBe('昨天 21:40')
    expect(whenLabel(at(7, 21, 40), at(10, 15), 4)).toBe('10/7')
  })
})

describe('shortDayLabel', () => {
  test('names tomorrow, then the weekday for the coming week, then the date', () => {
    expect(shortDayLabel('2026-10-02', '2026-10-01')).toBe('明天')
    expect(shortDayLabel('2026-10-03', '2026-10-01')).toBe('週六')
    expect(shortDayLabel('2026-10-07', '2026-10-01')).toBe('週三')
    expect(shortDayLabel('2026-10-08', '2026-10-01')).toBe('10/8')
  })
})

describe('dayLabel', () => {
  test('names the days next to today and dates the rest', () => {
    expect(dayLabel('2026-09-30', '2026-09-30')).toBe('今天')
    expect(dayLabel('2026-10-01', '2026-09-30')).toBe('明天')
    expect(dayLabel('2026-09-29', '2026-09-30')).toBe('昨天')
    expect(dayLabel('2026-10-02', '2026-09-30')).toBe('10/2 週五')
  })

  test('crosses month and year ends', () => {
    expect(dayLabel('2027-01-01', '2026-12-31')).toBe('明天')
    expect(dayLabel('2027-01-04', '2026-12-31')).toBe('1/4 週一')
  })
})

describe('daysAgoLabel', () => {
  const now = new Date(2026, 8, 30, 0, 30).getTime()

  test('counts whole days with the same day boundary as the rest of the app', () => {
    expect(daysAgoLabel(new Date(2026, 8, 29, 23, 50).getTime(), now, 4)).toBe('今天')
    expect(daysAgoLabel(new Date(2026, 8, 29, 3, 0).getTime(), now, 4)).toBe('昨天')
    expect(daysAgoLabel(new Date(2026, 8, 25, 12).getTime(), now, 4)).toBe('4 天前')
  })
})
