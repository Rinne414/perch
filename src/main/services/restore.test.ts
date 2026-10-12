import { beforeEach, describe, expect, test } from 'vitest'
import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentEvent } from '@shared/agentEvent'
import type { AgentSession } from '@shared/types'
import { applyAgentEvent, getAgentSession } from '../db/agents'
import { openDatabase } from '../db/connection'
import {
  bootTime,
  interruptedSessions,
  isFolder,
  isOpenNow,
  rangeStart,
  restoreCandidates,
  LOOKBACK_MS,
  parseEpoch,
  restartTime,
  restoreSessions,
  skipRestore,
  terminalEnv,
  waitForStart,
  wtEscape,
  wtPlan,
  type CandidateOptions,
  type Candidates,
  type RestoreDeps,
} from './restore'

const HOUR = 3_600_000
const BOOT = 1_800_000_000_000
const AFTER = BOOT + 5 * 60_000

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

const report = (over: Partial<AgentEvent> & { sessionId: string }): void => {
  applyAgentEvent(db, { v: 1, agent: 'claude-code', status: 'done', at: BOOT - HOUR, cwd: 'L:\\code\\app', ...over }, BOOT)
}

const ids = (sessions: readonly AgentSession[]): string[] => sessions.map((s) => s.id)

const session = (sessionId: string, cwd: string | null, agent = 'claude-code'): AgentSession => ({
  id: `${agent}:${sessionId}`,
  agent,
  sessionId,
  cwd,
  name: null,
  title: null,
  status: 'done',
  detail: null,
  startedAt: 0,
  updatedAt: 0,
  attentionAt: null,
  acknowledgedAt: null,
  endedAt: null,
  reopenedAt: null,
})

describe('bootTime', () => {
  test('is now minus the uptime', () => {
    expect(bootTime(BOOT + 4_832_812, 4832.812)).toBe(BOOT)
  })
})

describe('restartTime', () => {
  const NOW = BOOT + 5 * HOUR

  test('the sign-in when it came after the boot (a Fast Startup shut down keeps the uptime)', () => {
    expect(restartTime(BOOT - 3 * 86_400_000, BOOT, NOW)).toBe(BOOT)
    expect(restartTime(BOOT, BOOT + 30_000, NOW)).toBe(BOOT + 30_000)
  })

  test('never before the boot, and the boot when the sign-in is unknown or in the future', () => {
    expect(restartTime(BOOT, BOOT - HOUR, NOW)).toBe(BOOT)
    expect(restartTime(BOOT, null, NOW)).toBe(BOOT)
    expect(restartTime(BOOT, NOW + 1, NOW)).toBe(BOOT)
    expect(restartTime(BOOT, Number.NaN, NOW)).toBe(BOOT)
  })
})

describe('parseEpoch', () => {
  test('the number PowerShell printed, or null', () => {
    expect(parseEpoch('1791684064000\r\n')).toBe(1791684064000)
    expect(parseEpoch('')).toBeNull()
    expect(parseEpoch('Get-CimInstance : Access denied')).toBeNull()
  })
})

describe('interruptedSessions', () => {
  test('sessions left open in the 12 hours before the restart, newest first', () => {
    report({ sessionId: 'a', at: BOOT - 3 * HOUR })
    report({ sessionId: 'b', at: BOOT - HOUR, status: 'running' })
    report({ sessionId: 'closed', status: 'cancelled', ended: true })
    report({ sessionId: 'old', at: BOOT - LOOKBACK_MS - 1 })
    report({ sessionId: 'after', at: AFTER })
    report({ sessionId: 'codex-one', agent: 'codex', at: BOOT - 2 * HOUR })

    expect(ids(interruptedSessions(db, BOOT))).toEqual(['claude-code:b', 'codex:codex-one', 'claude-code:a'])
  })

  test('leaves out agents that never report closing, and ids that cannot be resumed safely', () => {
    report({ sessionId: 'o', agent: 'opencode' })
    report({ sessionId: 'g', agent: 'antigravity-cli' })
    report({ sessionId: 'x y' })
    report({ sessionId: 'nofolder', cwd: undefined })
    // cmd cannot start in a network share or a path without a drive.
    report({ sessionId: 'share', cwd: '\\\\server\\share\\app' })
    report({ sessionId: 'nodrive', cwd: '\\code\\app' })

    expect(interruptedSessions(db, BOOT)).toEqual([])
  })
})

