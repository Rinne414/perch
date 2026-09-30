import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HookSetup } from '../integrations/install'

/**
 * Development data stays inside the repo (`.data/`, git-ignored) so it never mixes with a real install.
 * TC_DATA_DIR points a development run at a throwaway folder instead.
 */
export function dataDir(): string {
  const dir = app.isPackaged ? app.getPath('userData') : (process.env['TC_DATA_DIR'] ?? join(app.getAppPath(), '.data'))
  mkdirSync(dir, { recursive: true })
  return dir
}

export const backupsDir = (): string => join(dataDir(), 'backups')
export const logsDir = (): string => join(dataDir(), 'logs')

/**
 * A development run keeps its Chromium profile and single-instance lock apart
 * from an installed copy, and from other test runs when TC_DATA_DIR is set.
 * Must run before the app is ready.
 */
export function separateDevProfile(): void {
  if (app.isPackaged) return
  const dir = process.env['TC_DATA_DIR']
  app.setPath('userData', dir ? join(dir, 'profile') : join(app.getPath('appData'), 'Perch (dev)'))
}

/** The app icon: shipped next to app.asar in packaged builds, read from build/ in development. */
export const iconPath = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')

/**
 * Agents run the hook script with plain Node, which cannot read inside app.asar,
 * so packaged builds point at the unpacked copy.
 * In development, TC_AGENT_HOME redirects every config change to a scratch folder.
 */
export function hookSetup(): HookSetup {
  const cliPath = join(__dirname, 'perch-hook.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  const home = (!app.isPackaged && process.env['TC_AGENT_HOME']) || homedir()
  return { cliPath, inboxDir: join(dataDir(), 'inbox'), home }
}
