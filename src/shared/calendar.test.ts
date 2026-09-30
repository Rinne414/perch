import { describe, expect, test } from 'vitest'
import { groupTimeline, monthGrid, type TimelineEntry } from './calendar'

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

const entry = (id: number, kind: TimelineEntry['kind'], title: string, detail: string | null = null): TimelineEntry => ({
  id,
  at: id * 60_000,
  kind,
  title,
  detail,
  hasTime: true,
})

describe('groupTimeline', () => {
  test('folds the replies of one project into a line placed at the first reply', () => {
    const lines = groupTimeline([
      entry(1, 'agent', 'Claude Code · style', 'a'),
      entry(2, 'done', '回覆房東'),
      entry(3, 'agent', 'Claude Code · sorter', 'b'),
      entry(4, 'agent-failed', 'Claude Code · style', 'c'),
      entry(5, 'agent', 'Claude Code · style', 'd'),
    ])
    expect(lines.map((l) => (l.kind === 'entry' ? l.entry.title : `${l.title} ×${l.replies.length}`))).toEqual([
      'Claude Code · style ×3',
      '回覆房東',
      'Claude Code · sorter',
    ])
  })

  test('keeps the replies in time order, failed ones included', () => {
    const [group] = groupTimeline([entry(1, 'agent', 'Codex · api'), entry(2, 'agent-failed', 'Codex · api')])
    expect(group.kind === 'agent-group' && group.replies.map((r) => r.kind)).toEqual(['agent', 'agent-failed'])
  })

  test('leaves a day without agents as it is', () => {
    const lines = groupTimeline([entry(1, 'done', 'a'), entry(2, 'manual', 'b')])
    expect(lines).toEqual([
      { kind: 'entry', entry: entry(1, 'done', 'a') },
      { kind: 'entry', entry: entry(2, 'manual', 'b') },
    ])
  })
})
