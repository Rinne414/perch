import { BrowserWindow, ipcMain, shell } from 'electron'
import { statSync } from 'node:fs'
import { CHANNELS, type AppInfo, type SavedFile } from '@shared/ipc'
import { currentAway } from './awayWatch'
import type { AppContext } from './context'
import { dataDir } from './paths'
import { markTodo, unmarkTodo } from './db/todoMarks'
import { sessionKey } from './ipcArgs'
import { pickFolder, type FolderPick } from './pickFolder'
import { saveSessionPdf } from './reportPdf'
import { sessionCutoff } from './restore'
import { getBriefingPayload } from './services/briefing'
import { defaultReportsFolder } from './services/reports'
import { saveBriefingNote, saveSessionNote, sessionRecord, type ReportPlace } from './services/saveReports'
import { updateSettings } from './services/settings'

/** A report point's key: shared/todos.ts todoKey, eight hex digits. */
const TODO_KEY = /^[0-9a-f]{8}$/

function todoKey(v: unknown): string {
  if (typeof v !== 'string' || !TODO_KEY.test(v)) throw new Error('Invalid point key')
  return v
}

const PDF_PICK: FolderPick = { title: '存成 PDF 時放到哪個資料夾？', buttonLabel: '放這裡', devEnv: 'TC_PDF_DIR' }

/** 存成筆記, 存成 PDF, 存成今天的筆記, the 設定 rows that say where they go, and ticking report points off. */
export function registerReportHandlers(ctx: AppContext, appInfo: () => AppInfo): void {
  const { db } = ctx
  // Only files this run saved can be shown in Explorer: the renderer never names an arbitrary path.
  const saved = new Set<string>()
  const keep = (file: SavedFile): SavedFile => {
    saved.add(file.path)
    return file
  }
  const place = (): ReportPlace => ({ obsidianDir: ctx.settings().obsidianDir, dataDir: dataDir(), dayStartHour: ctx.settings().dayStartHour })

  ipcMain.handle(CHANNELS.getSessionRecord, (_e, i: unknown) => sessionRecord(db, sessionKey(i)))
  ipcMain.handle(CHANNELS.saveSessionNote, (_e, i: unknown) => keep(saveSessionNote(db, sessionKey(i), place())))
  ipcMain.handle(CHANNELS.saveSessionPdf, async (_e, i: unknown) => {
    const folder = ctx.settings().pdfDir ?? defaultReportsFolder(dataDir())
    return keep(await saveSessionPdf(db, sessionKey(i), folder, ctx.settings().dayStartHour))
  })
  ipcMain.handle(CHANNELS.saveBriefingNote, () => {
    const now = Date.now()
    return keep(saveBriefingNote(getBriefingPayload(db, now, ctx.settings(), sessionCutoff(), currentAway(db, now), ctx.log), place()))
  })
  ipcMain.handle(CHANNELS.markTodo, (_e, i: unknown, key: unknown) => {
    markTodo(db, sessionKey(i), todoKey(key), Date.now())
    ctx.broadcast()
  })
  ipcMain.handle(CHANNELS.unmarkTodo, (_e, i: unknown, key: unknown) => {
    unmarkTodo(db, sessionKey(i), todoKey(key))
    ctx.broadcast()
  })
  ipcMain.on(CHANNELS.showSavedFile, (_e, path: unknown) => {
    if (typeof path === 'string' && saved.has(path)) shell.showItemInFolder(path)
  })
  ipcMain.handle(CHANNELS.pickPdfFolder, async (e) => {
    const target = await pickFolder(BrowserWindow.fromWebContents(e.sender), PDF_PICK)
    if (!target) return null
    if (!statSync(target.folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Not a folder')
    updateSettings(db, { pdfDir: target.folder })
    return appInfo()
  })
  ipcMain.handle(CHANNELS.resetPdfFolder, () => {
    updateSettings(db, { pdfDir: null })
    return appInfo()
  })
  ipcMain.handle(CHANNELS.setAutoReports, (_e, on: unknown) => {
    updateSettings(db, { autoReports: on === true })
    return appInfo()
  })
}
