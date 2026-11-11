import type { DatabaseSync } from 'node:sqlite'
import { getSetting, setSetting } from './settings'

export type ReportKind = 'note' | 'pdf'

/** A report file Perch wrote for a session. */
export interface ReportFile {
  readonly agentSessionId: string
  readonly kind: ReportKind
  readonly path: string
}

const KEY = 'reportFiles'

const read = (db: DatabaseSync): Record<string, string> => getSetting<Record<string, string>>(db, KEY, {})

/** Every report file Perch wrote: what the export lists, and how a PDF finds its own file again. */
export function listReportFiles(db: DatabaseSync): ReportFile[] {
  return Object.entries(read(db)).map(([key, path]) => {
    const at = key.indexOf(':')
    return { kind: key.slice(0, at) as ReportKind, agentSessionId: key.slice(at + 1), path }
  })
}

export const reportFileOf = (db: DatabaseSync, kind: ReportKind, sessionId: string): string | null => read(db)[`${kind}:${sessionId}`] ?? null

export function rememberReportFile(db: DatabaseSync, kind: ReportKind, sessionId: string, file: string): void {
  const files = read(db)
  if (files[`${kind}:${sessionId}`] === file) return
  setSetting(db, KEY, { ...files, [`${kind}:${sessionId}`]: file })
}
