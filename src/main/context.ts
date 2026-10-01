import { BrowserWindow } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { CHANNELS, type FloatTab, type MainTab } from '@shared/ipc'
import type { HookSetup } from '../integrations/install'
import type { Log } from './log'
import type { Updater } from './updater'
import { readSettings, type AppSettings } from './services/settings'

export interface AppContext {
  readonly db: DatabaseSync
  settings(): AppSettings
  /** Where the agent hooks point: the hook script, the inbox, and whose home folder to change. */
  readonly hookSetup: HookSetup
  /** Tells every window that the data behind "now" changed. */
  broadcast(): void
  showFloat(tab?: FloatTab): void
  openMain(tab?: MainTab): void
  isFloatPinned(): boolean
  setFloatPinned(on: boolean): void
  readonly log: Log
  readonly updater: Updater
  /** Registers the new capture shortcut and drops the old one; false when another program holds it. */
  moveCaptureShortcut(accelerator: string): boolean
  /** Rewrites that day's Obsidian note when a folder is set. */
  syncObsidian(day: string): void
}

export function broadcastChange(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.changed)
  }
}

export const settingsReader = (db: DatabaseSync) => (): AppSettings => readSettings(db)
