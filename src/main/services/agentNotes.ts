import type { DatabaseSync } from 'node:sqlite'
import type { ItemMessage } from '@shared/agentEvent'
import { parseCapture } from '@shared/capture'
import { addDays, dayKey } from '@shared/day'
import type { PlanTarget } from '@shared/ipc'
import type { Item } from '@shared/types'
import { getAgentSession } from '../db/agents'
import { createItem } from '../db/items'

interface Origin {
  /** The folder of the project it belongs to, if any. */
  readonly project: string | null
  readonly source: string
}

/**
 * A line about something to do, filed under a project: a date in the words wins;
 * otherwise the chosen day plans it, and "不排" leaves it in 隨手記.
 */
export function fileNote(
  db: DatabaseSync,
  text: string,
  plan: PlanTarget,
  origin: Origin,
  now: number,
  dayStartHour: number,
): Item {
  const parsed = parseCapture(text, now, dayStartHour)
  const base = { title: parsed.title, project: origin.project, source: origin.source }
  if (parsed.dueAt !== null) {
    return createItem(db, { ...base, kind: 'task', dueAt: parsed.dueAt, dueHasTime: parsed.dueHasTime }, now)
  }
  if (plan === 'none') return createItem(db, { ...base, kind: 'idea' }, now)
  const today = dayKey(now, dayStartHour)
  return createItem(db, { ...base, kind: 'task', plannedFor: plan === 'today' ? today : addDays(today, 1) }, now)
}

/** 記下來 on an agent card: the person's own words, filed under the folder that agent worked in. */
export function noteFromSession(
  db: DatabaseSync,
  sessionId: string,
  text: string,
  plan: PlanTarget,
  now: number,
  dayStartHour: number,
): Item {
  const session = getAgentSession(db, sessionId)
  if (!session) throw new Error(`Agent session not found: ${sessionId}`)
  return fileNote(db, text, plan, { project: session.cwd, source: 'user' }, now, dayStartHour)
}

/** `perch-hook add`: an agent or a script leaves the person something to do later. */
export function addFromMessage(db: DatabaseSync, msg: ItemMessage, now: number, dayStartHour: number): Item {
  const origin = { project: msg.cwd ?? null, source: `agent:${msg.agent}` }
  return fileNote(db, msg.title, 'none', origin, msg.at ?? now, dayStartHour)
}
