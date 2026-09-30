import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { mkdirSync } from 'node:fs'
import { release } from 'node:os'
import { basename } from 'node:path'
import { parsePast } from '@shared/capture'
import { parseSchedule } from '@shared/schedule'
import { isCaptureAccelerator } from '@shared/shortcut'
import {
  APP_FOLDERS,
  CHANNELS,
  GLASS_LEVELS,
  MAIN_TABS,
  type AppFolder,
  type AppInfo,
  type ExportResult,
  type BatchTarget,
  type CaptureTarget,
  type GlassLevel,
  type MainTab,
  type PlanTarget,
  type WindowAction,
} from '@shared/ipc'
import type { AppContext } from './context'
import { acknowledgeAgent } from './db/agents'
import { completeItem, dropItem, reopenItem } from './db/items'
import { clearAgentData } from './db/sources'
import { transaction } from './db/transaction'
import { backupsDir, dataDir } from './paths'
import { listBackups } from './services/backup'
import { writeExport } from './services/export'
import { issueUrl } from './services/report'
import { integrationsPayload, setHook } from './services/integrations'
import {
  addStep,
  createBatchUndo,
  createRoutine,
  createTrash,
  getMainPayload,
  planItem,
  renameItem,
  rescheduleOverdue,
  setDue,
  updateRoutine,
} from './services/manage'
import { addManualEntry, captureOn, dayView, monthMarks, removeManualEntry } from './services/calendar'
import { createFocus, type Focus } from './services/focus'
import { captureText, dismissRecap, getNowPayload, postponeItem } from './services/now'
import { recordRoutine, removeRoutineRecord, routineHistory } from './services/routines'
import { updateSettings } from './services/settings'

const MAX_ID = 128
const MAX_TEXT = 2000
const MAX_BATCH = 500
const TARGETS: ReadonlySet<string> = new Set<CaptureTarget>(['today', 'inbox'])
const PLANS: ReadonlySet<string> = new Set<PlanTarget>(['today', 'tomorrow', 'none'])
const WINDOW_ACTIONS: ReadonlySet<string> = new Set<WindowAction>(['minimize', 'maximize', 'close'])
const BATCH_TARGETS: ReadonlySet<string> = new Set<BatchTarget>(['today', 'tomorrow', 'none', 'drop'])
const FOLDERS: ReadonlySet<string> = new Set<AppFolder>(APP_FOLDERS)
const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

function id(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID) throw new Error('Invalid id')
  return v
}

function text(v: unknown): string {
  if (typeof v !== 'string' || !v.trim() || v.length > MAX_TEXT) throw new Error('Text must be 1-2000 characters')
  return v
}

function oneOf<T extends string>(allowed: ReadonlySet<string>, v: unknown, what: string): T {
  if (typeof v !== 'string' || !allowed.has(v)) throw new Error(`Invalid ${what}`)
  return v as T
}

/** An interval in days, or null for a tracker without one. */
const interval = (v: unknown): number | null => (v === null ? null : Number(v))

/** Fixed weekly times, or null / missing for none. */
const schedule = (v: unknown) => (v === null || v === undefined ? null : parseSchedule(v))

function recordId(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) throw new Error('Invalid record id')
  return v
}

const DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MAX_RANGE_DAYS = 60

function day(v: unknown): string {
  if (typeof v !== 'string' || !DAY_KEY.test(v)) throw new Error('Invalid day')
  return v
}

function ids(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_BATCH) throw new Error('Invalid id list')
  return v.map(id)
}

function agent(v: unknown): string {
  if (typeof v !== 'string' || !AGENT_NAME.test(v)) throw new Error('Invalid agent name')
  return v
}

/** Wraps a mutation so every window refreshes after it. */
const mutating =
  <A extends unknown[], R>(ctx: AppContext, fn: (...args: A) => R) =>
  (_e: IpcMainInvokeEvent, ...args: A): R => {
    const result = fn(...args)
    ctx.broadcast()
    return result
  }

