import type { DatabaseSync } from 'node:sqlite'
import { parseAgentEvent, parseItemMessage } from '@shared/agentEvent'
import { parseJsonText, readInbox, rejectInboxFile, removeInboxFile } from '../../integrations/inbox'
import { applyAgentEvent } from '../db/agents'
import { addFromMessage } from './agentNotes'

export interface IngestResult {
  readonly applied: number
  readonly rejected: number
}

/** Applies one file; false when it is neither a status report nor a usable note. */
function apply(db: DatabaseSync, content: string, now: number, dayStartHour: number): boolean {
  let raw: unknown
  try {
    raw = parseJsonText(content)
  } catch {
    return false
  }
  // Anything that still fails is set aside, so one bad file never blocks the reports behind it.
  try {
    const note = parseItemMessage(raw)
    if (note) {
      addFromMessage(db, note, now, dayStartHour)
      return true
    }
    const event = parseAgentEvent(raw)
    if (!event) return false
    applyAgentEvent(db, event, now)
    return true
  } catch {
    return false
  }
}

/** Applies every finished file in the inbox (status reports and notes), oldest first, and clears it. */
export function ingestInbox(db: DatabaseSync, dir: string, now: number, dayStartHour: number): IngestResult {
  let applied = 0
  let rejected = 0
  for (const file of readInbox(dir)) {
    if (apply(db, file.content, now, dayStartHour)) {
      removeInboxFile(file.path)
      applied++
    } else {
      rejectInboxFile(dir, file.path)
      rejected++
    }
  }
  return { applied, rejected }
}
