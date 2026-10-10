import type { AgentStatus } from './types'

/**
 * The public event format, version 1. Any agent or script can report its state by
 * writing one of these as JSON into the app's inbox folder.
 */
export interface AgentEvent {
  readonly v: 1
  /** Short id such as "claude-code" or "codex". */
  readonly agent: string
  readonly sessionId: string
  readonly status: AgentStatus
  /** Epoch milliseconds; the ingest time is used when missing. */
  readonly at?: number
  readonly cwd?: string
  /** Something a person recognises the session by, e.g. its first prompt. */
  readonly title?: string
  /** What the agent is waiting for or why it failed. */
  readonly detail?: string
  /**
   * The session itself was closed (Claude Code's SessionEnd), not just one turn. Without it
   * Perch cannot tell a session closed after finishing from one still open in a terminal.
   */
  readonly ended?: boolean
}

/**
 * Something for the person to do later, written by an agent or a script (`perch-hook add`).
 * The title is read like the capture field: a date in it ("明天下午3點 …") makes a dated
 * task; without one it waits in 隨手記.
 */
export interface ItemMessage {
  readonly v: 1
  readonly kind: 'item'
  /** Who asks, e.g. "claude-code"; shown as the item's source. */
  readonly agent: string
  readonly title: string
  /** The folder it was written from: the project it belongs to. */
  readonly cwd?: string
  /** Epoch milliseconds; relative dates in the title are read from here. */
  readonly at?: number
}

const STATUSES: ReadonlySet<string> = new Set(['running', 'needs_input', 'done', 'failed', 'cancelled'])
const MAX_TEXT = 500
const MAX_TITLE = 200
const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,39}$/

const timestamp = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const shortText = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s ? s.slice(0, MAX_TEXT) : undefined
}

/** Validates untrusted input (inbox files). Returns null when it is not a usable event. */
export function parseAgentEvent(raw: unknown): AgentEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const agent = shortText(r['agent'])
  const sessionId = shortText(r['sessionId'])
  const status = r['status']
  if (r['v'] !== 1 || !agent || !sessionId || typeof status !== 'string' || !STATUSES.has(status)) {
    return null
  }
  if (!AGENT_ID.test(agent)) return null
  return {
    v: 1,
    agent,
    sessionId,
    status: status as AgentStatus,
    at: timestamp(r['at']),
    cwd: shortText(r['cwd']),
    title: shortText(r['title']),
    detail: shortText(r['detail']),
    ...(r['ended'] === true ? { ended: true } : {}),
  }
}

/** Validates an inbox file that asks for something to be noted. Null when it is not one, or not usable. */
export function parseItemMessage(raw: unknown): ItemMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r['v'] !== 1 || r['kind'] !== 'item') return null
  const agent = shortText(r['agent'])
  const title = typeof r['title'] === 'string' ? r['title'].trim().slice(0, MAX_TITLE) : ''
  if (!agent || !AGENT_ID.test(agent) || !title) return null
  const cwd = shortText(r['cwd'])
  const at = timestamp(r['at'])
  return { v: 1, kind: 'item', agent, title, ...(cwd ? { cwd } : {}), ...(at !== undefined ? { at } : {}) }
}
