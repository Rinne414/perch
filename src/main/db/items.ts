import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { Item, ItemKind, ItemPatch, NewItem, Priority, RoutineSchedule } from '@shared/types'
import { appendEvent } from './events'
import { transaction } from './transaction'

interface ItemRow {
  id: string
  kind: string
  title: string
  notes: string | null
  parent_id: string | null
  sort_order: number
  priority: number | null
  created_at: number
  updated_at: number
  due_at: number | null
  due_has_time: number
  planned_for: string | null
  done_at: number | null
  dropped_at: number | null
  postpone_count: number
  interval_days: number | null
  last_done_at: number | null
  notified_at: number | null
  source: string
  schedule: string | null
}

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  kind: r.kind as ItemKind,
  title: r.title,
  notes: r.notes,
  parentId: r.parent_id,
  sortOrder: r.sort_order,
  priority: r.priority as Priority | null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  dueAt: r.due_at,
  dueHasTime: r.due_has_time === 1,
  plannedFor: r.planned_for,
  doneAt: r.done_at,
  droppedAt: r.dropped_at,
  postponeCount: r.postpone_count,
  intervalDays: r.interval_days,
  lastDoneAt: r.last_done_at,
  notifiedAt: r.notified_at,
  source: r.source,
  schedule: r.schedule ? (JSON.parse(r.schedule) as RoutineSchedule) : null,
})

/** Patchable fields and their columns. Only these names ever reach SQL. */
const PATCH_COLUMNS: Record<keyof ItemPatch, string> = {
  title: 'title',
  notes: 'notes',
  priority: 'priority',
  dueAt: 'due_at',
  dueHasTime: 'due_has_time',
  plannedFor: 'planned_for',
  intervalDays: 'interval_days',
  schedule: 'schedule',
  sortOrder: 'sort_order',
  kind: 'kind',
  notifiedAt: 'notified_at',
}

const toSql = (v: unknown): SQLInputValue => {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'object' && v !== null) return JSON.stringify(v)
  return (v ?? null) as SQLInputValue
}

export function getItem(db: DatabaseSync, id: string): Item | null {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined
  return row ? toItem(row) : null
}

function requireItem(db: DatabaseSync, id: string): Item {
  const item = getItem(db, id)
  if (!item) throw new Error(`Item not found: ${id}`)
  return item
}

