import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { groupTimeline, type EntryKind, type TimelineEntry } from '@shared/calendar'
import { dayKey } from '@shared/day'
import { clock, dayTitle, monthDay } from '@shared/format'
import { bucketOf, firstDayOf, isTopLevelWork, type ListSettings } from '@shared/lists'
import { scheduleLabel } from '@shared/schedule'
import type { AgentSession, Item, TimelineEvent } from '@shared/types'
import { listAgentSessions } from '../db/agents'
import { listDayNotes } from '../db/dayNotes'
import { listEvents } from '../db/events'
import { listAllItems } from '../db/items'
import { entryOf } from './calendar'

/** Bumped when the JSON layout changes in a way a reader has to know about. */
export const EXPORT_FORMAT = 1

/** Everything Perch stores about the person's work. Times are Unix milliseconds. */
export interface ExportData {
  readonly app: 'Perch'
  readonly format: number
  readonly version: string
  readonly exportedAt: string
  readonly items: readonly Item[]
  readonly timeline: readonly TimelineEvent[]
  readonly agentSessions: readonly AgentSession[]
  /** The diary: one note per day (YYYY-MM-DD), oldest first. */
  readonly dayNotes: readonly { readonly day: string; readonly text: string }[]
}

export function collectExport(db: DatabaseSync, version: string, now: number): ExportData {
  return {
    app: 'Perch',
    format: EXPORT_FORMAT,
    version,
    exportedAt: new Date(now).toISOString(),
    items: listAllItems(db),
    timeline: listEvents(db, 0, Number.MAX_SAFE_INTEGER),
    agentSessions: listAgentSessions(db, 0),
    dayNotes: listDayNotes(db).map(({ day, text }) => ({ day, text })),
  }
}

const KIND_LABEL: Readonly<Record<EntryKind, string>> = {
  done: '完成',
  routine: '例行',
  agent: 'Agent',
  'agent-failed': 'Agent 失敗',
  focus: '專注',
  dropped: '不做了',
  manual: '補記',
}

/** Keeps a title on its own list line. */
const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, ' ')

function whenLabel(item: Item): string {
  const parts: string[] = []
  if (item.plannedFor) parts.push(`排在 ${dayTitle(item.plannedFor).date}`)
  if (item.dueAt !== null) parts.push(`截止 ${monthDay(item.dueAt)}${item.dueHasTime ? ` ${clock(item.dueAt)}` : ''}`)
  return parts.join(' · ')
}

function workLines(items: readonly Item[], work: readonly Item[]): string[] {
  return work.flatMap((item) => {
    const when = whenLabel(item)
    const steps = items
      .filter((s) => s.parentId === item.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => `  - [${s.doneAt !== null ? 'x' : ' '}] ${oneLine(s.title)}`)
    return [`- [ ] ${oneLine(item.title)}${when ? ` · ${when}` : ''}`, ...steps]
  })
}

function routineLine(r: Item): string {
  const rhythm = r.schedule ? scheduleLabel(r.schedule) : r.intervalDays !== null ? `每 ${r.intervalDays} 天` : '只記上次'
  const last = r.lastDoneAt !== null ? `上次 ${monthDay(r.lastDoneAt)}` : '還沒做過'
  return `- ${oneLine(r.title)} · ${rhythm}${r.schedule ? '' : ` · ${last}`}`
}

export const entryLine = (e: TimelineEntry): string =>
  `- ${e.hasTime ? `${clock(e.at)} ` : ''}${KIND_LABEL[e.kind]}：${oneLine(e.title)}${e.detail ? `（${oneLine(e.detail)}）` : ''}`

/** A day's lines: each event, with an agent's many replies in one project folded into one line. */
export function dayLines(entries: readonly TimelineEntry[]): string[] {
  return groupTimeline(entries).map((line) => {
    if (line.kind === 'entry') return entryLine(line.entry)
    const [first, last] = [line.replies[0], line.replies[line.replies.length - 1]]
    return `- ${clock(first.at)} Agent：${oneLine(line.title)}（${line.replies.length} 次回覆，到 ${clock(last.at)}）`
  })
}

/** The day's note as a quote, so it reads apart from the timeline. */
export const noteLines = (note: string): string[] =>
  note.trim() ? [...note.trim().split(/\r?\n/).map((l) => (l ? `> ${l}` : '>')), ''] : []

function timelineLines(events: readonly TimelineEvent[], notes: ExportData['dayNotes'], dayStartHour: number): string[] {
  const days = new Map<string, TimelineEntry[]>()
  for (const e of events) {
    const entry = entryOf(e)
    if (!entry) continue
    const key = dayKey(e.at, dayStartHour)
    days.set(key, [...(days.get(key) ?? []), entry])
  }
  const noteOf = new Map(notes.map((n) => [n.day, n.text]))
  return [...new Set([...days.keys(), ...noteOf.keys()])]
    .sort()
    .reverse()
    .flatMap((key) => {
      const { weekday } = dayTitle(key)
      return [`### ${key} ${weekday}`, '', ...noteLines(noteOf.get(key) ?? ''), ...dayLines(days.get(key) ?? []), '']
    })
}

const section = (title: string, lines: readonly string[], empty: string): string[] => [
  `## ${title}`,
  '',
  ...(lines.length ? lines : [empty]),
  '',
]

/** A readable copy: what is still open, what waits in 隨手記, the routines, then every day newest first. */
export function toMarkdown(data: ExportData, settings: ListSettings, now: number): string {
  const today = dayKey(now, settings.dayStartHour)
  const open = data.items.filter(isTopLevelWork)
  const dated = open
    .filter((i) => ['today', 'upcoming'].includes(bucketOf(i, today, settings)))
    .sort((a, b) => (firstDayOf(a, settings.dayStartHour) ?? '').localeCompare(firstDayOf(b, settings.dayStartHour) ?? ''))
  const undated = open.filter((i) => !dated.includes(i))
  const routines = data.items.filter((i) => i.kind === 'routine' && i.parentId === null)
  const stamp = `${dayKey(now, 0)} ${clock(now)}`

  return [
    '# Perch 匯出',
    '',
    `${stamp} · Perch ${data.version}`,
    '',
    ...section('還沒做完', workLines(data.items, dated), '（沒有）'),
    ...section('隨手記', workLines(data.items, undated), '（沒有）'),
    ...section('例行', routines.map(routineLine), '（沒有）'),
    '## 紀錄',
    '',
    ...timelineLines(data.timeline, data.dayNotes, settings.dayStartHour),
  ]
    .join('\n')
    .trimEnd()
    .concat('\n')
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Writes perch-export-<date>-<time>.json and .md into `folder` and returns both paths. */
export function writeExport(
  db: DatabaseSync,
  folder: string,
  version: string,
  settings: ListSettings,
  now: number,
): { json: string; markdown: string } {
  const data = collectExport(db, version, now)
  const d = new Date(now)
  const base = `perch-export-${dayKey(now, 0)}-${pad(d.getHours())}${pad(d.getMinutes())}`
  mkdirSync(folder, { recursive: true })
  const json = join(folder, `${base}.json`)
  const markdown = join(folder, `${base}.md`)
  writeFileSync(json, `${JSON.stringify(data, null, 2)}\n`)
  writeFileSync(markdown, toMarkdown(data, settings, now))
  return { json, markdown }
}
