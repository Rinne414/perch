import type { DatabaseSync } from 'node:sqlite'
import type { BriefingPayload } from '@shared/briefing'
import { dayKey } from '@shared/day'
import type { SavedFile, SessionRecord } from '@shared/ipc'
import { SAVE_ERROR } from '@shared/saveErrors'
import { getAgentSession } from '../db/agents'
import { listTurns } from '../db/turns'
import { briefingNoteMarkdown, reportBaseName, sessionNoteMarkdown } from './reportNote'
import { rememberReportFile, reportFileOf } from '../db/reportFiles'
import { briefingNotePath, notePathFor, notesFolder, writeIfChanged } from './reports'

export interface ReportPlace {
  readonly obsidianDir: string | null
  readonly dataDir: string
  readonly dayStartHour: number
}

export function sessionRecord(db: DatabaseSync, sessionId: string): SessionRecord {
  const session = getAgentSession(db, sessionId)
  if (!session) throw new Error(`${SAVE_ERROR.sessionGone}: ${sessionId}`)
  return { session, turns: listTurns(db, sessionId) }
}

/** 存成筆記: the session's note in its own file, rewritten only when something changed. */
export function saveSessionNote(db: DatabaseSync, sessionId: string, place: ReportPlace): SavedFile {
  const { session, turns } = sessionRecord(db, sessionId)
  const folder = notesFolder(place.obsidianDir, place.dataDir)
  const file = notePathFor(folder, reportBaseName(session, place.dayStartHour), session.id, reportFileOf(db, 'note', session.id))
  const written = writeIfChanged(file, sessionNoteMarkdown(session, turns, place.dayStartHour))
  rememberReportFile(db, 'note', session.id, file)
  return { path: file, written }
}

/** 存成今天的筆記: the whole briefing as the day's note. */
export function saveBriefingNote(briefing: BriefingPayload, place: ReportPlace): SavedFile {
  const file = briefingNotePath(place.obsidianDir, place.dataDir, dayKey(briefing.at, place.dayStartHour))
  return { path: file, written: writeIfChanged(file, briefingNoteMarkdown(briefing)) }
}
