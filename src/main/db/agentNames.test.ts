import { beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentEvent } from '@shared/agentEvent'
import { applyAgentEvent, fillSessionNames, getAgentSession, listUnnamed, markSessionsReopened } from './agents'
import { openDatabase } from './connection'

const T0 = 1_000_000
const ev = (over: Partial<AgentEvent>): AgentEvent => ({ v: 1, agent: 'claude-code', sessionId: 's1', status: 'running', ...over })
const get = (): ReturnType<typeof getAgentSession> => getAgentSession(db, 'claude-code:s1')

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('session names', () => {
  test('the first prompt names a session; later prompts do not rename it', () => {
    applyAgentEvent(db, ev({ at: T0, title: '修好登入頁' }), T0)
    applyAgentEvent(db, ev({ at: T0 + 10, title: 'ok' }), T0 + 10)

    expect(get()).toMatchObject({ name: '修好登入頁', title: 'ok' })
  })

  test("the agent's own name wins over the first prompt, and its later renames follow", () => {
    applyAgentEvent(db, ev({ at: T0, title: 'continue' }), T0)
    applyAgentEvent(db, ev({ at: T0 + 10, status: 'done', name: '字幕對齊與知識庫整合' }), T0 + 10)
    expect(get()?.name).toBe('字幕對齊與知識庫整合')

    applyAgentEvent(db, ev({ at: T0 + 20, title: 'next' }), T0 + 20)
    expect(get()?.name).toBe('字幕對齊與知識庫整合')

    applyAgentEvent(db, ev({ at: T0 + 30, status: 'done', name: '字幕工具' }), T0 + 30)
    expect(get()?.name).toBe('字幕工具')
  })

  test('a name that comes with the session closing is kept', () => {
    applyAgentEvent(db, ev({ at: T0, status: 'done', name: '舊名字' }), T0)
    applyAgentEvent(db, ev({ at: T0 + 5, status: 'cancelled', ended: true, name: '最後改的名字' }), T0 + 5)

    expect(get()).toMatchObject({ status: 'done', endedAt: T0 + 5, name: '最後改的名字' })
  })

  test('names found later fill only sessions that have none', () => {
    applyAgentEvent(db, ev({ at: T0, status: 'done' }), T0)
    applyAgentEvent(db, ev({ sessionId: 's2', at: T0, title: '已經有名字' }), T0)

    expect(listUnnamed(db, 'claude-code', 0).map((s) => s.id)).toEqual(['claude-code:s1'])
    fillSessionNames(
      db,
      new Map([
        ['claude-code:s1', '從對話紀錄找到的'],
        ['claude-code:s2', '不該蓋掉'],
      ]),
    )

    expect(get()?.name).toBe('從對話紀錄找到的')
    expect(getAgentSession(db, 'claude-code:s2')?.name).toBe('已經有名字')
  })
})

describe('reopening', () => {
  test('a closed session Perch reopens counts as open again', () => {
    applyAgentEvent(db, ev({ at: T0, status: 'done' }), T0)
    applyAgentEvent(db, ev({ at: T0 + 5, status: 'cancelled', ended: true }), T0 + 5)
    expect(get()?.endedAt).toBe(T0 + 5)

    markSessionsReopened(db, ['claude-code:s1'], T0 + 100)

    expect(get()).toMatchObject({ endedAt: null, reopenedAt: T0 + 100 })
  })
})

describe('migration 8', () => {
  test('sessions from before it have no name, so their first prompt or transcript can give one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perch-names-'))
    const path = join(dir, 'old.db')
    try {
      const old = openDatabase(path)
      old.exec('ALTER TABLE agent_sessions DROP COLUMN name')
      old.exec(
        `INSERT INTO agent_sessions (id, agent, session_id, title, status, started_at, updated_at)
         VALUES ('claude-code:x', 'claude-code', 'x', 'ok', 'done', 1, 42)`,
      )
      old.exec('ALTER TABLE items DROP COLUMN monthly')
      old.exec('PRAGMA user_version = 7')
      old.close()

      const upgraded = openDatabase(path)
      const row = getAgentSession(upgraded, 'claude-code:x')
      upgraded.close()

      expect(row).toMatchObject({ name: null, title: 'ok' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
