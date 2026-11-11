import { describe, expect, test } from 'vitest'
import { fnv1a, textKey } from './hash'

describe('hash', () => {
  test('fnv1a gives the known values and the same number for the same text', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
    expect(fnv1a('a')).toBe(0xe40c292c)
    expect(fnv1a('到設定選資料夾')).toBe(fnv1a('到設定選資料夾'))
  })

  test('textKey ignores the spaces around the text and is 8 hex digits', () => {
    expect(textKey('  回一下 Alex  ')).toBe(textKey('回一下 Alex'))
    expect(textKey('x')).toMatch(/^[0-9a-f]{8}$/)
    expect(textKey('a')).not.toBe(textKey('b'))
  })
})
