import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, test } from 'vitest'
import { applyAgentEvent } from '../db/agents'
import { openDatabase } from '../db/connection'
import { completeItem, getItem, listOpenItems } from '../db/items'
import { captureOn, dayView, monthMarks } from './calendar'
import { createRoutine, updateRoutine } from './manage'
import { DEFAULT_SETTINGS } from './settings'

const at = (m: number, d: number, h: number, min = 0): number => new Date(2026, m - 1, d, h, min).getTime()
const NOW = at(10, 28, 14)
const RENT = { days: [5], leadDays: 0 }

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('monthly routines', () => {
  test('are stored and come back as written; weekly and monthly at once is refused', () => {
    const rent = createRoutine(db, '繳房租', 30, NOW, null, RENT)
    expect(getItem(db, rent.id)).toMatchObject({ monthly: RENT, intervalDays: null, schedule: null })
    expect(() => createRoutine(db, 'x', null, NOW, { slots: [{ weekday: 1, start: '09:00', end: '10:00' }], remindMinutes: null }, RENT)).toThrow()
  })

  test('an edit can turn one into every N days and back', () => {
    const rent = createRoutine(db, '繳房租', null, NOW, null, RENT)
    updateRoutine(db, rent.id, '繳房租', 30, NOW)
    expect(getItem(db, rent.id)).toMatchObject({ monthly: null, intervalDays: 30 })
    updateRoutine(db, rent.id, '繳房租', null, NOW, null, { days: [1, 15], leadDays: 3 })
    expect(getItem(db, rent.id)).toMatchObject({ monthly: { days: [1, 15], leadDays: 3 }, intervalDays: null, notifiedAt: NOW })
  })

  test('show on their date in the month and on that future day', () => {
    createRoutine(db, '繳房租', null, at(10, 1, 9), null, RENT)

    const marks = monthMarks(db, '2026-11-01', '2026-11-07', DEFAULT_SETTINGS)
    expect(marks.find((m) => m.day === '2026-11-05')?.schedules).toEqual(['繳房租'])
    expect(marks.find((m) => m.day === '2026-11-04')?.schedules).toEqual([])
    expect(dayView(db, '2026-11-05', NOW, DEFAULT_SETTINGS).routinesDue.map((i) => i.title)).toEqual(['繳房租'])
    expect(dayView(db, '2026-11-06', NOW, DEFAULT_SETTINGS).routinesDue).toEqual([])
  })

  test('a completion closes this month', () => {
    const rent = createRoutine(db, '繳房租', null, at(9, 1, 9), null, RENT)
    completeItem(db, rent.id, at(10, 6, 10))
    expect(listOpenItems(db).find((i) => i.id === rent.id)?.lastDoneAt).toBe(at(10, 6, 10))
  })
})

describe('the month shows where agents worked', () => {
  test('folder names per day, busiest first', () => {
    const reply = (sessionId: string, cwd: string, h: number): void => {
      applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId, status: 'running', cwd, at: at(10, 27, h) }, NOW)
      applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId, status: 'done', at: at(10, 27, h, 5) }, NOW)
    }
    reply('a', 'D:\\code\\shop', 10)
    reply('b', 'D:\\code\\notes', 11)
    reply('a', 'D:\\code\\shop', 12)

    const marks = monthMarks(db, '2026-10-27', '2026-10-28', DEFAULT_SETTINGS)
    expect(marks.find((m) => m.day === '2026-10-27')?.projects).toEqual(['shop', 'notes'])
    expect(marks.find((m) => m.day === '2026-10-28')?.projects).toEqual([])
  })

  test('migration 9 gives replies recorded before folders were stored their session folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perch-folders-'))
    const path = join(dir, 'old.db')
    try {
      const old = openDatabase(path)
      applyAgentEvent(old, { v: 1, agent: 'codex', sessionId: 'old', status: 'running', cwd: 'D:\\code\\api', at: at(10, 27, 9) }, NOW)
      applyAgentEvent(old, { v: 1, agent: 'codex', sessionId: 'old', status: 'done', at: at(10, 27, 10) }, NOW)
      applyAgentEvent(old, { v: 1, agent: 'grok', sessionId: 'nowhere', status: 'done', at: at(10, 27, 11) }, NOW)
      old.exec("UPDATE events SET data = json_remove(data, '$.cwd')")
      old.exec('ALTER TABLE items DROP COLUMN monthly')
      old.exec('PRAGMA user_version = 8')
      old.close()

      const upgraded = openDatabase(path)
      const timeline = dayView(upgraded, '2026-10-27', NOW, DEFAULT_SETTINGS).timeline
      upgraded.close()

      expect(timeline.map((e) => e.cwd)).toEqual(['D:\\code\\api', null])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('migration 9 skips a reply whose data is not JSON instead of stopping the app', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perch-badjson-'))
    const path = join(dir, 'old.db')
    try {
      const old = openDatabase(path)
      applyAgentEvent(old, { v: 1, agent: 'codex', sessionId: 'old', status: 'running', cwd: 'D:\\code\\api', at: at(10, 27, 9) }, NOW)
      applyAgentEvent(old, { v: 1, agent: 'codex', sessionId: 'old', status: 'done', at: at(10, 27, 10) }, NOW)
      old.exec("UPDATE events SET data = '{broken'")
      old.exec('ALTER TABLE items DROP COLUMN monthly')
      old.exec('PRAGMA user_version = 8')
      old.close()

      expect(() => openDatabase(path).close()).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('monthly marks start when the routine does', () => {
  test('no mark on a date before it was made', () => {
    createRoutine(db, '繳房租', null, at(10, 10, 9), null, RENT)
    const marks = monthMarks(db, '2026-10-01', '2026-11-30', DEFAULT_SETTINGS)
    expect(marks.filter((m) => m.schedules.length > 0).map((m) => m.day)).toEqual(['2026-11-05'])
  })
})

describe('captureOn with a deadline', () => {
  test('without a time: due that day, the whole line kept', () => {
    captureOn(db, '交報告', '2026-11-03', NOW, DEFAULT_SETTINGS, true)
    const [task] = listOpenItems(db)
    expect(task).toMatchObject({ title: '交報告', dueAt: at(11, 3, 12), dueHasTime: false, plannedFor: null })
  })

  test('with a time: due that day at that time', () => {
    captureOn(db, '下午3點 交報告', '2026-11-03', NOW, DEFAULT_SETTINGS, true)
    const [task] = listOpenItems(db)
    expect(task).toMatchObject({ title: '交報告', dueAt: at(11, 3, 15), dueHasTime: true })
  })

  test('a time before the day starts is the late night of that day', () => {
    captureOn(db, '凌晨1點 交報告', '2026-11-03', NOW, DEFAULT_SETTINGS, true)
    const [task] = listOpenItems(db)
    expect(task).toMatchObject({ title: '交報告', dueAt: at(11, 4, 1), dueHasTime: true })
  })

  test('without the switch the day is only planned, as before', () => {
    captureOn(db, '交報告', '2026-11-03', NOW, DEFAULT_SETTINGS)
    expect(listOpenItems(db)[0]).toMatchObject({ plannedFor: '2026-11-03', dueAt: null })
  })
})
