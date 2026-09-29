import { describe, expect, test } from 'vitest'
import { parseCapture, parsePast } from './capture'

const at = (d: number, h: number, m = 0): number => new Date(2026, 8, d, h, m).getTime()
const TUE_EVENING = at(29, 18)

describe('parseCapture', () => {
  test('pulls a Chinese date and time out and keeps the rest as the title', () => {
    const r = parseCapture('明天下午3點交報告', TUE_EVENING, 4)

    expect(r.title).toBe('交報告')
    expect(r.dueAt).toBe(at(30, 15))
    expect(r.dueHasTime).toBe(true)
    expect(r.matchedText).toBe('明天下午3點')
  })

  test('a weekday without a time is a date-only due', () => {
    const r = parseCapture('週五 回信', TUE_EVENING, 4)

    expect(r.title).toBe('回信')
    expect(new Date(r.dueAt!).getDate()).toBe(2)
    expect(r.dueHasTime).toBe(false)
  })

  test('English works too', () => {
    const r = parseCapture('call Lena tomorrow 3pm', TUE_EVENING, 4)

    expect(r.title).toBe('call Lena')
    expect(r.dueAt).toBe(at(30, 15))
  })

  test('text with no date is kept whole', () => {
    expect(parseCapture('  買牛奶 ', TUE_EVENING, 4)).toEqual({
      title: '買牛奶',
      dueAt: null,
      dueHasTime: false,
      matchedText: null,
    })
  })

  test('a line that is only a date keeps the date words as its title', () => {
    expect(parseCapture('明天', TUE_EVENING, 4).title).toBe('明天')
  })

  test('"明天" typed after midnight but before the day start means the next waking day', () => {
    const oneAmWednesday = at(30, 1)

    const r = parseCapture('明天 看牙醫', oneAmWednesday, 4)

    expect(new Date(r.dueAt!).getDate()).toBe(30)
  })

  test('a numeric month/day next to Chinese words keeps its day and time', () => {
    const r = parseCapture('10/2 下午5點 交季報', TUE_EVENING, 4)

    expect(r.title).toBe('交季報')
    expect(r.dueAt).toBe(new Date(2026, 9, 2, 17).getTime())
    expect(r.dueHasTime).toBe(true)
  })

  test('a numeric date with a 24-hour time after a Chinese title', () => {
    const r = parseCapture('交季報 10/2 17:00', TUE_EVENING, 4)

    expect(r.title).toBe('交季報')
    expect(r.dueAt).toBe(new Date(2026, 9, 2, 17).getTime())
  })

  test('a weekday with only a part of day ("週六下午") lands on that weekday', () => {
    const afternoon = parseCapture('週六下午 大掃除', TUE_EVENING, 4)
    const evening = parseCapture('星期六晚上', TUE_EVENING, 4)

    expect(new Date(afternoon.dueAt!).getDate()).toBe(3)
    expect(afternoon.title).toBe('大掃除')
    expect(afternoon.dueHasTime).toBe(false)
    expect(new Date(evening.dueAt!).getDate()).toBe(3)
  })

  test('purely English numeric dates still go through the English parser', () => {
    expect(parseCapture('10/2 5pm', TUE_EVENING, 4).dueAt).toBe(new Date(2026, 9, 2, 17).getTime())
  })

  test('relative times typed after midnight count from the real clock', () => {
    const oneAm = at(30, 1)

    expect(parseCapture('30分鐘後 關火', oneAm, 4).dueAt).toBe(at(30, 1, 30))
    expect(parseCapture('in 30 minutes call', oneAm, 4).dueAt).toBe(at(30, 1, 30))
    expect(parseCapture('今天下午3點 開會', oneAm, 4).dueAt).toBe(at(30, 15))
  })

  test('a plain "今天" after midnight is still the day being lived', () => {
    expect(new Date(parseCapture('今天 繳費', at(30, 1), 4).dueAt!).getDate()).toBe(29)
  })
})

describe('parsePast', () => {
  const WED_MORNING = at(30, 10)

  test('reads moments that already happened', () => {
    expect(new Date(parsePast('昨天', WED_MORNING, 4)!).getDate()).toBe(29)
    expect(parsePast('前天晚上', WED_MORNING, 4)).toBe(at(28, 22))
    expect(parsePast('9/27 下午3點', WED_MORNING, 4)).toBe(at(27, 15))
    expect(new Date(parsePast('上週五', WED_MORNING, 4)!).getDate()).toBe(25)
  })

  test('refuses the future and text without a date', () => {
    expect(parsePast('明天', WED_MORNING, 4)).toBeNull()
    expect(parsePast('今天晚上8點', WED_MORNING, 4)).toBeNull()
    expect(parsePast('隨便', WED_MORNING, 4)).toBeNull()
  })

  test('"今天" without a time means earlier today, not later', () => {
    expect(parsePast('今天', WED_MORNING, 4)).toBe(WED_MORNING)
  })

  test('"昨天" typed after midnight is the day before the one being lived', () => {
    expect(new Date(parsePast('昨天', at(30, 1), 4)!).getDate()).toBe(28)
  })
})
