import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_RETENTION_DAYS } from '@shared/clips'
import type { GlassLevel } from '@shared/ipc'
import { getSetting, setSetting } from '../db/settings'

export interface AppSettings {
  /** Local hour a new day begins, so late nights count for the previous day. */
  readonly dayStartHour: number
  readonly staleDays: number
  /** Reminder time for items that only have a due date. */
  readonly morningHour: number
  readonly captureShortcut: string
  readonly glass: GlassLevel
  /** An Obsidian vault (or a folder in one) that gets a note per day in its Perch/ folder; null when off. */
  readonly obsidianDir: string | null
  /** 暫存 that is not kept is cleared after this many days unused; null = never. */
  readonly clipRetentionDays: number | null
  /** Where 存成 PDF writes; null = output/reports in the data folder. */
  readonly pdfDir: string | null
  /** With an Obsidian folder chosen, a finished session's note is written by itself. */
  readonly autoReports: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  dayStartHour: 4,
  staleDays: 14,
  morningHour: 9,
  captureShortcut: 'Control+Alt+N',
  glass: 'mid',
  obsidianDir: null,
  clipRetentionDays: DEFAULT_RETENTION_DAYS,
  pdfDir: null,
  autoReports: true,
}

const KEY = 'app'

export function readSettings(db: DatabaseSync): AppSettings {
  return { ...DEFAULT_SETTINGS, ...getSetting<Partial<AppSettings>>(db, KEY, {}) }
}

/**
 * Decides once whether finished sessions get their notes by themselves. On for a setup without an
 * Obsidian folder (whoever chooses one from now on sees, beside it, that it happens); off for a folder
 * chosen before this version, whose owner never agreed to prompts and replies going into a vault
 * that may sync to a cloud. Written once, so it never flips later.
 */
export function settleAutoReports(db: DatabaseSync): void {
  const stored = getSetting<Partial<AppSettings>>(db, KEY, {})
  if (typeof stored.autoReports === 'boolean') return
  setSetting(db, KEY, { ...stored, autoReports: !stored.obsidianDir })
}

/** Saves the given changes on top of what is stored and returns the full settings. */
export function updateSettings(db: DatabaseSync, patch: Partial<AppSettings>): AppSettings {
  setSetting(db, KEY, { ...getSetting<Partial<AppSettings>>(db, KEY, {}), ...patch })
  return readSettings(db)
}
