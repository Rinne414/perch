import { describe, expect, test } from 'vitest'
import { parseWeekly, weeklyLabel } from './weekly'

const days = (text: string): number[] | undefined => parseWeekly(text)?.slots.map((s) => s.weekday)
const times = (text: string): [string, string] | undefined => {
  const slot = parseWeekly(text)?.slots[0]
  return slot && [slot.start, slot.end]
}

describe('parseWeekly', () => {
  test('one weekday with a time range, and what is left as the title', () => {
    expect(parseWeekly('每週四 18:30-21:30 上班')).toEqual({
      title: '上班',
      slots: [{ weekday: 4, start: '18:30', end: '21:30' }],
    })
  })

  test('the title may come first, and the separators vary', () => {
    expect(parseWeekly('上班 每周四 18:30~21:30')?.title).toBe('上班')
    expect(times('每星期四 18:30–21:30 上班')).toEqual(['18:30', '21:30'])
    expect(times('每禮拜四 18:30到21:30 上班')).toEqual(['18:30', '21:30'])
  })

  test('several days: listed, run together, or as a range', () => {
    expect(days('每週三、四 16:00-19:00 上班')).toEqual([3, 4])
    expect(days('每週三四 16:00-19:00 上班')).toEqual([3, 4])
    expect(days('每週一到五 9:00-18:00 上班')).toEqual([1, 2, 3, 4, 5])
    expect(days('每週一至週五 9:00-18:00 上班')).toEqual([1, 2, 3, 4, 5])
    expect(days('每週六日 10:00-12:00 游泳')).toEqual([6, 0])
  })

  test('every day, weekdays and weekends', () => {
    expect(days('每天 8:00-8:15 吃藥')).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(days('平日 9:00-18:00 上班')).toEqual([1, 2, 3, 4, 5])
    expect(days('每個週末 10:00-11:00 打掃')).toEqual([6, 0])
    expect(days('每週末 10:00-11:00 打掃')).toEqual([6, 0])
  })

  test('a weekend without 每 is one weekend, not every one', () => {
    expect(parseWeekly('週末下午3點 看電影')).toBeNull()
  })

  test('hours in words, with the part of the day carried to the end', () => {
    expect(times('每週三 下午4點到7點 上班')).toEqual(['16:00', '19:00'])
    expect(times('每週二 晚上7點半到9點 社團')).toEqual(['19:30', '21:00'])
    expect(times('每週一 上午9點-12點 開會')).toEqual(['09:00', '12:00'])
    expect(times('每週五 22:00-02:00 夜班')).toEqual(['22:00', '02:00'])
  })

  test('only a start time: an hour long', () => {
    expect(times('每週四 18:30 上班')).toEqual(['18:30', '19:30'])
    expect(times('每天 晚上10點 寫日記')).toEqual(['22:00', '23:00'])
  })

  test('not a fixed schedule without a weekly day, a time, or a name', () => {
    expect(parseWeekly('明天下午3點 交報告')).toBeNull()
    expect(parseWeekly('每週四 倒垃圾')).toBeNull()
    expect(parseWeekly('每週四 18:30-21:30')).toBeNull()
    expect(parseWeekly('週四 18:30 開會')).toBeNull()
  })
})

describe('weeklyLabel', () => {
  test('names the days the short way', () => {
    const label = (t: string): string => weeklyLabel(parseWeekly(t)!.slots)
    expect(label('每週四 18:30-21:30 上班')).toBe('每週四 18:30–21:30')
    expect(label('每週三、四 16:00-19:00 上班')).toBe('每週三、四 16:00–19:00')
    expect(label('每天 8:00-8:15 吃藥')).toBe('每天 08:00–08:15')
    expect(label('平日 9:00-18:00 上班')).toBe('平日 09:00–18:00')
    expect(label('每週末 10:00-11:00 打掃')).toBe('每週末 10:00–11:00')
  })
})
