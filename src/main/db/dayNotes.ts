import type { DatabaseSync } from 'node:sqlite'

export interface DayNote {
  readonly day: string
  readonly text: string
  readonly updatedAt: number
}

interface NoteRow {
  day: string
  text: string
  updated_at: number
}

const toNote = (r: NoteRow): DayNote => ({ day: r.day, text: r.text, updatedAt: r.updated_at })

export function getDayNote(db: DatabaseSync, day: string): string {
  const row = db.prepare('SELECT text FROM day_notes WHERE day = ?').get(day) as { text: string } | undefined
  return row?.text ?? ''
}

/** Saves the day's note; an empty note is removed rather than kept blank. */
export function setDayNote(db: DatabaseSync, day: string, text: string, now: number): void {
  if (!text.trim()) {
    db.prepare('DELETE FROM day_notes WHERE day = ?').run(day)
    return
  }
  db.prepare(
    'INSERT INTO day_notes (day, text, updated_at) VALUES (?, ?, ?) ON CONFLICT (day) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at',
  ).run(day, text, now)
}

/** Every note, oldest day first. */
export function listDayNotes(db: DatabaseSync): DayNote[] {
  return (db.prepare('SELECT * FROM day_notes ORDER BY day').all() as unknown as NoteRow[]).map(toNote)
}
