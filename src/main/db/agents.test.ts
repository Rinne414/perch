import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { parseAgentEvent, type AgentEvent } from '@shared/agentEvent'
import { acknowledgeAgent, applyAgentEvent, getAgentSession, listAgentSessions } from './agents'
import { openDatabase } from './connection'
import { listEvents } from './events'

const T0 = 1_000_000
const ev = (over: Partial<AgentEvent>): AgentEvent => ({
  v: 1,
  agent: 'claude-code',
  sessionId: 's1',
  status: 'running',
  ...over,
})

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('applyAgentEvent', () => {
  test('a finished turn asks for attention and lands on the timeline once', () => {
    applyAgentEvent(db, ev({ status: 'running', at: T0, cwd: 'L:\\code\\perch', title: '修 bug' }), T0)
    const done = applyAgentEvent(db, ev({ status: 'done', at: T0 + 10 }), T0 + 10)
    applyAgentEvent(db, ev({ status: 'done', at: T0 + 20 }), T0 + 20)

    expect(done).toMatchObject({ status: 'done', attentionAt: T0 + 10, title: '修 bug', startedAt: T0 })
    expect(getAgentSession(db, 'claude-code:s1')?.attentionAt).toBe(T0 + 10)
    const timeline = listEvents(db, 0, T0 + 100)
    expect(timeline.map((e) => [e.type, e.title, e.data])).toEqual([
      ['agent.status', 'Claude Code · perch', { status: 'done', prompt: '修 bug' }],
    ])
  })

  test('running again clears the attention; a later stop asks again', () => {
    applyAgentEvent(db, ev({ status: 'needs_input', at: T0, detail: '要執行 pnpm install' }), T0)
    const resumed = applyAgentEvent(db, ev({ status: 'running', at: T0 + 5 }), T0 + 5)
    const stopped = applyAgentEvent(db, ev({ status: 'done', at: T0 + 9 }), T0 + 9)

    expect(resumed).toMatchObject({ attentionAt: null, detail: null })
    expect(stopped.attentionAt).toBe(T0 + 9)
  })

  test('a session ending right after it finished keeps its result waiting', () => {
    applyAgentEvent(db, ev({ status: 'done', at: T0 }), T0)

    const ended = applyAgentEvent(db, ev({ status: 'cancelled', at: T0 + 1 }), T0 + 1)

    expect(ended).toMatchObject({ status: 'done', attentionAt: T0 })
  })

  test('a session closed while running is simply cancelled', () => {
    applyAgentEvent(db, ev({ status: 'running', at: T0 }), T0)

    expect(applyAgentEvent(db, ev({ status: 'cancelled', at: T0 + 1 }), T0 + 1)).toMatchObject({
      status: 'cancelled',
      attentionAt: null,
    })
  })

  test('an event older than the stored state is ignored', () => {
    applyAgentEvent(db, ev({ status: 'done', at: T0 + 50 }), T0 + 50)

    expect(applyAgentEvent(db, ev({ status: 'running', at: T0 + 10 }), T0 + 60).status).toBe('done')
  })

  test('acknowledging keeps the row but records when it was seen', () => {
    applyAgentEvent(db, ev({ status: 'failed', at: T0 }), T0)
    acknowledgeAgent(db, 'claude-code:s1', T0 + 1)

    expect(listAgentSessions(db, 0)[0].acknowledgedAt).toBe(T0 + 1)
  })
})

describe('parseAgentEvent', () => {
  test('accepts a well-formed event and trims text', () => {
    expect(parseAgentEvent({ v: 1, agent: 'codex', sessionId: ' x ', status: 'done', title: ' hi ' })).toEqual({
      v: 1,
      agent: 'codex',
      sessionId: 'x',
      status: 'done',
      at: undefined,
      cwd: undefined,
      title: 'hi',
      detail: undefined,
    })
  })

  test.each([
    ['wrong version', { v: 2, agent: 'codex', sessionId: 'x', status: 'done' }],
    ['unknown status', { v: 1, agent: 'codex', sessionId: 'x', status: 'sleeping' }],
    ['agent id with spaces', { v: 1, agent: 'my agent', sessionId: 'x', status: 'done' }],
    ['missing session', { v: 1, agent: 'codex', status: 'done' }],
    ['not an object', 'done'],
  ])('rejects %s', (_label, raw) => {
    expect(parseAgentEvent(raw)).toBeNull()
  })
})
