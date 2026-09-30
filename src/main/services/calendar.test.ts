import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { applyAgentEvent } from '../db/agents'
import { openDatabase } from '../db/connection'
import { completeItem, createItem, getItem } from '../db/items'
import { addManualEntry, captureOn, dayView, monthMarks, removeManualEntry } from './calendar'
import { createFocus } from './focus'
import { addStep, createRoutine } from './manage'
import { DEFAULT_SETTINGS } from './settings'

const at = (m: number, d: number, h: number, min = 0): number => new Date(2026, m - 1, d, h, min).getTime()
const NOW = at(9, 30, 10)
const WORK = { slots: [{ weekday: 4, start: '18:30', end: '21:30' }], remindMinutes: 30 }

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('monthMarks', () => {
  test('marks finished work, fixed-time routines and open deadlines per day', () => {
    const report = createItem(db, { kind: 'task', title: '寫週報' }, at(9, 27, 9))
    completeItem(db, report.id, at(9, 28, 11))
    const step = addStep(db, report.id, '寄出', at(9, 27, 9))
    completeItem(db, step.id, at(9, 28, 12))
    createRoutine(db, '上班', null, at(9, 1, 9), WORK)
    createItem(db, { kind: 'task', title: '交季報', dueAt: at(10, 2, 17), dueHasTime: true }, at(9, 20, 9))

    const marks = monthMarks(db, '2026-09-28', '2026-10-02', DEFAULT_SETTINGS)

    expect(marks.find((m) => m.day === '2026-09-28')).toMatchObject({ done: 1, schedules: [], dues: [] })
    expect(marks.find((m) => m.day === '2026-10-01')?.schedules).toEqual(['上班'])
    expect(marks.find((m) => m.day === '2026-10-02')?.dues).toEqual(['交季報'])
    expect(marks).toHaveLength(5)
  })
})

describe('dayView', () => {
  test('a past day tells what happened and sums it up', () => {
    const task = createItem(db, { kind: 'task', title: '修好登入頁' }, at(9, 27, 9))
    completeItem(db, task.id, at(9, 28, 9, 40))
    const gym = createRoutine(db, '運動', 3, at(9, 1, 9))
    completeItem(db, gym.id, at(9, 28, 14, 20))
    applyAgentEvent(db, { v: 1, agent: 'codex', sessionId: 's', status: 'done', cwd: 'C:\\code\\api', title: '加上分頁', at: at(9, 28, 11) }, NOW)
    const focus = createFocus()
    const later = createItem(db, { kind: 'task', title: '寫週報' }, at(9, 27, 9))
    focus.start(db, later.id, null, at(9, 28, 15))
    focus.stop(db, at(9, 28, 15, 12))

    const view = dayView(db, '2026-09-28', NOW, DEFAULT_SETTINGS)

    expect(view.relation).toBe('past')
    expect(view.summary).toEqual({ done: 1, routines: 1, agents: 1, focusMinutes: 12 })
    expect(view.timeline.map((e) => [e.kind, e.title])).toEqual([
      ['done', '修好登入頁'],
      ['agent', 'Codex · api'],
      ['routine', '運動'],
      ['focus', '寫週報'],
    ])
    expect(view.timeline.find((e) => e.kind === 'agent')?.detail).toBe('加上分頁')
  })

  test('a future day lists what is planned, due, scheduled and expected', () => {
    createItem(db, { kind: 'task', title: '預約牙醫', plannedFor: '2026-10-01' }, NOW)
    createItem(db, { kind: 'task', title: '交季報', dueAt: at(10, 1, 17), dueHasTime: true }, NOW)
    createRoutine(db, '上班', null, at(9, 1, 9), WORK)
    const gym = createRoutine(db, '運動', 3, at(9, 1, 9))
    completeItem(db, gym.id, at(9, 28, 20))

    const view = dayView(db, '2026-10-01', NOW, DEFAULT_SETTINGS)

    expect(view.relation).toBe('future')
    expect(view.planned.map((i) => i.title)).toEqual(['預約牙醫'])
    expect(view.dues.map((i) => i.title)).toEqual(['交季報'])
    expect(view.schedule.map((o) => o.item.title)).toEqual(['上班'])
    expect(view.routinesDue.map((i) => i.title)).toEqual(['運動'])
  })
})

describe('manual entries', () => {
  test('are placed at the time written, on that day, and can be taken back', () => {
    addManualEntry(db, '2026-09-28', '下午3點 跟客戶開會', NOW, DEFAULT_SETTINGS)
    addManualEntry(db, '2026-09-28', '整理照片', NOW, DEFAULT_SETTINGS)

    const entries = dayView(db, '2026-09-28', NOW, DEFAULT_SETTINGS).timeline
    expect(entries.map((e) => [e.title, e.hasTime, e.at])).toEqual([
      ['整理照片', false, at(9, 28, 12)],
      ['跟客戶開會', true, at(9, 28, 15)],
    ])

    removeManualEntry(db, entries[0].id)
    expect(dayView(db, '2026-09-28', NOW, DEFAULT_SETTINGS).timeline).toHaveLength(1)
  })

  test('cannot be written for the future', () => {
    expect(() => addManualEntry(db, '2026-10-01', '開會', NOW, DEFAULT_SETTINGS)).toThrow('future')
    expect(() => addManualEntry(db, '2026-09-30', '晚上8點 開會', NOW, DEFAULT_SETTINGS)).toThrow('future')
  })

  test('only manual entries can be removed this way', () => {
    const task = createItem(db, { kind: 'task', title: 'x' }, at(9, 27, 9))
    completeItem(db, task.id, at(9, 28, 9))
    const done = dayView(db, '2026-09-28', NOW, DEFAULT_SETTINGS).timeline[0]
    expect(() => removeManualEntry(db, done.id)).toThrow('manual')
  })
})

describe('captureOn', () => {
  test('a line without a date is planned for the chosen day; a dated line keeps its date', () => {
    const plain = captureOn(db, '買禮物', '2026-10-03', NOW, DEFAULT_SETTINGS)
    const dated = captureOn(db, '10/5 繳費', '2026-10-03', NOW, DEFAULT_SETTINGS)

    expect(getItem(db, plain.id)).toMatchObject({ kind: 'task', plannedFor: '2026-10-03', dueAt: null })
    expect(new Date(dated.dueAt!).getDate()).toBe(5)
  })
})
