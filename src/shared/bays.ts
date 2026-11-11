import { sessionLabel } from './agents'
import { projectName } from './projects'
import { stateOf, stateRank, type SessionGroup, type SessionState } from './sessionState'
import { shortSpan, stampLabel } from './spans'
import type { AgentSession } from './types'

/** One session of the briefing, with the group it sits in and when it last started waiting or finished. */
export interface MapSession {
  readonly session: AgentSession
  readonly group: SessionGroup
  /** When it started waiting (waiting) or finished (done); otherwise its last report. */
  readonly since: number
}

export interface BayRow {
  readonly id: string
  readonly name: string
  readonly state: SessionState
  /** "等 2 分", "跑 5 分", "13:52", "3 天". */
  readonly time: string
}

export interface Bay {
  /** The whole folder path, or a key no path can be (`NO_FOLDER_KEY`, `OTHER_KEY`): what the bay is told apart by. */
  readonly key: string
  /** What it shows: the folder's name (with its parent when two bays share one), or 沒有資料夾 / 其他專案. */
  readonly name: string
  /** The most urgent state inside: the bay's colour and its wire. */
  readonly state: SessionState
  readonly side: 'left' | 'right'
  readonly rows: readonly BayRow[]
}

export const MAX_BAYS = 8
export const NO_FOLDER = '沒有資料夾'
export const OTHER_PROJECTS = '其他專案'
/** Keys of the two bays that are not one folder; "<" cannot appear in a Windows path or start an absolute one. */
export const NO_FOLDER_KEY = '<no folder>'
export const OTHER_KEY = '<other projects>'

const BACKSLASH = String.fromCharCode(92)
const SEPARATORS = /[\\/]+/
const TRAILING_SEPARATORS = /[\\/]+$/

/** One folder, however it ends: with or without a closing separator it is the same bay. */
const folderKey = (cwd: string | null): string => (cwd ? cwd.replace(TRAILING_SEPARATORS, '') || cwd : NO_FOLDER_KEY)

/** The folder with its parent ("a" + separator + "app"), in the path's own separator. */
function withParent(path: string): string {
  const parts = path.split(SEPARATORS).filter(Boolean)
  return parts.slice(-2).join(path.includes(BACKSLASH) ? BACKSLASH : '/')
}

/** Folder names, with the parent added where two bays would show the same name. */
function labels(keys: readonly string[]): Map<string, string> {
  const base = new Map(keys.map((k) => [k, k === NO_FOLDER_KEY ? NO_FOLDER : k === OTHER_KEY ? OTHER_PROJECTS : (projectName(k) ?? k)]))
  const count = new Map<string, number>()
  for (const name of base.values()) count.set(name, (count.get(name) ?? 0) + 1)
  return new Map(
    keys.map((k) => {
      const name = base.get(k) ?? k
      return [k, (count.get(name) ?? 0) > 1 && k !== NO_FOLDER_KEY && k !== OTHER_KEY ? withParent(k) : name]
    }),
  )
}

/** The short time a row shows: how long it waits or runs, when it finished, how long it was left. */
export function shortTime(m: MapSession, now: number, dayStartHour: number): string {
  const s = m.session
  if (m.group === 'waiting') return `等 ${shortSpan(now - m.since)}`
  if (m.group === 'running') return `跑 ${shortSpan(now - s.startedAt)}`
  if (m.group === 'done') return stampLabel(m.since, now, dayStartHour)
  return shortSpan(now - s.updatedAt)
}

interface Ranked {
  readonly m: MapSession
  readonly state: SessionState
}

/** Most urgent first, then the most recently moved. */
const byUrgency = (a: Ranked, b: Ranked): number => stateRank(a.state) - stateRank(b.state) || b.m.session.updatedAt - a.m.session.updatedAt

function bayOf(key: string, members: readonly Ranked[], now: number, dayStartHour: number): Omit<Bay, 'side' | 'name'> {
  const sorted = [...members].sort(byUrgency)
  return {
    key,
    state: sorted[0].state,
    rows: sorted.map(({ m, state }) => ({ id: m.session.id, name: sessionLabel(m.session), state, time: shortTime(m, now, dayStartHour) })),
  }
}

/**
 * Every session of the briefing, one box ("bay") per project folder, told apart by its whole path. Bays go most urgent first,
 * then the most recently moved, taking turns left and right so the most urgent sit on top. Past
 * `MAX_BAYS`, the projects left share one last bay, 其他專案.
 */
export function buildBays(sessions: readonly MapSession[], now: number, dayStartHour: number): Bay[] {
  const byFolder = new Map<string, Ranked[]>()
  for (const m of sessions) {
    const key = folderKey(m.session.cwd)
    const list = byFolder.get(key) ?? []
    list.push({ m, state: stateOf(m.session, m.group) })
    byFolder.set(key, list)
  }
  const ordered = [...byFolder.entries()]
    .map(([key, members]) => ({ key, members, top: [...members].sort(byUrgency)[0] }))
    .sort((a, b) => byUrgency(a.top, b.top))
  const kept = ordered.length > MAX_BAYS ? ordered.slice(0, MAX_BAYS - 1) : ordered
  const rest = ordered.slice(kept.length).flatMap((b) => b.members)
  const bays = kept.map((b) => bayOf(b.key, b.members, now, dayStartHour))
  if (rest.length) bays.push(bayOf(OTHER_KEY, rest, now, dayStartHour))
  const names = labels(bays.map((b) => b.key))
  return bays.map((bay, i) => ({ ...bay, name: names.get(bay.key) ?? bay.key, side: i % 2 === 0 ? 'left' : 'right' }))
}
