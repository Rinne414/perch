import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from './connection'
import {
  completeItem,
  createItem,
  deleteItemsBySource,
  getItem,
  listDoneItems,
  listOpenItems,
  reopenItem,
  rolloverPlans,
  updateItem,
} from './items'
import { listEvents } from './events'
import { importLegacyData } from './legacyImport'

const T0 = new Date(2026, 8, 29, 10, 0).getTime()

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('createItem', () => {
  test('stores a trimmed task and logs a created event', () => {
    const item = createItem(db, { kind: 'task', title: '  寫報告 ' }, T0)

    expect(item.title).toBe('寫報告')
    expect(item.source).toBe('user')
    expect(listEvents(db, T0, T0 + 1).map((e) => e.type)).toEqual(['item.created'])
  })

  test('rejects an empty title', () => {
    expect(() => createItem(db, { kind: 'idea', title: '   ' }, T0)).toThrow('empty')
  })

  test('numbers steps under a parent in creation order and does not log them', () => {
    const parent = createItem(db, { kind: 'task', title: '搬家' }, T0)
    const a = createItem(db, { kind: 'task', title: '找紙箱', parentId: parent.id }, T0)
    const b = createItem(db, { kind: 'task', title: '打包書', parentId: parent.id }, T0)

    expect([a.sortOrder, b.sortOrder]).toEqual([0, 1])
    expect(listEvents(db, T0, T0 + 1)).toHaveLength(1)
  })
})

describe('updateItem', () => {
  test('applies only known fields and bumps updatedAt', () => {
    const item = createItem(db, { kind: 'task', title: 'a' }, T0)
    const patch = { title: 'b', dueAt: T0 + 1000, dueHasTime: true, bogus: 1 } as never

    const updated = updateItem(db, item.id, patch, T0 + 5)

    expect(updated).toMatchObject({ title: 'b', dueAt: T0 + 1000, dueHasTime: true, updatedAt: T0 + 5 })
  })

  test('throws for an unknown id', () => {
    expect(() => updateItem(db, 'nope', { title: 'x' }, T0)).toThrow('not found')
  })
})

describe('completeItem / reopenItem', () => {
  test('a finished task keeps its row and records when it was done', () => {
    const item = createItem(db, { kind: 'task', title: '回信' }, T0)

    completeItem(db, item.id, T0 + 60_000)

    expect(getItem(db, item.id)?.doneAt).toBe(T0 + 60_000)
    expect(listOpenItems(db)).toHaveLength(0)
    expect(listDoneItems(db, T0, T0 + 120_000).map((i) => i.id)).toEqual([item.id])
  })

  test('completing twice keeps the first completion time', () => {
    const item = createItem(db, { kind: 'task', title: '回信' }, T0)
    completeItem(db, item.id, T0 + 1)

    expect(completeItem(db, item.id, T0 + 2).doneAt).toBe(T0 + 1)
  })

  test('a routine never closes; it only moves lastDoneAt', () => {
    const item = createItem(db, { kind: 'routine', title: '運動', intervalDays: 3 }, T0)

    const done = completeItem(db, item.id, T0 + 10)

    expect(done.doneAt).toBeNull()
    expect(done.lastDoneAt).toBe(T0 + 10)
    expect(listEvents(db, T0, T0 + 11).map((e) => e.type)).toEqual(['item.created', 'routine.done'])
  })

  test('reopen clears the completion and logs it', () => {
    const item = createItem(db, { kind: 'task', title: 'x' }, T0)
    completeItem(db, item.id, T0 + 1)

    expect(reopenItem(db, item.id, T0 + 2).doneAt).toBeNull()
    expect(listEvents(db, T0, T0 + 3).at(-1)?.type).toBe('item.reopened')
  })
})

describe('rolloverPlans', () => {
  test('moves unfinished past plans to today and counts each postponement', () => {
    const late = createItem(db, { kind: 'task', title: '舊計畫', plannedFor: '2026-09-27' }, T0)
    const done = createItem(db, { kind: 'task', title: '做完了', plannedFor: '2026-09-27' }, T0)
    const future = createItem(db, { kind: 'task', title: '明天', plannedFor: '2026-09-30' }, T0)
    completeItem(db, done.id, T0)

    expect(rolloverPlans(db, '2026-09-29', T0)).toBe(1)
    expect(getItem(db, late.id)).toMatchObject({ plannedFor: '2026-09-29', postponeCount: 1 })
    expect(getItem(db, done.id)?.plannedFor).toBe('2026-09-27')
    expect(getItem(db, future.id)?.plannedFor).toBe('2026-09-30')
  })
})

describe('deleteItemsBySource', () => {
  test('removes only what one writer created', () => {
    createItem(db, { kind: 'task', title: 'mine' }, T0)
    createItem(db, { kind: 'task', title: 'noise', source: 'agent:codex' }, T0)

    expect(deleteItemsBySource(db, 'agent:codex')).toBe(1)
    expect(listOpenItems(db).map((i) => i.title)).toEqual(['mine'])
  })
})

describe('importLegacyData', () => {
  const legacy = JSON.stringify({
    win: { width: 360 },
    items: [
      { id: 'welcome1', text: '雙擊這行字可以直接改內容', p: 0, done: false },
      { id: 'a1', text: '繳電話費', p: 0, done: false },
      { id: 'a2', text: '讀完那本書', p: 2, done: true },
      { id: 'a3', text: '   ', p: 1, done: false },
    ],
  })

  test('imports real rows once, skipping tutorial and blank rows', () => {
    expect(importLegacyData(db, legacy, T0)).toBe(2)
    expect(importLegacyData(db, legacy, T0)).toBe(0)

    const open = listOpenItems(db)
    expect(open.map((i) => [i.title, i.priority, i.source])).toEqual([['繳電話費', 0, 'import:legacy']])
    expect(listDoneItems(db, T0, T0 + 1).map((i) => i.title)).toEqual(['讀完那本書'])
  })
})
