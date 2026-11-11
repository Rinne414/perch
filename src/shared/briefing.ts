import { sessionLabel } from './agents'
import { buildBays, type Bay, type MapSession } from './bays'
import { ago } from './format'
import { heroReport, type HeroReport } from './heroReport'
import { firstLineOf, quoteOf } from './briefingText'
import { buildLanes, type LaneSource, type LanesView, type TurnSpan } from './lanes'
import { isOneShot, isRunning, needsAttention } from './now'
import { projectName } from './projects'
import { isPlaceholderTitle } from './prompt'
import { digestReply, type ReplyDigest } from './replyDigest'
import { stateOf, type SessionGroup, type SessionState } from './sessionState'
import { gatherTodos, type TodoMarks, type TodoView } from './todos'
import type { AgentSession, AgentStatus, Item, SessionBrief } from './types'

export { durationLabel, durationParts, stampLabel, type DurationPart } from './spans'
export { firstLineOf, quoteOf } from './briefingText'

/** A stretch the person was away from the computer. */
export interface AwayStretch {
  readonly from: number
  readonly to: number
}

/** The span the briefing reports on: the away stretch, or the last 12 hours. */
export interface BriefingWindow {
  readonly from: number
  readonly to: number
}

/** A session that stopped to ask the person something, or failed. */
export interface WaitingEntry {
  readonly session: AgentSession
  readonly waitingSince: number
  /** What it asks: its own words when it stopped, else the first line of its latest reply. */
  readonly ask: string | null
  /** The person's latest typed prompt, shortened. */
  readonly latestPrompt: string | null
  /** The first line of its latest reply, when that is not already the ask. */
  readonly lastReply: string | null
  /** That reply came inside the away stretch. */
  readonly repliedWhileAway: boolean
  /** What its report says, for 報告裡留給你的事. */
  readonly digest: ReplyDigest
}

/** A session that finished and waits to be looked at. */
export interface DoneEntry {
  readonly session: AgentSession
  readonly finishedAt: number
  /** Prompts the person typed in it; 0 for sessions recorded before turns were kept. */
  readonly promptCount: number
  /** The first thing the person typed, shortened. */
  readonly firstPrompt: string | null
  /** Its report (see `pickReportTurn`), whole up to MAX_REPLY characters, else the one line it left when it stopped. */
  readonly reply: string | null
  /** The report was longer than MAX_REPLY; the full record has all of it. */
  readonly replyCut: boolean
  /** Perch kept its turns, so the full record has something to show. */
  readonly hasTurns: boolean
  readonly digest: ReplyDigest
}

export interface RunningEntry {
  readonly session: AgentSession
  readonly latestPrompt: string | null
  readonly hasTurns: boolean
  /** What its latest report said; empty while it has none. */
  readonly digest: ReplyDigest
}

/** One session of the 放著沒接 pile. */
export interface LeftEntry {
  readonly session: AgentSession
  readonly latestPrompt: string | null
  /** Perch kept its turns, so the full record has something to show. */
  readonly hasTurns: boolean
  readonly digest: ReplyDigest
}

/** Sessions left waiting from before the last restart: never looked at, never closed. */
export interface UnattendedSummary {
  readonly count: number
  readonly newestAt: number
  readonly oldestAt: number
  readonly failed: number
}

/** One line of 經過: a reply inside the window, or what a waiting session asks. */
export interface TimelineEntry {
  readonly at: number
  readonly sessionId: string
  readonly label: string
  readonly line: string
  readonly state: SessionState
  /** A waiting session's question (or a failure), not a reply. */
  readonly ask: boolean
}

export interface IdeaEntry {
  readonly item: Item
  /** The project folder's name, when the idea belongs to one. */
  readonly project: string | null
}

export interface BriefingPayload {
  readonly at: number
  readonly dayStartHour: number
  /** Null when the last away stretch was too short or too long ago to report. */
  readonly away: AwayStretch | null
  readonly window: BriefingWindow
  /** Longest waiting first. */
  readonly waiting: readonly WaitingEntry[]
  readonly done: readonly DoneEntry[]
  readonly running: readonly RunningEntry[]
  readonly unattended: UnattendedSummary | null
  /** The whole 放著沒接 pile, the most recently left first. */
  readonly left: readonly LeftEntry[]
  /** Oldest first. */
  readonly timeline: readonly TimelineEntry[]
  /** The newest open ideas; `ideaCount` has how many there are. */
  readonly ideas: readonly IdeaEntry[]
  readonly ideaCount: number
  readonly hero: HeroReport
  /** 全部的 agent: every session above, by project. */
  readonly bays: readonly Bay[]
  /** 你不在的時候. */
  readonly lanes: LanesView
  /** 報告裡留給你的事. */
  readonly todos: TodoView
}