function registerItemHandlers(ctx: AppContext, focus: Focus): void {
  const { db } = ctx
  const trash = createTrash()
  const batches = createBatchUndo()
  const handle = <A extends unknown[]>(channel: string, fn: (...args: A) => unknown): void => {
    ipcMain.handle(channel, mutating(ctx, fn))
  }
  handle(CHANNELS.capture, (t: unknown, target: unknown) =>
    captureText(db, text(t), oneOf<CaptureTarget>(TARGETS, target, 'capture target'), Date.now(), ctx.settings()),
  )
  handle(CHANNELS.complete, (i: unknown) => void completeItem(db, id(i), Date.now()))
  handle(CHANNELS.reopen, (i: unknown) => void reopenItem(db, id(i), Date.now()))
  handle(CHANNELS.postpone, (i: unknown) => void postponeItem(db, id(i), Date.now(), ctx.settings()))
  handle(CHANNELS.plan, (i: unknown, target: unknown) => {
    planItem(db, id(i), oneOf<PlanTarget>(PLANS, target, 'plan'), Date.now(), ctx.settings())
  })
  handle(CHANNELS.setDue, (i: unknown, t: unknown) => {
    setDue(db, id(i), t === null ? null : text(t), Date.now(), ctx.settings())
  })
  handle(CHANNELS.rename, (i: unknown, t: unknown) => void renameItem(db, id(i), text(t), Date.now()))
  handle(CHANNELS.remove, (i: unknown) => trash.remove(db, id(i)))
  handle(CHANNELS.drop, (i: unknown) => void dropItem(db, id(i), Date.now()))
  handle(CHANNELS.rescheduleOverdue, (list: unknown, target: unknown) => {
    const chosen = ids(list)
    const how = oneOf<BatchTarget>(BATCH_TARGETS, target, 'batch target')
    const token = batches.save(db, chosen)
    rescheduleOverdue(db, chosen, how, Date.now(), ctx.settings())
    return token
  })
  handle(CHANNELS.undoBatch, (token: unknown) => batches.restore(db, text(token), Date.now()))
  handle(CHANNELS.undoRemove, (i: unknown) => trash.restore(db, id(i)))
  handle(CHANNELS.addStep, (p: unknown, t: unknown) => void addStep(db, id(p), text(t), Date.now()))
  handle(CHANNELS.createRoutine, (t: unknown, days: unknown, s: unknown) => {
    createRoutine(db, text(t), interval(days), Date.now(), schedule(s))
  })
  handle(CHANNELS.updateRoutine, (i: unknown, t: unknown, days: unknown, s: unknown) => {
    updateRoutine(db, id(i), text(t), interval(days), Date.now(), schedule(s))
  })
  ipcMain.handle(CHANNELS.getRoutineHistory, (_e, i: unknown) => routineHistory(db, id(i)))
  handle(CHANNELS.recordRoutine, (i: unknown, when: unknown) => {
    const now = Date.now()
    const at = parsePast(text(when), now, ctx.settings().dayStartHour)
    if (at === null) throw new Error('No past time found in the text')
    recordRoutine(db, id(i), at, now)
  })
  handle(CHANNELS.removeRoutineRecord, (r: unknown) => void removeRoutineRecord(db, recordId(r), Date.now()))
  handle(CHANNELS.startFocus, (i: unknown, step: unknown) => {
    focus.start(db, id(i), step === null ? null : id(step), Date.now())
  })
  handle(CHANNELS.extendFocus, () => void focus.extend())
  handle(CHANNELS.stopFocus, () => focus.stop(db, Date.now()))
  ipcMain.handle(CHANNELS.getMonth, (_e, from: unknown, to: unknown) => {
    const [a, b] = [day(from), day(to)]
    const span = (Date.parse(b) - Date.parse(a)) / 86_400_000
    if (span < 0 || span > MAX_RANGE_DAYS) throw new Error('Invalid range')
    return monthMarks(db, a, b, ctx.settings())
  })
  ipcMain.handle(CHANNELS.getDay, (_e, d: unknown) => dayView(db, day(d), Date.now(), ctx.settings()))
  handle(CHANNELS.captureOn, (t: unknown, d: unknown) => void captureOn(db, text(t), day(d), Date.now(), ctx.settings()))
  handle(CHANNELS.addManualEntry, (d: unknown, t: unknown) => void addManualEntry(db, day(d), text(t), Date.now(), ctx.settings()))
  handle(CHANNELS.removeManualEntry, (r: unknown) => removeManualEntry(db, recordId(r)))
  handle(CHANNELS.acknowledgeAgents, (list: unknown) => {
    const now = Date.now()
    transaction(db, () => ids(list).forEach((i) => acknowledgeAgent(db, i, now)))
  })
  handle(CHANNELS.dismissRecap, () => dismissRecap(db, Date.now(), ctx.settings()))
}

function registerIntegrationHandlers(ctx: AppContext): void {
  const { db, hookSetup } = ctx
  ipcMain.handle(CHANNELS.getIntegrations, () => integrationsPayload(db, hookSetup))
  ipcMain.handle(CHANNELS.setHook, (_e, a: unknown, on: unknown) => {
    setHook(agent(a), on === true, hookSetup)
    return integrationsPayload(db, hookSetup)
  })
  ipcMain.handle(
    CHANNELS.clearAgentData,
    mutating(ctx, (a: unknown) => clearAgentData(db, agent(a))),
  )
}

