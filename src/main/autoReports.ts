import type { DatabaseSync } from 'node:sqlite'
import { isOneShot } from '@shared/now'
import type { AgentSession } from '@shared/types'
import { listAgentSessions } from './db/agents'
import { getSetting, setSetting } from './db/settings'
import type { Log } from './log'
import { saveSessionNote, type ReportPlace } from './services/saveReports'
import type { AppSettings } from './services/settings'

/** A finished session waits this long, so a run that closes within a minute of answering (a one-shot) is known as one. */
export const SETTLE_MS = 2 * 60_000
const KEY = 'autoReportsAt'
/** The scan point alone is saved at most this often. */
const SAVE_MS = 60_000

/** Sessions that finished in (from, to] and are worth a note: done, and not a one-shot run another program started. */
export function finishedBetween(sessions: readonly AgentSession[], from: number, to: number): AgentSession[] {
  return sessions.filter(
    (s) => s.status === 'done' && s.attentionAt !== null && s.attentionAt > from && s.attentionAt <= to && !isOneShot(s),
  )
}

type SaveNote = (db: DatabaseSync, sessionId: string, place: ReportPlace) => unknown

/**
 * With an Obsidian folder chosen and 報告筆記 on, each finished session gets its note in Perch/報告,
 * as the day notes do. Called once per scheduler tick; never throws. A note that cannot be written
 * (read-only, busy, a path too long, the folder gone) is logged once and passed over, so it never
 * holds up the sessions after it.
 */
export function createAutoReports(
  db: DatabaseSync,
  settings: () => AppSettings,
  dataDir: () => string,
  log: Log,
  save: SaveNote = saveSessionNote,
): (now: number) => void {
  let from: number | null = getSetting<number | null>(db, KEY, null)
  let savedAt = 0
  const logged = new Set<string>()
  const advance = (to: number, now: number): void => {
    from = to
    if (now - savedAt < SAVE_MS) return
    setSetting(db, KEY, to)
    savedAt = now
  }
  const write = (sessionId: string, place: ReportPlace): void => {
    try {
      save(db, sessionId, place)
    } catch (err) {
      const key = `${sessionId}\n${(err as Error).message}`
      if (!logged.has(key)) log.error('Session note not written', err)
      logged.add(key)
    }
  }
  return (now) => {
    const { obsidianDir, autoReports, dayStartHour } = settings()
    const until = now - SETTLE_MS
    // Nothing is written for sessions that finished before the first run, or while it was off.
    if (from !== null && obsidianDir && autoReports) {
      const place = { obsidianDir, dataDir: dataDir(), dayStartHour }
      for (const s of finishedBetween(listAgentSessions(db, from), from, until)) write(s.id, place)
    }
    advance(until, now)
  }
}