describe('wtPlan', () => {
  const everywhere = (): boolean => true

  test('one new window, a tab per session in its folder, separated by ;', () => {
    const plan = wtPlan([session('s1', 'D:\\my code\\shop'), session('c2', 'D:\\api', 'codex')], everywhere)

    expect(plan.args).toEqual([
      '-w',
      'new',
      'new-tab',
      '-d',
      'D:\\my code\\shop',
      'cmd',
      '/k',
      'claude',
      '--resume',
      's1',
      ';',
      'new-tab',
      '-d',
      'D:\\api',
      'cmd',
      '/k',
      'codex',
      'resume',
      'c2',
    ])
    expect(ids(plan.opened)).toEqual(['claude-code:s1', 'codex:c2'])
  })

  test('a ; inside a folder name is escaped so Windows Terminal keeps it in the path', () => {
    expect(wtEscape('C:\\work\\a;b')).toBe('C:\\work\\a\\;b')
    expect(wtPlan([session('s1', 'C:\\work\\a;b')], everywhere).args).toContain('C:\\work\\a\\;b')
  })

  test('folders that are gone are left out and reported; unsafe ids are never opened', () => {
    const plan = wtPlan([session('s1', 'C:\\gone'), session('--evil', 'C:\\here'), session('s3', 'C:\\here')], (p) => p !== 'C:\\gone')

    expect(ids(plan.missing)).toEqual(['claude-code:s1'])
    expect(ids(plan.opened)).toEqual(['claude-code:s3'])
    expect(plan.args).not.toContain('--evil')
  })

  test('nothing to open gives no arguments', () => {
    expect(wtPlan([session('s1', 'C:\\gone')], () => false).args).toEqual([])
  })
})

const listed = (over: Partial<CandidateOptions> = {}): Candidates =>
  restoreCandidates(db, { now: AFTER, cutoffAt: BOOT, rangeMs: 12 * HOUR, liveClaude: null, folderExists: (p) => p !== 'L:\\gone', ...over })

const cids = (c: Candidates): { cut: string[]; other: string[] } => ({
  cut: c.interrupted.map((x) => x.session.id),
  other: c.others.map((x) => x.session.id),
})

describe('restoreCandidates', () => {
  test('cut-off sessions first; closed ones in the range below; open ones and old ones not at all', () => {
    report({ sessionId: 'cut' })
    report({ sessionId: 'closed', at: BOOT - 3 * HOUR })
    report({ sessionId: 'closed', status: 'cancelled', ended: true, at: BOOT - 2 * HOUR })
    report({ sessionId: 'open-now', at: AFTER - 60_000 })
    report({ sessionId: 'old', at: BOOT - 30 * HOUR })
    report({ sessionId: 'old', status: 'cancelled', ended: true, at: BOOT - 29 * HOUR })
    report({ sessionId: 'opencode', agent: 'opencode' })

    expect(cids(listed())).toEqual({ cut: ['claude-code:cut'], other: ['claude-code:closed'] })
  })

  test("a session Claude Code lists as running is never offered, even before it reports anything", () => {
    report({ sessionId: 'cut' })
    report({ sessionId: 'resumed-by-hand' })
    report({ sessionId: 'closed-but-resumed', at: BOOT - 3 * HOUR })
    report({ sessionId: 'closed-but-resumed', status: 'cancelled', ended: true, at: BOOT - 2 * HOUR })

    const c = listed({ liveClaude: new Set(['resumed-by-hand', 'closed-but-resumed']) })

    expect(cids(c)).toEqual({ cut: ['claude-code:cut'], other: [] })
  })

  test('one-shot runs other programs started are not offered', () => {
    report({ sessionId: 'oneshot', at: BOOT - 3 * HOUR })
    report({ sessionId: 'oneshot', status: 'cancelled', ended: true, at: BOOT - 3 * HOUR + 2_000 })

    expect(cids(listed()).other).toEqual([])
  })

  test('a session whose folder is gone is listed as gone', () => {
    report({ sessionId: 'gone', cwd: 'L:\\gone' })

    expect(listed().interrupted).toEqual([expect.objectContaining({ gone: true })])
  })

  test('3 days reach further back than 12 hours', () => {
    report({ sessionId: 'two-days', at: BOOT - 48 * HOUR })
    report({ sessionId: 'two-days', status: 'cancelled', ended: true, at: BOOT - 47 * HOUR })

    expect(cids(listed()).other).toEqual([])
    expect(cids(listed({ rangeMs: 72 * HOUR })).other).toEqual(['claude-code:two-days'])
  })
})

