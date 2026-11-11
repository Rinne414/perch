import { BrowserWindow } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { SavedFile } from '@shared/ipc'
import { SAVE_ERROR } from '@shared/saveErrors'
import { rememberReportFile } from './db/reportFiles'
import { createQueue, withDeadline } from './services/printJobs'
import { reportBaseName } from './services/reportNote'
import { writePdfFile } from './services/reports'
import { sessionRecord } from './services/saveReports'
import { loadView, preloadPath } from './windows/load'

/** The whole print (load, draw, print) gets this long; then the hidden window is destroyed. */
const PRINT_LIMIT_MS = 45_000
const READY_POLL_MS = 100

/** One PDF at a time: a print and the file it claims never interleave with another. */
const printQueue = createQueue()

async function waitUntilDrawn(win: BrowserWindow): Promise<void> {
  while (!win.isDestroyed()) {
    const ready = (await win.webContents.executeJavaScript('document.body.dataset.ready ?? ""')) as string
    if (ready === 'yes') return
    if (ready === 'missing') throw new Error(`${SAVE_ERROR.sessionGone}: the print page found no such session`)
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
  }
  throw new Error(`${SAVE_ERROR.printFailed}: the print window closed`)
}

/** Rejects as soon as the page's process dies or the page fails to load. */
function whenBroken(win: BrowserWindow): Promise<never> {
  return new Promise<never>((_, reject) => {
    win.webContents.once('render-process-gone', (_e, details) =>
      reject(new Error(`${SAVE_ERROR.printFailed}: the print page stopped (${details.reason})`)),
    )
    win.webContents.once('did-fail-load', (_e, _code, description) =>
      reject(new Error(`${SAVE_ERROR.printFailed}: the print page did not load (${description})`)),
    )
  })
}

/** Draws the session on a hidden light page and prints it to A4; the page sets its own margins. */
async function printSession(sessionId: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    backgroundColor: '#ffffff',
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true },
  })
  const destroy = (): void => {
    if (!win.isDestroyed()) win.destroy()
  }
  const work = (async () => {
    await loadView(win, 'print', { session: sessionId })
    await waitUntilDrawn(win)
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, generateDocumentOutline: true })
  })()
  const broken = whenBroken(win)
  // Whichever loses the race settles later with nobody listening; that is expected, not an error.
  work.catch(() => undefined)
  broken.catch(() => undefined)
  try {
    return await withDeadline(Promise.race([work, broken]), PRINT_LIMIT_MS, destroy)
  } finally {
    destroy()
  }
}

/** 存成 PDF: the same record as the note, as a PDF in `folder`. One session keeps one file. */
export function saveSessionPdf(db: DatabaseSync, sessionId: string, folder: string, dayStartHour: number): Promise<SavedFile> {
  return printQueue(async () => {
    const { session } = sessionRecord(db, sessionId)
    const pdf = await printSession(session.id)
    const file = writePdfFile(db, folder, reportBaseName(session, dayStartHour), session.id, pdf)
    rememberReportFile(db, 'pdf', session.id, file)
    return { path: file, written: true }
  })
}