export function createItem(db: DatabaseSync, input: NewItem, now: number): Item {
  const title = input.title.trim()
  if (!title) throw new Error('Item title is empty')
  const id = randomUUID()
  const parentId = input.parentId ?? null
  const source = input.source ?? 'user'
  return transaction(db, () => {
    const order = parentId
      ? (db
          .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM items WHERE parent_id = ?')
          .get(parentId) as { n: number }).n
      : 0
    db.prepare(
      `INSERT INTO items (id, kind, title, notes, parent_id, sort_order, priority, created_at,
         updated_at, due_at, due_has_time, planned_for, interval_days, last_done_at, source, schedule)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.kind,
      title,
      input.notes ?? null,
      parentId,
      order,
      input.priority ?? null,
      now,
      now,
      input.dueAt ?? null,
      input.dueHasTime ? 1 : 0,
      input.plannedFor ?? null,
      input.intervalDays ?? null,
      input.lastDoneAt ?? null,
      source,
      input.schedule ? JSON.stringify(input.schedule) : null,
    )
    if (!parentId) {
      appendEvent(db, { at: now, type: 'item.created', title, itemId: id, source })
    }
    return requireItem(db, id)
  })
}

export function updateItem(db: DatabaseSync, id: string, patch: ItemPatch, now: number): Item {
  const keys = (Object.keys(patch) as (keyof ItemPatch)[]).filter((k) => k in PATCH_COLUMNS)
  if (keys.length === 0) return requireItem(db, id)
  if (patch.title !== undefined && !patch.title.trim()) throw new Error('Item title is empty')
  const sets = keys.map((k) => `${PATCH_COLUMNS[k]} = ?`).join(', ')
  const values = keys.map((k) => toSql(k === 'title' ? patch.title?.trim() : patch[k]))
  const result = db
    .prepare(`UPDATE items SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...values, now, id)
  if (result.changes === 0) throw new Error(`Item not found: ${id}`)
  return requireItem(db, id)
}

/** Tasks and ideas get a completion time; routines only move their "last done" forward. */
export function completeItem(db: DatabaseSync, id: string, now: number): Item {
  return transaction(db, () => {
    const item = requireItem(db, id)
    if (item.kind === 'routine') {
      db.prepare('UPDATE items SET last_done_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
      appendEvent(db, { at: now, type: 'routine.done', title: item.title, itemId: id, source: 'user' })
      return requireItem(db, id)
    }
    if (item.doneAt !== null) return item
    db.prepare('UPDATE items SET done_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    const parent = item.parentId ? getItem(db, item.parentId) : null
    appendEvent(db, {
      at: now,
      type: 'item.done',
      title: item.title,
      itemId: id,
      source: 'user',
      data: parent ? { stepOf: parent.title } : null,
    })
    return requireItem(db, id)
  })
}

export function reopenItem(db: DatabaseSync, id: string, now: number): Item {
  return transaction(db, () => {
    const item = requireItem(db, id)
    if (item.doneAt === null) return item
    db.prepare('UPDATE items SET done_at = NULL, dropped_at = NULL, updated_at = ? WHERE id = ?').run(now, id)
    appendEvent(db, { at: now, type: 'item.reopened', title: item.title, itemId: id, source: 'user' })
    return requireItem(db, id)
  })
}

/** "不做了": closes an open task or idea without counting it as done. It stays in history and can be reopened. */
export function dropItem(db: DatabaseSync, id: string, now: number): Item {
  return transaction(db, () => {
    const item = requireItem(db, id)
    if (item.kind === 'routine') throw new Error('A routine cannot be dropped; delete it instead')
    if (item.doneAt !== null) return item
    db.prepare('UPDATE items SET done_at = ?, dropped_at = ?, updated_at = ? WHERE id = ?').run(now, now, now, id)
    appendEvent(db, { at: now, type: 'item.dropped', title: item.title, itemId: id, source: 'user' })
    return requireItem(db, id)
  })
}

export function deleteItem(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM items WHERE id = ?').run(id)
}

/** Raw rows of an item and its steps, so a deletion can be undone exactly. */
export type ItemSnapshot = readonly Readonly<ItemRow>[]

const COLUMNS = [
  'id', 'kind', 'title', 'notes', 'parent_id', 'sort_order', 'priority', 'created_at', 'updated_at', 'due_at',
  'due_has_time', 'planned_for', 'done_at', 'dropped_at', 'postpone_count', 'interval_days', 'last_done_at', 'notified_at', 'source', 'schedule',
] as const satisfies readonly (keyof ItemRow)[]

/** Deletes an item with its steps and returns what was removed. */
export function takeItem(db: DatabaseSync, id: string): ItemSnapshot {
  return transaction(db, () => {
    const rows = db
      .prepare('SELECT * FROM items WHERE id = ? OR parent_id = ? ORDER BY parent_id IS NOT NULL, sort_order')
      .all(id, id) as unknown as ItemRow[]
    if (rows.length === 0) throw new Error(`Item not found: ${id}`)
    deleteItem(db, id)
    return rows
  })
}

/** Puts back rows returned by takeItem, parent first. */
export function restoreItem(db: DatabaseSync, snapshot: ItemSnapshot): void {
  const insert = db.prepare(
    `INSERT INTO items (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
  )
  transaction(db, () => snapshot.forEach((row) => insert.run(...COLUMNS.map((c) => row[c]))))
}

/** Removes everything one writer created, e.g. after an agent filled the list with noise. */
export function deleteItemsBySource(db: DatabaseSync, source: string): number {
  return Number(db.prepare('DELETE FROM items WHERE source = ?').run(source).changes)
}

/** Every item, finished or not, oldest first. */
export function listAllItems(db: DatabaseSync): Item[] {
  const rows = db.prepare('SELECT * FROM items ORDER BY created_at, sort_order').all() as unknown as ItemRow[]
  return rows.map(toItem)
}

/** Open tasks, ideas and steps, plus every routine. */
export function listOpenItems(db: DatabaseSync): Item[] {
  const rows = db
    .prepare('SELECT * FROM items WHERE done_at IS NULL ORDER BY sort_order, created_at')
    .all() as unknown as ItemRow[]
  return rows.map(toItem)
}

/** Steps (open and done) of every unfinished item, in their order. */
export function listStepsOfOpenItems(db: DatabaseSync): Item[] {
  const rows = db
    .prepare(
      `SELECT s.* FROM items s JOIN items p ON p.id = s.parent_id
       WHERE p.done_at IS NULL ORDER BY s.sort_order, s.created_at`,
    )
    .all() as unknown as ItemRow[]
  return rows.map(toItem)
}

/** Items finished in [from, to), oldest first. */
export function listDoneItems(db: DatabaseSync, from: number, to: number): Item[] {
  const rows = db
    .prepare('SELECT * FROM items WHERE done_at >= ? AND done_at < ? ORDER BY done_at')
    .all(from, to) as unknown as ItemRow[]
  return rows.map(toItem)
}

/**
 * Moves unfinished plans from earlier days onto `today` and counts the postponement.
 * Returns how many items moved.
 */
export function rolloverPlans(db: DatabaseSync, today: string, now: number): number {
  const result = db
    .prepare(
      `UPDATE items
       SET planned_for = ?, postpone_count = postpone_count + 1, updated_at = ?
       WHERE planned_for < ? AND done_at IS NULL AND kind != 'routine'`,
    )
    .run(today, now, today)
  return Number(result.changes)
}
