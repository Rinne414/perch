import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { projectName, type ProjectDetail, type ProjectSummary } from '@shared/projects'
import type { Item } from '@shared/types'
import { isKnownWorkFolder, listProjectHeads, listSessionsIn } from '../db/agents'
import { countOpenByProject, listOpenItemsOf } from '../db/items'
import { getSetting, setSetting } from '../db/settings'
import { fileNote } from './agentNotes'
import type { AppSettings } from './settings'

/** Longer than any real folder path; anything beyond it is not one. */
const MAX_PATH = 1024
/** Folders the person chose 不再列出 for. */
const HIDDEN = 'hiddenProjects'
/** How many sessions the project panel lists under 最近做的. */
const DETAIL_SESSIONS = 8

/**
 * The folder "開資料夾" may open: one an agent reported working in, and only while it is
 * still a folder. The path comes from the renderer, so this is what keeps it from making
 * Perch open an arbitrary file or start a program.
 */
export function projectFolder(db: DatabaseSync, cwd: unknown): string | null {
  if (typeof cwd !== 'string' || !cwd || cwd.length > MAX_PATH || !isAbsolute(cwd)) return null
  if (!isKnownWorkFolder(db, cwd)) return null
  return statSync(cwd, { throwIfNoEntry: false })?.isDirectory() ? cwd : null
}

/** Every folder agents worked in, most recently touched first. */
export function listProjects(db: DatabaseSync): ProjectSummary[] {
  const hidden = new Set(getSetting<string[]>(db, HIDDEN, []))
  const open = countOpenByProject(db)
  return listProjectHeads(db)
    .map(({ session, sessionCount, firstAt }): ProjectSummary => {
      const cwd = session.cwd!
      return {
        cwd,
        name: projectName(cwd) ?? cwd,
        firstAt,
        lastAt: session.updatedAt,
        sessionCount,
        latest: session,
        openItems: open.get(cwd) ?? 0,
        hidden: hidden.has(cwd),
      }
    })
    .sort((a, b) => b.lastAt - a.lastAt)
}

export function projectDetail(db: DatabaseSync, cwd: string): ProjectDetail | null {
  const project = listProjects(db).find((p) => p.cwd === cwd)
  if (!project) return null
  return { project, sessions: listSessionsIn(db, cwd, DETAIL_SESSIONS), items: listOpenItemsOf(db, cwd) }
}

/** "不再列出" for a one-off folder, or listing it again. */
export function setProjectHidden(db: DatabaseSync, cwd: string, hidden: boolean): void {
  const others = getSetting<string[]>(db, HIDDEN, []).filter((c) => c !== cwd)
  setSetting(db, HIDDEN, hidden ? [...others, cwd] : others)
}

/** A line typed in a project's panel: its task when it names a date, otherwise its idea. */
export function captureForProject(db: DatabaseSync, text: string, cwd: string, now: number, settings: AppSettings): Item {
  if (!isKnownWorkFolder(db, cwd)) throw new Error('No agent worked in that folder')
  return fileNote(db, text, 'none', { project: cwd, source: 'user' }, now, settings.dayStartHour)
}
