import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { applyAgentEvent } from '../db/agents'
import { openDatabase } from '../db/connection'
import { addFromMessage, noteFromSession } from './agentNotes'

const at = (d: number, h: number, m = 0): number => new Date(2026, 9, d, h, m).getTime()
const NOW = at(1, 10)
const PERCH = 'D:\\code\\perch'

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
  applyAgentEvent(db, { v: 1, agent: 'codex', sessionId: 's', status: 'done', cwd: PERCH, at: NOW - 1 }, NOW - 1)
})

describe('noteFromSession', () => {
  test('without a date it waits in 隨手記, filed under the agent’s folder, written by the person', () => {
    expect(noteFromSession(db, 'codex:s', '更新 README', 'none', NOW, 4)).toMatchObject({
      kind: 'idea',
      title: '更新 README',
      project: PERCH,
      source: 'user',
    })
  })

  test('the chosen day plans it; a date in the words wins over the chips', () => {
    expect(noteFromSession(db, 'codex:s', '跑測試', 'tomorrow', NOW, 4)).toMatchObject({ kind: 'task', plannedFor: '2026-10-02' })
    const dated = noteFromSession(db, 'codex:s', '週五 交報告', 'today', NOW, 4)
    expect(dated).toMatchObject({ kind: 'task', title: '交報告', dueHasTime: false, plannedFor: null })
    expect(new Date(dated.dueAt!).getDate()).toBe(2)
  })

  test('refuses a session it does not know', () => {
    expect(() => noteFromSession(db, 'codex:nope', 'x', 'none', NOW, 4)).toThrow()
  })
})

describe('addFromMessage', () => {
  test('an agent’s request lands in 隨手記 under its folder, marked as from that agent', () => {
    expect(addFromMessage(db, { v: 1, kind: 'item', agent: 'claude-code', title: '確認 macOS 版能開', cwd: PERCH }, NOW, 4)).toMatchObject({
      kind: 'idea',
      project: PERCH,
      source: 'agent:claude-code',
    })
  })

  test('a date in the request makes a dated task, read from when it was written', () => {
    const item = addFromMessage(db, { v: 1, kind: 'item', agent: 'codex', title: '明天下午3點 看 CI 結果', at: NOW }, NOW + 60_000, 4)

    expect(item).toMatchObject({ kind: 'task', title: '看 CI 結果', dueAt: at(2, 15), dueHasTime: true, project: null })
  })
})
