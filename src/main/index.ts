import { app, globalShortcut, type BrowserWindow, type Tray } from 'electron'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { CHANNELS, MAIN_TABS, type FloatTab, type MainTab } from '@shared/ipc'
import { timerClock, type PowerState } from '@shared/power'
import { broadcastChange, settingsReader, type AppContext } from './context'
import { openDatabase } from './db/connection'
import { getSetting, setSetting } from './db/settings'
import { captureIfRequested } from './devScreenshot'
import { seedIfRequested } from './devSeed'
import { watchInbox } from './inboxWatcher'
import { registerIpc } from './ipc'
import { createLog } from './log'
import { mirrorNotifications, notify } from './notify'
import { registerClipScheme, serveClips } from './clipProtocol'
import { backupsDir, clipsDir, dataDir, hookSetup, logsDir, separateDevProfile } from './paths'
import { startPower, type PowerControl } from './power'
import { startPhone, type PhoneControl } from './phone'
import { startRestore } from './restore'
import { startScheduler } from './scheduler'
import { startDailyBackups, writeBackup } from './services/backup'
import { createObsidianSync } from './services/obsidian'
import { createTray, setTrayShutdown, type TrayActions } from './tray'
import { createCaptureWindow, toggleCapture } from './windows/capture'
import { createFloatWindow, readFloatState, saveFloatPinned } from './windows/float'
import { createMainWindow, focusMainWindow } from './windows/main'
import { createUpdater } from './updater'

let db: DatabaseSync | null = null
let floatWin: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null
let captureWin: BrowserWindow | null = null
let tray: Tray | null = null
let stopScheduler: (() => void) | null = null
let closeInbox: (() => void) | null = null
let stopBackups: (() => void) | null = null
let powerControl: PowerControl | null = null
let phoneControl: PhoneControl | null = null
let captureShortcut = ''

const log = createLog(logsDir())

const WELCOMED = 'welcomed'

const alive = (win: BrowserWindow | null): win is BrowserWindow => win !== null && !win.isDestroyed()

/** Shows the float, on `tab` when a notification says what it is about. */
function showFloat(tab?: FloatTab): void {
  if (!db) return
  if (!alive(floatWin)) {
    floatWin = createFloatWindow(db, tab)
    return
  }
  if (tab) floatWin.webContents.send(CHANNELS.floatTab, tab)
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

function registerCaptureShortcut(accelerator: string): void {
  captureShortcut = accelerator
  if (globalShortcut.register(accelerator, openCapture)) return
  log.warn(`Capture shortcut ${accelerator} is taken by another program`)
  notify(
    { title: '快速記錄的快捷鍵被占用了', body: `${accelerator} 已經被別的程式用走，按這裡到設定換一個；也可以從系統匣選「快速記錄」。` },
    () => openMain('settings'),
  )
}

/** Registers the new shortcut before letting go of the old one, so a taken key never leaves the person without one. */
function moveCaptureShortcut(next: string): boolean {
  if (globalShortcut.isRegistered(next)) return true
  if (!globalShortcut.register(next, openCapture)) return false
  if (captureShortcut) globalShortcut.unregister(captureShortcut)
  captureShortcut = next
  return true
}

/** A copy of the database right before a new version changes its shape. */
function backupBeforeUpgrade(database: DatabaseSync): void {
  try {
    log.info(`Backup before upgrading: ${basename(writeBackup(database, backupsDir(), 'before-update', new Date()))}`)
  } catch (err) {
    log.error('Backup before upgrading failed', err)
  }
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
  log.info(`Perch ${app.getVersion()} started`)
  const database = openDatabase(join(dataDir(), 'tasks.db'), backupBeforeUpgrade)
  db = database
  stopBackups = startDailyBackups(database, backupsDir(), log)
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
    log,
    updater: createUpdater(log, dataDir()),
    moveCaptureShortcut,
    syncObsidian: createObsidianSync(database, settings, log),
  }
  registerIpc(ctx)
  serveClips(database, clipsDir())
  const trayActions: TrayActions = {
    showFloat: () => showFloat(),
    openMain: () => openMain(),
    openCapture,
    cancelShutdown: () => powerControl?.power.cancel(),
    quit: () => app.quit(),
  }
  tray = createTray(trayActions)
  powerControl = startPower(ctx, trayFollowsShutdown(trayActions))
  phoneControl = startPhone(ctx, powerControl)
  mirrorNotifications((alert) => phoneControl?.push(alert))
  registerCaptureShortcut(settings().captureShortcut)
  const inbox = watchInbox(ctx, join(dataDir(), 'inbox'))
  closeInbox = inbox.close
  startRestore(ctx)
  stopScheduler = startScheduler(ctx, inbox.drain)
  if (showForScreenshot()) return
  showFloat()
  if (floatWin) captureIfRequested(floatWin)
  welcomeOnce(database)
}

/** The tray menu gets a cancel item while a shutdown is planned; rebuilt only when its words change. */
function trayFollowsShutdown(actions: TrayActions): (state: PowerState) => void {
  let shown: string | null = null
  return (state) => {
    const plan = state.plan
    const label = !plan ? null : plan.kind === 'timer' ? timerClock(plan.at, Date.now()) : '等 GPU 閒下來'
    if (label === shown || !tray) return
    shown = label
    setTrayShutdown(tray, actions, label)
  }
}

/** The first start opens Settings, where the agents get connected to this copy of the app. */
function welcomeOnce(database: DatabaseSync): void {
  if (process.env['TC_SCREENSHOT'] || getSetting(database, WELCOMED, false)) return
  setSetting(database, WELCOMED, true)
  openMain('settings')
}

separateDevProfile()
registerClipScheme()
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Kept running after these: a tray app should not die over one failed handler, but the cause must be findable.
  process.on('uncaughtException', (err) => log.error('Uncaught exception', err))
  process.on('unhandledRejection', (reason) => log.error('Unhandled rejection', reason))
  app.on('render-process-gone', (_e, _contents, details) => log.error(`A window stopped: ${details.reason} (${details.exitCode})`))
  // Starting the app again (desktop shortcut, Start menu) opens the main window.
  app.on('second-instance', () => openMain())
  // Closing every window keeps the app alive in the tray.
  app.on('window-all-closed', () => undefined)
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopScheduler?.()
    powerControl?.stop()
    phoneControl?.stop()
    stopBackups?.()
    closeInbox?.()
    tray?.destroy()
    db?.close()
  })
  void app.whenReady().then(start)
}
