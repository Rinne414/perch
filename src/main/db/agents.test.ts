import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { capTurnText, MAX_TURN_TEXT, parseAgentEvent, type AgentEvent } from '@shared/agentEvent'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acknowledgeAgent,
  applyAgentEvent,
  getAgentSession,
  listAgentSessions,
  listOpenSessions,
  markSessionsEnded,
  markSessionsReopened,
} from './agents'
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
      ['agent.status', 'Claude Code · perch', { status: 'done', prompt: '修 bug', cwd: 'L:\\code\\perch' }],
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

describe('closed sessions (ended_at)', () => {
  const get = (): ReturnType<typeof getAgentSession> => getAgentSession(db, 'claude-code:s1')

  test('closing after a finished turn keeps the result but marks the session closed', () => {
    applyAgentEvent(db, ev({ status: 'done', at: T0 }), T0)

    const ended = applyAgentEvent(db, ev({ status: 'cancelled', ended: true, at: T0 + 5 }), T0 + 5)

    expect(ended).toMatchObject({ status: 'done', attentionAt: T0, updatedAt: T0, endedAt: T0 + 5 })
    expect(get()).toMatchObject({ status: 'done', endedAt: T0 + 5 })
  })

  test('closing a running session cancels it and marks it closed', () => {
    applyAgentEvent(db, ev({ status: 'running', at: T0 }), T0)
    applyAgentEvent(db, ev({ status: 'cancelled', ended: true, at: T0 + 5 }), T0 + 5)

    expect(get()).toMatchObject({ status: 'cancelled', endedAt: T0 + 5 })
  })

  test('a cancelled turn without ended leaves the session open', () => {
    applyAgentEvent(db, ev({ status: 'running', at: T0 }), T0)
    applyAgentEvent(db, ev({ status: 'cancelled', at: T0 + 5 }), T0 + 5)
    expect(get()?.endedAt).toBeNull()

    applyAgentEvent(db, ev({ sessionId: 's2', status: 'done', at: T0 }), T0)
    applyAgentEvent(db, ev({ sessionId: 's2', status: 'cancelled', at: T0 + 5 }), T0 + 5)
    expect(getAgentSession(db, 'claude-code:s2')?.endedAt).toBeNull()
  })

  test('any later report means it was opened again', () => {
    applyAgentEvent(db, ev({ status: 'done', at: T0 }), T0)
    applyAgentEvent(db, ev({ status: 'cancelled', ended: true, at: T0 + 5 }), T0 + 5)

    applyAgentEvent(db, ev({ status: 'running', at: T0 + 9, title: '繼續' }), T0 + 9)

    expect(get()).toMatchObject({ status: 'running', endedAt: null })
  })

  test('a later cancelled turn (no ended) also means it is open again', () => {
    applyAgentEvent(db, ev({ status: 'done', at: T0 }), T0)
    applyAgentEvent(db, ev({ status: 'cancelled', ended: true, at: T0 + 5 }), T0 + 5)

    applyAgentEvent(db, ev({ status: 'cancelled', at: T0 + 9 }), T0 + 9)

    expect(get()).toMatchObject({ status: 'done', endedAt: null })
  })

  test('a report older than the close is ignored, so a late hook cannot reopen it', () => {
    applyAgentEvent(db, ev({ status: 'done', at: T0 }), T0)
    applyAgentEvent(db, ev({ status: 'cancelled', ended: true, at: T0 + 5 }), T0 + 5)

    applyAgentEvent(db, ev({ status: 'running', at: T0 + 3 }), T0 + 9)

    expect(get()).toMatchObject({ status: 'done', endedAt: T0 + 5 })
  })
})

describe('sessions open before a restart', () => {
  const AGENTS = ['claude-code', 'codex']
  const open = (from: number, before: number): string[] => listOpenSessions(db, from, before, AGENTS, 10).map((s) => s.id)

  test('lists sessions that never closed, last seen in the window, in a folder, of the given agents', () => {
    applyAgentEvent(db, ev({ sessionId: 'open', status: 'done', at: T0 + 10, cwd: '/w/a' }), T0)
    applyAgentEvent(db, ev({ sessionId: 'newer', status: 'running', at: T0 + 20, cwd: '/w/b' }), T0)
    applyAgentEvent(db, ev({ sessionId: 'closed', status: 'cancelled', ended: true, at: T0 + 10, cwd: '/w/a' }), T0)
    applyAgentEvent(db, ev({ sessionId: 'nofolder', status: 'done', at: T0 + 10 }), T0)
    applyAgentEvent(db, ev({ sessionId: 'tooold', status: 'done', at: T0 - 1, cwd: '/w/a' }), T0)
    applyAgentEvent(db, ev({ sessionId: 'after', status: 'done', at: T0 + 100, cwd: '/w/a' }), T0)
    applyAgentEvent(db, ev({ agent: 'opencode', sessionId: 'other', status: 'done', at: T0 + 10, cwd: '/w/a' }), T0)

    expect(open(T0, T0 + 100)).toEqual(['claude-code:newer', 'claude-code:open'])
    expect(listOpenSessions(db, T0, T0 + 100, [], 10)).toEqual([])
  })

  test('marking them closed takes them off; reopening by Perch counts as a sign of life', () => {
    applyAgentEvent(db, ev({ sessionId: 'a', status: 'done', at: T0 + 10, cwd: '/w/a' }), T0)
    applyAgentEvent(db, ev({ sessionId: 'b', status: 'done', at: T0 + 10, cwd: '/w/b' }), T0)

    markSessionsEnded(db, ['claude-code:a'], T0 + 50)
    markSessionsReopened(db, ['claude-code:b'], T0 + 50)

    expect(open(T0, T0 + 40)).toEqual([])
    // The next restart: b was reopened at T0 + 50 and never closed, so it was open again.
    expect(open(T0 + 45, T0 + 200)).toEqual(['claude-code:b'])
  })
})

