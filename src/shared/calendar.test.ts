import { describe, expect, test } from 'vitest'
import { monthGrid } from './calendar'

describe('monthGrid', () => {
  test('covers whole weeks, Sunday first', () => {
    const sept = monthGrid(2026, 9)

    expect(sept[0]).toBe('2026-08-30')
    expect(sept.at(-1)).toBe('2026-10-03')
    expect(sept).toHaveLength(35)
  })

  test('a month starting on Sunday starts on its 1st', () => {
    expect(monthGrid(2026, 2)[0]).toBe('2026-02-01')
    expect(monthGrid(2026, 2)).toHaveLength(28)
  })
})
