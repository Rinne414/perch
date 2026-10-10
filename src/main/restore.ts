import { app, ipcMain } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { uptime } from 'node:os'
import { join } from 'node:path'
import { CHANNELS } from '@shared/ipc'
import type { AppContext } from './context'
import { getSetting, setSetting } from './db/settings'
import { notify } from './notify'
import {
  bootTime,
  interruptedSessions,
  isFolder,
  parseEpoch,
  restartTime,
  restoreSessions,
  skipRestore,
  START_GRACE_MS,
  terminalEnv,
  waitForStart,
} from './services/restore'

/** Reopening goes through Windows Terminal, so it is offered on Windows only. */
const SUPPORTED = process.platform === 'win32'
/** Starts this close to the noted restart are the same one (Perch restarted, not the computer). */
const SAME_BOOT_MS = 2 * 60_000
/** The restart the "重開機前有 N 個 session 還開著" notification was last shown for. */
const NOTIFIED = 'restoreNotifiedBoot'
/** Asking Windows for the sign-in time takes about a second; past this it is left at the boot. */
const SIGN_IN_TIMEOUT_MS = 15_000
/**
 * The earliest interactive sign-in (console, remote, cached) still open, in epoch milliseconds.
 * Without admin rights Windows lists only the person's own sign-ins. No input goes into it.
 */
const SIGN_IN_QUERY =
  "(Get-CimInstance Win32_LogonSession -Filter 'LogonType = 2 OR LogonType = 10 OR LogonType = 11' | " +
  'ForEach-Object { ([DateTimeOffset]$_.StartTime).ToUnixTimeMilliseconds() } | Measure-Object -Minimum).Minimum'

/** The boot until the sign-in time is known (`startRestore`), then whichever is later. */
let restartAt: number | null = SUPPORTED ? bootTime(Date.now(), uptime()) : null

/** Since when sessions from before count as cut off (see `restartTime`); null where reopening is not offered. */
export const restoreBootAt = (): number | null => restartAt

function readSignInTime(): Promise<number | null> {
  const powershell = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise((resolve) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command', SIGN_IN_QUERY], { windowsHide: true, timeout: SIGN_IN_TIMEOUT_MS }, (err, stdout) =>
      resolve(err ? null : parseEpoch(stdout)),
    )
  })
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

/** The Store app's alias (a link `existsSync` cannot follow, so lstat), else whatever PATH finds. */
function wtPath(): string {
  const local = process.env['LOCALAPPDATA']
  const alias = local ? join(local, 'Microsoft', 'WindowsApps', 'wt.exe') : null
  return alias && lstatSync(alias, { throwIfNoEntry: false }) ? alias : 'wt.exe'
}

/** Starts Windows Terminal with an argument array (no shell); it keeps running after Perch. */
function openTerminal(args: readonly string[]): Promise<void> {
  const child = spawn(wtPath(), args, { detached: true, stdio: 'ignore', env: terminalEnv(process.env) })
  child.unref()
  return waitForStart(child, START_GRACE_MS)
}

/** Once per boot: says how many sessions were still open before the restart; the click opens the Agent tab. */
function announce(ctx: AppContext, bootAt: number): void {
  const count = interruptedSessions(ctx.db, bootAt).length
  if (count === 0) return
  const noted = getSetting<number | null>(ctx.db, NOTIFIED, null)
  if (noted !== null && Math.abs(noted - bootAt) < SAME_BOOT_MS) return
  setSetting(ctx.db, NOTIFIED, bootAt)
  ctx.log.info(`${count} agent sessions were open before the restart`)
  notify(
    { title: `重開機前有 ${count} 個 session 還開著`, body: '按這裡挑要接回哪些，Perch 會在 Windows Terminal 一次開好。' },
    () => ctx.openMain('agents'),
  )
}

/**
 * After a restart: the IPC that reopens the sessions in Windows Terminal (or skips them), and
 * one notification when some were open. Call after the inbox has been read, so reports written
 * while Perch was not running count.
 */
export function startRestore(ctx: AppContext): void {
  // One restore at a time: a second click (another window, a remounted list) must not open the batch twice.
  let restoring = false
  ipcMain.handle(CHANNELS.restoreSessions, async (_e, open: unknown, skip: unknown) => {
    const bootAt = restoreBootAt()
    if (bootAt === null) throw new Error('Only Windows can reopen sessions')
    if (restoring) throw new Error('上一批還在開，等一下')
    restoring = true
    try {
      const result = await restoreSessions(ctx.db, strings(open), strings(skip), bootAt, Date.now(), { folderExists: isFolder, openTerminal })
      ctx.log.info(`Reopened ${result.opened} agent sessions in Windows Terminal; ${result.missing.length} folders missing`)
      ctx.broadcast()
      return result
    } finally {
      restoring = false
    }
  })
  ipcMain.handle(CHANNELS.skipRestore, (_e, ids: unknown) => {
    const bootAt = restoreBootAt()
    if (bootAt === null) return
    skipRestore(ctx.db, strings(ids), bootAt, Date.now())
    ctx.broadcast()
  })
  if (restartAt === null) return
  const bootAt = restartAt
  void readSignInTime().then((signedInAt) => {
    restartAt = restartTime(bootAt, signedInAt, Date.now())
    const at = (ms: number | null): string => (ms === null ? 'unknown' : new Date(ms).toISOString())
    ctx.log.info(`Sessions from before ${at(restartAt)} count as cut off (boot ${at(bootAt)}, sign-in ${at(signedInAt)})`)
    ctx.broadcast()
    // Screenshot runs of a development build show the list without a notification on the desktop.
    if (process.env['TC_SCREENSHOT'] && !app.isPackaged) return
    try {
      announce(ctx, restartAt)
    } catch (err) {
      ctx.log.error('Could not look for sessions open before the restart', err)
    }
  })
}