function registerAppHandlers(ctx: AppContext): void {
  const appInfo = (): AppInfo => ({
    version: app.getVersion(),
    dataDir: dataDir(),
    openAtLogin: app.isPackaged && app.getLoginItemSettings().openAtLogin,
    canOpenAtLogin: app.isPackaged,
    glass: ctx.settings().glass,
    captureShortcut: ctx.settings().captureShortcut,
    lastBackupAt: listBackups(backupsDir())[0]?.at ?? null,
  })
  ipcMain.handle(CHANNELS.getAppInfo, appInfo)
  ipcMain.handle(CHANNELS.setOpenAtLogin, (_e, on: unknown) => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on === true })
    return appInfo()
  })
  ipcMain.handle(
    CHANNELS.setGlass,
    mutating(ctx, (level: unknown) => {
      updateSettings(ctx.db, { glass: oneOf<GlassLevel>(new Set(GLASS_LEVELS), level, 'glass level') })
      return appInfo()
    }),
  )
  ipcMain.handle(CHANNELS.setCaptureShortcut, (_e, accelerator: unknown) => {
    if (typeof accelerator !== 'string' || !isCaptureAccelerator(accelerator)) throw new Error('Invalid shortcut')
    if (!ctx.moveCaptureShortcut(accelerator)) return null
    updateSettings(ctx.db, { captureShortcut: accelerator })
    return appInfo()
  })
  ipcMain.on(CHANNELS.copyText, (_e, t: unknown) => clipboard.writeText(text(t)))
}

/** The folder picker, or TC_EXPORT_DIR in a development run so tests need no dialog. */
async function exportFolder(win: BrowserWindow | null): Promise<{ folder: string; reveal: boolean } | null> {
  const devDir = app.isPackaged ? undefined : process.env['TC_EXPORT_DIR']
  if (devDir) return { folder: devDir, reveal: false }
  const options: Electron.OpenDialogOptions = {
    title: '匯出到哪個資料夾？',
    defaultPath: app.getPath('documents'),
    buttonLabel: '匯出到這裡',
    properties: ['openDirectory', 'createDirectory'],
  }
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const folder = picked.canceled ? undefined : picked.filePaths[0]
  return folder ? { folder, reveal: true } : null
}

/** Backups, logs, export, problem reports and updates. */
function registerUpkeepHandlers(ctx: AppContext): void {
  const folders: Readonly<Record<AppFolder, () => string>> = {
    data: dataDir,
    backups: backupsDir,
    logs: () => ctx.log.dir,
  }
  ipcMain.on(CHANNELS.openFolder, (_e, f: unknown) => {
    if (typeof f !== 'string' || !FOLDERS.has(f)) return
    const dir = folders[f as AppFolder]()
    mkdirSync(dir, { recursive: true })
    void shell.openPath(dir)
  })
  ipcMain.handle(CHANNELS.exportData, async (e): Promise<ExportResult | null> => {
    const target = await exportFolder(BrowserWindow.fromWebContents(e.sender))
    if (!target) return null
    const { json, markdown } = writeExport(ctx.db, target.folder, app.getVersion(), ctx.settings(), Date.now())
    ctx.log.info('Exported all data')
    if (target.reveal) shell.showItemInFolder(markdown)
    return { folder: target.folder, files: [basename(json), basename(markdown)] }
  })
  ipcMain.on(CHANNELS.reportProblem, () => void shell.openExternal(issueUrl(app.getVersion(), release(), process.arch)))
  ipcMain.handle(CHANNELS.getUpdateStatus, () => ctx.updater.status())
  ipcMain.handle(CHANNELS.checkForUpdate, () => ctx.updater.check())
  ipcMain.on(CHANNELS.installUpdate, () => ctx.updater.install())
}

function registerWindowHandlers(ctx: AppContext): void {
  ipcMain.handle(
    CHANNELS.setPinned,
    mutating(ctx, (on: unknown) => ctx.setFloatPinned(on === true)),
  )
  ipcMain.on(CHANNELS.openMain, (_e, tab: unknown) => {
    ctx.openMain(MAIN_TABS.includes(tab as MainTab) ? (tab as MainTab) : undefined)
  })
  ipcMain.on(CHANNELS.windowAction, (e, action: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || typeof action !== 'string' || !WINDOW_ACTIONS.has(action)) return
    if (action === 'minimize') win.minimize()
    else if (action === 'close') win.close()
    else if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(CHANNELS.hideWindow, (e) => BrowserWindow.fromWebContents(e.sender)?.hide())
}

export function registerIpc(ctx: AppContext): void {
  const { db } = ctx
  const focus = createFocus()
  ipcMain.handle(CHANNELS.getNow, () =>
    getNowPayload(db, Date.now(), ctx.settings(), ctx.isFloatPinned(), focus.current(db)),
  )
  ipcMain.handle(CHANNELS.getMain, () => getMainPayload(db, Date.now(), ctx.settings(), focus.current(db)))
  registerItemHandlers(ctx, focus)
  registerIntegrationHandlers(ctx)
  registerAppHandlers(ctx)
  registerUpkeepHandlers(ctx)
  registerWindowHandlers(ctx)
}
