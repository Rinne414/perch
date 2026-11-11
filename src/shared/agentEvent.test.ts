import { describe, expect, test } from 'vitest'
import { parseAgentEvent, parseItemMessage, isAgentSessionKey } from './agentEvent'

describe('parseAgentEvent: name', () => {
  test("keeps the agent's own name for the session, trimmed; drops an empty or non-text one", () => {
    const base = { v: 1, agent: 'claude-code', sessionId: 's1', status: 'done' }
    expect(parseAgentEvent({ ...base, name: '  清理垃圾資料夾 ' })?.name).toBe('清理垃圾資料夾')
    expect(parseAgentEvent({ ...base, name: '   ' })).not.toHaveProperty('name')
    expect(parseAgentEvent({ ...base, name: 42 })).not.toHaveProperty('name')
    expect(parseAgentEvent({ ...base, name: '第一行\n第二行\t\u0007結尾' })?.name).toBe('第一行 第二行 結尾')
  })
})

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

describe('isAgentSessionKey', () => {
  test('"<agent>:<session id>" with the session id as long as an event may carry', () => {
    expect(isAgentSessionKey('claude-code:abc')).toBe(true)
    expect(isAgentSessionKey(`codex:${'x'.repeat(500)}`)).toBe(true)
    expect(isAgentSessionKey('claude-code:a:b')).toBe(true)
  })

  test('anything else is refused', () => {
    expect(isAgentSessionKey(`codex:${'x'.repeat(501)}`)).toBe(false)
    expect(isAgentSessionKey('claude-code:')).toBe(false)
    expect(isAgentSessionKey(':abc')).toBe(false)
    expect(isAgentSessionKey('Bad Agent:abc')).toBe(false)
    expect(isAgentSessionKey(42)).toBe(false)
  })
})