export interface BriefingInput {
  readonly now: number
  readonly dayStartHour: number
  /** The last restart or sign-in; see `needsAttention`. */
  readonly cutoff: number
  /** Sessions to sort into the groups. */
  readonly sessions: readonly AgentSession[]
  readonly briefs: ReadonlyMap<string, SessionBrief>
  /** Replies that may have come inside the window (others are ignored), each at least its first line. */
  readonly turns: readonly TimelineReply[]
  /** When turns worked, for every turn overlapping the lanes' reach (see `laneHorizon`). */
  readonly spans: readonly TurnSpan[]
  /** Sessions the turns and spans belong to that are not in `sessions`, for their names. */
  readonly others: readonly AgentSession[]
  /** Open items; only top-level ideas are used. */
  readonly items: readonly Item[]
  readonly away: AwayStretch | null
  /** Points of the reports the person ticked off. */
  readonly todoMarks: TodoMarks
  /** Reads a report; the caller can make one bad reply give an empty digest instead of failing all. */
  readonly digest?: (reply: string | null, sessionId: string) => ReplyDigest
}

/** One reply for 經過. */
export interface TimelineReply {
  readonly agentSessionId: string
  readonly endedAt: number | null
  readonly reply: string | null
}

const HOUR_MS = 3_600_000
/** Without an away stretch the briefing looks back this far. */
export const FALLBACK_WINDOW_MS = 12 * HOUR_MS
export const SHOWN_IDEAS = 5
/** A finished session's report is carried this far on every refresh; 看完整紀錄 reads it whole. */
export const MAX_REPLY = 50_000

/** Statuses that ask the person to decide something (as opposed to look at a result). */
const DECISION_STATUSES: ReadonlySet<AgentStatus> = new Set(['needs_input', 'failed'])

export const isDecision = (s: AgentSession): boolean => DECISION_STATUSES.has(s.status)

/** Waiting on the person, and from before the last restart: it lost its terminal with nobody looking. */
export const isUnattended = (s: AgentSession, cutoff: number): boolean => needsAttention(s) && s.updatedAt < cutoff

export function briefingWindow(now: number, away: AwayStretch | null): BriefingWindow {
  return away ? { from: away.from, to: away.to } : { from: now - FALLBACK_WINDOW_MS, to: now }
}

const briefOf = (input: BriefingInput, s: AgentSession): SessionBrief | undefined => input.briefs.get(s.id)

const digestOf = (input: BriefingInput): ((reply: string | null, sessionId: string) => ReplyDigest) => input.digest ?? digestReply

/**
 * The person's latest prompt. Sessions from before turns were kept fall back to the title Perch
 * stored, unless that title only stands in for a background notice or other text nobody typed.
 */
const latestPromptOf = (brief: SessionBrief | undefined, s: AgentSession): string | null =>
  quoteOf(brief?.latestPrompt ?? null) ?? (s.title !== null && isPlaceholderTitle(s.title) ? null : quoteOf(s.title))

const inside = (at: number | null, w: BriefingWindow): boolean => at !== null && at >= w.from && at <= w.to

/** The report's text for the digest, carried no further than MAX_REPLY. */
const reportText = (brief: SessionBrief | undefined): string | null => brief?.reportReply?.slice(0, MAX_REPLY) ?? null

function waitingEntry(input: BriefingInput, s: AgentSession): WaitingEntry {
  const brief = briefOf(input, s)
  const replyLine = firstLineOf(brief?.latestReply ?? null)
  const ask = firstLineOf(s.detail) ?? replyLine
  const lastReply = replyLine !== null && replyLine !== ask ? replyLine : null
  return {
    session: s,
    waitingSince: s.attentionAt ?? s.updatedAt,
    ask,
    latestPrompt: latestPromptOf(brief, s),
    lastReply,
    repliedWhileAway: lastReply !== null && input.away !== null && inside(brief?.latestReplyAt ?? null, input.away),
    digest: digestOf(input)(reportText(brief), s.id),
  }
}

