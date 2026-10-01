import { describe, expect, test } from 'vitest'
import {
  clearsAt,
  daysLeft,
  groupClips,
  isExpired,
  kindOfText,
  matchesFilter,
  tagsOf,
  topTags,
  type Clip,
} from './clips'

const DAY = 86_400_000
const at = (d: number, h: number): number => new Date(2026, 9, d, h).getTime()
const NOW = at(31, 15)

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: 'c',
  kind: 'text',
  text: '',
  file: null,
  width: null,
  height: null,
  bytes: null,
  tags: [],
  kept: false,
  createdAt: NOW,
  usedAt: NOW,
  ...over,
})

describe('tagsOf', () => {
  test('finds #tags in any script, once each, in lower case', () => {
    expect(tagsOf('浮窗的截圖 #perch #UI #Perch 還有 #靈感')).toEqual(['perch', 'ui', '靈感'])
    expect(tagsOf('沒有標籤，只有 # 號')).toEqual([])
  })
})

describe('kindOfText', () => {
  test('a lone web address is a link; anything else is text', () => {
    expect(kindOfText(' https://github.com/EcoPasteHub/EcoPaste ')).toBe('link')
    expect(kindOfText('看這個 https://example.com')).toBe('text')
  })
})

describe('clearing', () => {
  test('an unkept clip goes 30 days after it was last used, kept ones never', () => {
    const c = clip({ usedAt: NOW - 10 * DAY })
    expect(clearsAt(c, 30)).toBe(NOW + 20 * DAY)
    expect(clearsAt({ ...c, kept: true }, 30)).toBeNull()
    expect(clearsAt(c, null)).toBeNull()
    expect(isExpired(clip({ usedAt: NOW - 31 * DAY }), NOW, 30)).toBe(true)
    expect(isExpired(clip({ usedAt: NOW - 29 * DAY }), NOW, 30)).toBe(false)
  })

  test('says how many days are left only in the last three', () => {
    expect(daysLeft(clip({ usedAt: NOW - 27.5 * DAY }), NOW, 30)).toBe(3)
    expect(daysLeft(clip({ usedAt: NOW - 29.9 * DAY }), NOW, 30)).toBe(1)
    expect(daysLeft(clip({ usedAt: NOW - 10 * DAY }), NOW, 30)).toBeNull()
    expect(daysLeft(clip({ usedAt: NOW - 29 * DAY, kept: true }), NOW, 30)).toBeNull()
  })
})

describe('groupClips', () => {
  test('kept first, then today, yesterday and earlier, newest first in each', () => {
    const groups = groupClips(
      [
        clip({ id: 'old', createdAt: at(20, 10) }),
        clip({ id: 'kept', createdAt: at(1, 10), kept: true }),
        clip({ id: 'today2', createdAt: at(31, 14) }),
        clip({ id: 'yesterday', createdAt: at(30, 22) }),
        clip({ id: 'today1', createdAt: at(31, 9) }),
        // 2 a.m. still belongs to the day before.
        clip({ id: 'late night', createdAt: at(31, 2) }),
      ],
      NOW,
      4,
    )

    expect(groups.map((g) => [g.label, g.clips.map((c) => c.id)])).toEqual([
      ['保留', ['kept']],
      ['今天', ['today2', 'today1']],
      ['昨天', ['late night', 'yesterday']],
      ['更早', ['old']],
    ])
  })
})

describe('filters', () => {
  const clips = [
    clip({ id: 'a', kind: 'text', text: 'NativeImage 存成 PNG #perch', tags: ['perch'] }),
    clip({ id: 'b', kind: 'image', text: '浮窗截圖 #perch #ui', tags: ['perch', 'ui'] }),
    clip({ id: 'c', kind: 'link', text: 'https://github.com/EcoPasteHub/EcoPaste', tags: [] }),
  ]

  test('by kind, by tag and by words, together', () => {
    const ids = (f: Parameters<typeof matchesFilter>[1]): string[] => clips.filter((c) => matchesFilter(c, f)).map((c) => c.id)
    expect(ids({ kind: 'all', tag: null, query: '' })).toEqual(['a', 'b', 'c'])
    expect(ids({ kind: 'image', tag: null, query: '' })).toEqual(['b'])
    expect(ids({ kind: 'all', tag: 'perch', query: '' })).toEqual(['a', 'b'])
    expect(ids({ kind: 'all', tag: null, query: 'ecopaste' })).toEqual(['c'])
    expect(ids({ kind: 'text', tag: 'perch', query: 'png' })).toEqual(['a'])
  })

  test('the most used tags first', () => {
    expect(topTags(clips, 5)).toEqual([
      { tag: 'perch', count: 2 },
      { tag: 'ui', count: 1 },
    ])
  })
})
