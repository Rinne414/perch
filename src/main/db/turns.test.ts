import { mkdtempSync, rmSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import type { AgentEvent } from '@shared/agentEvent'
import { applyAgentEvent } from './agents'
import { openDatabase } from './connection'
import { listAllTurns, listTurns, listRepliesEndedBetween, listTurnSpans, sessionBriefs } from './turns'

const T0 = 1_000_000
const ID = 'claude-code:s1'
const ev = (over: Partial<AgentEvent>): AgentEvent => ({ v: 1, agent: 'claude-code', sessionId: 's1', status: 'running', ...over })
const apply = (over: Partial<AgentEvent>): void => {
  applyAgentEvent(db, ev(over), over.at ?? T0)
}
const shape = (id = ID): [string | null, string | null, number | null][] =>
  listTurns(db, id).map((t) => [t.prompt, t.reply, t.endedAt])

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('turns from events', () => {
  test('a prompt starts a turn and a reply closes it', () => {
    apply({ at: T0, prompt: '修登入頁' })
    apply({ at: T0 + 10, status: 'done', reply: '修好了' })

    expect(listTurns(db, ID)).toEqual([
      { id: expect.any(Number), agentSessionId: ID, startedAt: T0, prompt: '修登入頁', endedAt: T0 + 10, reply: '修好了', replyLen: 3 },
    ])
  })

  test('each prompt is a new turn, in order', () => {
    apply({ at: T0, prompt: 'one' })
    apply({ at: T0 + 10, status: 'done', reply: 'first answer' })
    apply({ at: T0 + 20, prompt: 'two' })

    expect(shape()).toEqual([
      ['one', 'first answer', T0 + 10],
      ['two', null, null],
    ])
  })

  test('a second reply never replaces the first: it starts a turn of its own with no prompt', () => {
    apply({ at: T0, prompt: 'one' })
    apply({ at: T0 + 10, status: 'done', reply: 'stopped once' })
    apply({ at: T0 + 15, status: 'running' })
    apply({ at: T0 + 20, status: 'done', reply: 'stopped twice' })

    expect(shape()).toEqual([
      ['one', 'stopped once', T0 + 10],
      [null, 'stopped twice', T0 + 20],
    ])
  })

  test('an answer to a background notice keeps the real report before it', () => {
    apply({ at: T0, prompt: 'write the report' })
    apply({ at: T0 + 10, status: 'done', reply: '## The whole report, many lines long' })
    apply({ at: T0 + 500, status: 'done', reply: 'Background task finished.' })

    expect(shape()).toEqual([
      ['write the report', '## The whole report, many lines long', T0 + 10],
      [null, 'Background task finished.', T0 + 500],
    ])
  })

  test('a reply with no turn yet makes one without a prompt', () => {
    apply({ at: T0, status: 'running' })
    apply({ at: T0 + 10, status: 'done', reply: 'carried on from before' })

    expect(shape()).toEqual([[null, 'carried on from before', T0 + 10]])
    expect(listTurns(db, ID)[0].startedAt).toBe(T0 + 10)
  })

  test('events without text make no turns', () => {
    apply({ at: T0, status: 'running', title: 'x' })
    apply({ at: T0 + 1, status: 'done' })

    expect(listAllTurns(db)).toEqual([])
  })

  test('an event older than the stored state changes nothing, turns included', () => {
    apply({ at: T0 + 50, prompt: 'new' })

    apply({ at: T0 + 10, prompt: 'stale', reply: 'stale' })

    expect(shape()).toEqual([['new', null, null]])
  })

  test('a prompt and a reply in one event make one finished turn', () => {
    apply({ at: T0, status: 'done', prompt: 'quick one', reply: 'quick answer' })

    expect(shape()).toEqual([['quick one', 'quick answer', T0]])
  })

  test('a reply that arrives with the session closing is still kept', () => {
    apply({ at: T0, prompt: 'p' })
    apply({ at: T0 + 5, status: 'done', reply: 'r1' })
    apply({ at: T0 + 6, status: 'cancelled', ended: true, reply: 'r2' })

    expect(shape()).toEqual([
      ['p', 'r1', T0 + 5],
      [null, 'r2', T0 + 6],
    ])
  })

  test('sessions keep their turns apart', () => {
    apply({ at: T0, prompt: 'a' })
    applyAgentEvent(db, ev({ sessionId: 's2', at: T0 + 1, prompt: 'b' }), T0 + 1)

    expect(shape(ID)).toEqual([['a', null, null]])
    expect(shape('claude-code:s2')).toEqual([['b', null, null]])
    expect(listAllTurns(db)).toHaveLength(2)
  })
})

describe('sessionBriefs', () => {
  test('give the first and latest typed prompt and the latest reply of several sessions at once', () => {
    apply({ at: T0, prompt: 'first ask' })
    apply({ at: T0 + 1, status: 'done', reply: 'first answer' })
    apply({ at: T0 + 2, prompt: 'second ask' })
    apply({ at: T0 + 3, status: 'done', reply: 'second answer' })
    applyAgentEvent(db, ev({ sessionId: 's2', at: T0, prompt: 'other ask' }), T0)
    applyAgentEvent(db, ev({ sessionId: 's3', at: T0, status: 'done' }), T0)

    const briefs = sessionBriefs(db, [ID, 'claude-code:s2', 'claude-code:s3', 'claude-code:missing'])

    expect([...briefs.keys()]).toEqual([ID, 'claude-code:s2', 'claude-code:s3'])
    expect(briefs.get(ID)).toEqual({
      agentSessionId: ID,
      firstPrompt: 'first ask',
      latestPrompt: 'second ask',
      latestReply: 'second answer',
      latestReplyAt: T0 + 3,
      reportReply: 'second answer',
      reportReplyAt: T0 + 3,
      promptCount: 2,
      turnCount: 2,
    })
    expect(briefs.get('claude-code:s2')).toMatchObject({ firstPrompt: 'other ask', latestReply: null, latestReplyAt: null, promptCount: 1 })
    expect(briefs.get('claude-code:s3')).toMatchObject({ firstPrompt: null, latestPrompt: null, latestReply: null, promptCount: 0, turnCount: 0 })
  })

  test('turns without a typed prompt do not count as prompts, but their reply is the latest reply', () => {
    apply({ at: T0, prompt: 'typed' })
    apply({ at: T0 + 1, status: 'done', reply: 'answer' })
    // Re-open from a background notice: the answer replaces the reply; no second prompt exists.
    apply({ at: T0 + 2, status: 'done', reply: 'answer to the notice' })

    expect(sessionBriefs(db, [ID]).get(ID)).toMatchObject({
      firstPrompt: 'typed',
      latestPrompt: 'typed',
      latestReply: 'answer to the notice',
      promptCount: 1,
      turnCount: 2,
    })
  })

  test('a session whose only turn has no prompt has no typed prompt', () => {
    apply({ at: T0, status: 'done', reply: 'from before' })

    expect(sessionBriefs(db, [ID]).get(ID)).toMatchObject({
      firstPrompt: null,
      latestPrompt: null,
      latestReply: 'from before',
      promptCount: 0,
      turnCount: 1,
    })
  })
})

describe('the report of a session', () => {
  test('a one-line answer to a notice after the real report does not replace it', () => {
    apply({ at: T0, prompt: 'write the report' })
    apply({ at: T0 + 10, status: 'done', reply: '## 結論\n\nThe whole report, many lines long.' })
    apply({ at: T0 + 20, status: 'done', reply: 'ok' })

    expect(sessionBriefs(db, [ID]).get(ID)).toMatchObject({
      latestReply: 'ok',
      reportReply: '## 結論\n\nThe whole report, many lines long.',
      reportReplyAt: T0 + 10,
    })
  })

  test('only the round since the last typed prompt counts; a round still at work keeps the one before', () => {
    apply({ at: T0, prompt: 'one' })
    apply({ at: T0 + 10, status: 'done', reply: 'a very long first report that should not win later' })
    apply({ at: T0 + 20, prompt: 'two' })
    apply({ at: T0 + 30, status: 'done', reply: 'short second' })
    expect(sessionBriefs(db, [ID]).get(ID)?.reportReply).toBe('short second')

    apply({ at: T0 + 40, prompt: 'three' })
    expect(sessionBriefs(db, [ID]).get(ID)).toMatchObject({ reportReply: 'short second', reportReplyAt: T0 + 30 })
  })

  test('a session without replies has no report', () => {
    apply({ at: T0, prompt: 'just started' })
    expect(sessionBriefs(db, [ID]).get(ID)).toMatchObject({ reportReply: null, reportReplyAt: null })
  })
})

describe('listTurnSpans', () => {
  test('every turn overlapping the window, open ones however old, times only', () => {
    applyAgentEvent(db, ev({ sessionId: 'old', at: T0 - 500, prompt: 'never answered' }), T0 - 500)
    apply({ at: T0, prompt: 'before' })
    apply({ at: T0 + 5, status: 'done', reply: 'ended before' })
    apply({ at: T0 + 8, prompt: 'across the start' })
    apply({ at: T0 + 15, status: 'done', reply: 'ended inside' })
    apply({ at: T0 + 40, prompt: 'after' })

    expect(listTurnSpans(db, T0 + 10, T0 + 30)).toEqual([
      { agentSessionId: 'claude-code:old', startedAt: T0 - 500, endedAt: null },
      { agentSessionId: ID, startedAt: T0 + 8, endedAt: T0 + 15 },
    ])
  })
})

describe('listRepliesEndedBetween', () => {
  test('keeps replies inside the window, both ends included, oldest first', () => {
    apply({ at: T0, prompt: 'a' })
    apply({ at: T0 + 10, status: 'done', reply: 'at the start' })
    apply({ at: T0 + 20, prompt: 'b' })
    apply({ at: T0 + 30, status: 'done', reply: 'at the end' })
    apply({ at: T0 + 40, prompt: 'c' })
    apply({ at: T0 + 41, status: 'done', reply: 'after' })
    apply({ at: T0 + 50, prompt: 'still working' })

    expect(listRepliesEndedBetween(db, T0 + 10, T0 + 30).map((t) => t.reply)).toEqual(['at the start', 'at the end'])
    expect(listRepliesEndedBetween(db, T0 + 11, T0 + 29)).toEqual([])
  })

  test('reads a long list of sessions and an empty one', () => {
    const ids: string[] = []
    for (let i = 0; i < 1200; i++) {
      applyAgentEvent(db, ev({ sessionId: `n${i}`, at: T0, prompt: `ask ${i}` }), T0)
      ids.push(`claude-code:n${i}`)
    }

    const briefs = sessionBriefs(db, ids)

    expect(briefs.size).toBe(1200)
    expect(briefs.get('claude-code:n1199')?.firstPrompt).toBe('ask 1199')
    expect(sessionBriefs(db, []).size).toBe(0)
  })
})

describe('migration 10', () => {
  test('a version 9 database gets the turns table and keeps its sessions; old sessions have no turns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perch-turns-'))
    const path = join(dir, 'v9.db')
    try {
      const old = openDatabase(path)
      old.exec('DROP TABLE agent_turns')
      old.exec(
        `INSERT INTO agent_sessions (id, agent, session_id, title, status, started_at, updated_at)
         VALUES ('claude-code:x', 'claude-code', 'x', 'ok', 'done', 1, 42)`,
      )
      old.exec('PRAGMA user_version = 9')
      old.close()

      const upgraded = openDatabase(path)
      const version = (upgraded.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
      const columns = (upgraded.prepare('PRAGMA table_info(agent_turns)').all() as { name: string }[]).map((c) => c.name)
      const indexes = (upgraded.prepare('PRAGMA index_list(agent_turns)').all() as { name: string }[]).map((i) => i.name)
      const before = listTurns(upgraded, 'claude-code:x')
      // The first reply of such a session makes its first turn.
      applyAgentEvent(upgraded, ev({ sessionId: 'x', status: 'done', at: 100, reply: 'late answer' }), 100)
      const after = listTurns(upgraded, 'claude-code:x')
      upgraded.close()

      expect(version).toBeGreaterThanOrEqual(10)
      expect(columns).toEqual(['id', 'agent_session_id', 'started_at', 'prompt', 'ended_at', 'reply', 'reply_len'])
      expect(indexes).toContain('agent_turns_session')
      expect(before).toEqual([])
      expect(after).toMatchObject([{ prompt: null, reply: 'late answer', endedAt: 100 }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('agent_turns indexes', () => {
  test('the window query reads replies by ended_at through an index', () => {
    const names = (db.prepare("PRAGMA index_list('agent_turns')").all() as { name: string }[]).map((r) => r.name)
    expect(names).toContain('agent_turns_ended')
  })
})