function doneEntry(input: BriefingInput, s: AgentSession): DoneEntry {
  const brief = briefOf(input, s)
  // Without turns the session left one stored line, which can carry a Markdown mark ("## 改好了").
  const whole = brief?.reportReply?.trim() ? brief.reportReply : firstLineOf(s.detail)
  const reply = whole === null ? null : whole.slice(0, MAX_REPLY)
  return {
    session: s,
    finishedAt: s.attentionAt ?? s.updatedAt,
    promptCount: brief?.promptCount ?? 0,
    firstPrompt: quoteOf(brief?.firstPrompt ?? null),
    reply,
    replyCut: (whole?.length ?? 0) > MAX_REPLY,
    hasTurns: (brief?.turnCount ?? 0) > 0,
    digest: digestOf(input)(reply, s.id),
  }
}

function otherEntry(input: BriefingInput, s: AgentSession): RunningEntry & LeftEntry {
  const brief = briefOf(input, s)
  return {
    session: s,
    latestPrompt: latestPromptOf(brief, s),
    hasTurns: (brief?.turnCount ?? 0) > 0,
    digest: digestOf(input)(reportText(brief), s.id),
  }
}

const sinceOf = (s: AgentSession): number => s.attentionAt ?? s.updatedAt
const byWaitedLongest = (a: AgentSession, b: AgentSession): number => sinceOf(a) - sinceOf(b)
const byAttentionDesc = (a: AgentSession, b: AgentSession): number => sinceOf(b) - sinceOf(a)
const byMovedDesc = (a: AgentSession, b: AgentSession): number => b.updatedAt - a.updatedAt

function unattendedSummary(pile: readonly AgentSession[]): UnattendedSummary | null {
  if (pile.length === 0) return null
  const times = pile.map((s) => s.updatedAt)
  return {
    count: pile.length,
    newestAt: Math.max(...times),
    oldestAt: Math.min(...times),
    failed: pile.filter((s) => s.status === 'failed').length,
  }
}

interface Groups {
  readonly waiting: readonly AgentSession[]
  readonly done: readonly AgentSession[]
  readonly running: readonly AgentSession[]
  readonly pile: readonly AgentSession[]
}

function groupsOf({ now, cutoff, sessions }: BriefingInput): Groups {
  const attention = sessions.filter((s) => needsAttention(s, cutoff))
  return {
    waiting: attention.filter(isDecision).sort(byWaitedLongest),
    done: attention.filter((s) => s.status === 'done' && !isOneShot(s)).sort(byAttentionDesc),
    running: sessions.filter((s) => isRunning(s, now, cutoff)).sort(byMovedDesc),
    pile: sessions.filter((s) => isUnattended(s, cutoff)).sort(byMovedDesc),
  }
}

/** Every grouped session with its group and when it started waiting or finished, most urgent group first. */
function mapSessions(g: Groups): MapSession[] {
  const of = (list: readonly AgentSession[], group: SessionGroup): MapSession[] =>
    list.map((session) => ({ session, group, since: group === 'waiting' || group === 'done' ? sinceOf(session) : session.updatedAt }))
  return [...of(g.waiting, 'waiting'), ...of(g.running, 'running'), ...of(g.done, 'done'), ...of(g.pile, 'unattended')]
}

/** Every session that may get a lane: the grouped ones, then the rest that only worked in the window. */
function laneSources(input: BriefingInput, grouped: readonly MapSession[]): LaneSource[] {
  const known = new Set(grouped.map((m) => m.session.id))
  const rest = [...input.sessions, ...input.others].filter((s) => !known.has(s.id))
  return [...grouped, ...[...new Map(rest.map((s) => [s.id, s])).values()].map((session) => ({ session, group: null, since: session.updatedAt }))]
}

