import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../db/connection'
import { listEvents } from '../db/events'
import { completeItem, createItem } from '../db/items'
import { createFocus } from './focus'

const MIN = 60_000
const NOW = new Date(2026, 8, 30, 10, 0).getTime()

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('focus ("先做 5 分鐘")', () => {
  test('starts on the next step and logs how long it ran when stopped', () => {
    const focus = createFocus()
    const task = createItem(db, { kind: 'task', title: '寫週報' }, NOW)
    const step = createItem(db, { kind: 'task', title: '列出做完的事', parentId: task.id }, NOW)

    expect(focus.start(db, task.id, step.id, NOW)).toMatchObject({ itemId: task.id, stepId: step.id, title: '列出做完的事' })
    expect(focus.stop(db, NOW + 7 * MIN)).toBe(7)

    expect(focus.current(db)).toBeNull()
    const logged = listEvents(db, NOW, NOW + 8 * MIN).filter((e) => e.type === 'focus')
    expect(logged).toEqual([
      expect.objectContaining({ at: NOW, title: '列出做完的事', itemId: task.id, data: { minutes: 7, stepId: step.id } }),
    ])
  })

  test('only one runs at a time: starting another ends the first', () => {
    const focus = createFocus()
    const a = createItem(db, { kind: 'task', title: 'a' }, NOW)
    const b = createItem(db, { kind: 'task', title: 'b' }, NOW)

    focus.start(db, a.id, null, NOW)
    focus.start(db, b.id, null, NOW + 3 * MIN)

    expect(focus.current(db)?.itemId).toBe(b.id)
    expect(listEvents(db, NOW, NOW + 4 * MIN).filter((e) => e.type === 'focus').map((e) => e.title)).toEqual(['a'])
  })

  test('a slip of the finger (under a minute) leaves no record', () => {
    const focus = createFocus()
    const a = createItem(db, { kind: 'task', title: 'a' }, NOW)

    focus.start(db, a.id, null, NOW)

    expect(focus.stop(db, NOW + 20_000)).toBe(0)
    expect(listEvents(db, NOW, NOW + MIN).filter((e) => e.type === 'focus')).toEqual([])
  })

  test('finishing the task elsewhere ends the timer', () => {
    const focus = createFocus()
    const a = createItem(db, { kind: 'task', title: 'a' }, NOW)
    focus.start(db, a.id, null, NOW)

    completeItem(db, a.id, NOW + MIN)

    expect(focus.current(db)).toBeNull()
  })

  test('"繼續" after five minutes only hides the question', () => {
    const focus = createFocus()
    const a = createItem(db, { kind: 'task', title: 'a' }, NOW)
    focus.start(db, a.id, null, NOW)

    expect(focus.extend()).toMatchObject({ extended: true, startedAt: NOW })
  })
})
