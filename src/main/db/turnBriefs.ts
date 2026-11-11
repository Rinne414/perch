import type { DatabaseSync } from 'node:sqlite'
import { MAX_REPLY } from '@shared/briefing'
import { pickReportTurn } from '@shared/reportPick'
import type { SessionBrief } from '@shared/types'

/** SQLite allows at least 999 bound values per statement; longer lists are read in several queries. */
const IDS_PER_QUERY = 500
/** One character past what the report card carries, so a longer report can still be told cut. */
const REPORT_CHARS = MAX_REPLY + 1
/** A prompt is quoted, and a latest reply read for its first line: far less than this is shown. */
const SHORT_CHARS = 2000

interface ShapeRow {
  readonly id: number
  readonly agent_session_id: string
  readonly typed: number
  readonly replied: number
  readonly reply_len: number
  readonly ended_at: number | null
}

/** Which turns of one session the brief reads text from, found from the shapes alone. */
interface Picks {
  readonly firstPrompt: number | null
  readonly latestPrompt: number | null
  readonly latestReply: number | null
  readonly latestReplyAt: number | null
  readonly report: number | null
  readonly reportAt: number | null
  readonly promptCount: number
  readonly turnCount: number
}

const marks = (n: number): string => Array.from({ length: n }, () => '?').join(', ')

/** Shapes of every turn of the sessions, oldest first, from the covering index (no text is read). */
function shapesOf(db: DatabaseSync, chunk: readonly string[]): Map<string, ShapeRow[]> {
  const rows = db
    .prepare(
      `SELECT id, agent_session_id, prompt IS NOT NULL AS typed, reply IS NOT NULL AS replied, reply_len, ended_at
       FROM agent_turns WHERE agent_session_id IN (${marks(chunk.length)}) ORDER BY agent_session_id, started_at, id`,
    )
    .all(...chunk) as unknown as ShapeRow[]
  const bySession = new Map<string, ShapeRow[]>()
  for (const r of rows) {
    const list = bySession.get(r.agent_session_id)
    if (list) list.push(r)
    else bySession.set(r.agent_session_id, [r])
  }
  return bySession
}

function picksOf(shapes: readonly ShapeRow[]): Picks {
  const typed = shapes.filter((t) => Number(t.typed) === 1)
  const replied = shapes.filter((t) => Number(t.replied) === 1)
  const report = pickReportTurn(shapes.map((t) => ({ id: Number(t.id), typed: Number(t.typed) === 1, replyLength: Number(t.reply_len) })))
  return {
    firstPrompt: typed[0]?.id ?? null,
    latestPrompt: typed.at(-1)?.id ?? null,
    latestReply: replied.at(-1)?.id ?? null,
    latestReplyAt: replied.at(-1)?.ended_at ?? null,
    report,
    reportAt: shapes.find((t) => t.id === report)?.ended_at ?? null,
    promptCount: typed.length,
    turnCount: shapes.length,
  }
}

/** The start of one text column of the given turns, by turn id. */
function textsOf(db: DatabaseSync, column: 'prompt' | 'reply', chars: number, ids: readonly number[]): Map<number, string> {
  const texts = new Map<number, string>()
  for (let from = 0; from < ids.length; from += IDS_PER_QUERY) {
    const chunk = ids.slice(from, from + IDS_PER_QUERY)
    const rows = db
      .prepare(`SELECT id, substr(${column}, 1, ${chars}) AS text FROM agent_turns WHERE id IN (${marks(chunk.length)})`)
      .all(...chunk) as unknown as { id: number; text: string | null }[]
    for (const r of rows) if (r.text !== null) texts.set(Number(r.id), r.text)
  }
  return texts
}

const present = (ids: readonly (number | null)[]): number[] => [...new Set(ids.filter((id): id is number => id !== null))]

function briefsOfChunk(db: DatabaseSync, chunk: readonly string[]): SessionBrief[] {
  const known = db.prepare(`SELECT id FROM agent_sessions WHERE id IN (${marks(chunk.length)})`).all(...chunk) as unknown as { id: string }[]
  const exists = new Set(known.map((r) => r.id))
  const shapes = shapesOf(db, chunk)
  const picks = new Map(chunk.filter((id) => exists.has(id)).map((id) => [id, picksOf(shapes.get(id) ?? [])]))
  const all = [...picks.values()]
  const prompts = textsOf(db, 'prompt', SHORT_CHARS, present(all.flatMap((p) => [p.firstPrompt, p.latestPrompt])))
  const reports = textsOf(db, 'reply', REPORT_CHARS, present(all.map((p) => p.report)))
  // The latest reply is often the report itself: read only those that are not.
  const latest = textsOf(db, 'reply', SHORT_CHARS, present(all.map((p) => (p.latestReply === p.report ? null : p.latestReply))))
  const replyText = (id: number | null): string | null => (id === null ? null : (latest.get(id) ?? reports.get(id)?.slice(0, SHORT_CHARS) ?? null))
  return [...picks.entries()].map(([id, p]) => ({
    agentSessionId: id,
    firstPrompt: p.firstPrompt === null ? null : (prompts.get(p.firstPrompt) ?? null),
    latestPrompt: p.latestPrompt === null ? null : (prompts.get(p.latestPrompt) ?? null),
    latestReply: replyText(p.latestReply),
    latestReplyAt: p.latestReplyAt,
    reportReply: p.report === null ? null : (reports.get(p.report) ?? null),
    reportReplyAt: p.reportAt,
    promptCount: p.promptCount,
    turnCount: p.turnCount,
  }))
}

/**
 * For each of the given sessions: the first and the latest prompt a person typed, the latest reply,
 * the report (see `pickReportTurn`) and how many turns there are. Which turns matter is found from a
 * covering index without reading any text; then only those texts are read, each cut to what is
 * shown. Sessions that do not exist are missing from the result; one without turns has null texts
 * and zero counts.
 */
export function sessionBriefs(db: DatabaseSync, ids: readonly string[]): Map<string, SessionBrief> {
  const briefs = new Map<string, SessionBrief>()
  for (let from = 0; from < ids.length; from += IDS_PER_QUERY) {
    for (const brief of briefsOfChunk(db, ids.slice(from, from + IDS_PER_QUERY))) briefs.set(brief.agentSessionId, brief)
  }
  return briefs
}
