import type { DatabaseSync } from 'node:sqlite'
import { getSetting } from '../db/settings'

export interface AppSettings {
  /** Local hour a new day begins, so late nights count for the previous day. */
  readonly dayStartHour: number
  readonly staleDays: number
  /** Reminder time for items that only have a due date. */
  readonly morningHour: number
  readonly captureShortcut: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  dayStartHour: 4,
  staleDays: 14,
  morningHour: 9,
  captureShortcut: 'Control+Alt+N',
}

export function readSettings(db: DatabaseSync): AppSettings {
  return { ...DEFAULT_SETTINGS, ...getSetting<Partial<AppSettings>>(db, 'app', {}) }
}
