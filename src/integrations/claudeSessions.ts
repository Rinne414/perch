import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

/*
 * Claude Code's own files, read but never written:
 * - transcripts `~/.claude/projects/<folder>/<session id>.jsonl`, where lines like
 *   {"type":"ai-title","aiTitle":"…"} and {"type":"custom-title","customTitle":"…"} (after /rename)
 *   carry the name /resume shows;
 * - `~/.claude/sessions/<pid>.json`, one file per running interactive session, removed when it
 *   closes cleanly (checked on Claude Code 2.1.296, 2026-10-12).
 */

/** The title lines sit near the start of a transcript and again near its end. */
const HEAD_BYTES = 64 * 1024
const TAIL_BYTES = 256 * 1024
const MAX_NAME = 200
/** Session ids are UUIDs; anything else never becomes part of a path. */
const SESSION_ID = /^[0-9A-Za-z][\w-]{0,127}$/

/** The start and the end of a file that may be growing while it is read. */
function headAndTail(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const read = (start: number, length: number): string => {
      const buf = Buffer.alloc(Math.max(0, Math.min(length, size - start)))
      const n = readSync(fd, buf, 0, buf.length, start)
      return buf.toString('utf8', 0, n)
    }
    if (size <= HEAD_BYTES + TAIL_BYTES) return read(0, size)
    return `${read(0, HEAD_BYTES)}\n${read(size - TAIL_BYTES, TAIL_BYTES)}`
  } finally {
    closeSync(fd)
  }
}

const field = (o: Record<string, unknown>, key: string): string | null => {
  const v = o[key]
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_NAME) : null
}

/** The latest name a person gave the session (/rename), else the latest one Claude Code gave it. */
export function transcriptName(text: string): string | null {
  let custom: string | null = null
  let ai: string | null = null
  for (const line of text.split('\n')) {
    // Only whole lines that are title records; a message that merely mentions the words is skipped by JSON.parse or by its shape.
    if (!line.startsWith('{') || (!line.includes('"customTitle"') && !line.includes('"aiTitle"'))) continue
    let o: unknown
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof o !== 'object' || o === null) continue
    custom = field(o as Record<string, unknown>, 'customTitle') ?? custom
    ai = field(o as Record<string, unknown>, 'aiTitle') ?? ai
  }
  return custom ?? ai
}

/** The session's name from its transcript; null when the file is missing, unreadable or has none. */
export function claudeSessionName(transcriptPath: unknown): string | null {
  if (typeof transcriptPath !== 'string' || !transcriptPath.endsWith('.jsonl')) return null
  try {
    return transcriptName(headAndTail(transcriptPath))
  } catch {
    return null
  }
}

/** Every transcript by session id, for sessions recorded before Perch kept names. */
export function findTranscripts(home: string, sessionIds: readonly string[]): Map<string, string> {
  const found = new Map<string, string>()
  const wanted = sessionIds.filter((id) => SESSION_ID.test(id))
  const projects = join(home, '.claude', 'projects')
  if (wanted.length === 0 || !existsSync(projects)) return found
  let dirs: Dirent[]
  try {
    dirs = readdirSync(projects, { withFileTypes: true })
  } catch {
    return found
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    for (const id of wanted) {
      const file = join(projects, dir.name, `${id}.jsonl`)
      if (!found.has(id) && existsSync(file)) found.set(id, file)
    }
  }
  return found
}

export interface RegistryEntry {
  readonly pid: number
  readonly sessionId: string
  /** The process's start time as a Windows FILETIME (UTC), so a reused PID can be told apart. */
  readonly procStart: string | null
}

/** Running interactive sessions as Claude Code lists them. A file written during a crash can end in NUL bytes. */
export function readClaudeRegistry(home: string): RegistryEntry[] | null {
  const dir = join(home, '.claude', 'sessions')
  if (!existsSync(dir)) return null
  const entries: RegistryEntry[] = []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return null
  }
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue
    try {
      const o = JSON.parse(readFileSync(join(dir, name), 'utf8').replace(/\0+$/, '')) as Record<string, unknown>
      const pid = o['pid']
      const sessionId = o['sessionId']
      if (typeof pid !== 'number' || !Number.isInteger(pid) || typeof sessionId !== 'string') continue
      if (o['kind'] !== undefined && o['kind'] !== 'interactive') continue
      entries.push({ pid, sessionId, procStart: typeof o['procStart'] === 'string' ? o['procStart'] : null })
    } catch {
      // A half-written or foreign file says nothing about which sessions run.
    }
  }
  return entries
}

/**
 * Sessions whose process is still the one that registered them: alive under that PID with the
 * same start time. `startTimes` maps each running PID to its start (FILETIME, UTC).
 */
export function liveSessionIds(entries: readonly RegistryEntry[], startTimes: ReadonlyMap<number, string>): Set<string> {
  return new Set(
    entries
      .filter((e) => {
        const started = startTimes.get(e.pid)
        return started !== undefined && (e.procStart === null || e.procStart === started)
      })
      .map((e) => e.sessionId),
  )
}
