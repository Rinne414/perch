import { sessionLabel } from './agents'
import { clock } from './format'
import { shortTime } from './bays'
import { stateOf, type SessionGroup, type SessionState } from './sessionState'
import { stampLabel } from './spans'
import type { AgentSession } from './types'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
/** Without an away stretch the lanes look back at most this far. */
const LOOKBACK_MS = 12 * HOUR_MS
/** A running session silent this long may be stuck. */
export const QUIET_MS = 10 * MINUTE_MS

/** A session that may get a lane: its group in the briefing, or null when it only worked in the window. */
export interface LaneSource {
  readonly session: AgentSession
  readonly group: SessionGroup | null
  /** When it started waiting (waiting) or finished (done); otherwise its last report. */
  readonly since: number
}

/** One turn's span: from its prompt to its reply; still open while `endedAt` is null. */
export interface TurnSpan {
  readonly agentSessionId: string
  readonly startedAt: number
  readonly endedAt: number | null
}

export interface LaneBar {
  /** Where it is drawn from: its start, or the window's start when it began before. */
  readonly from: number
  readonly to: number
  /** When it really began. */
  readonly start: number
  /** It began before the window; it fades in at the left edge. */
  readonly pre: boolean
  /** Still open; drawn with the bright end cap where the solid part ends. */
  readonly open: boolean
  /**
   * An open bar whose session has not reported for `QUIET_MS` or more: solid only up to its last
   * report, then this faint dashed stretch to now. Nobody saw work there, so it counts for nothing.
   */
  readonly silent: { readonly from: number; readonly to: number } | null
}

export interface LaneEnd {
  readonly kind: 'done' | 'wait' | 'fail'
  readonly at: number
}

export interface Lane {
  readonly id: string
  readonly name: string
  readonly state: SessionState
  /** The same short time the map shows: "等 6 分", "跑 5 分", "13:52". */
  readonly time: string
  readonly bars: readonly LaneBar[]
  readonly end: LaneEnd | null
  /** Waiting for the person since then: a dashed line to now. */
  readonly holdFrom: number | null
}

export interface Tick {
  readonly at: number
  /** A clock label on the major ticks. */
  readonly label: string | null
}

export interface LaneFigure {
  readonly name: string
  readonly ms: number
}

export interface LanesView {
  readonly from: number
  readonly to: number
  readonly lanes: readonly Lane[]
  readonly ticks: readonly Tick[]
  /** Sessions of the briefing that did nothing inside the window, so they have no lane. */
  readonly idle: number
  /** Sum of the solid bars inside the away stretch, or inside the window without one. */
  readonly workMs: number
  /** The running session that has not reported for `QUIET_MS` or more, the longest. */
  readonly quiet: LaneFigure | null
  /** The session that has waited for the person longest. */
  readonly longestWait: LaneFigure | null
}

/** Room left before the first bar: at least 10 minutes, or 15% of the span. */
export const lanePad = (spanMs: number): number => Math.max(10 * MINUTE_MS, spanMs * 0.15)

/** The earliest moment a lane can show: the away stretch's start less the pad, else 12 hours back. */
export const laneHorizon = (now: number, away: { from: number; to: number } | null): number =>
  away ? away.from - lanePad(away.to - away.from) : now - LOOKBACK_MS

interface RawBar {
  readonly from: number
  readonly to: number
  readonly open: boolean
  /** Where an open bar's silent stretch ends (now); null when it is not silent. */
  readonly silentTo: number | null
}

interface Raw {
  readonly source: LaneSource
  readonly bars: readonly RawBar[]
}

/** A bar still open now: solid up to the last report when that was `QUIET_MS` or more ago, else to now. */
function openBar(from: number, s: AgentSession, now: number): RawBar {
  if (now - s.updatedAt < QUIET_MS) return { from, to: now, open: true, silentTo: null }
  return { from, to: Math.max(from, s.updatedAt), open: true, silentTo: now }
}

/**
 * One turn as a bar. A turn that never got a reply but has a later turn after it was interrupted:
 * it ends where the next one starts, never over it. The last one is open only while the session runs.
 */
function turnBar(t: TurnSpan, next: TurnSpan | undefined, s: AgentSession, running: boolean, now: number): RawBar {
  const closed = (to: number): RawBar => ({ from: t.startedAt, to: Math.max(t.startedAt, to), open: false, silentTo: null })
  if (t.endedAt !== null) return closed(t.endedAt)
  if (next) return closed(next.startedAt)
  return running ? openBar(t.startedAt, s, now) : closed(s.updatedAt)
}

function rawBars(source: LaneSource, spans: readonly TurnSpan[], now: number): Raw {
  const s = source.session
  const running = source.group === 'running'
  const own = spans.filter((t) => t.agentSessionId === s.id).sort((a, b) => a.startedAt - b.startedAt)
  const bars = own.length
    ? own.map((t, i) => turnBar(t, own[i + 1], s, running, now))
    : [running ? openBar(s.startedAt, s, now) : { from: s.startedAt, to: s.updatedAt, open: false, silentTo: null }]
  return { source, bars }
}