describe('migration 7', () => {
  test('sessions from before it count as closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perch-agents-'))
    const path = join(dir, 'old.db')
    try {
      const old = openDatabase(path)
      old.exec('ALTER TABLE agent_sessions DROP COLUMN name')
      old.exec('ALTER TABLE agent_sessions DROP COLUMN reopened_at')
      old.exec('ALTER TABLE agent_sessions DROP COLUMN ended_at')
      old.exec(
        `INSERT INTO agent_sessions (id, agent, session_id, status, started_at, updated_at)
         VALUES ('claude-code:x', 'claude-code', 'x', 'running', 1, 42)`,
      )
      old.exec('ALTER TABLE items DROP COLUMN monthly')
      old.exec('PRAGMA user_version = 6')
      old.close()

      const upgraded = openDatabase(path)
      const row = getAgentSession(upgraded, 'claude-code:x')
      upgraded.close()

      expect(row?.endedAt).toBe(42)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('capTurnText', () => {
  test('leaves text up to the limit alone', () => {
    const text = 'a'.repeat(MAX_TURN_TEXT)

    expect(capTurnText(text)).toBe(text)
  })

  test('cuts longer text at the limit and says how many characters were not kept', () => {
    const capped = capTurnText('a'.repeat(MAX_TURN_TEXT + 1234))

    expect(capped.startsWith('a'.repeat(MAX_TURN_TEXT))).toBe(true)
    expect(capped.slice(MAX_TURN_TEXT)).toBe('\n\n（太長了，只留前 1,000,000 字，後面 1,234 字沒有保留）')
  })

  test('does not cut a character in half', () => {
    const text = `${'a'.repeat(MAX_TURN_TEXT - 1)}😀${'b'.repeat(10)}`
    const capped = capTurnText(text)

    expect(capped).toContain('只留前 999,999 字，後面 12 字沒有保留')
    expect(capped.startsWith('a'.repeat(MAX_TURN_TEXT - 1) + '\n')).toBe(true)
  })

  test('parseAgentEvent applies it to prompt and reply only', () => {
    const e = parseAgentEvent({
      v: 1,
      agent: 'codex',
      sessionId: 'x',
      status: 'done',
      prompt: 'p'.repeat(MAX_TURN_TEXT + 5),
      reply: 'r'.repeat(MAX_TURN_TEXT),
    })

    expect(e?.prompt).toMatch(/後面 5 字沒有保留）$/)
    expect(e?.reply).toHaveLength(MAX_TURN_TEXT)
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

  test('keeps ended only when it is exactly true', () => {
    const base = { v: 1, agent: 'codex', sessionId: 'x', status: 'cancelled' }

    expect(parseAgentEvent({ ...base, ended: true })).toMatchObject({ ended: true })
    expect(parseAgentEvent({ ...base, ended: 'yes' })).not.toHaveProperty('ended')
    expect(parseAgentEvent(base)).not.toHaveProperty('ended')
  })

  test('keeps prompt and reply whole, past the 500 characters other text is cut at', () => {
    const prompt = '問'.repeat(5000)
    const reply = ` ${'答'.repeat(20_000)}\n`

    expect(parseAgentEvent({ v: 1, agent: 'codex', sessionId: 'x', status: 'done', title: 't', detail: 'd'.repeat(900), prompt, reply })).toMatchObject({
      prompt,
      reply: '答'.repeat(20_000),
      detail: 'd'.repeat(500),
    })
  })

  test('leaves prompt and reply out when they are missing, blank or not text', () => {
    const base = { v: 1, agent: 'codex', sessionId: 'x', status: 'done' }
    const e = parseAgentEvent({ ...base, prompt: '  ', reply: 42 })

    expect(e).not.toHaveProperty('prompt')
    expect(e).not.toHaveProperty('reply')
    expect(parseAgentEvent(base)).not.toHaveProperty('prompt')
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
