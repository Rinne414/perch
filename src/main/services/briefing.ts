import type { DatabaseSync } from 'node:sqlite'
import { briefingWindow, buildBriefing, type AwayStretch, type BriefingPayload } from '@shared/briefing'
import { laneHorizon } from '@shared/lanes'
import { isRunning, needsAttention } from '@shared/now'
import { digestReply, EMPTY_DIGEST, type ReplyDigest } from '@shared/replyDigest'
import type { AgentSession } from '@shared/types'
import { getAgentSession, listAgentSessions, listUnclosedBefore } from '../db/agents'
import { listOpenItems } from '../db/items'
import { todoMarksOf } from '../db/todoMarks'
import { listRepliesEndedBetween, listTurnSpans, sessionBriefs } from '../db/turns'
import type { Log } from '../log'
import type { AppSettings } from './settings'

/** Reads one report; a reply the reader trips on gives that session an empty digest, never a failed briefing. */
function safeDigest(log: Pick<Log, 'error'> | undefined): (reply: string | null, sessionId: string) => ReplyDigest {
  return (reply, sessionId) => {
    try {
      return digestReply(reply)
    } catch (err) {
      log?.error(`Report digest failed for session ${sessionId}`, err)
      return EMPTY_DIGEST
    }
  }
}

/** The same week the Agent tab lists, so both count the same sessions as waiting, done and running. */
const AGENT_WINDOW_MS = 7 * 86_400_000

/**
 * The briefing tab's data. The groups come from the last week, as on the Agent tab; sessions left
 * waiting from before the last restart are read however old they are. The lanes read when every
 * turn worked from the away stretch's start (less a pad) or 12 hours back.
 */
export function getBriefingPayload(
  db: DatabaseSync,
  now: number,
  settings: AppSettings,
  cutoffAt: number,
  away: AwayStretch | null,
  log?: Pick<Log, 'error'>,
): BriefingPayload {
  const since = now - AGENT_WINDOW_MS
  const sessions = [...listAgentSessions(db, since), ...listUnclosedBefore(db, Math.min(since, cutoffAt))]
  const shown = sessions.filter((s) => needsAttention(s) || isRunning(s, now, cutoffAt)).map((s) => s.id)
  const window = briefingWindow(now, away)
  const turns = listRepliesEndedBetween(db, window.from, window.to)
  const spans = listTurnSpans(db, laneHorizon(now, away), now)
  const known = new Set(sessions.map((s) => s.id))
  const others = [...new Set([...turns, ...spans].map((t) => t.agentSessionId))]
    .filter((id) => !known.has(id))
    .map((id) => getAgentSession(db, id))
    .filter((s): s is AgentSession => s !== null)
  return buildBriefing({
    now,
    dayStartHour: settings.dayStartHour,
    cutoff: cutoffAt,
    sessions,
    briefs: sessionBriefs(db, shown),
    turns,
    spans,
    others,
    items: listOpenItems(db),
    away,
    todoMarks: todoMarksOf(db, shown),
    digest: safeDigest(log),
  })
}
