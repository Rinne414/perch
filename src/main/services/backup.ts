import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Log } from '../log'

/** A daily copy, or the one taken right before a new version changes the database. */
export type BackupKind = 'daily' | 'before-update'

/** How many copies of each kind stay; older ones are deleted. */
export const BACKUPS_KEPT: Readonly<Record<BackupKind, number>> = { daily: 7, 'before-update': 3 }

const NAME = /^tasks-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(-before-update)?\.db$/

export interface BackupFile {
  readonly name: string
  readonly kind: BackupKind
  /** Local time the copy was taken, read back from its name. */
  readonly at: number
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** tasks-2026-09-30_09-15-02.db, or …-before-update.db; names sort by time. */
export function backupName(kind: BackupKind, at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`
  return `tasks-${date}_${time}${kind === 'before-update' ? '-before-update' : ''}.db`
}

function parse(name: string): BackupFile | null {
  const m = NAME.exec(name)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number)
  return { name, kind: m[7] ? 'before-update' : 'daily', at: new Date(y, mo - 1, d, h, mi, s).getTime() }
}

/** Every backup in the folder, newest first. Other files there are left alone. */
export function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map(parse)
    .filter((b): b is BackupFile => b !== null)
    .sort((a, b) => b.at - a.at)
}

/**
 * Copies the database into `dir` as one consistent file (VACUUM INTO works while
 * the app keeps writing), then deletes the oldest copies of that kind.
 */
export function writeBackup(db: DatabaseSync, dir: string, kind: BackupKind, now: Date): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, backupName(kind, now))
  if (!existsSync(path)) db.prepare('VACUUM INTO ?').run(path)
  for (const old of listBackups(dir).filter((b) => b.kind === kind).slice(BACKUPS_KEPT[kind])) {
    rmSync(join(dir, old.name), { force: true })
  }
  return path
}

const sameDate = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Perch usually runs for days, so the daily copy is checked for every hour, not only at start. */
const CHECK_EVERY_MS = 3_600_000

/** Takes the day's copy unless one was already taken on this calendar date. Returns its path, or null. */
export function backupIfDue(db: DatabaseSync, dir: string, now: Date): string | null {
  const last = listBackups(dir).find((b) => b.kind === 'daily')
  if (last && sameDate(new Date(last.at), now)) return null
  return writeBackup(db, dir, 'daily', now)
}

/** Takes today's copy now if it is missing, then keeps checking while the app runs. Returns a stop function. */
export function startDailyBackups(db: DatabaseSync, dir: string, log: Log): () => void {
  const run = (): void => {
    try {
      const path = backupIfDue(db, dir, new Date())
      if (path) log.info(`Daily backup ${basename(path)}`)
    } catch (err) {
      log.error('Daily backup failed', err)
    }
  }
  run()
  const timer = setInterval(run, CHECK_EVERY_MS)
  return () => clearInterval(timer)
}
