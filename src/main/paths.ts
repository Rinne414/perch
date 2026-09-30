import { app } from 'electron'
import { cpSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
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
 * A Linux AppImage is mounted at a new temporary path on every start, so agents would lose the
 * script after a restart. They get a copy in the data folder instead, refreshed on each start.
 */
function stableCopy(script: string): string {
  const dir = join(dataDir(), 'hook')
  mkdirSync(dir, { recursive: true })
  cpSync(script, join(dir, 'perch-hook.js'))
  cpSync(join(dirname(script), 'chunks'), join(dir, 'chunks'), { recursive: true })
  return join(dir, 'perch-hook.js')
}

/**
 * Agents run the hook script with plain Node, which cannot read inside app.asar,
 * so packaged builds point at the unpacked copy.
 * In development, TC_AGENT_HOME redirects every config change to a scratch folder.
 */
export function hookSetup(): HookSetup {
  const unpacked = join(__dirname, 'perch-hook.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  const cliPath = app.isPackaged && process.env['APPIMAGE'] ? stableCopy(unpacked) : unpacked
  const home = (!app.isPackaged && process.env['TC_AGENT_HOME']) || homedir()
  return { cliPath, inboxDir: join(dataDir(), 'inbox'), home }
}
