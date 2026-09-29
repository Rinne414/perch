import { app, BrowserWindow, clipboard, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { parsePast } from '@shared/capture'
import {
  CHANNELS,
  MAIN_TABS,
  type AppInfo,
  type BatchTarget,
  type CaptureTarget,
  type MainTab,
  type PlanTarget,
  type WindowAction,
} from '@shared/ipc'
import type { AppContext } from './context'
import { acknowledgeAgent } from './db/agents'
import { completeItem, dropItem, reopenItem } from './db/items'
import { clearAgentData } from './db/sources'
import { transaction } from './db/transaction'
import { dataDir } from './paths'
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
import { createFocus, type Focus } from './services/focus'
import { captureText, dismissRecap, getNowPayload, postponeItem } from './services/now'
import { recordRoutine, removeRoutineRecord, routineHistory } from './services/routines'

const MAX_ID = 128
const MAX_TEXT = 2000
const MAX_BATCH = 500
const TARGETS: ReadonlySet<string> = new Set<CaptureTarget>(['today', 'inbox'])
const PLANS: ReadonlySet<string> = new Set<PlanTarget>(['today', 'tomorrow', 'none'])
const WINDOW_ACTIONS: ReadonlySet<string> = new Set<WindowAction>(['minimize', 'maximize', 'close'])
const BATCH_TARGETS: ReadonlySet<string> = new Set<BatchTarget>(['today', 'tomorrow', 'none', 'drop'])
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

function recordId(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) throw new Error('Invalid record id')
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
  handle(CHANNELS.createRoutine, (t: unknown, days: unknown) => {
    createRoutine(db, text(t), interval(days), Date.now())
  })
  handle(CHANNELS.updateRoutine, (i: unknown, t: unknown, days: unknown) => {
    updateRoutine(db, id(i), text(t), interval(days), Date.now())
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

function appInfo(): AppInfo {
  return {
    version: app.getVersion(),
    dataDir: dataDir(),
    openAtLogin: app.isPackaged && app.getLoginItemSettings().openAtLogin,
    canOpenAtLogin: app.isPackaged,
  }
}

function registerAppHandlers(): void {
  ipcMain.handle(CHANNELS.getAppInfo, appInfo)
  ipcMain.handle(CHANNELS.setOpenAtLogin, (_e, on: unknown) => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on === true })
    return appInfo()
  })
  ipcMain.on(CHANNELS.openDataFolder, () => void shell.openPath(dataDir()))
  ipcMain.on(CHANNELS.copyText, (_e, t: unknown) => clipboard.writeText(text(t)))
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
  registerAppHandlers()
  registerWindowHandlers(ctx)
}
