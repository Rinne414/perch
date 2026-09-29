import { BrowserWindow } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { CHANNELS, type MainTab } from '@shared/ipc'
import type { HookSetup } from '../integrations/install'
import { readSettings, type AppSettings } from './services/settings'

export interface AppContext {
  readonly db: DatabaseSync
  settings(): AppSettings
  /** Where the agent hooks point: the hook script, the inbox, and whose home folder to change. */
  readonly hookSetup: HookSetup
  /** Tells every window that the data behind "now" changed. */
  broadcast(): void
  showFloat(): void
  openMain(tab?: MainTab): void
  isFloatPinned(): boolean
  setFloatPinned(on: boolean): void
}

export function broadcastChange(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.changed)
  }
}

export const settingsReader = (db: DatabaseSync) => (): AppSettings => readSettings(db)
