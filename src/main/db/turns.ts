import type { DatabaseSync } from 'node:sqlite'
import type { TurnSpan } from '@shared/lanes'
import type { AgentTurn } from '@shared/types'
import { transaction } from './transaction'

export { sessionBriefs } from './turnBriefs'

/** A turn's raw row, so a session taken off the list can bring its turns back exactly. */
export interface TurnRow {
  readonly id: number
  readonly agent_session_id: string
  readonly started_at: number
  readonly prompt: string | null
  readonly ended_at: number | null
  readonly reply: string | null
  readonly reply_len: number
}

const TURN_COLUMNS = ['id', 'agent_session_id', 'started_at', 'prompt', 'ended_at', 'reply', 'reply_len'] as const satisfies readonly (keyof TurnRow)[]

const toTurn = (r: TurnRow): AgentTurn => ({
  id: r.id,
  agentSessionId: r.agent_session_id,
  startedAt: r.started_at,
  prompt: r.prompt,
  endedAt: r.ended_at,
  reply: r.reply,
  replyLen: Number(r.reply_len),
})

/** What the report pick compares: the length of the trimmed reply, 0 for none or blank. */
export const replyLength = (reply: string | null): number => reply?.trim().length ?? 0

/**
 * Keeps what one event says about the session's turns; the session row must exist.
 * A prompt starts a turn, and closes older turns of the session that never got a reply (the
 * person interrupted them or typed again), so none stays open forever. A reply closes the latest
 * turn when that turn has no reply yet. Nothing is ever overwritten: a reply for a turn that
 * already has one (the agent stopped again, or answered a background notice) starts a turn of its
 * own without a prompt, as does a reply with no turn yet.
 */
export function recordTurn(
  db: DatabaseSync,
  agentSessionId: string,
  words: { readonly prompt?: string; readonly reply?: string },
  at: number,
): void {
  if (words.prompt === undefined && words.reply === undefined) return
  transaction(db, () => {
    if (words.prompt !== undefined) {
      db.prepare('UPDATE agent_turns SET ended_at = ? WHERE agent_session_id = ? AND reply IS NULL AND ended_at IS NULL').run(at, agentSessionId)
      db.prepare('INSERT INTO agent_turns (agent_session_id, started_at, prompt) VALUES (?, ?, ?)').run(agentSessionId, at, words.prompt)
    }
    if (words.reply === undefined) return
    const length = replyLength(words.reply)
    const latest = db
      .prepare('SELECT id, reply IS NOT NULL AS replied FROM agent_turns WHERE agent_session_id = ? ORDER BY started_at DESC, id DESC LIMIT 1')
      .get(agentSessionId) as { id: number; replied: number } | undefined
    if (latest && Number(latest.replied) === 0) {
      db.prepare('UPDATE agent_turns SET reply = ?, reply_len = ?, ended_at = ? WHERE id = ?').run(words.reply, length, at, latest.id)
    } else {
      db.prepare('INSERT INTO agent_turns (agent_session_id, started_at, ended_at, reply, reply_len) VALUES (?, ?, ?, ?, ?)').run(
        agentSessionId,
        at,
        at,
        words.reply,
        length,
      )
    }
  })
}

/** All turns of one session, whole, oldest first: the full record. */
export function listTurns(db: DatabaseSync, agentSessionId: string): AgentTurn[] {
  const rows = db
    .prepare(`SELECT ${TURN_COLUMNS.join(', ')} FROM agent_turns WHERE agent_session_id = ? ORDER BY started_at, id`)
    .all(agentSessionId) as unknown as TurnRow[]
  return rows.map(toTurn)
}

/** Every turn of every session, for the export: by session, oldest first. */
export function listAllTurns(db: DatabaseSync): AgentTurn[] {
  const rows = db
    .prepare(`SELECT ${TURN_COLUMNS.join(', ')} FROM agent_turns ORDER BY agent_session_id, started_at, id`)
    .all() as unknown as TurnRow[]
  return rows.map(toTurn)
}

/** One reply of 經過: the start of its text is all the line needs. */
export interface ReplyLine {
  readonly agentSessionId: string
  readonly endedAt: number
  readonly reply: string
}

/** 經過 reads only this much of each reply; its line is cut far shorter. */
export const LINE_CHARS = 2000

/** Replies that came between `from` and `to` (both included), oldest first, each cut to LINE_CHARS. */
export function listRepliesEndedBetween(db: DatabaseSync, from: number, to: number): ReplyLine[] {
  const rows = db
    .prepare(
      `SELECT agent_session_id, ended_at, substr(reply, 1, ${LINE_CHARS}) AS reply FROM agent_turns
       WHERE reply IS NOT NULL AND ended_at >= ? AND ended_at <= ? ORDER BY ended_at, id`,
    )
    .all(from, to) as unknown as { agent_session_id: string; ended_at: number; reply: string }[]
  return rows.map((r) => ({ agentSessionId: r.agent_session_id, endedAt: r.ended_at, reply: r.reply }))
}

/**
 * When each turn worked, for every turn that overlaps `from` to `to`: those still open are
 * included however long ago they began. Only the times, no texts.
 */
export function listTurnSpans(db: DatabaseSync, from: number, to: number): TurnSpan[] {
  const rows = db
    .prepare(
      `SELECT agent_session_id, started_at, ended_at FROM agent_turns
       WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY started_at, id`,
    )
    .all(to, from) as unknown as { agent_session_id: string; started_at: number; ended_at: number | null }[]
  return rows.map((r) => ({ agentSessionId: r.agent_session_id, startedAt: r.started_at, endedAt: r.ended_at }))
}

/** The raw turns of one session (called before the session is deleted). */
export const turnRowsOf = (db: DatabaseSync, agentSessionId: string): TurnRow[] =>
  db.prepare(`SELECT ${TURN_COLUMNS.join(', ')} FROM agent_turns WHERE agent_session_id = ? ORDER BY id`).all(agentSessionId) as unknown as TurnRow[]

/** Puts turn rows back; the session they belong to must exist. A turn already there is left alone. */
export function restoreTurnRows(db: DatabaseSync, rows: readonly TurnRow[]): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO agent_turns (${TURN_COLUMNS.join(', ')}) VALUES (${TURN_COLUMNS.map(() => '?').join(', ')})`,
  )
  for (const row of rows) stmt.run(...TURN_COLUMNS.map((c) => row[c]))
}
