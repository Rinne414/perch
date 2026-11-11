import { mkdtempSync, rmSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { applyAgentEvent, restoreAgentSession, takeAgentSession } from './agents'
import { openDatabase } from './connection'
import { listAllTodoMarks, markTodo, MAX_MARKS_PER_SESSION, todoMarksOf, unmarkTodo } from './todoMarks'

const T0 = 1_000_000
const A = 'claude-code:a'
const B = 'claude-code:b'

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
  applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 'a', status: 'done', reply: '## 需要你做的事\n- 重拍截圖' }, T0)
  applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 'b', status: 'done' }, T0)
})

describe('ticks', () => {
  test('are read back by session; ticking twice keeps the first time; unmarking takes one back', () => {
    markTodo(db, A, '0000000a', T0 + 1)
    markTodo(db, A, '0000000a', T0 + 9)
    markTodo(db, A, '0000000b', T0 + 2)
    markTodo(db, B, '0000000c', T0 + 3)

    expect(todoMarksOf(db, [A, B, 'claude-code:none'])).toEqual(
      new Map([
        [A, new Set(['0000000a', '0000000b'])],
        [B, new Set(['0000000c'])],
      ]),
    )
    expect(listAllTodoMarks(db)[0]).toEqual({ agentSessionId: A, key: '0000000a', markedAt: T0 + 1 })

    unmarkTodo(db, A, '0000000b')
    expect(todoMarksOf(db, [A]).get(A)).toEqual(new Set(['0000000a']))
  })

  test(`at most ${MAX_MARKS_PER_SESSION} per session: one more is refused, none is dropped`, () => {
    for (let i = 0; i < MAX_MARKS_PER_SESSION; i++) markTodo(db, A, i.toString(16).padStart(8, '0'), T0)

    expect(() => markTodo(db, A, 'ffffffff', T0)).toThrow()
    expect(() => markTodo(db, A, '00000000', T0 + 1)).not.toThrow()
    expect(todoMarksOf(db, [A]).get(A)?.size).toBe(MAX_MARKS_PER_SESSION)
  })

  test('a tick needs its session', () => {
    expect(() => markTodo(db, 'claude-code:gone', '0000000a', T0)).toThrow()
  })

  test('go with the session when it is taken off the list, and come back with the undo', () => {
    markTodo(db, A, '0000000a', T0 + 1)

    const snapshot = takeAgentSession(db, A)
    expect(listAllTodoMarks(db)).toEqual([])
    expect(snapshot.todoMarks).toEqual([{ agent_session_id: A, key: '0000000a', marked_at: T0 + 1 }])

    restoreAgentSession(db, snapshot)
    expect(todoMarksOf(db, [A]).get(A)).toEqual(new Set(['0000000a']))
  })

  test('reads a long list of sessions', () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `claude-code:n${i}`)
    for (const [i, id] of ids.entries()) {
      applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: `n${i}`, status: 'done' }, T0)
      markTodo(db, id, '0000000a', T0)
    }
    expect(todoMarksOf(db, ids).size).toBe(1200)
  })
})

describe('migration 11', () => {
  test('a version 10 database gets the ticks table and keeps its sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perch-marks-'))
    const path = join(dir, 'v10.db')
    try {
      const old = openDatabase(path)
      old.exec('DROP TABLE agent_todo_marks')
      old.exec(
        `INSERT INTO agent_sessions (id, agent, session_id, title, status, started_at, updated_at)
         VALUES ('claude-code:x', 'claude-code', 'x', 'ok', 'done', 1, 42)`,
      )
      old.exec('PRAGMA user_version = 10')
      old.close()

      const upgraded = openDatabase(path)
      const version = (upgraded.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
      const columns = (upgraded.prepare('PRAGMA table_info(agent_todo_marks)').all() as { name: string }[]).map((c) => c.name)
      markTodo(upgraded, 'claude-code:x', '0000000a', 50)
      const marks = todoMarksOf(upgraded, ['claude-code:x'])
      upgraded.close()

      expect(version).toBeGreaterThanOrEqual(11)
      expect(columns).toEqual(['agent_session_id', 'key', 'marked_at'])
      expect(marks.get('claude-code:x')).toEqual(new Set(['0000000a']))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