describe('rangeStart', () => {
  test('from the restart when it was recent, so the sessions it cut off are all inside', () => {
    expect(rangeStart(AFTER, BOOT, 12 * HOUR)).toBe(BOOT - 12 * HOUR)
  })

  test('from now when the restart was long ago', () => {
    expect(rangeStart(BOOT + 20 * HOUR, BOOT, 12 * HOUR)).toBe(BOOT + 8 * HOUR)
  })
})

describe('isOpenNow', () => {
  const s = (over: Partial<AgentSession>): AgentSession => ({ ...session('x', 'L:\\a'), ...over })

  test('by the hooks: never closed and seen after the restart', () => {
    expect(isOpenNow(s({ updatedAt: AFTER }), BOOT, null)).toBe(true)
    expect(isOpenNow(s({ updatedAt: AFTER, endedAt: AFTER + 1 }), BOOT, null)).toBe(false)
    expect(isOpenNow(s({ updatedAt: BOOT - 1 }), BOOT, null)).toBe(false)
    expect(isOpenNow(s({ updatedAt: BOOT - 1, reopenedAt: AFTER }), BOOT, null)).toBe(true)
  })

  test("or Claude Code lists it as running; its list never makes an open session look closed", () => {
    expect(isOpenNow(s({ updatedAt: BOOT - HOUR, endedAt: BOOT - HOUR }), BOOT, new Set(['x']))).toBe(true)
    expect(isOpenNow(s({ updatedAt: AFTER }), BOOT, new Set())).toBe(true)
    expect(isOpenNow(s({ agent: 'codex', id: 'codex:x', updatedAt: BOOT - HOUR, endedAt: BOOT - HOUR }), BOOT, new Set(['x']))).toBe(false)
  })
})

