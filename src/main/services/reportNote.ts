import { agentName, sessionLabel, STATUS_LABEL } from '@shared/agents'
import { durationLabel, firstLineOf, stampLabel, unattendedSentence, type BriefingPayload } from '@shared/briefing'
import { dayKey } from '@shared/day'
import { localStamp } from '@shared/format'
import { projectName } from '@shared/projects'
import { reportText } from '@shared/reportPick'
import type { AgentSession, AgentTurn } from '@shared/types'
import { safeInline, safeQuote } from './noteSafety'

/** Line breaks JSON leaves as they are but a YAML reader may break a line at. */
const RAW_BREAKS = /[\u0085\u2028\u2029]/g

/**
 * A front matter value: a JSON string, which YAML reads as the same text, with every line break
 * escaped, so no value (a folder, an id) can start a line of its own such as a forged `session:`.
 */
export const yaml = (v: string | number): string =>
  typeof v === 'number' ? String(v) : JSON.stringify(v).replace(RAW_BREAKS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i
const MAX_NAME = 80

/** A session name as a file name Windows accepts: no reserved characters or names, no trailing dot or space. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .replace(/[. ]+$/, '')
  if (!cleaned) return 'session'
  return WINDOWS_RESERVED.test(cleaned) ? `${cleaned}_` : cleaned
}

/** "2026-11-10 ComfyUI 新模型工作流": the day it started, so one session keeps one name however long it runs. */
export const reportBaseName = (s: AgentSession, dayStartHour: number): string =>
  `${dayKey(s.startedAt, dayStartHour)} ${safeFileName(sessionLabel(s))}`

/** When the session last stopped (finished, failed, asked), else when it last reported. */
export const finishedAt = (s: AgentSession): number => s.attentionAt ?? s.updatedAt

const NO_TURNS = '（這個 session 在 Perch 開始留下完整紀錄之前就有了，沒有逐句紀錄。）'
/** As on the day notes: Perch rewrites the file, so edits made in it do not last. */
const REWRITTEN = '<!-- Perch 會改寫這個檔，這裡改的會被蓋掉；想寫的話請另開一個檔。 -->'

/** A prompt or reply as quoted text: made safe, its headings pushed under level `top`. */
const quoted = (text: string, top: number): string => nestHeadings(safeQuote(text.trim()), top)

function frontMatter(s: AgentSession, prompts: number, dayStartHour: number): string[] {
  return [
    '---',
    `date: ${dayKey(finishedAt(s), dayStartHour)}`,
    'source: Perch',
    `agent: ${yaml(agentName(s.agent))}`,
    `folder: ${yaml(s.cwd ?? '')}`,
    `session: ${yaml(s.id)}`,
    `started: ${yaml(localStamp(s.startedAt))}`,
    `finished: ${yaml(localStamp(finishedAt(s)))}`,
    `prompts: ${prompts}`,
    '---',
  ]
}

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+\S/
const DEEPEST_HEADING = 6

/**
 * A reply or a pasted prompt has headings of its own; left as they are they would sit beside
 * the note's own sections in Obsidian's outline. Pushes them down so the text's top heading
 * lands on level `top` (never up, and never inside a code fence).
 */
export function nestHeadings(text: string, top: number): string {
  const lines = text.split('\n')
  let fenced = false
  const levels = lines.map((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced
      return 0
    }
    return fenced ? 0 : (HEADING.exec(line)?.[1].length ?? 0)
  })
  const found = levels.filter((level) => level > 0)
  const shift = found.length ? Math.max(0, top - Math.min(...found)) : 0
  if (shift === 0) return text
  return lines
    .map((line, i) => (levels[i] ? `${'#'.repeat(Math.min(DEEPEST_HEADING, levels[i] + shift))}${line.slice(levels[i])}` : line))
    .join('\n')
}

/** Heading levels for quoted text: under a "## section", and under a "### turn" inside one. */
const UNDER_SECTION = 3
const UNDER_TURN = 4

function fullRecord(turns: readonly AgentTurn[]): string[] {
  return turns.flatMap((t, i) => [
    `### ${i + 1}. ${localStamp(t.startedAt)}`,
    '',
    ...(t.prompt !== null
      ? ['**你說**', '', quoted(t.prompt, UNDER_TURN), '']
      : ['**你說**：（沒有，這一輪是背景通知或接著上一輪）', '']),
    ...(t.reply !== null && t.endedAt !== null
      ? [`**它回**（${localStamp(t.endedAt)}）`, '', quoted(t.reply, UNDER_TURN), '']
      : ['**它回**：（這一輪沒有留下回覆）', '']),
  ])
}

/**
 * One session as a note: front matter for search and for agents, then its report whole, every
 * prompt the person typed, and every turn. Sessions recorded before turns were kept say so.
 */
