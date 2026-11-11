import { describe, expect, test } from 'vitest'
import { EMPTY_DIGEST, type ReplyDigest } from './replyDigest'
import { gatherTodos, todoKey, TODOS_PER_SESSION, type TodoSource } from './todos'
import type { AgentSession } from './types'

const NOW = new Date(2026, 10, 11, 14, 0).getTime()

function source(id: string, todos: ReplyDigest['todos'], glyph: TodoSource['glyph'] = 'done'): TodoSource {
  const session: AgentSession = {
    id,
    agent: 'claude-code',
    sessionId: id,
    cwd: `C:\\code\\${id}`,
    name: `工作 ${id}`,
    title: null,
    status: 'done',
    detail: null,
    startedAt: NOW - 3_600_000,
    updatedAt: NOW,
    attentionAt: NOW,
    acknowledgedAt: null,
    endedAt: null,
    reopenedAt: null,
  }
  return { session, glyph, reportAt: NOW - 60_000, digest: { ...EMPTY_DIGEST, todos } }
}

describe('gatherTodos', () => {
  test('one group per report that leaves something, in the order given', () => {
    const view = gatherTodos([source('a', ['重拍截圖']), source('b', 'none'), source('c', null), source('d', ['給實測值', '看一眼跨月'], 'running')], new Map())

    expect(view.total).toBe(3)
    expect(view.groups.map((g) => [g.sessionId, g.glyph, g.rows.map((r) => r.text)])).toEqual([
      ['a', 'done', ['重拍截圖']],
      ['d', 'running', ['給實測值', '看一眼跨月']],
    ])
    expect(view.groups[0]).toMatchObject({ name: '工作 a', cwd: 'C:\\code\\a', reportAt: NOW - 60_000, more: 0 })
  })

  test('ticked points leave; the same point said twice shows once', () => {
    const view = gatherTodos([source('a', ['重拍截圖', ' 重拍截圖 ', '給實測值'])], new Map([['a', new Set([todoKey(NOW - 60_000, '給實測值')])]]))

    expect(view.groups[0].rows).toEqual([{ key: todoKey(NOW - 60_000, '重拍截圖'), text: '重拍截圖' }])
    expect(view.total).toBe(1)
  })

  test(`at most ${TODOS_PER_SESSION} rows per report; the rest are counted`, () => {
    const many = Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 件`)
    const view = gatherTodos([source('a', many)], new Map())

    expect(view.groups[0].rows).toHaveLength(TODOS_PER_SESSION)
    expect(view.groups[0].more).toBe(7)
    expect(view.total).toBe(12)
  })

  test('a tick belongs to one report: the same text in a later report shows again, the same report keeps it', () => {
    const ticked = new Map([['a', new Set([todoKey(NOW - 60_000, '重拍截圖')])]])
    const later = { ...source('a', ['重拍截圖']), reportAt: NOW }

    expect(gatherTodos([source('a', ['重拍截圖'])], ticked).total).toBe(0)
    expect(gatherTodos([later], ticked).groups[0].rows.map((r) => r.text)).toEqual(['重拍截圖'])
  })

  test('the key is eight hex digits and does not mix up times and texts', () => {
    expect(todoKey(1, 'a')).toMatch(/^[0-9a-f]{8}$/)
    expect(todoKey(1, 'a')).not.toBe(todoKey(2, 'a'))
    expect(todoKey(null, ' a ')).toBe(todoKey(null, 'a'))
  })

  test('a report whose points are all ticked off has no group', () => {
    expect(gatherTodos([source('a', ['x'])], new Map([['a', new Set([todoKey(NOW - 60_000, 'x')])]]))).toEqual({ groups: [], total: 0 })
  })
})
