import type { DatabaseSync } from 'node:sqlite'
import { agentName, ATTENTION_STATUSES } from '@shared/agents'
import type { AgentEvent } from '@shared/agentEvent'
import { projectName } from '@shared/projects'
import { promptTitle } from '@shared/prompt'
import type { AgentSession, AgentStatus } from '@shared/types'
import { appendEvent } from './events'
import { transaction } from './transaction'

interface SessionRow {
  id: string
  agent: string
  session_id: string
  cwd: string | null
  title: string | null
  status: string
  detail: string | null
  started_at: number
  updated_at: number
  attention_at: number | null
  acknowledged_at: number | null
}

const toSession = (r: SessionRow): AgentSession => ({
  id: r.id,
  agent: r.agent,
  sessionId: r.session_id,
  cwd: r.cwd,
  // Titles stored before prompts were cleaned can be a lone tag line such as <pasted_content>.
  title: r.title === null ? null : promptTitle(r.title),
  status: r.status as AgentStatus,
  detail: r.detail,
  startedAt: r.started_at,
  updatedAt: r.updated_at,
  attentionAt: r.attention_at,
  acknowledgedAt: r.acknowledged_at,
})

export function getAgentSession(db: DatabaseSync, id: string): AgentSession | null {
  const row = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as SessionRow | undefined
  return row ? toSession(row) : null
}


/**
 * Records one status report. Events older than what is stored are ignored, so
 * hooks that finish out of order cannot move a session backwards.
 */
export function applyAgentEvent(db: DatabaseSync, e: AgentEvent, now: number): AgentSession {
  const id = `${e.agent}:${e.sessionId}`
  const at = e.at ?? now
  return transaction(db, () => {
    const prev = getAgentSession(db, id)
    if (prev && at < prev.updatedAt) return prev
    // A session that closes right after finishing (headless runs, background agents)
    // still has a result worth looking at, so its end does not wipe the result.
    if (prev && e.status === 'cancelled' && (prev.status === 'done' || prev.status === 'failed')) return prev

    const statusChanged = prev?.status !== e.status
    const wantsPerson = ATTENTION_STATUSES.has(e.status)
    const attentionAt = wantsPerson ? (statusChanged || !prev?.attentionAt ? at : prev.attentionAt) : null
    const next: AgentSession = {
      id,
      agent: e.agent,
      sessionId: e.sessionId,
      cwd: e.cwd ?? prev?.cwd ?? null,
      title: e.title ?? prev?.title ?? null,
      status: e.status,
      detail: e.detail ?? (statusChanged ? null : (prev?.detail ?? null)),
      startedAt: prev?.startedAt ?? at,
      updatedAt: at,
      attentionAt,
      acknowledgedAt: prev?.acknowledgedAt ?? null,
    }
    db.prepare(
      `INSERT INTO agent_sessions (id, agent, session_id, cwd, title, status, detail, started_at,
         updated_at, attention_at, acknowledged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET cwd = excluded.cwd, title = excluded.title,
         status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at,
         attention_at = excluded.attention_at`,
    ).run(
      next.id,
      next.agent,
      next.sessionId,
      next.cwd,
      next.title,
      next.status,
      next.detail,
      next.startedAt,
      next.updatedAt,
      next.attentionAt,
      next.acknowledgedAt,
    )
    if (statusChanged && (e.status === 'done' || e.status === 'failed')) {
      const where = projectName(next.cwd)
      appendEvent(db, {
        at,
        type: 'agent.status',
        title: where ? `${agentName(e.agent)} · ${where}` : agentName(e.agent),
        agentSessionId: id,
        source: `agent:${e.agent}`,
        data: { status: e.status, ...(next.title ? { prompt: next.title } : {}) },
      })
    }
    return next
  })
}

export function acknowledgeAgent(db: DatabaseSync, id: string, now: number): void {
  db.prepare('UPDATE agent_sessions SET acknowledged_at = ? WHERE id = ?').run(now, id)
}

/** Sessions that reported anything since `since`, newest first. */
export function listAgentSessions(db: DatabaseSync, since: number): AgentSession[] {
  const rows = db
    .prepare('SELECT * FROM agent_sessions WHERE updated_at >= ? ORDER BY updated_at DESC')
    .all(since) as unknown as SessionRow[]
  return rows.map(toSession)
}

export interface ProjectHead {
  /** The session of this folder that reported last. */
  readonly session: AgentSession
  readonly sessionCount: number
  readonly firstAt: number
}

/** Every folder agents reported working in, with its latest session. */
export function listProjectHeads(db: DatabaseSync): ProjectHead[] {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT *,
           ROW_NUMBER() OVER (PARTITION BY cwd ORDER BY updated_at DESC) AS rn,
           COUNT(*) OVER (PARTITION BY cwd) AS session_count,
           MIN(started_at) OVER (PARTITION BY cwd) AS first_at
         FROM agent_sessions
         WHERE cwd IS NOT NULL AND cwd <> ''
       ) WHERE rn = 1`,
    )
    .all() as unknown as (SessionRow & { session_count: number; first_at: number })[]
  return rows.map((r) => ({ session: toSession(r), sessionCount: r.session_count, firstAt: r.first_at }))
}

/** The latest sessions that worked in one folder, newest first. */
export function listSessionsIn(db: DatabaseSync, cwd: string, limit: number): AgentSession[] {
  const rows = db
    .prepare('SELECT * FROM agent_sessions WHERE cwd = ? ORDER BY updated_at DESC LIMIT ?')
    .all(cwd, limit) as unknown as SessionRow[]
  return rows.map(toSession)
}

/** Whether any agent session reported working in this folder. */
export function isKnownWorkFolder(db: DatabaseSync, cwd: string): boolean {
  return db.prepare('SELECT 1 FROM agent_sessions WHERE cwd = ? LIMIT 1').get(cwd) !== undefined
}

export function deleteAgentSessionsByAgent(db: DatabaseSync, agent: string): number {
  return Number(db.prepare('DELETE FROM agent_sessions WHERE agent = ?').run(agent).changes)
}
