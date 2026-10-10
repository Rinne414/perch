import type { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { REOPENABLE_AGENTS, resumeArgs } from '@shared/agents'
import type { RestoreResult } from '@shared/ipc'
import type { AgentSession } from '@shared/types'
import { listOpenSessions, markSessionsEnded, markSessionsReopened } from '../db/agents'

/** How long before a restart a session may have last shown life and still count as open. */
export const LOOKBACK_MS = 12 * 3_600_000
/** More tabs than this in one window is no longer a restore. */
export const MAX_SESSIONS = 30

/**
 * A folder on a drive (C:\…). Network shares (\\server\share) are left out: cmd cannot start in
 * one, so the agent would resume in C:\Windows and miss its conversation.
 */
const DRIVE_PATH = /^[A-Za-z]:[\\/]/

/** When the computer last started, from its uptime in seconds (`os.uptime()`). */
export const bootTime = (now: number, uptimeSeconds: number): number => now - Math.round(uptimeSeconds * 1000)

/** The first number in a command's output (epoch milliseconds), or null. */
export function parseEpoch(text: string): number | null {
  const match = /\d{10,}/.exec(text)
  return match ? Number(match[0]) : null
}

/**
 * Since when every agent session from before is gone: the sign-in to Windows, which signing
 * out, a crash, a restart and a Fast Startup shut down (which keeps the uptime) all end. Never
 * before the boot; the boot when the sign-in is unknown or makes no sense. Too early only
 * offers fewer sessions; it can never offer one that is still running.
 */
export function restartTime(bootAt: number, signedInAt: number | null, now: number): number {
  if (signedInAt === null || !Number.isFinite(signedInAt) || signedInAt > now) return bootAt
  return Math.max(bootAt, signedInAt)
}

/**
 * Sessions still open in a terminal when the computer restarted (or the person signed out),
 * newest first: they never reported closing, showed life in the 12 hours before `bootAt`
 * (see `restartTime`), and can be resumed. Restoring or skipping them takes them off this list.
 */
export function interruptedSessions(db: DatabaseSync, bootAt: number): AgentSession[] {
  // Read twice the limit: rows dropped by the filter must not use up its places.
  return listOpenSessions(db, bootAt - LOOKBACK_MS, bootAt, REOPENABLE_AGENTS, MAX_SESSIONS * 2)
    .filter((s) => resumeArgs(s) !== null && s.cwd !== null && DRIVE_PATH.test(s.cwd))
    .slice(0, MAX_SESSIONS)
}

/**
 * Variables a running Claude Code gives the programs it starts. Windows Terminal hands the
 * caller's environment to new tabs, so a Perch started from inside a Claude Code session would
 * make every reopened claude think it is a child session (it then stops saving its transcript).
 */
const AGENT_SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(CHILD_SESSION|SESSION_\w+|ENTRYPOINT|MESSAGING_\w+|EXECPATH|SSE_PORT))$/i

/**
 * The environment for the terminal: Perch's own, minus the markers of a session Perch may have
 * been started from. NoDefaultCurrentDirectoryInExePath stops cmd from looking in the project
 * folder first, so a `claude.cmd` in a cloned repository is never what runs.
 */
export function terminalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([name]) => !AGENT_SESSION_VARS.test(name))),
    NoDefaultCurrentDirectoryInExePath: '1',
  }
}

/** Only a folder on a drive that is still there. */
export const isFolder = (path: string): boolean => DRIVE_PATH.test(path) && statSync(path, { throwIfNoEntry: false })?.isDirectory() === true

/** How long wt.exe gets to fail before it counts as started (it normally hands over to the window and exits 0). */
export const START_GRACE_MS = 2_000

/**
 * Settles once a started wt.exe either exits (0 = fine, anything else = it refused) or is still
 * running after `graceMs`. `error` (not found, not allowed) rejects at once.
 */
export function waitForStart(child: EventEmitter, graceMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    child.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new Error(err.code === 'ENOENT' ? '找不到 Windows Terminal（wt.exe）' : `Windows Terminal 沒有打開（${err.code ?? err.message}）`))
    })
    child.once('spawn', () => {
      timer = setTimeout(resolve, graceMs)
    })
    child.once('exit', (code: number | null) => {
      clearTimeout(timer)
      if (code === null || code === 0) resolve()
      else reject(new Error(`Windows Terminal 沒有打開（結束代碼 ${code}）`))
    })
  })
}

/** Windows Terminal reads `;` as "next command"; `\;` keeps it inside the argument. */
export const wtEscape = (arg: string): string => arg.replace(/;/g, '\\;')

export interface WtPlan {
  /** Arguments for wt.exe; empty when there is nothing to open. */
  readonly args: readonly string[]
  readonly opened: readonly AgentSession[]
  /** Left out because their folder is gone. */
  readonly missing: readonly AgentSession[]
}

/**
 * One new Windows Terminal window with a tab per session, each in its folder:
 * `-w new new-tab -d <folder> cmd /k claude --resume <id> ; new-tab …`. The arguments go
 * to wt.exe as an array, never through a shell; cmd /k keeps a tab open when the agent
 * cannot start, so its message stays readable.
 */
export function wtPlan(sessions: readonly AgentSession[], folderExists: (path: string) => boolean): WtPlan {
  const args: string[] = ['-w', 'new']
  const opened: AgentSession[] = []
  const missing: AgentSession[] = []
  for (const s of sessions) {
    const resume = resumeArgs(s)
    if (!resume || !s.cwd) continue
    if (!folderExists(s.cwd)) {
      missing.push(s)
      continue
    }
    if (opened.length > 0) args.push(';')
    args.push('new-tab', '-d', wtEscape(s.cwd), 'cmd', '/k', ...resume)
    opened.push(s)
  }
  return { args: opened.length > 0 ? args : [], opened, missing }
}

export interface RestoreDeps {
  readonly folderExists: (path: string) => boolean
  /** Starts Windows Terminal; rejects when it cannot. */
  readonly openTerminal: (args: readonly string[]) => Promise<void>
}

/**
 * Reopens the chosen sessions of the current batch in one Windows Terminal window. The ones
 * in `skip` and the ones whose folder is gone count as closed, so they are not offered again.
 * Ids outside the current batch are ignored. Nothing is marked when the terminal fails to start.
 */
export async function restoreSessions(
  db: DatabaseSync,
  open: readonly string[],
  skip: readonly string[],
  bootAt: number,
  now: number,
  deps: RestoreDeps,
): Promise<RestoreResult> {
  const batch = interruptedSessions(db, bootAt)
  const chosen = new Set(open)
  const plan = wtPlan(
    batch.filter((s) => chosen.has(s.id)),
    deps.folderExists,
  )
  if (plan.opened.length > 0) await deps.openTerminal(plan.args)
  markSessionsReopened(
    db,
    plan.opened.map((s) => s.id),
    now,
  )
  const skipped = new Set(skip)
  markSessionsEnded(
    db,
    batch.filter((s) => skipped.has(s.id) || plan.missing.includes(s)).map((s) => s.id),
    now,
  )
  return { opened: plan.opened.length, missing: plan.missing.map((s) => s.cwd!) }
}

/** 略過: the shown sessions of the current batch count as closed. */
export function skipRestore(db: DatabaseSync, ids: readonly string[], bootAt: number, now: number): void {
  const shown = new Set(ids)
  markSessionsEnded(
    db,
    interruptedSessions(db, bootAt)
      .filter((s) => shown.has(s.id))
      .map((s) => s.id),
    now,
  )
}
