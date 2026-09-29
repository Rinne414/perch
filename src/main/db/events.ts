import type { DatabaseSync } from 'node:sqlite'
import type { TimelineEvent, TimelineEventType } from '@shared/types'

export interface NewEvent {
  readonly at: number
  readonly type: TimelineEventType
  readonly title: string
  readonly itemId?: string | null
  readonly agentSessionId?: string | null
  readonly source: string
  readonly data?: Record<string, unknown> | null
}

interface EventRow {
  id: number
  at: number
  type: string
  title: string
  item_id: string | null
  agent_session_id: string | null
  source: string
  data: string | null
}

const toEvent = (r: EventRow): TimelineEvent => ({
  id: r.id,
  at: r.at,
  type: r.type as TimelineEventType,
  title: r.title,
  itemId: r.item_id,
  agentSessionId: r.agent_session_id,
  source: r.source,
  data: r.data ? (JSON.parse(r.data) as Record<string, unknown>) : null,
})

export function appendEvent(db: DatabaseSync, e: NewEvent): TimelineEvent {
  const data = e.data ? JSON.stringify(e.data) : null
  const result = db
    .prepare(
      `INSERT INTO events (at, type, title, item_id, agent_session_id, source, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(e.at, e.type, e.title, e.itemId ?? null, e.agentSessionId ?? null, e.source, data)
  return toEvent({
    id: Number(result.lastInsertRowid),
    at: e.at,
    type: e.type,
    title: e.title,
    item_id: e.itemId ?? null,
    agent_session_id: e.agentSessionId ?? null,
    source: e.source,
    data,
  })
}

/** Events in [from, to), oldest first. */
export function listEvents(db: DatabaseSync, from: number, to: number): TimelineEvent[] {
  const rows = db
    .prepare('SELECT * FROM events WHERE at >= ? AND at < ? ORDER BY at, id')
    .all(from, to) as unknown as EventRow[]
  return rows.map(toEvent)
}

export function deleteEvent(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM events WHERE id = ?').run(id)
}

export function deleteEventsBySource(db: DatabaseSync, source: string): number {
  return Number(db.prepare('DELETE FROM events WHERE source = ?').run(source).changes)
}

export function getEvent(db: DatabaseSync, id: number): TimelineEvent | null {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined
  return row ? toEvent(row) : null
}

/** One item's events of one type, newest first. */
export function listItemEvents(db: DatabaseSync, itemId: string, type: TimelineEventType, limit: number): TimelineEvent[] {
  const rows = db
    .prepare('SELECT * FROM events WHERE item_id = ? AND type = ? ORDER BY at DESC, id DESC LIMIT ?')
    .all(itemId, type, limit) as unknown as EventRow[]
  return rows.map(toEvent)
}
