import { app, ipcMain, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { uptime } from 'node:os'
import { join } from 'node:path'
import { CHANNELS } from '@shared/ipc'
import {
  preChecked,
  RESTORE_RANGES_HOURS,
  restartTitle,
  type RestartInfo,
  type RestoreList,
  type RestoreSummary,
} from '@shared/restore'
import { claudeSessionName, findTranscripts, liveSessionIds, readClaudeRegistry } from '../integrations/claudeSessions'
import type { AppContext } from './context'
import { fillSessionNames, listUnnamed } from './db/agents'
import { getSetting, setSetting } from './db/settings'
import { notify } from './notify'
import { classifyRestart, parseShutdownEvents, type ShutdownEvent } from './services/restartKind'
import {
  bootTime,
  interruptedSessions,
  isFolder,
  LOOKBACK_MS,
  parseEpoch,
  restartTime,
  restoreCandidates,
  restoreSessions,
  skipRestore,
  START_GRACE_MS,
  terminalEnv,
  waitForStart,
  type Candidates,
} from './services/restore'

/** Reopening goes through Windows Terminal, so it is offered on Windows only. */
export const RESTORE_SUPPORTED = process.platform === 'win32'
/** Starting Perch with this (the jump list, the desktop shortcut) opens the reopen window. */
export const RESTORE_ARG = '--restore'
const APP_ID = 'io.github.rinne414.perch'
const SHORTCUT_NAME = '接回 Agent session.lnk'
/** Starts this close to the noted restart are the same one (Perch restarted, not the computer). */
const SAME_BOOT_MS = 2 * 60_000
/** The restart the notification was last shown for. */
const NOTIFIED = 'restoreNotifiedBoot'
/** Asking Windows takes about a second each; past this the answer is left unknown. */
const QUERY_TIMEOUT_MS = 15_000
const DAY_MS = 86_400_000
/** Sessions this recent without a name get one from their transcript. */
const NAME_LOOKBACK_MS = 7 * DAY_MS
/**
 * The earliest interactive sign-in (console, remote, cached) still open, in epoch milliseconds.
 * Without admin rights Windows lists only the person's own sign-ins. No input goes into it.
 */
const SIGN_IN_QUERY =
  "(Get-CimInstance Win32_LogonSession -Filter 'LogonType = 2 OR LogonType = 10 OR LogonType = 11' | " +
  'ForEach-Object { ([DateTimeOffset]$_.StartTime).ToUnixTimeMilliseconds() } | Measure-Object -Minimum).Minimum'
/** The last two weeks of unclean (41, 6008) and requested (1074) shutdowns, as JSON. No input goes into it. */
const SHUTDOWN_QUERY = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  "$e = Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,6008,1074; StartTime=(Get-Date).AddDays(-14)} -MaxEvents 80 -ErrorAction SilentlyContinue",
  '$rows = @($e | ForEach-Object { $p = $_.Properties; $asked = $_.Id -eq 1074; [pscustomobject]@{ ' +
    'id = $_.Id; at = ([DateTimeOffset]$_.TimeCreated).ToUnixTimeMilliseconds(); ' +
    "process = $(if ($asked) { [string]$p[0].Value } else { '' }); type = $(if ($asked) { [string]$p[4].Value } else { '' }); " +
    "note = $(if ($asked) { [string]$p[5].Value } else { '' }) } })",
  'ConvertTo-Json -InputObject $rows -Compress',
  'exit 0',
].join('; ')

const bootAt = bootTime(Date.now(), uptime())
/** The boot until the sign-in time is known (`startRestore`), then whichever is later. */
let cutoffAt = bootAt
let restart: RestartInfo | null = null
/** Claude Code's running sessions as last asked (startup, every listing); null until known or when unreadable. */
let liveCache: ReadonlySet<string> | null = null
/** Settles once the cut-off and the kind of restart are known (or could not be found out). */
let restartKnown: Promise<void> = Promise.resolve()

/** Since when sessions from before count as cut off: the last restart, or the sign-in after it. */
export const sessionCutoff = (): number => cutoffAt

const powershell = (): string =>
  join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

function runPowerShell(script: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(powershell(), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: QUERY_TIMEOUT_MS }, (err, stdout) =>
      resolve(err ? null : stdout),
    )
  })
}

const readSignInTime = async (): Promise<number | null> => {
  const out = await runPowerShell(SIGN_IN_QUERY)
  return out === null ? null : parseEpoch(out)
}

