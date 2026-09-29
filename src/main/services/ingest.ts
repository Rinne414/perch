import type { DatabaseSync } from 'node:sqlite'
import { parseAgentEvent } from '@shared/agentEvent'
import { readInbox, rejectInboxFile, removeInboxFile } from '../../integrations/inbox'
import { applyAgentEvent } from '../db/agents'

export interface IngestResult {
  readonly applied: number
  readonly rejected: number
}

/** Applies every finished event file in the inbox, oldest first, and clears it. */
export function ingestInbox(db: DatabaseSync, dir: string, now: number): IngestResult {
  let applied = 0
  let rejected = 0
  for (const file of readInbox(dir)) {
    let event = null
    try {
      event = parseAgentEvent(JSON.parse(file.content))
    } catch {
      event = null
    }
    if (!event) {
      rejectInboxFile(dir, file.path)
      rejected++
      continue
    }
    applyAgentEvent(db, event, now)
    removeInboxFile(file.path)
    applied++
  }
  return { applied, rejected }
}
