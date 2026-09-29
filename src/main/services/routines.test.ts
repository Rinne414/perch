import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../db/connection'
import { completeItem, getItem } from '../db/items'
import { createRoutine } from './manage'
import { averageInterval, recordRoutine, removeRoutineRecord, routineHistory } from './routines'

const DAY = 86_400_000
const at = (d: number, h = 12): number => new Date(2026, 8, d, h).getTime()
const NOW = at(30, 10)

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('averageInterval', () => {
  test('needs three records before it says anything', () => {
    expect(averageInterval([at(20), at(10)])).toBeNull()
    expect(averageInterval([at(28), at(20), at(10)])).toBe(9)
  })
})

describe('routine history', () => {
  test('lists every time it was done, newest first, back-filled ones included', () => {
    const r = createRoutine(db, '換牙刷', null, at(1))
    completeItem(db, r.id, at(20))
    recordRoutine(db, r.id, at(5), NOW)

    const history = routineHistory(db, r.id)

    expect(history.records.map((x) => [x.at, x.backfilled])).toEqual([
      [at(20), false],
      [at(5), true],
    ])
    expect(getItem(db, r.id)?.lastDoneAt).toBe(at(20))
  })

  test('back-filling a later time than the last one moves "last done" forward', () => {
    const r = createRoutine(db, '運動', 3, at(1))
    completeItem(db, r.id, at(20))

    recordRoutine(db, r.id, at(29), NOW)

    expect(getItem(db, r.id)?.lastDoneAt).toBe(at(29))
  })

  test('refuses a time in the future', () => {
    const r = createRoutine(db, '運動', 3, at(1))
    expect(() => recordRoutine(db, r.id, NOW + DAY, NOW)).toThrow('future')
  })

  test('removing a wrong record falls back to the previous one', () => {
    const r = createRoutine(db, '運動', 3, at(1))
    completeItem(db, r.id, at(20))
    completeItem(db, r.id, at(25))
    const latest = routineHistory(db, r.id).records[0]

    removeRoutineRecord(db, latest.id, NOW)

    expect(getItem(db, r.id)?.lastDoneAt).toBe(at(20))
    expect(routineHistory(db, r.id).records).toHaveLength(1)
  })

  test('removing the only record leaves the routine never done', () => {
    const r = createRoutine(db, '運動', 3, at(1))
    completeItem(db, r.id, at(20))

    removeRoutineRecord(db, routineHistory(db, r.id).records[0].id, NOW)

    expect(getItem(db, r.id)?.lastDoneAt).toBeNull()
  })
})
