import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** One file of about a megabyte, plus the previous one. */
const MAX_BYTES = 1_000_000
export const LOG_FILE = 'perch.log'
const OLD_FILE = 'perch.old.log'

export interface Log {
  /** The folder the log files live in. */
  readonly dir: string
  info(message: string): void
  warn(message: string): void
  error(message: string, err?: unknown): void
}

const describe = (err: unknown): string => (err instanceof Error ? (err.stack ?? err.message) : String(err))

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local time, so a line can be matched with what the person remembers doing. */
function stamp(d: Date): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * A plain-text log on this computer, for finding out what went wrong in an installed copy.
 * It records errors and app events (start, update, backup), never task titles or agent prompts.
 */
export function createLog(dir: string, maxBytes = MAX_BYTES, now = (): Date => new Date()): Log {
  const file = join(dir, LOG_FILE)

  const write = (level: string, message: string): void => {
    try {
      mkdirSync(dir, { recursive: true })
      const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0
      if (size > maxBytes) renameSync(file, join(dir, OLD_FILE))
      appendFileSync(file, `${stamp(now())} ${level} ${message}\n`)
    } catch {
      // The log is the place errors get reported; there is nowhere left to report its own failure.
    }
  }

  return {
    dir,
    info: (message) => write('INFO ', message),
    warn: (message) => write('WARN ', message),
    error: (message, err) => write('ERROR', err === undefined ? message : `${message}: ${describe(err)}`),
  }
}