/** The event log, or in a development build a stand-in file (TC_RESTART_EVENTS) to show other kinds of restart. */
async function readShutdownEvents(): Promise<ShutdownEvent[]> {
  const fake = !app.isPackaged ? process.env['TC_RESTART_EVENTS'] : undefined
  if (fake) return parseShutdownEvents(readFileSync(fake, 'utf8'))
  return parseShutdownEvents((await runPowerShell(SHUTDOWN_QUERY)) ?? '')
}

/** When each of these processes started (FILETIME, UTC); null when Windows could not be asked. */
async function processStarts(pids: readonly number[]): Promise<Map<number, string> | null> {
  const ids = pids.filter((p) => Number.isSafeInteger(p) && p > 0)
  if (ids.length === 0) return new Map()
  const out = await runPowerShell(
    `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.StartTime.ToFileTimeUtc())" }; exit 0`,
  )
  if (out === null) return null
  const starts = new Map<number, string>()
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\d+) (\d+)$/.exec(line.trim())
    if (m) starts.set(Number(m[1]), m[2])
  }
  return starts
}

/** Claude Code sessions running now, by its own list; null when that list or the processes cannot be read. */
async function liveClaude(home: string): Promise<ReadonlySet<string> | null> {
  const entries = readClaudeRegistry(home)
  const starts = entries ? await processStarts(entries.map((e) => e.pid)) : null
  liveCache = entries && starts ? liveSessionIds(entries, starts) : null
  return liveCache
}

/** Sessions whose transcript was already searched for a name, found or not: each is read once per run. */
const nameSearched = new Set<string>()

/** Cut off by the restart and not running again (a Claude Code session resumed by hand has not reported yet). */
const stillCutOff = (db: AppContext['db']): ReturnType<typeof interruptedSessions> =>
  interruptedSessions(db, cutoffAt).filter((s) => !(s.agent === 'claude-code' && liveCache?.has(s.sessionId)))

/** Claude Code sessions recorded before Perch kept names get the one /resume shows. */
function fillClaudeNames(ctx: AppContext): void {
  const unnamed = listUnnamed(ctx.db, 'claude-code', Date.now() - NAME_LOOKBACK_MS).filter((s) => !nameSearched.has(s.id))
  if (unnamed.length === 0) return
  for (const s of unnamed) nameSearched.add(s.id)
  const files = findTranscripts(
    ctx.hookSetup.home,
    unnamed.map((s) => s.sessionId),
  )
  const names = new Map<string, string>()
  for (const s of unnamed) {
    const name = claudeSessionName(files.get(s.sessionId))
    if (name) names.set(s.id, name)
  }
  fillSessionNames(ctx.db, names)
}

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

/** For the Agent tab: the line after a restart. Null where reopening is not offered. */
export function restoreSummary(ctx: Pick<AppContext, 'db'>): RestoreSummary | null {
  if (!RESTORE_SUPPORTED) return null
  const interrupted = stillCutOff(ctx.db).length
  return { restart: interrupted > 0 ? restart : null, interrupted }
}

const rangeOf = (hours: unknown): number =>
  (RESTORE_RANGES_HOURS as readonly number[]).includes(hours as number) ? (hours as number) : RESTORE_RANGES_HOURS[0]

async function candidates(ctx: AppContext, rangeHours: number): Promise<Candidates> {
  try {
    fillClaudeNames(ctx)
  } catch (err) {
    ctx.log.error('Could not read Claude Code session names', err)
  }
  return restoreCandidates(ctx.db, {
    now: Date.now(),
    cutoffAt,
    rangeMs: rangeHours * 3_600_000,
    liveClaude: await liveClaude(ctx.hookSetup.home).catch(() => null),
    folderExists: isFolder,
  })
}

/** A shortcut that opens the reopen window, on the desktop (a test folder in development). */
function makeShortcut(): string {
  const dir = (!app.isPackaged && process.env['TC_SHORTCUT_DIR']) || app.getPath('desktop')
  const file = join(dir, SHORTCUT_NAME)
  const args = app.isPackaged ? RESTORE_ARG : `"${app.getAppPath()}" ${RESTORE_ARG}`
  const ok = shell.writeShortcutLink(file, existsSync(file) ? 'replace' : 'create', {
    target: process.execPath,
    args,
    description: '打開 Perch，挑要接回的 Agent session',
    icon: process.execPath,
    iconIndex: 0,
    appUserModelId: APP_ID,
  })
  if (!ok) throw new Error('捷徑沒有建立成功')
  return file
}