function timelineOf(input: BriefingInput, w: BriefingWindow, grouped: readonly MapSession[], waiting: readonly WaitingEntry[]): TimelineEntry[] {
  const byId = new Map([...input.others, ...input.sessions].map((s) => [s.id, s]))
  const states = new Map(grouped.map((m) => [m.session.id, stateOf(m.session, m.group)]))
  const entries: TimelineEntry[] = []
  for (const t of input.turns) {
    const line = firstLineOf(t.reply)
    const session = byId.get(t.agentSessionId)
    if (!inside(t.endedAt, w) || line === null || !session) continue
    const state = states.get(session.id) ?? stateOf(session, 'done')
    entries.push({ at: t.endedAt!, sessionId: session.id, label: sessionLabel(session), line, state, ask: false })
  }
  for (const e of waiting) {
    if (e.ask === null) continue
    const failed = e.session.status === 'failed'
    const line = `${failed ? '失敗了' : '問你'}：${e.ask}`
    entries.push({ at: e.waitingSince, sessionId: e.session.id, label: sessionLabel(e.session), line, state: failed ? 'failed' : 'waiting', ask: true })
  }
  return entries.sort((a, b) => a.at - b.at || Number(a.ask) - Number(b.ask))
}

function ideasOf(items: readonly Item[]): IdeaEntry[] {
  return items
    .filter((i) => i.kind === 'idea' && i.parentId === null && i.doneAt === null && i.droppedAt === null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((item) => ({ item, project: projectName(item.project) }))
}

function todosOf(input: BriefingInput, waiting: readonly WaitingEntry[], done: readonly DoneEntry[], running: readonly RunningEntry[]): TodoView {
  const reportAt = (s: AgentSession): number | null => briefOf(input, s)?.reportReplyAt ?? null
  return gatherTodos(
    [
      ...waiting.map((e) => ({ session: e.session, glyph: stateOf(e.session, 'waiting'), reportAt: reportAt(e.session), digest: e.digest })),
      ...done.map((e) => ({ session: e.session, glyph: stateOf(e.session, 'done'), reportAt: reportAt(e.session), digest: e.digest })),
      ...running.map((e) => ({ session: e.session, glyph: stateOf(e.session, 'running'), reportAt: reportAt(e.session), digest: e.digest })),
    ],
    input.todoMarks,
  )
}

/** Everything Perch knows about what happened while the person was away, in one screen's worth. */
export function buildBriefing(input: BriefingInput): BriefingPayload {
  const { now, dayStartHour, away } = input
  const g = groupsOf(input)
  const window = briefingWindow(now, away)
  const ideas = ideasOf(input.items)
  const waiting = g.waiting.map((s) => waitingEntry(input, s))
  const done = g.done.map((s) => doneEntry(input, s))
  const running = g.running.map((s) => otherEntry(input, s))
  const grouped = mapSessions(g)
  const unattended = unattendedSummary(g.pile)
  const todos = todosOf(input, waiting, done, running)
  return {
    at: now,
    dayStartHour,
    away,
    window,
    waiting,
    done,
    running,
    unattended,
    left: g.pile.map((s) => otherEntry(input, s)),
    timeline: timelineOf(input, window, grouped, waiting),
    ideas: ideas.slice(0, SHOWN_IDEAS),
    ideaCount: ideas.length,
    hero: heroReport({
      now,
      waiting: waiting.map((e) => ({ name: sessionLabel(e.session), since: e.waitingSince, failed: e.session.status === 'failed', ask: e.ask })),
      done: done.length,
      running: running.length,
      firstDone: done[0] ? sessionLabel(done[0].session) : null,
      todoCount: todos.total,
      pile: unattended,
    }),
    bays: buildBays(grouped, now, dayStartHour),
    lanes: buildLanes(now, away, laneSources(input, grouped), input.spans, dayStartHour),
    todos,
  }
}

/** The sentence under 放著沒接: how many, how old, how many failed. */
export function unattendedSentence(u: UnattendedSummary, now: number): string {
  const age = (at: number): string => {
    const label = ago(at, now)
    return label === '剛剛' ? '不到 1 分鐘' : label
  }
  const newest = age(u.newestAt)
  const oldest = age(u.oldestAt)
  const ages = u.count === 1 || newest === oldest ? `放了 ${newest}` : `最近的一個放了 ${newest}，最久的 ${oldest}`
  const failed = u.failed === 0 ? '' : u.failed === u.count ? `，都是失敗後沒處理` : `，其中 ${u.failed} 個是失敗後沒處理`
  return `停下來等你之後，電腦重開或登出過，你沒有再回去，也沒有關掉。${ages}${failed}。`
}
