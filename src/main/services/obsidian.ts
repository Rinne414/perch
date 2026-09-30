import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { TimelineEntry } from '@shared/calendar'
import { addDays, dayKey, dayStart } from '@shared/day'
import { clock, dayTitle } from '@shared/format'
import { getDayNote } from '../db/dayNotes'
import type { Log } from '../log'
import { listEvents } from '../db/events'
import { entryOf } from './calendar'
import { dayLines } from './export'

/** Perch only ever writes inside this folder of the chosen vault. */
export const OBSIDIAN_SUBFOLDER = 'Perch'
/** How far back the first write reaches when a folder is chosen. */
export const BACKFILL_DAYS = 30

const DONE_KINDS: ReadonlySet<TimelineEntry['kind']> = new Set(['done', 'routine'])

function entriesOf(db: DatabaseSync, day: string, dayStartHour: number): TimelineEntry[] {
  return listEvents(db, dayStart(day, dayStartHour), dayStart(addDays(day, 1), dayStartHour))
    .map(entryOf)
    .filter((e): e is TimelineEntry => e !== null)
}

/** One day as an Obsidian note: the diary, what got done, then the day's events. Null for an empty day. */
export function dayNoteMarkdown(db: DatabaseSync, day: string, dayStartHour: number): string | null {
  const entries = entriesOf(db, day, dayStartHour)
  const note = getDayNote(db, day).trim()
  if (!entries.length && !note) return null
  const done = entries.filter((e) => DONE_KINDS.has(e.kind))
  return [
    '---',
    `date: ${day}`,
    'source: Perch',
    '---',
    '',
    `# ${day} ${dayTitle(day).weekday}`,
    '',
    '<!-- Perch 會改寫這個檔；想寫的話請寫在 Perch 日曆的「筆記」裡，這裡改的不會同步回去。 -->',
    '',
    ...(note ? ['## 筆記', '', note, ''] : []),
    ...(done.length ? ['## 做完的事', '', ...done.map((e) => `- ${e.hasTime ? `${clock(e.at)} ` : ''}${e.title}`), ''] : []),
    ...(entries.length ? ['## 那天的經過', '', ...dayLines(entries), ''] : []),
  ]
    .join('\n')
    .trimEnd()
    .concat('\n')
}

/** Writes <dir>/Perch/<day>.md when its content changed, so sync tools only see real changes. */
export function writeObsidianDay(db: DatabaseSync, dir: string, day: string, dayStartHour: number): boolean {
  const markdown = dayNoteMarkdown(db, day, dayStartHour)
  if (markdown === null) return false
  const folder = join(dir, OBSIDIAN_SUBFOLDER)
  const file = join(folder, `${day}.md`)
  if (existsSync(file) && readFileSync(file, 'utf8') === markdown) return false
  mkdirSync(folder, { recursive: true })
  writeFileSync(file, markdown)
  return true
}

/**
 * Keeps a day's note current while a folder is set. A folder that went away (an unplugged drive)
 * is logged once per distinct error, never thrown: the note is a copy, the app keeps working.
 */
export function createObsidianSync(
  db: DatabaseSync,
  settings: () => { readonly obsidianDir: string | null; readonly dayStartHour: number },
  log: Log,
): (day: string) => void {
  let lastFailure = ''
  return (day) => {
    const { obsidianDir, dayStartHour } = settings()
    if (!obsidianDir) return
    try {
      writeObsidianDay(db, obsidianDir, day, dayStartHour)
      lastFailure = ''
    } catch (err) {
      const message = (err as Error).message
      if (message !== lastFailure) log.error('Obsidian note not written', err)
      lastFailure = message
    }
  }
}

/** The first write after a folder is chosen: today and the 30 days before. Returns how many files were written. */
export function backfillObsidian(db: DatabaseSync, dir: string, now: number, dayStartHour: number): number {
  const today = dayKey(now, dayStartHour)
  let written = 0
  for (let i = BACKFILL_DAYS; i >= 0; i--) if (writeObsidianDay(db, dir, addDays(today, -i), dayStartHour)) written++
  return written
}
