import { describe, expect, test } from 'vitest'
import { dayLabel, daysAgoLabel } from './format'

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
