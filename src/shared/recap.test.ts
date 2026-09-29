import { describe, expect, test } from 'vitest'
import { buildRecap } from './recap'
import type { TimelineEvent } from './types'

let seq = 0
const ev = (over: Partial<TimelineEvent>): TimelineEvent => ({
  id: ++seq,
  at: 0,
  type: 'item.done',
  title: 't',
  itemId: null,
  agentSessionId: null,
  source: 'user',
  data: null,
  ...over,
})

describe('buildRecap', () => {
  test('counts finished items, routines and distinct finished agent sessions', () => {
    const events = [
      ev({ type: 'item.done' }),
      ev({ type: 'item.done' }),
      ev({ type: 'item.created' }),
      ev({ type: 'routine.done' }),
      ev({ type: 'agent.status', agentSessionId: 'codex:1', data: { status: 'done' } }),
      ev({ type: 'agent.status', agentSessionId: 'codex:1', data: { status: 'done' } }),
      ev({ type: 'agent.status', agentSessionId: 'claude-code:2', data: { status: 'failed' } }),
    ]

    expect(buildRecap('2026-09-28', events)).toEqual({
      day: '2026-09-28',
      itemsDone: 2,
      routinesDone: 1,
      agentsDone: 1,
    })
  })

  test('returns null for an empty day', () => {
    expect(buildRecap('2026-09-28', [ev({ type: 'item.created' })])).toBeNull()
  })
})
