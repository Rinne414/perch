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
}

const STATUSES: ReadonlySet<string> = new Set(['running', 'needs_input', 'done', 'failed', 'cancelled'])
const MAX_TEXT = 500

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
  if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(agent)) return null
  const at = typeof r['at'] === 'number' && Number.isFinite(r['at']) ? r['at'] : undefined
  return {
    v: 1,
    agent,
    sessionId,
    status: status as AgentStatus,
    at,
    cwd: shortText(r['cwd']),
    title: shortText(r['title']),
    detail: shortText(r['detail']),
  }
}
