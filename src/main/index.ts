import { app, globalShortcut, type BrowserWindow, type Tray } from 'electron'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { MAIN_TABS, type MainTab } from '@shared/ipc'
import { broadcastChange, settingsReader, type AppContext } from './context'
import { openDatabase } from './db/connection'
import { getSetting, setSetting } from './db/settings'
import { captureIfRequested } from './devScreenshot'
import { seedIfRequested } from './devSeed'
import { watchInbox } from './inboxWatcher'
import { registerIpc } from './ipc'
import { notify } from './notify'
import { dataDir, hookSetup, separateDevProfile } from './paths'
import { startScheduler } from './scheduler'
import { createTray } from './tray'
import { createCaptureWindow, toggleCapture } from './windows/capture'
import { createFloatWindow, readFloatState, saveFloatPinned } from './windows/float'
import { createMainWindow, focusMainWindow } from './windows/main'

let db: DatabaseSync | null = null
let floatWin: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null
let captureWin: BrowserWindow | null = null
let tray: Tray | null = null
let stopScheduler: (() => void) | null = null
let closeInbox: (() => void) | null = null

const WELCOMED = 'welcomed'

const alive = (win: BrowserWindow | null): win is BrowserWindow => win !== null && !win.isDestroyed()

function showFloat(): void {
  if (!db) return
  if (!alive(floatWin)) {
    floatWin = createFloatWindow(db)
    return
  }
  floatWin.show()
  floatWin.focus()
}

function openMain(tab?: MainTab): void {
  if (!db) return
  if (alive(mainWin)) focusMainWindow(mainWin, tab)
  else mainWin = createMainWindow(db, tab)
}

function openCapture(): void {
  if (!alive(captureWin)) captureWin = createCaptureWindow()
  toggleCapture(captureWin)
}

/** Development aid: TC_SCREENSHOT_VIEW picks which window the screenshot shows. */
function showForScreenshot(): boolean {
  const view = process.env['TC_SCREENSHOT_VIEW']
  if (!process.env['TC_SCREENSHOT'] || app.isPackaged || !view) return false
  if (view === 'capture') {
    openCapture()
    if (captureWin) captureIfRequested(captureWin)
    return true
  }
  if (view === 'main') {
    const tab = process.env['TC_SCREENSHOT_TAB'] as MainTab | undefined
    openMain(tab && MAIN_TABS.includes(tab) ? tab : undefined)
    if (mainWin) captureIfRequested(mainWin)
    return true
  }
  return false
}

function start(): void {
  app.setAppUserModelId('io.github.rinne414.perch')
  const database = openDatabase(join(dataDir(), 'tasks.db'))
  db = database
  const settings = settingsReader(database)
  seedIfRequested(database, settings().dayStartHour)

  const ctx: AppContext = {
    db: database,
    settings,
    hookSetup: hookSetup(),
    broadcast: broadcastChange,
    showFloat,
    openMain,
    isFloatPinned: () => readFloatState(database).pinned,
    setFloatPinned: (on) => {
      saveFloatPinned(database, on)
      floatWin?.setAlwaysOnTop(on)
    },
  }
  registerIpc(ctx)
  tray = createTray({ showFloat, openMain: () => openMain(), openCapture, quit: () => app.quit() })
  const shortcut = settings().captureShortcut
  if (!globalShortcut.register(shortcut, openCapture)) {
    notify(
      { title: '快速記錄的快捷鍵被占用了', body: `${shortcut} 已經被別的程式用走，可以從系統匣選「快速記錄」。` },
      openCapture,
    )
  }
  const inbox = watchInbox(ctx, join(dataDir(), 'inbox'))
  closeInbox = inbox.close
  stopScheduler = startScheduler(ctx, inbox.drain)
  if (showForScreenshot()) return
  showFloat()
  if (floatWin) captureIfRequested(floatWin)
  welcomeOnce(database)
}

/** The first start opens Settings, where the agents get connected to this copy of the app. */
function welcomeOnce(database: DatabaseSync): void {
  if (process.env['TC_SCREENSHOT'] || getSetting(database, WELCOMED, false)) return
  setSetting(database, WELCOMED, true)
  openMain('settings')
}

separateDevProfile()
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Starting the app again (desktop shortcut, Start menu) opens the main window.
  app.on('second-instance', () => openMain())
  // Closing every window keeps the app alive in the tray.
  app.on('window-all-closed', () => undefined)
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopScheduler?.()
    closeInbox?.()
    tray?.destroy()
    db?.close()
  })
  void app.whenReady().then(start)
}
