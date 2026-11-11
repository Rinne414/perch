import { describe, expect, test } from 'vitest'
import { pickReportTurn, reportText, type TurnShape } from './reportPick'

const t = (id: number, typed: boolean, replyLength: number): TurnShape => ({ id, typed, replyLength })

describe('pickReportTurn', () => {
  test('a one-line answer after the real report does not hide it', () => {
    expect(pickReportTurn([t(1, true, 40), t(2, true, 3200), t(3, false, 12)])).toBe(2)
  })

  test('only the round since the last typed prompt counts, longest first', () => {
    expect(pickReportTurn([t(1, true, 9000), t(2, true, 300), t(3, false, 200)])).toBe(2)
  })

  test('a tie goes to the later reply', () => {
    expect(pickReportTurn([t(1, true, 100), t(2, false, 100)])).toBe(2)
  })

  test('a round still at work falls back to the report of the round before', () => {
    expect(pickReportTurn([t(1, true, 500), t(2, false, 20), t(3, true, 0)])).toBe(1)
  })

  test('without typed prompts the last 8 turns are looked at', () => {
    const turns = [t(1, false, 9999), ...Array.from({ length: 8 }, (_, i) => t(i + 2, false, 10 + i))]
    expect(pickReportTurn(turns)).toBe(9)
  })

  test('no reply at all is null', () => {
    expect(pickReportTurn([])).toBeNull()
    expect(pickReportTurn([t(1, true, 0)])).toBeNull()
  })
})

describe('reportText', () => {
  test('the report among whole turns, not the one-liner after it', () => {
    const turns = [
      { id: 1, prompt: 'write it', reply: '## 結論 a long report ', replyLen: 20 },
      { id: 2, prompt: null, reply: 'ok', replyLen: 2 },
    ]
    expect(reportText(turns)).toBe('## 結論 a long report')
    expect(reportText([{ id: 1, prompt: 'p', reply: '   ', replyLen: 0 }])).toBeNull()
  })
})
