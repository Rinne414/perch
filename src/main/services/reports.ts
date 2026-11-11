import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { listReportFiles, reportFileOf } from '../db/reportFiles'
import { OBSIDIAN_SUBFOLDER } from './obsidian'

/** Inside the vault's Perch/ folder: one note per session, one per day's briefing. */
export const REPORTS_SUBFOLDER = '報告'
export const BRIEFINGS_SUBFOLDER = '簡報'

/** Without an Obsidian folder, notes and PDFs go here inside Perch's data folder: no setup needed. */
export const defaultReportsFolder = (dataDir: string): string => join(dataDir, 'output', 'reports')

/** Where a session's note goes: the vault's Perch/報告, else the default folder. */
export const notesFolder = (obsidianDir: string | null, dataDir: string): string =>
  obsidianDir ? join(obsidianDir, OBSIDIAN_SUBFOLDER, REPORTS_SUBFOLDER) : defaultReportsFolder(dataDir)

/** Where a day's briefing note goes: Perch/簡報/<day>.md, else 簡報 <day>.md in the default folder. */
export const briefingNotePath = (obsidianDir: string | null, dataDir: string, day: string): string =>
  obsidianDir
    ? join(obsidianDir, OBSIDIAN_SUBFOLDER, BRIEFINGS_SUBFOLDER, `${day}.md`)
    : join(defaultReportsFolder(dataDir), `簡報 ${day}.md`)

/** Two paths name the same file: compared resolved, and without case on Windows, whose file names ignore it. */
export function samePath(a: string, b: string): boolean {
  const normal = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))
  return normal(a) === normal(b)
}

/** A front matter value as YAML reads it: double-quoted, single-quoted, or bare (Obsidian may rewrite it bare). */
function yamlScalar(raw: string): string {
  const v = raw.trim()
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v) as string
    } catch {
      return v.slice(1, v.length > 1 && v.endsWith('"') ? -1 : undefined)
    }
  }
  if (v.startsWith("'")) return v.slice(1, v.length > 1 && v.endsWith("'") ? -1 : undefined).replace(/''/g, "'")
  const comment = v.search(/\s#/)
  return (comment < 0 ? v : v.slice(0, comment)).trim()
}

const FRONT_MATTER_HEAD = 4000

/** The session a note belongs to, read from the `session:` key of its front matter; null when there is none. */
export function noteOwner(file: string): string | null {
  let lines: string[]
  try {
    lines = readFileSync(file, 'utf8').slice(0, FRONT_MATTER_HEAD).split(/\r?\n/)
  } catch {
    return null
  }
  if (lines[0]?.trim() !== '---') return null
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') return null
    if (line.startsWith('session:')) return yamlScalar(line.slice('session:'.length))
  }
  return null
}

const candidate = (folder: string, base: string, n: number, ext: string): string =>
  join(folder, n === 1 ? `${base}${ext}` : `${base}_${n}${ext}`)

/** Past this many files of one name something is wrong; stop rather than loop. */
const MAX_COPIES = 9999

/**
 * The note file for a session. The file it already has wins while it is there and still names it
 * (so a renamed session, or a changed day start, keeps writing one file); else `<base>.md` unless
 * another session owns it, then `<base>_2.md` and so on.
 */
export function notePathFor(folder: string, base: string, sessionId: string, stored: string | null): string {
  if (stored && samePath(dirname(stored), folder) && existsSync(stored) && noteOwner(stored) === sessionId) return stored
  for (let n = 1; n <= MAX_COPIES; n++) {
    const file = candidate(folder, base, n, '.md')
    if (!existsSync(file) || noteOwner(file) === sessionId) return file
  }
  throw new Error(`EEXIST: ${MAX_COPIES} notes named ${base}`)
}

const isTakenBy = (db: DatabaseSync, file: string, sessionId: string): boolean =>
  listReportFiles(db).some((f) => f.kind === 'pdf' && f.agentSessionId !== sessionId && samePath(f.path, file))

/**
 * Writes a session's PDF. Its own file is rewritten while it is in this folder and no other session
 * has since been given that name; otherwise a new file is created exclusively (`<base>.pdf`,
 * `<base>_2.pdf`…), so a save never overwrites a file that belongs to another session.
 */
export function writePdfFile(db: DatabaseSync, folder: string, base: string, sessionId: string, pdf: Uint8Array): string {
  const stored = reportFileOf(db, 'pdf', sessionId)
  if (stored && samePath(dirname(stored), folder) && existsSync(stored) && !isTakenBy(db, stored, sessionId)) {
    writeFileSync(stored, pdf)
    return stored
  }
  mkdirSync(folder, { recursive: true })
  for (let n = 1; n <= MAX_COPIES; n++) {
    const file = candidate(folder, base, n, '.pdf')
    if (isTakenBy(db, file, sessionId)) continue
    try {
      writeFileSync(file, pdf, { flag: 'wx' })
      return file
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error(`EEXIST: ${MAX_COPIES} PDFs named ${base}`)
}

/** Writes the file only when its content changed, so sync tools see only real changes. True when written. */
export function writeIfChanged(file: string, content: string): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  return true
}
