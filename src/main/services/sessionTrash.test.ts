import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, test } from 'vitest'
import { applyAgentEvent, getAgentSession, isKnownWorkFolder } from '../db/agents'
import { openDatabase } from '../db/connection'
import { dayView } from './calendar'
import { DEFAULT_SETTINGS } from './settings'
import { createSessionTrash } from './sessionTrash'

const at = (h: number, m = 0): number => new Date(2026, 9, 28, h, m).getTime()
const CWD = 'D:\\my code\\shop'

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
  applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 's1', status: 'running', cwd: CWD, title: '修 bug', at: at(10) }, at(10))
  applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 's1', status: 'done', detail: '修好了', at: at(10, 5) }, at(10, 5))
})

describe('createSessionTrash', () => {
  test('takes a session off the list and puts it back exactly within a minute', () => {
    let now = at(11)
    const trash = createSessionTrash(() => now)
    const before = getAgentSession(db, 'claude-code:s1')

    trash.remove(db, 'claude-code:s1')
    expect(getAgentSession(db, 'claude-code:s1')).toBeNull()

    now += 59_000
    expect(trash.restore(db, 'claude-code:s1')).toBe(true)
    expect(getAgentSession(db, 'claude-code:s1')).toEqual(before)
  })

  test('after a minute the undo is gone', () => {
    let now = at(11)
    const trash = createSessionTrash(() => now)
    trash.remove(db, 'claude-code:s1')
    now += 61_000
    expect(trash.restore(db, 'claude-code:s1')).toBe(false)
    expect(getAgentSession(db, 'claude-code:s1')).toBeNull()
  })

  test('a session that reported again meanwhile keeps its newer row', () => {
    const trash = createSessionTrash(() => at(11))
    trash.remove(db, 'claude-code:s1')
    applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 's1', status: 'running', title: '再改一下', at: at(11, 1) }, at(11, 1))

    expect(trash.restore(db, 'claude-code:s1')).toBe(true)
    expect(getAgentSession(db, 'claude-code:s1')?.status).toBe('running')
  })

  test('the replies stay on the calendar with their folder, and the folder can still be opened', () => {
    createSessionTrash(() => at(11)).remove(db, 'claude-code:s1')

    const view = dayView(db, '2026-10-28', at(12), DEFAULT_SETTINGS)
    expect(view.timeline.map((e) => [e.kind, e.title, e.cwd])).toEqual([['agent', 'Claude Code · shop', CWD]])
    expect(isKnownWorkFolder(db, CWD)).toBe(true)
    expect(isKnownWorkFolder(db, 'C:\\Windows')).toBe(false)
  })

  test('removing a session that is not there fails', () => {
    expect(() => createSessionTrash().remove(db, 'claude-code:nope')).toThrow()
  })
})
