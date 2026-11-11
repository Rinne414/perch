import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { acknowledgeAgent, applyAgentEvent, getAgentSession } from '../db/agents'
import { openDatabase } from '../db/connection'
import { createAckUndo } from './ackUndo'

const T0 = 1_000_000_000
let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
  for (const id of ['a', 'b', 'c']) applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: id, status: 'done', at: T0 }, T0)
})

const seen = (id: string): number | null => getAgentSession(db, `claude-code:${id}`)!.acknowledgedAt

describe('createAckUndo', () => {
  test('marks every session as seen and one undo puts them all back', () => {
    acknowledgeAgent(db, 'claude-code:c', T0 + 5)
    const undo = createAckUndo(() => T0 + 100)

    const token = undo.acknowledge(db, ['claude-code:a', 'claude-code:b', 'claude-code:c'], T0 + 100)

    expect([seen('a'), seen('b'), seen('c')]).toEqual([T0 + 100, T0 + 100, T0 + 100])
    expect(undo.restore(db, token)).toBe(true)
    expect([seen('a'), seen('b'), seen('c')]).toEqual([null, null, T0 + 5])
  })

  test('a token works once, and not after a minute', () => {
    let now = T0
    const undo = createAckUndo(() => now)
    const first = undo.acknowledge(db, ['claude-code:a'], now)
    expect(undo.restore(db, first)).toBe(true)
    expect(undo.restore(db, first)).toBe(false)

    const late = undo.acknowledge(db, ['claude-code:b'], now)
    now += 60_001
    expect(undo.restore(db, late)).toBe(false)
    expect(seen('b')).toBe(T0)
  })

  test('a session marked again after the press keeps the newer mark', () => {
    const undo = createAckUndo(() => T0 + 10)
    const token = undo.acknowledge(db, ['claude-code:a'], T0 + 10)
    acknowledgeAgent(db, 'claude-code:a', T0 + 20)

    undo.restore(db, token)

    expect(seen('a')).toBe(T0 + 20)
  })

  test('unknown ids are skipped', () => {
    const undo = createAckUndo(() => T0)
    expect(() => undo.restore(db, undo.acknowledge(db, ['claude-code:nope'], T0))).not.toThrow()
  })
})
