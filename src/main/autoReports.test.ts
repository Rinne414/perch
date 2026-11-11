import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { applyAgentEvent, listAgentSessions } from './db/agents'
import { openDatabase } from './db/connection'
import type { Log } from './log'
import { createAutoReports, finishedBetween, SETTLE_MS } from './autoReports'
import { DEFAULT_SETTINGS, type AppSettings } from './services/settings'

const MIN = 60_000
const T0 = new Date(2026, 10, 11, 12, 0).getTime()

let dir: string
let db: DatabaseSync
let errors: string[]
const log: Log = { dir: '', info: () => undefined, warn: () => undefined, error: (m) => void errors.push(m) }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'perch-auto-'))
  db = openDatabase(':memory:')
  errors = []
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function finish(id: string, at: number, over: { ended?: number } = {}): void {
  applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: id, status: 'running', name: `工作 ${id}`, prompt: '做', at: at - 5 * MIN }, at)
  applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: id, status: 'done', reply: '好了', at }, at)
  if (over.ended) applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: id, status: 'cancelled', ended: true, at: over.ended }, over.ended)
}

const notes = (): string[] => (existsSync(join(dir, 'Perch', '報告')) ? readdirSync(join(dir, 'Perch', '報告')) : [])

describe('finishedBetween', () => {
  test('keeps done sessions that finished inside the span, leaves out one-shot runs', () => {
    finish('a', T0)
    finish('b', T0 + 10 * MIN)
    finish('shot', T0 + MIN, { ended: T0 + MIN + 5_000 })
    expect(listAgentSessions(db, 0)).toHaveLength(3)

    const picked = finishedBetween(listAgentSessions(db, 0), T0 - 1, T0 + 5 * MIN).map((s) => s.sessionId)

    expect(picked).toEqual(['a'])
  })
})

describe('createAutoReports', () => {
  const settings = (over: Partial<AppSettings>) => (): AppSettings => ({ ...DEFAULT_SETTINGS, obsidianDir: dir, ...over })

  test('writes the note of a session that finished after the first run, once it has settled', () => {
    finish('old', T0 - 60 * MIN)
    const tick = createAutoReports(db, settings({}), () => dir, log)
    tick(T0)
    finish('new', T0 + MIN)

    tick(T0 + MIN + SETTLE_MS - 1)
    expect(notes()).toEqual([])
    tick(T0 + MIN + SETTLE_MS)
    expect(notes()).toEqual(['2026-11-11 工作 new.md'])
  })

  test('writes nothing while switched off or without an Obsidian folder, and does not catch up later', () => {
    const off = createAutoReports(db, settings({ autoReports: false }), () => dir, log)
    off(T0)
    finish('a', T0 + MIN)
    off(T0 + 10 * MIN)
    const none = createAutoReports(db, settings({ obsidianDir: null }), () => dir, log)
    none(T0 + 10 * MIN)

    expect(notes()).toEqual([])
    expect(existsSync(join(dir, 'output'))).toBe(false)
  })

  test('a folder that is gone is logged once and never thrown', () => {
    const gone = join(dir, 'gone\u0000')
    const tick = createAutoReports(db, settings({ obsidianDir: gone }), () => dir, log)
    tick(T0)
    finish('a', T0 + MIN)

    expect(() => {
      tick(T0 + 10 * MIN)
      tick(T0 + 11 * MIN)
    }).not.toThrow()
    expect(errors).toEqual(['Session note not written'])
  })
})

describe('createAutoReports: one bad session', () => {
  test('a note that cannot be written is logged once and skipped; the others are still written', () => {
    const tried: string[] = []
    const save = (_db: DatabaseSync, id: string): void => {
      tried.push(id)
      if (id === 'claude-code:bad') throw new Error('EBUSY: resource busy or locked')
    }
    const tick = createAutoReports(db, () => ({ ...DEFAULT_SETTINGS, obsidianDir: dir }), () => dir, log, save)
    tick(T0)
    finish('bad', T0 + MIN)
    finish('good', T0 + 2 * MIN)

    tick(T0 + 10 * MIN)
    tick(T0 + 11 * MIN)

    expect(tried).toEqual(['claude-code:good', 'claude-code:bad'])
    expect(errors).toEqual(['Session note not written'])
  })
})
