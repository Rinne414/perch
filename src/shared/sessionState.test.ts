import { describe, expect, test } from 'vitest'
import { sessionLabel } from './agents'
import { endLabel, isOneShot, isRunning, isSettled, needsAttention } from './now'
import type { AgentSession } from './types'

const NOW = 1_800_000_000_000
const MIN = 60_000
const RESTART = NOW - 60 * MIN

const session = (over: Partial<AgentSession>): AgentSession => ({
  id: 'claude-code:s1',
  agent: 'claude-code',
  sessionId: 's1',
  cwd: 'L:\\code\\app',
  name: null,
  title: null,
  status: 'done',
  detail: null,
  startedAt: NOW - 30 * MIN,
  updatedAt: NOW - 5 * MIN,
  attentionAt: NOW - 5 * MIN,
  acknowledgedAt: null,
  endedAt: null,
  reopenedAt: null,
  ...over,
})

describe('needsAttention', () => {
  test('an open session that finished a turn waits on the person', () => {
    expect(needsAttention(session({}), RESTART)).toBe(true)
  })

  test('a closed session does not, however it ended', () => {
    expect(needsAttention(session({ endedAt: NOW - MIN }), RESTART)).toBe(false)
    expect(needsAttention(session({ status: 'needs_input', endedAt: NOW - MIN }), RESTART)).toBe(false)
  })

  test('nor one whose terminal went away with the last restart', () => {
    expect(needsAttention(session({ updatedAt: RESTART - MIN, attentionAt: RESTART - MIN }), RESTART)).toBe(false)
  })

  test('marking it seen still clears it until it asks again', () => {
    expect(needsAttention(session({ acknowledgedAt: NOW - MIN }), RESTART)).toBe(false)
  })
})

describe('isRunning', () => {
  test('a session still running before the restart is not running now', () => {
    expect(isRunning(session({ status: 'running', updatedAt: NOW - MIN }), NOW, RESTART)).toBe(true)
    expect(isRunning(session({ status: 'running', updatedAt: RESTART - MIN }), NOW, RESTART)).toBe(false)
  })

  test('a cut-off session is settled: it goes to the recent list', () => {
    expect(isSettled(session({ status: 'running', updatedAt: RESTART - MIN }), NOW, RESTART)).toBe(true)
  })
})

describe('endLabel', () => {
  test('closed by the person, cut off by the restart, or still open', () => {
    expect(endLabel(session({ endedAt: NOW - MIN }), RESTART)).toBe('已關')
    expect(endLabel(session({ updatedAt: RESTART - 5 * MIN }), RESTART)).toBe('關機時斷掉')
    expect(endLabel(session({}), RESTART)).toBeNull()
  })

  test('skipped after the restart (marked closed then) still says the restart closed it', () => {
    expect(endLabel(session({ updatedAt: RESTART - 5 * MIN, endedAt: NOW - MIN }), RESTART)).toBe('關機時斷掉')
    expect(endLabel(session({ updatedAt: RESTART - 5 * MIN, endedAt: RESTART - 2 * MIN }), RESTART)).toBe('已關')
  })
})

describe('isOneShot', () => {
  test('closed within a minute of answering, less than ten minutes after it started', () => {
    expect(isOneShot(session({ startedAt: NOW - 20_000, updatedAt: NOW - 10_000, endedAt: NOW - 9_000 }))).toBe(true)
    expect(isOneShot(session({ startedAt: NOW - 8 * MIN, updatedAt: NOW - MIN, endedAt: NOW - MIN + 500 }))).toBe(true)
  })

  test('a long session closed right after its last words is the person\'s own, not a one-shot', () => {
    expect(isOneShot(session({ startedAt: NOW - 90 * MIN, updatedAt: NOW - MIN, endedAt: NOW - MIN + 20_000 }))).toBe(false)
  })

  test('a quick session closed later, or one still open, is not either', () => {
    expect(isOneShot(session({ startedAt: NOW - 3 * MIN, updatedAt: NOW - 2 * MIN, endedAt: NOW }))).toBe(false)
    expect(isOneShot(session({ startedAt: NOW - 20_000, updatedAt: NOW - 10_000 }))).toBe(false)
  })
})

describe('sessionLabel', () => {
  test('its name, else its latest prompt, else the agent', () => {
    expect(sessionLabel(session({ name: '清理垃圾資料夾', title: 'ok' }))).toBe('清理垃圾資料夾')
    expect(sessionLabel(session({ title: 'ok' }))).toBe('ok')
    expect(sessionLabel(session({}))).toBe('Claude Code')
  })
})