/** Once per restart: how many sessions were cut off and how; the click opens the reopen window. */
function announce(ctx: AppContext): void {
  const count = stillCutOff(ctx.db).length
  if (count === 0) return
  const noted = getSetting<number | null>(ctx.db, NOTIFIED, null)
  if (noted !== null && Math.abs(noted - cutoffAt) < SAME_BOOT_MS) return
  setSetting(ctx.db, NOTIFIED, cutoffAt)
  ctx.log.info(`${count} agent sessions were open before the restart (${restart?.kind ?? 'unknown'})`)
  notify(
    {
      title: restartTitle(restart, count),
      body: preChecked(restart?.kind) ? '按這裡接回，當時開著的已經先勾好。' : '按這裡挑要接回哪些。',
    },
    () => ctx.openRestore(),
  )
}

/** Works out the cut-off and how the computer went down, then tells the person once. */
async function readRestart(ctx: AppContext): Promise<void> {
  // Claude Code's list only refines the count; without it the restart is still worked out.
  const live = liveClaude(ctx.hookSetup.home).catch(() => null)
  const [signedInAt, events] = await Promise.all([readSignInTime(), readShutdownEvents(), live])
  cutoffAt = restartTime(bootAt, signedInAt, Date.now())
  const cut = interruptedSessions(ctx.db, cutoffAt)
  const lastActive = cut.length > 0 ? Math.max(...cut.map((s) => s.updatedAt)) : cutoffAt - LOOKBACK_MS
  restart = classifyRestart(events, lastActive, bootAt, cutoffAt)
  const at = (ms: number | null): string => (ms === null ? 'unknown' : new Date(ms).toISOString())
  ctx.log.info(
    `Sessions from before ${at(cutoffAt)} count as cut off (boot ${at(bootAt)}, sign-in ${at(signedInAt)}); ` +
      `last went down: ${restart.kind}${restart.by ? ` by ${restart.by}` : ''} at ${at(restart.at)}`,
  )
  ctx.broadcast()
  // Screenshot runs of a development build show the list without a notification on the desktop.
  if (process.env['TC_SCREENSHOT'] && !app.isPackaged) return
  announce(ctx)
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

/**
 * The reopen window's IPC, names for old Claude Code sessions, the taskbar jump list, and after
 * a restart one notification when sessions were cut off. Call after the inbox has been read,
 * so reports written while Perch was not running count.
 */
export function startRestore(ctx: AppContext): void {
  // One restore at a time: a second click (another window, a remounted list) must not open the batch twice.
  let restoring = false
  ipcMain.handle(CHANNELS.listRestore, async (_e, hours: unknown): Promise<RestoreList> => {
    await restartKnown
    const rangeHours = rangeOf(hours)
    const found = await candidates(ctx, rangeHours)
    return {
      restart: found.interrupted.length > 0 ? restart : null,
      ...found,
      preChecked: preChecked(restart?.kind),
      rangeHours,
      cutoffAt,
    }
  })
  ipcMain.handle(CHANNELS.restoreSessions, async (_e, open: unknown, skip: unknown, hours: unknown) => {
    if (!RESTORE_SUPPORTED) throw new Error('只有 Windows 能接回 session')
    if (restoring) throw new Error('上一批還在開，等一下')
    restoring = true
    try {
      const listed = await candidates(ctx, rangeOf(hours))
      const result = await restoreSessions(ctx.db, strings(open), strings(skip), listed, Date.now(), { folderExists: isFolder, openTerminal })
      ctx.log.info(`Reopened ${result.opened} agent sessions in Windows Terminal; ${result.missing.length} folders missing`)
      ctx.broadcast()
      return result
    } finally {
      restoring = false
    }
  })
  ipcMain.handle(CHANNELS.skipRestore, (_e, ids: unknown) => {
    skipRestore(ctx.db, strings(ids), cutoffAt, Date.now())
    ctx.broadcast()
  })
  ipcMain.handle(CHANNELS.openRestore, () => ctx.openRestore())
  ipcMain.handle(CHANNELS.restoreShortcut, () => {
    if (!RESTORE_SUPPORTED) throw new Error('只有 Windows 能放捷徑')
    const file = makeShortcut()
    ctx.log.info(`Shortcut to the reopen window: ${file}`)
    return file
  })

  setTimeout(() => {
    try {
      fillClaudeNames(ctx)
      ctx.broadcast()
    } catch (err) {
      ctx.log.error('Could not read Claude Code session names', err)
    }
  }, 2_000)

  if (!RESTORE_SUPPORTED) return
  if (app.isPackaged) {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: RESTORE_ARG,
        iconPath: process.execPath,
        iconIndex: 0,
        title: '接回 Agent session',
        description: '挑要接回的 session，在 Windows Terminal 一次開好',
      },
    ])
  }
  restartKnown = readRestart(ctx).catch((err: unknown) => ctx.log.error('Could not look for sessions open before the restart', err))
}