/** Time covered by the bars between `from` and `to`, overlaps counted once. */
function coveredMs(bars: readonly LaneBar[], from: number, to: number): number {
  const parts = bars
    .map((b) => [Math.max(b.from, from), Math.min(b.to, to)] as const)
    .filter(([a, z]) => z > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let reach = -Infinity
  for (const [a, z] of parts) {
    if (z <= reach) continue
    total += z - Math.max(a, reach)
    reach = z
  }
  return total
}

function endOf(source: LaneSource, lastTo: number): LaneEnd | null {
  const s = source.session
  if (source.group === 'waiting') return { kind: s.status === 'failed' ? 'fail' : 'wait', at: source.since }
  // A finished one's dot sits where its last bar ends, even when a later line came after it finished.
  if (source.group === 'done' || (source.group === null && s.status === 'done')) return { kind: 'done', at: lastTo }
  if (source.group === null && s.status === 'failed') return { kind: 'fail', at: lastTo }
  return null
}

const RANK: Readonly<Record<string, number>> = { waiting: 0, running: 1 }

function timeOf(source: LaneSource, lastTo: number, now: number, dayStartHour: number): string {
  const { group } = source
  return group ? shortTime({ ...source, group }, now, dayStartHour) : stampLabel(lastTo, now, dayStartHour)
}

function laneOf(raw: Raw, from: number, now: number, dayStartHour: number): Lane {
  const { source } = raw
  const bars = raw.bars
    .filter((b) => (b.silentTo ?? b.to) >= from)
    .map((b) => ({
      from: Math.max(b.from, from),
      to: Math.max(b.to, from),
      start: b.from,
      pre: b.from < from,
      open: b.open,
      silent: b.silentTo === null ? null : { from: Math.max(b.to, from), to: b.silentTo },
    }))
  const lastTo = Math.max(...raw.bars.map((b) => b.to))
  const end = endOf(source, lastTo)
  const waits = source.group === 'waiting' && source.session.status !== 'failed'
  return {
    id: source.session.id,
    name: sessionLabel(source.session),
    state: stateOf(source.session, source.group ?? 'done'),
    time: timeOf(source, lastTo, now, dayStartHour),
    bars,
    end: end && end.at >= from ? end : null,
    holdFrom: waits ? Math.max(from, source.since) : null,
  }
}

const TICK_STEPS_MIN = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720]
const MAX_LABELS = 6

/** Ruler ticks: a clock label every step that leaves at most six labels, a small tick halfway. */
export function rulerTicks(from: number, to: number): Tick[] {
  const span = Math.max(MINUTE_MS, to - from)
  const step = (TICK_STEPS_MIN.find((m) => span / (m * MINUTE_MS) <= MAX_LABELS) ?? 720) * MINUTE_MS
  const half = step / 2
  const offset = new Date(from).getTimezoneOffset() * MINUTE_MS
  const ticks: Tick[] = []
  for (let at = Math.ceil((from - offset) / half) * half + offset; at <= to; at += half) {
    ticks.push({ at, label: Math.round((at - offset) / half) % 2 === 0 ? clock(at) : null })
  }
  return ticks
}

function figures(sources: readonly LaneSource[], now: number): Pick<LanesView, 'quiet' | 'longestWait'> {
  const longest = (list: readonly LaneSource[], age: (s: LaneSource) => number): LaneFigure | null =>
    list.reduce<LaneFigure | null>((best, s) => (best && best.ms >= age(s) ? best : { name: sessionLabel(s.session), ms: age(s) }), null)
  return {
    quiet: longest(sources.filter((s) => s.group === 'running' && now - s.session.updatedAt >= QUIET_MS), (s) => now - s.session.updatedAt),
    longestWait: longest(sources.filter((s) => s.group === 'waiting'), (s) => now - s.since),
  }
}

/**
 * 你不在的時候: one lane per session that worked inside the window or is waiting or running now.
 * The window runs to now from the away stretch's start less a pad, or, without one, from the
 * earliest bar less the pad but never more than 12 hours back. Waiting first, then running, then
 * the rest by when they ended, newest first.
 */
export function buildLanes(
  now: number,
  away: { from: number; to: number } | null,
  sources: readonly LaneSource[],
  spans: readonly TurnSpan[],
  dayStartHour: number,
): LanesView {
  const horizon = laneHorizon(now, away)
  const raws = sources
    .map((s) => rawBars(s, spans, now))
    .filter((r) => r.source.group === 'waiting' || r.source.group === 'running' || r.bars.some((b) => b.to >= horizon))
  const earliest = Math.min(now, ...raws.flatMap((r) => r.bars.map((b) => b.from)))
  const from = away ? horizon : Math.max(horizon, earliest - lanePad(now - earliest))
  const lastEnd = (r: Raw): number => Math.max(...r.bars.map((b) => b.to))
  const ordered = [...raws].sort((a, b) => (RANK[a.source.group ?? ''] ?? 2) - (RANK[b.source.group ?? ''] ?? 2) || lastEnd(b) - lastEnd(a))
  const lanes = ordered.map((r) => laneOf(r, from, now, dayStartHour))
  const shown = new Set(lanes.map((l) => l.id))
  const [workFrom, workTo] = away ? [away.from, away.to] : [from, now]
  return {
    from,
    to: now,
    lanes,
    ticks: rulerTicks(from, now),
    idle: sources.filter((s) => s.group !== null && !shown.has(s.session.id)).length,
    workMs: lanes.reduce((sum, l) => sum + coveredMs(l.bars, workFrom, workTo), 0),
    ...figures(sources, now),
  }
}
