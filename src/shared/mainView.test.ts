import { describe, expect, test } from 'vitest'
import { bucketOf, firstDayOf, routineState } from './lists'
import { buildMainView } from './mainView'
import type { Item } from './types'

const DAY = 86_400_000
const NOW = new Date(2026, 8, 30, 10, 0).getTime()
const SETTINGS = { dayStartHour: 4, staleDays: 14 }

let seq = 0
function item(over: Partial<Item>): Item {
  seq++
  return {
    id: `i${seq}`,
    kind: 'task',
    title: `item ${seq}`,
    notes: null,
    parentId: null,
    sortOrder: 0,
    priority: null,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    dueAt: null,
    dueHasTime: false,
    plannedFor: null,
    doneAt: null,
    droppedAt: null,
    postponeCount: 0,
    intervalDays: null,
    lastDoneAt: null,
    notifiedAt: null,
    source: 'user',
    ...over,
  }
}

describe('bucketOf', () => {
  const day = '2026-09-30'

  test('due or planned on or before today is today', () => {
    expect(bucketOf(item({ dueAt: NOW - 3 * DAY }), day, SETTINGS)).toBe('today')
    expect(bucketOf(item({ plannedFor: '2026-09-30' }), day, SETTINGS)).toBe('today')
    expect(bucketOf(item({ plannedFor: '2026-10-05', dueAt: NOW }), day, SETTINGS)).toBe('today')
  })

  test('a date in the future is upcoming', () => {
    expect(bucketOf(item({ dueAt: NOW + 2 * DAY }), day, SETTINGS)).toBe('upcoming')
    expect(bucketOf(item({ plannedFor: '2026-10-01' }), day, SETTINGS)).toBe('upcoming')
  })

  test('undated work is inbox until it sits untouched for staleDays', () => {
    expect(bucketOf(item({ updatedAt: NOW - 13 * DAY }), day, SETTINGS)).toBe('inbox')
    expect(bucketOf(item({ updatedAt: NOW - 14 * DAY }), day, SETTINGS)).toBe('old')
  })
})

describe('firstDayOf', () => {
  test('takes the earlier of the planned day and the due day', () => {
    const both = item({ plannedFor: '2026-10-03', dueAt: new Date(2026, 9, 2, 17).getTime() })
    expect(firstDayOf(both, 4)).toBe('2026-10-02')
    expect(firstDayOf(item({ plannedFor: '2026-10-01' }), 4)).toBe('2026-10-01')
    expect(firstDayOf(item({}), 4)).toBeNull()
  })
})

describe('routineState', () => {
  test('counts from the last completion, or from creation when never done', () => {
    const done = routineState(item({ kind: 'routine', intervalDays: 3, lastDoneAt: NOW - 5 * DAY }), '2026-09-30', 4)
    const never = routineState(item({ kind: 'routine', intervalDays: 7, createdAt: NOW - 2 * DAY }), '2026-09-30', 4)

    expect(done).toMatchObject({ daysSince: 5, dueIn: -2, isDue: true })
    expect(never).toMatchObject({ daysSince: null, dueIn: 5, isDue: false })
  })

  test('a tracker without an interval only counts days and is never due', () => {
    const tracker = routineState(item({ kind: 'routine', intervalDays: null, lastDoneAt: NOW - 90 * DAY }), '2026-09-30', 4)

    expect(tracker).toMatchObject({ daysSince: 90, dueIn: null, isDue: false })
  })
})

describe('buildMainView', () => {
  test('sorts open work into today, upcoming, inbox and old', () => {
    const today = item({ title: 'today', plannedFor: '2026-09-30' })
    const later = item({ title: 'later', dueAt: new Date(2026, 9, 5, 9).getTime() })
    const soon = item({ title: 'soon', plannedFor: '2026-10-01' })
    const fresh = item({ title: 'fresh', kind: 'idea', createdAt: NOW - 1000, updatedAt: NOW - 1000 })
    const older = item({ title: 'older', kind: 'idea', createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY })
    const stale = item({ title: 'stale', updatedAt: NOW - 30 * DAY })

    const view = buildMainView([later, today, fresh, stale, soon, older], [], [], NOW, SETTINGS)

    expect(view.day).toBe('2026-09-30')
    expect(view.today.map((e) => e.item.title)).toEqual(['today'])
    expect(view.upcoming.map((e) => [e.item.title, e.day])).toEqual([
      ['soon', '2026-10-01'],
      ['later', '2026-10-05'],
    ])
    expect(view.inbox.map((i) => i.title)).toEqual(['fresh', 'older'])
    expect(view.old.map((i) => i.title)).toEqual(['stale'])
  })

  test('groups steps under their parent and gives upcoming work its next step', () => {
    const parent = item({ title: 'trip', plannedFor: '2026-10-02' })
    const done = item({ parentId: parent.id, sortOrder: 0, doneAt: NOW - 1, title: 'book' })
    const open = item({ parentId: parent.id, sortOrder: 1, title: 'pack' })

    const view = buildMainView([parent, open], [done, open], [], NOW, SETTINGS)

    expect(view.steps[parent.id].map((s) => s.title)).toEqual(['book', 'pack'])
    expect(view.upcoming[0].nextStep?.title).toBe('pack')
    expect(view.inbox).toEqual([])
  })

  test('lists every routine, due ones first by how late they are for their interval', () => {
    const weekly = item({ title: 'weekly', kind: 'routine', intervalDays: 7, lastDoneAt: NOW - 12 * DAY })
    const daily = item({ title: 'daily', kind: 'routine', intervalDays: 1, lastDoneAt: NOW - 3 * DAY })
    const fine = item({ title: 'fine', kind: 'routine', intervalDays: 7, lastDoneAt: NOW - 1 * DAY })
    const soon = item({ title: 'soon', kind: 'routine', intervalDays: 3, lastDoneAt: NOW - 2 * DAY })

    const view = buildMainView([fine, weekly, soon, daily], [], [], NOW, SETTINGS)

    const toothbrush = item({ title: 'toothbrush', kind: 'routine', intervalDays: null, lastDoneAt: NOW - 80 * DAY })
    const view2 = buildMainView([fine, toothbrush, weekly, soon, daily], [], [], NOW, SETTINGS)

    expect(view.routines.map((r) => [r.item.title, r.dueIn])).toEqual([
      ['daily', -2],
      ['weekly', -5],
      ['soon', 1],
      ['fine', 6],
    ])
    expect(view2.routines.at(-1)?.item.title).toBe('toothbrush')
  })

  test('done today lists finished top-level work, latest first', () => {
    const a = item({ title: 'a', doneAt: NOW - 3000 })
    const b = item({ title: 'b', doneAt: NOW - 1000 })
    const step = item({ title: 'step', parentId: a.id, doneAt: NOW - 500 })

    expect(buildMainView([], [], [a, step, b], NOW, SETTINGS).doneToday.map((i) => i.title)).toEqual(['b', 'a'])
  })
})
