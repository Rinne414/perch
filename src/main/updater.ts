import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANNELS, type UpdateStatus } from '@shared/ipc'
import type { Log } from './log'
import { createUpdateState } from './services/update'

export interface Updater {
  status(): UpdateStatus
  /** Looks for a newer release; a newer one starts downloading by itself. Resolves once the check is over. */
  check(): Promise<UpdateStatus>
  /** Quits and runs the downloaded installer silently, then starts the new version. */
  install(): void
}

function broadcastStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.updateStatus, status)
  }
}

/**
 * Development aid: TC_UPDATE_FEED points a development run at a test folder served over HTTP
 * (latest.yml plus an installer), with its own download cache. Returns whether it is set.
 */
function useDevFeed(dataDir: string): boolean {
  const url = process.env['TC_UPDATE_FEED']
  if (app.isPackaged || !url) return false
  const config = join(dataDir, 'dev-app-update.yml')
  writeFileSync(config, `provider: generic\nurl: ${JSON.stringify(url)}\nupdaterCacheDirName: perch-updater-dev\n`)
  autoUpdater.updateConfigPath = config
  autoUpdater.forceDevUpdateConfig = true
  return true
}

const UNAVAILABLE: UpdateStatus = { state: 'unavailable' }

/**
 * Updates come from the GitHub releases named in app-update.yml (written by electron-builder).
 * Nothing is fetched until check() runs, which only happens when the person presses 檢查更新.
 */
export function createUpdater(log: Log, dataDir: string): Updater {
  if (!app.isPackaged && !useDevFeed(dataDir)) {
    return { status: () => UNAVAILABLE, check: async () => UNAVAILABLE, install: () => undefined }
  }
  const state = createUpdateState(broadcastStatus)
  autoUpdater.logger = {
    info: (m: unknown) => log.info(`updater: ${String(m)}`),
    warn: (m: unknown) => log.warn(`updater: ${String(m)}`),
    error: (m: unknown) => log.error(`updater: ${String(m)}`),
    debug: () => undefined,
  }
  autoUpdater.autoDownload = true
  // A development run only goes as far as downloading: what it fetched is a test file, not an installer.
  autoUpdater.autoInstallOnAppQuit = app.isPackaged
  autoUpdater.on('checking-for-update', state.checking)
  autoUpdater.on('update-not-available', state.latest)
  autoUpdater.on('update-available', (info) => state.found(info.version))
  autoUpdater.on('download-progress', (p) => state.progress(p.percent))
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`Update ${info.version} downloaded`)
    state.downloaded(info.version)
  })
  autoUpdater.on('error', (err) => {
    log.error('Update failed', err)
    state.failed(err)
  })

  return {
    status: state.current,
    check: async () => {
      if (!state.canCheck()) return state.current()
      state.checking()
      try {
        const result = await autoUpdater.checkForUpdates()
        // A failed download is reported through the 'error' event above.
        result?.downloadPromise?.catch(() => undefined)
      } catch (err) {
        if (state.current().state === 'checking') state.failed(err)
      }
      return state.current()
    },
    install: () => {
      if (state.current().state !== 'ready') return
      if (!app.isPackaged) return log.info('Development run: the downloaded update is not installed')
      log.info('Restarting to install the update')
      autoUpdater.quitAndInstall(true, true)
    },
  }
}
