import { sessionLabel } from './agents'
import { textKey } from './hash'
import type { ReplyDigest } from './replyDigest'
import type { SessionState } from './sessionState'
import type { AgentSession } from './types'

/** One session whose report may leave things for the person. */
export interface TodoSource {
  readonly session: AgentSession
  readonly glyph: SessionState
  /** When the report was given (its turn's end); the ticks of a point belong to it. */
  readonly reportAt: number | null
  readonly digest: ReplyDigest
}

export interface TodoRow {
  /** The same point of the same report: what a tick is stored under (see `todoKey`). */
  readonly key: string
  readonly text: string
}

/** The open points of one report, at most `TODOS_PER_SESSION` of them. */
export interface TodoGroup {
  readonly sessionId: string
  readonly name: string
  readonly glyph: SessionState
  readonly reportAt: number | null
  /** The session's folder: 排到今天 files the task under it. */
  readonly cwd: string | null
  readonly rows: readonly TodoRow[]
  /** Open points of this report not shown here; its card has them all. */
  readonly more: number
}

export interface TodoView {
  readonly groups: readonly TodoGroup[]
  /** Every open point, shown or not. */
  readonly total: number
}

export const TODOS_PER_SESSION = 5

/**
 * A tick belongs to one report: the hash of the report's time and the point's text. The same text
 * in a later report is a new point; the same report read again keeps its ticks.
 */
export const todoKey = (reportAt: number | null, text: string): string => textKey(`${reportAt ?? ''}|${text.trim()}`)

/** Session id to the keys of the points the person ticked off. */
export type TodoMarks = ReadonlyMap<string, ReadonlySet<string>>

function openRows(source: TodoSource, marks: TodoMarks): TodoRow[] {
  const { todos } = source.digest
  if (todos === null || todos === 'none') return []
  const ticked = marks.get(source.session.id)
  const seen = new Set<string>()
  const rows: TodoRow[] = []
  for (const raw of todos) {
    const text = raw.trim()
    const key = todoKey(source.reportAt, text)
    if (!text || seen.has(key) || ticked?.has(key)) continue
    seen.add(key)
    rows.push({ key, text })
  }
  return rows
}

/**
 * 報告裡留給你的事: the points each report leaves for the person, in the order the sessions come
 * (waiting, finished, running), without the ones already ticked off or said twice.
 */
export function gatherTodos(sources: readonly TodoSource[], marks: TodoMarks): TodoView {
  const groups: TodoGroup[] = []
  let total = 0
  for (const source of sources) {
    const rows = openRows(source, marks)
    if (rows.length === 0) continue
    total += rows.length
    groups.push({
      sessionId: source.session.id,
      name: sessionLabel(source.session),
      glyph: source.glyph,
      reportAt: source.reportAt,
      cwd: source.session.cwd,
      rows: rows.slice(0, TODOS_PER_SESSION),
      more: Math.max(0, rows.length - TODOS_PER_SESSION),
    })
  }
  return { groups, total }
}
