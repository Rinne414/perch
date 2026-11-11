import { mkdtempSync, rmSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { AgentEvent } from '@shared/agentEvent'
import { reportText } from '@shared/reportPick'
import { applyAgentEvent } from './agents'
import { openDatabase } from './connection'
import { listAllTurns, listRepliesEndedBetween, listTurns, listTurnSpans, sessionBriefs } from './turns'

const T0 = 1_000_000
const ID = 'claude-code:s1'
const ev = (over: Partial<AgentEvent>): AgentEvent => ({ v: 1, agent: 'claude-code', sessionId: 's1', status: 'running', ...over })

let dir: string
let db: DatabaseSync
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'perch-cost-'))
  db = openDatabase(join(dir, 'tasks.db'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const apply = (over: Partial<AgentEvent>): void => {
  applyAgentEvent(db, ev(over), over.at ?? T0)
}

describe('reply length', () => {
  test('is kept on write as the length of the trimmed reply, 0 for a blank one', () => {
    apply({ at: T0, prompt: 'go' })
    apply({ at: T0 + 1, status: 'done', reply: '  done  \n' })
    apply({ at: T0 + 2, status: 'done', reply: '   \n\t ' })

    expect(listTurns(db, ID).map((t) => t.replyLen)).toEqual([4, 0])
  })

  test('the briefing and the note pick the same report when a whitespace-only reply comes last', () => {
    apply({ at: T0, prompt: 'go' })
    apply({ at: T0 + 1, status: 'done', reply: 'ok' })
    apply({ at: T0 + 2, status: 'done', reply: ' '.repeat(40) })

    expect(sessionBriefs(db, [ID]).get(ID)?.reportReply).toBe('ok')
    expect(reportText(listTurns(db, ID))).toBe('ok')
  })

  test('migration 12 fills it in for turns kept before, trimmed, and adds the covering index', () => {
    apply({ at: T0, prompt: 'go' })
    apply({ at: T0 + 1, status: 'done', reply: '  report  ' })
    apply({ at: T0 + 2, status: 'done', reply: '   ' })
    db.exec('UPDATE agent_turns SET reply_len = 0')
    db.exec('DROP INDEX agent_turns_shape')
    db.exec('DROP INDEX agent_turns_span')
    db.exec('PRAGMA user_version = 11')
    db.close()

    db = openDatabase(join(dir, 'tasks.db'))
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id, agent_session_id, prompt IS NOT NULL AS typed, reply IS NOT NULL AS replied, reply_len, ended_at FROM agent_turns WHERE agent_session_id IN ('x') ORDER BY agent_session_id, started_at, id",
      )
      .all() as { detail: string }[]

    expect(version).toBe(12)
    expect(listTurns(db, ID).map((t) => t.replyLen)).toEqual([6, 0])
    const spans = db
      .prepare('EXPLAIN QUERY PLAN SELECT agent_session_id, started_at, ended_at FROM agent_turns WHERE started_at <= 1 AND (ended_at IS NULL OR ended_at >= 0) ORDER BY started_at, id')
      .all() as { detail: string }[]

    expect(plan.map((r) => r.detail).join(' ')).toContain('COVERING INDEX agent_turns_shape')
    expect(spans.map((r) => r.detail).join(' ')).toContain('COVERING INDEX agent_turns_span')
  })
})

describe('turns that never got a reply', () => {
  test('a new prompt closes them, so none stays open over the next one', () => {
    apply({ at: T0, prompt: 'first, interrupted' })
    apply({ at: T0 + 5, prompt: 'second' })
    apply({ at: T0 + 9, status: 'done', reply: 'answer to the second' })

    expect(listTurns(db, ID).map((t) => [t.prompt, t.endedAt, t.reply])).toEqual([
      ['first, interrupted', T0 + 5, null],
      ['second', T0 + 9, 'answer to the second'],
    ])
  })
})

describe('cost of a refresh', () => {
  /** Writing 36 million characters takes a few seconds here and far longer on a slow machine. */
  const SEED_TIMEOUT_MS = 120_000

  /** The fastest of three runs, in ms, so one slow run on a busy machine does not decide the result. */
  const fastest = (run: () => void): number =>
    Math.min(
      ...[0, 1, 2].map(() => {
        const t0 = performance.now()
        run()
        return performance.now() - t0
      }),
    )

  test('40 sessions x 3 turns x 300,000 characters: the briefing queries read only what they show', () => {
    const big = (k: number): string => `## 結論\n第 ${k} 份。\n${'說'.repeat(300_000)}`
    const ids: string[] = []
    for (let s = 0; s < 40; s++) {
      const e = (over: Partial<AgentEvent>): AgentEvent => ({ v: 1, agent: 'claude-code', sessionId: `n${s}`, status: 'running', ...over })
      for (let k = 0; k < 3; k++) {
        applyAgentEvent(db, e({ prompt: `ask ${k}`.repeat(1000) }), T0 + k * 10)
        applyAgentEvent(db, e({ status: 'done', reply: big(k) }), T0 + k * 10 + 5)
      }
      ids.push(`claude-code:n${s}`)
    }

    const briefs = sessionBriefs(db, ids)
    const lines = listRepliesEndedBetween(db, T0, T0 + 100)
    const spans = listTurnSpans(db, T0, T0 + 100)
    const shownMs = fastest(() => {
      sessionBriefs(db, ids)
      listRepliesEndedBetween(db, T0, T0 + 100)
      listTurnSpans(db, T0, T0 + 100)
    })
    const wholeMs = fastest(() => {
      listAllTurns(db)
    })

    expect(briefs.get('claude-code:n0')?.reportReply).toHaveLength(50_001)
    expect(briefs.get('claude-code:n0')?.latestReply).toHaveLength(2000)
    expect(lines.every((l) => l.reply.length === 2000)).toBe(true)
    expect(spans).toHaveLength(120)
    // Against reading every turn whole on the same machine, so a slow machine cannot fail it and
    // queries that read every text again cannot pass. Measured on the owner's PC (2026-11-12):
    // about 140 ms against about 550 ms; the old queries, which read every text, took about 900 ms.
    expect(shownMs).toBeLessThan(wholeMs / 2)
  }, SEED_TIMEOUT_MS)
})
