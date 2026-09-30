import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createLog, LOG_FILE } from './log'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'perch-log-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const read = (name = LOG_FILE): string => readFileSync(join(dir, name), 'utf8')
const fixed = (): Date => new Date(2026, 8, 30, 9, 5, 7)

describe('log', () => {
  test('writes one line per entry with local time and level', () => {
    const log = createLog(join(dir, 'logs'), 1000, fixed)
    log.info('Perch 0.1.0 started')
    log.warn('slow')
    expect(readFileSync(join(dir, 'logs', LOG_FILE), 'utf8')).toBe(
      '2026-09-30 09:05:07 INFO  Perch 0.1.0 started\n2026-09-30 09:05:07 WARN  slow\n',
    )
  })

  test('errors carry the stack of what was thrown', () => {
    const log = createLog(dir, 100_000, fixed)
    log.error('Update check failed', new Error('net::ERR_INTERNET_DISCONNECTED'))
    log.error('Odd value', 42)
    expect(read()).toContain('ERROR Update check failed: Error: net::ERR_INTERNET_DISCONNECTED\n    at ')
    expect(read()).toContain('ERROR Odd value: 42')
  })

  test('starts a new file once the current one is too big, keeping the previous one', () => {
    const log = createLog(dir, 60, fixed)
    log.info('first line that fills the file up')
    log.info('second line that goes over the limit')
    expect(existsSync(join(dir, 'perch.old.log'))).toBe(false)
    log.info('third')
    expect(read('perch.old.log')).toContain('second line')
    expect(read()).toBe('2026-09-30 09:05:07 INFO  third\n')
  })
})