export function sessionNoteMarkdown(s: AgentSession, turns: readonly AgentTurn[], dayStartHour: number): string {
  const typed = turns.filter((t): t is AgentTurn & { prompt: string } => t.prompt !== null)
  const lastReply = reportText(turns) ?? firstLineOf(s.detail)
  const where = projectName(s.cwd)
  return [
    ...frontMatter(s, typed.length, dayStartHour),
    '',
    `# ${safeInline(sessionLabel(s))}`,
    '',
    REWRITTEN,
    '',
    `${agentName(s.agent)}${where ? `，在 ${where}` : ''}，${STATUS_LABEL[s.status]}。從 ${localStamp(s.startedAt)} 到 ${localStamp(finishedAt(s))}。`,
    '',
    '## 最後的回覆',
    '',
    lastReply ? quoted(lastReply, UNDER_SECTION) : '（沒有回覆）',
    '',
    '## 你說過的話',
    '',
    ...(typed.length
      ? typed.flatMap((t) => [`### ${localStamp(t.startedAt)}`, '', quoted(t.prompt, UNDER_TURN), ''])
      : [NO_TURNS, '']),
    '## 完整經過',
    '',
    ...(turns.length ? fullRecord(turns) : [NO_TURNS, '']),
  ]
    .join('\n')
    .trimEnd()
    .concat('\n')
}

const bullet = (name: string, facts: string, line: string | null): string =>
  `- **${safeInline(name)}**（${safeInline(facts)}）${line ? `：${safeInline(line)}` : ''}`

function sessionSections(b: BriefingPayload): string[] {
  const { at, dayStartHour } = b
  const where = (s: AgentSession): string => projectName(s.cwd) ?? agentName(s.agent)
  const section = (title: string, lines: readonly string[]): string[] => (lines.length ? [`## ${title}（${lines.length}）`, '', ...lines, ''] : [])
  return [
    `## 等你決定（${b.waiting.length}）`,
    '',
    ...(b.waiting.length ? [] : ['現在沒有 agent 在等你。']),
    ...b.waiting.map((w) =>
      bullet(sessionLabel(w.session), `${STATUS_LABEL[w.session.status]}，${where(w.session)}，等了 ${durationLabel(at - w.waitingSince)}`, w.ask ?? w.lastReply),
    ),
    '',
    ...section(
      '做完了',
      b.done.map((d) => bullet(sessionLabel(d.session), `${where(d.session)}，${stampLabel(d.finishedAt, at, dayStartHour)} 做完`, firstLineOf(d.reply))),
    ),
    ...section(
      '還在跑',
      b.running.map((r) => bullet(sessionLabel(r.session), `${where(r.session)}，跑了 ${durationLabel(at - r.session.startedAt)}`, r.latestPrompt && `你最後交代的「${r.latestPrompt}」`)),
    ),
  ]
}

/** 存成今天的筆記: the whole briefing as one note. */
export function briefingNoteMarkdown(b: BriefingPayload): string {
  const { at, dayStartHour, away } = b
  const day = dayKey(at, dayStartHour)
  const span = away
    ? `你離開了 ${durationLabel(away.to - away.from)}（${stampLabel(away.from, at, dayStartHour)} 到 ${stampLabel(away.to, at, dayStartHour)}）。`
    : '這段時間：最近 12 小時。'
  return [
    '---',
    `date: ${day}`,
    'source: Perch',
    'kind: 簡報',
    `written: ${yaml(localStamp(at))}`,
    '---',
    '',
    `# 簡報 ${day}`,
    '',
    REWRITTEN,
    '',
    span,
    '',
    ...sessionSections(b),
    ...(b.todos.total
      ? [
          `## 報告裡留給你的事（${b.todos.total}）`,
          '',
          ...b.todos.groups.flatMap((g) => [
            ...g.rows.map((r) => `- [ ] ${safeInline(r.text)}（${safeInline(g.name)}）`),
            ...(g.more ? [`- 「${safeInline(g.name)}」的報告還有 ${g.more} 件`] : []),
          ]),
          '',
        ]
      : []),
    ...(b.unattended
      ? [`## 放著沒接（${b.unattended.count}）`, '', unattendedSentence(b.unattended, at), '', ...b.left.map((l) => bullet(sessionLabel(l.session), `${STATUS_LABEL[l.session.status]}，放了 ${durationLabel(at - l.session.updatedAt)}`, null)), '']
      : []),
    ...(b.timeline.length ? ['## 這段時間的經過', '', ...b.timeline.map((t) => `- ${stampLabel(t.at, at, dayStartHour)} ${safeInline(t.line)}（${safeInline(t.label)}）`), ''] : []),
    ...(b.ideaCount
      ? [
          `## 提過、還沒做的（${b.ideaCount > b.ideas.length ? `最新 ${b.ideas.length} 個，共 ${b.ideaCount} 個` : b.ideaCount}）`,
          '',
          ...b.ideas.map((i) => `- ${safeInline(i.item.title)}${i.project ? `（${safeInline(i.project)}）` : ''}`),
          '',
        ]
      : []),
  ]
    .join('\n')
    .trimEnd()
    .concat('\n')
}
