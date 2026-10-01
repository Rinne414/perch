import { describe, expect, test } from 'vitest'
import { parseItemMessage } from './agentEvent'

describe('parseItemMessage', () => {
  test('keeps what an agent asked to be noted, trimmed', () => {
    expect(parseItemMessage({ v: 1, kind: 'item', agent: 'claude-code', title: '  明天 更新 README ', cwd: 'D:\\code\\x', at: 5 })).toEqual({
      v: 1,
      kind: 'item',
      agent: 'claude-code',
      title: '明天 更新 README',
      cwd: 'D:\\code\\x',
      at: 5,
    })
  })

  test('refuses anything without a title, a valid agent name or the version', () => {
    expect(parseItemMessage({ v: 1, kind: 'item', agent: 'codex', title: '  ' })).toBeNull()
    expect(parseItemMessage({ v: 1, kind: 'item', agent: 'Bad Name', title: 'x' })).toBeNull()
    expect(parseItemMessage({ v: 2, kind: 'item', agent: 'codex', title: 'x' })).toBeNull()
    expect(parseItemMessage({ v: 1, agent: 'codex', sessionId: 's', status: 'done' })).toBeNull()
  })

  test('cuts a very long title', () => {
    expect(parseItemMessage({ v: 1, kind: 'item', agent: 'codex', title: 'x'.repeat(500) })?.title).toHaveLength(200)
  })
})
