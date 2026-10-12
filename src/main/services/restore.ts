import type { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { REOPENABLE_AGENTS, resumeArgs } from '@shared/agents'
import type { RestoreResult } from '@shared/ipc'
import { isOneShot } from '@shared/now'
import type { RestoreCandidate } from '@shared/restore'
import type { AgentSession } from '@shared/types'
import { listOpenSessions, listRecentSessions, markSessionsEnded, markSessionsReopened } from '../db/agents'

/** How long before a restart a session may have last shown life and still count as open. */
export const LOOKBACK_MS = 12 * 3_600_000
/** More tabs than this in one window is no longer a restore. */
export const MAX_SESSIONS = 30
/** Rows read before filtering: scripts calling `claude -p` in a loop can leave many one-shot runs in the range. */
const RECENT_ROWS = 500

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
    .filter(resumable)
    .slice(0, MAX_SESSIONS)
}

/** It has a resume command and a folder a terminal can start in. */
const resumable = (s: AgentSession): boolean => resumeArgs(s) !== null && s.cwd !== null && DRIVE_PATH.test(s.cwd)

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

/**
 * Whether a session may be open in a terminal now: it never reported closing and showed life
 * after the last restart, or Claude Code lists it as running (resumed by hand, nothing reported
 * yet). Either is enough: offering an open session would start a second copy of it.
 */
export function isOpenNow(s: AgentSession, cutoffAt: number, liveClaude: ReadonlySet<string> | null): boolean {
  if (s.agent === 'claude-code' && liveClaude?.has(s.sessionId)) return true
  return s.endedAt === null && Math.max(s.updatedAt, s.reopenedAt ?? 0) >= cutoffAt
}

export interface CandidateOptions {
  readonly now: number
  readonly cutoffAt: number
  /** How far back closed sessions are listed. */
  readonly rangeMs: number
  /** Claude Code's running sessions by id; null when its list could not be read. */
  readonly liveClaude: ReadonlySet<string> | null
  readonly folderExists: (path: string) => boolean
}

export interface Candidates {
  readonly interrupted: readonly RestoreCandidate[]
  readonly others: readonly RestoreCandidate[]
}

/** The range reaches back from now, or from the restart when that was recent, so its sessions are never cut in two. */
export const rangeStart = (now: number, cutoffAt: number, rangeMs: number): number =>
  now - cutoffAt < rangeMs ? cutoffAt - rangeMs : now - rangeMs

/**
 * What the reopen window lists: the sessions the last restart cut off (and not reopened or
 * skipped yet), then every other session used in the range that is not open now, closed ones
 * included. Only agents that resume by id, only folders on a drive.
 */
export function restoreCandidates(db: DatabaseSync, o: CandidateOptions): Candidates {
  const toCandidate = (s: AgentSession): RestoreCandidate => ({ session: s, gone: !o.folderExists(s.cwd!) })
  const notLive = (s: AgentSession): boolean => !(s.agent === 'claude-code' && o.liveClaude?.has(s.sessionId))
  const interrupted = interruptedSessions(db, o.cutoffAt).filter(notLive)
  const taken = new Set(interrupted.map((s) => s.id))
  const others = listRecentSessions(db, rangeStart(o.now, o.cutoffAt, o.rangeMs), REOPENABLE_AGENTS, RECENT_ROWS)
    // One-shot runs (`claude -p` from a script) have no conversation worth going back to.
    .filter((s) => !taken.has(s.id) && resumable(s) && !isOneShot(s) && !isOpenNow(s, o.cutoffAt, o.liveClaude))
    .slice(0, MAX_SESSIONS)
  return { interrupted: interrupted.map(toCandidate), others: others.map(toCandidate) }
}

export interface RestoreDeps {
  readonly folderExists: (path: string) => boolean
  /** Starts Windows Terminal; rejects when it cannot. */
  readonly openTerminal: (args: readonly string[]) => Promise<void>
}

/**
 * Reopens the chosen sessions in one Windows Terminal window; ids not in `listed` (what the
 * window showed) are ignored. Of the sessions the restart cut off, the ones in `skip` and the
 * ones whose folder is gone count as closed, so they are not offered as cut off again.
 * Nothing is marked when the terminal fails to start.
 */
export async function restoreSessions(
  db: DatabaseSync,
  open: readonly string[],
  skip: readonly string[],
  listed: Candidates,
  now: number,
  deps: RestoreDeps,
): Promise<RestoreResult> {
  const chosen = new Set(open)
  const all = [...listed.interrupted, ...listed.others].map((c) => c.session)
  const plan = wtPlan(
    all.filter((s) => chosen.has(s.id)),
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
    listed.interrupted.map((c) => c.session).filter((s) => skipped.has(s.id) || plan.missing.includes(s)).map((s) => s.id),
    now,
  )
  return { opened: plan.opened.length, missing: plan.missing.map((s) => s.cwd!) }
}

/** 這次都不要: the sessions the restart cut off count as closed and stop being offered as cut off. */
export function skipRestore(db: DatabaseSync, ids: readonly string[], cutoffAt: number, now: number): void {
  const shown = new Set(ids)
  markSessionsEnded(
    db,
    interruptedSessions(db, cutoffAt)
      .filter((s) => shown.has(s.id))
      .map((s) => s.id),
    now,
  )
}
