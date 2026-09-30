import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../db/connection'
import { createItem } from '../db/items'
import { getMainPayload, createRoutine } from './manage'
import { getNowPayload } from './now'
import { scheduleAlerts } from './scheduleAlerts'
import { DEFAULT_SETTINGS } from './settings'

const at = (m: number, d: number, h: number, min = 0): number => new Date(2026, m - 1, d, h, min).getTime()
const WORK = {
  slots: [
    { weekday: 3, start: '16:00', end: '19:00' },
    { weekday: 4, start: '18:30', end: '21:30' },
  ],
  remindMinutes: 30,
}

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('fixed-time routines', () => {
  test('are stored with their schedule and no interval', () => {
    const work = createRoutine(db, '上班', 7, at(9, 1, 9), WORK)
    expect(work).toMatchObject({ kind: 'routine', intervalDays: null, schedule: WORK })
  })

  test('today shows the slots still ahead in the float and all of them in the main window', () => {
    createRoutine(db, '上班', null, at(9, 1, 9), WORK)
    createItem(db, { kind: 'task', title: 'x' }, at(9, 1, 9))

    expect(getNowPayload(db, at(9, 30, 15), DEFAULT_SETTINGS, true).view.schedule.map((o) => o.startAt)).toEqual([at(9, 30, 16)])
    expect(getNowPayload(db, at(9, 30, 20), DEFAULT_SETTINGS, true).view.schedule).toEqual([])
    expect(getMainPayload(db, at(9, 30, 20), DEFAULT_SETTINGS).view.schedule.map((o) => o.endAt)).toEqual([at(9, 30, 19)])
  })
})

describe('scheduleAlerts', () => {
  test('announces each slot once, even across restarts', () => {
    createRoutine(db, '上班', null, at(9, 1, 9), WORK)

    const first = scheduleAlerts(db, at(9, 30, 15, 35))
    expect(first).toEqual([{ title: '上班 16:00 開始', body: '還有 25 分鐘 · 到 19:00' }])
    expect(scheduleAlerts(db, at(9, 30, 15, 40))).toEqual([])

    expect(scheduleAlerts(db, at(10, 1, 18, 5))).toEqual([{ title: '上班 18:30 開始', body: '還有 25 分鐘 · 到 21:30' }])
  })

  test('stays quiet outside the window and for routines without reminders', () => {
    createRoutine(db, '上班', null, at(9, 1, 9), { ...WORK, remindMinutes: null })
    expect(scheduleAlerts(db, at(9, 30, 15, 50))).toEqual([])
  })
})