describe('restoreSessions', () => {
  const deps = (opened: string[][], fail = false): RestoreDeps => ({
    folderExists: (p) => p !== 'L:\\gone',
    openTerminal: async (args) => {
      if (fail) throw new Error('找不到 Windows Terminal（wt.exe）')
      opened.push([...args])
    },
  })

  test('opens the chosen ones; the skipped and the missing are not offered again', async () => {
    report({ sessionId: 'pick' })
    report({ sessionId: 'skip' })
    report({ sessionId: 'gone', cwd: 'L:\\gone' })
    report({ sessionId: 'unseen' })
    const calls: string[][] = []

    const result = await restoreSessions(db, ['claude-code:pick', 'claude-code:gone', 'claude-code:later'], ['claude-code:skip'], listed(), AFTER, deps(calls))

    expect(result).toEqual({ opened: 1, missing: ['L:\\gone'] })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('pick')
    expect(ids(interruptedSessions(db, BOOT))).toEqual(['claude-code:unseen'])
    expect(getAgentSession(db, 'claude-code:skip')?.endedAt).toBe(AFTER)
    expect(getAgentSession(db, 'claude-code:pick')?.endedAt).toBeNull()
  })

  test('a reopened session is offered again after the next restart if it never closed', async () => {
    report({ sessionId: 'pick' })
    await restoreSessions(db, ['claude-code:pick'], [], listed(), AFTER, deps([]))

    expect(ids(interruptedSessions(db, AFTER + 10 * HOUR))).toEqual(['claude-code:pick'])
  })

  test('a closed session from the list can be reopened too; it then counts as open', async () => {
    report({ sessionId: 'closed', at: BOOT - 3 * HOUR })
    report({ sessionId: 'closed', status: 'cancelled', ended: true, at: BOOT - 2 * HOUR })
    const calls: string[][] = []

    const result = await restoreSessions(db, ['claude-code:closed'], [], listed(), AFTER, deps(calls))

    expect(result.opened).toBe(1)
    expect(calls[0]).toContain('closed')
    expect(cids(listed({ now: AFTER + 60_000 })).other).toEqual([])
  })

  test('ids the window did not list are ignored', async () => {
    report({ sessionId: 'old', at: BOOT - 40 * HOUR })
    report({ sessionId: 'old', status: 'cancelled', ended: true, at: BOOT - 39 * HOUR })
    const calls: string[][] = []

    expect((await restoreSessions(db, ['claude-code:old'], [], listed(), AFTER, deps(calls))).opened).toBe(0)
    expect(calls).toEqual([])
  })

  test('when Windows Terminal does not start, nothing is marked', async () => {
    report({ sessionId: 'pick' })

    await expect(restoreSessions(db, ['claude-code:pick'], [], listed(), AFTER, deps([], true))).rejects.toThrow('wt.exe')
    expect(ids(interruptedSessions(db, BOOT))).toEqual(['claude-code:pick'])
  })
})

describe('skipRestore', () => {
  test('only the sessions that were shown count as closed', () => {
    report({ sessionId: 'shown' })
    report({ sessionId: 'arrived-later' })

    skipRestore(db, ['claude-code:shown'], BOOT, AFTER)

    expect(ids(interruptedSessions(db, BOOT))).toEqual(['claude-code:arrived-later'])
  })
})

describe('terminalEnv', () => {
  test('drops the markers of a Claude Code session Perch was started from, keeps the rest', () => {
    const env = terminalEnv({
      PATH: 'C:/bin',
      CLAUDECODE: '1',
      CLAUDE_PID: '42',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_MESSAGING_SOCKET: 'x',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:/Git/bin/bash.exe',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
    })

    expect(env).toEqual({
      PATH: 'C:/bin',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:/Git/bin/bash.exe',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
      // cmd must not run a claude.cmd that sits in the project folder.
      NoDefaultCurrentDirectoryInExePath: '1',
    })
  })
})

describe('isFolder', () => {
  test('only folders on a drive', () => {
    expect(isFolder('\\\\server\\share')).toBe(false)
    expect(isFolder('\\Windows')).toBe(false)
    expect(isFolder('relative')).toBe(false)
  })
})

describe('waitForStart', () => {
  const started = (): EventEmitter => {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('spawn'))
    return child
  }

  test('wt.exe handing over and exiting 0 is a start; a non-zero exit is not', async () => {
    const ok = started()
    const okDone = waitForStart(ok, 1_000)
    setTimeout(() => ok.emit('exit', 0), 5)
    await expect(okDone).resolves.toBeUndefined()

    const refused = started()
    const refusedDone = waitForStart(refused, 1_000)
    setTimeout(() => refused.emit('exit', 1), 5)
    await expect(refusedDone).rejects.toThrow('結束代碼 1')
  })

  test('still running after the grace time counts as started; a missing wt.exe is named', async () => {
    await expect(waitForStart(started(), 10)).resolves.toBeUndefined()

    const missing = new EventEmitter()
    const missingDone = waitForStart(missing, 1_000)
    missing.emit('error', Object.assign(new Error('spawn wt.exe ENOENT'), { code: 'ENOENT' }))
    await expect(missingDone).rejects.toThrow('找不到 Windows Terminal')
  })
})
