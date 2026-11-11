import type { DatabaseSync } from 'node:sqlite'
import type { TodoMarks } from '@shared/todos'

/** A tick's raw row, carried by the delete-undo snapshot and the export. */
export interface TodoMarkRow {
  readonly agent_session_id: string
  readonly key: string
  readonly marked_at: number
}

/** A tick as the export writes it. */
export interface AgentTodoMark {
  readonly agentSessionId: string
  readonly key: string
  readonly markedAt: number
}

/** SQLite allows at least 999 bound values per statement; longer lists are read in several queries. */
const IDS_PER_QUERY = 500

/** The ticked points of the given sessions, by session. */
export function todoMarksOf(db: DatabaseSync, ids: readonly string[]): TodoMarks {
  const marks = new Map<string, Set<string>>()
  for (let from = 0; from < ids.length; from += IDS_PER_QUERY) {
    const chunk = ids.slice(from, from + IDS_PER_QUERY)
    const rows = db
      .prepare(`SELECT agent_session_id, key FROM agent_todo_marks WHERE agent_session_id IN (${chunk.map(() => '?').join(', ')})`)
      .all(...chunk) as unknown as Pick<TodoMarkRow, 'agent_session_id' | 'key'>[]
    for (const r of rows) marks.set(r.agent_session_id, (marks.get(r.agent_session_id) ?? new Set()).add(r.key))
  }
  return marks
}

/** Ticks one session may hold: far more than any report lists, so only a runaway caller meets it. */
export const MAX_MARKS_PER_SESSION = 2000

/**
 * Ticks a point off. Ticking it again keeps the first time; a session that is gone is an error, and
 * so is a new tick past MAX_MARKS_PER_SESSION (refused, never by dropping an older one).
 */
export function markTodo(db: DatabaseSync, agentSessionId: string, key: string, at: number): void {
  const exists = db.prepare('SELECT 1 FROM agent_todo_marks WHERE agent_session_id = ? AND key = ?').get(agentSessionId, key)
  if (exists) return
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM agent_todo_marks WHERE agent_session_id = ?').get(agentSessionId) as { n: number }
  if (Number(n) >= MAX_MARKS_PER_SESSION) throw new Error('Too many ticked points for one session')
  db.prepare('INSERT INTO agent_todo_marks (agent_session_id, key, marked_at) VALUES (?, ?, ?)').run(agentSessionId, key, at)
}

/** Takes a tick back (復原). */
export function unmarkTodo(db: DatabaseSync, agentSessionId: string, key: string): void {
  db.prepare('DELETE FROM agent_todo_marks WHERE agent_session_id = ? AND key = ?').run(agentSessionId, key)
}

/** The raw ticks of one session (called before the session is deleted). */
export const todoMarkRowsOf = (db: DatabaseSync, agentSessionId: string): TodoMarkRow[] =>
  db
    .prepare('SELECT agent_session_id, key, marked_at FROM agent_todo_marks WHERE agent_session_id = ? ORDER BY key')
    .all(agentSessionId) as unknown as TodoMarkRow[]

/** Puts ticks back; the session must exist. A tick already there is left alone. */
export function restoreTodoMarkRows(db: DatabaseSync, rows: readonly TodoMarkRow[]): void {
  const stmt = db.prepare('INSERT OR IGNORE INTO agent_todo_marks (agent_session_id, key, marked_at) VALUES (?, ?, ?)')
  for (const r of rows) stmt.run(r.agent_session_id, r.key, r.marked_at)
}

/** Every tick, for the export: by session, then key. */
export function listAllTodoMarks(db: DatabaseSync): AgentTodoMark[] {
  const rows = db
    .prepare('SELECT agent_session_id, key, marked_at FROM agent_todo_marks ORDER BY agent_session_id, key')
    .all() as unknown as TodoMarkRow[]
  return rows.map((r) => ({ agentSessionId: r.agent_session_id, key: r.key, markedAt: r.marked_at }))
}
