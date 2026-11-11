import type { AwayStretch } from '@shared/briefing'

/** What the away tracker remembers between ticks (and between runs, in settings). */
export interface AwayState {
  /** The previous tick; a long gap since then (sleep, shut down, Perch not running) counts as away. */
  readonly lastTickAt: number | null
  /** When the stretch going on now began; null while the person is here. */
  readonly openFrom: number | null
  /** The last stretch that ended. */
  readonly last: AwayStretch | null
}

export const NO_AWAY: AwayState = { lastTickAt: null, openFrom: null, last: null }

const MINUTE_MS = 60_000
/** No input for this long means the person left, from the moment the input stopped. */
export const IDLE_AWAY_MS = 5 * MINUTE_MS
/** Ticks come every 20 seconds; a gap longer than this means the computer slept or Perch was not running. */
export const GAP_AWAY_MS = 5 * MINUTE_MS
/** Shorter stretches are not worth a sentence. */
export const MIN_SHOWN_MS = 10 * MINUTE_MS
/** A stretch that ended longer ago than this is old news. */
export const SHOWN_FOR_MS = 12 * 60 * MINUTE_MS

/**
 * One scheduler tick: `idleSeconds` is how long the system has had no keyboard or mouse input.
 * A stretch starts when that reaches five minutes, or with a gap of more than five minutes
 * between two ticks, and ends at the first input after it.
 */
export function stepAway(state: AwayState, now: number, idleSeconds: number): AwayState {
  const lastInputAt = now - Math.max(0, idleSeconds) * 1000
  const gapFrom = state.lastTickAt !== null && now - state.lastTickAt > GAP_AWAY_MS ? state.lastTickAt : null
  const from = gapFrom === null ? state.openFrom : Math.min(state.openFrom ?? gapFrom, gapFrom)
  if (now - lastInputAt >= IDLE_AWAY_MS) {
    return { ...state, lastTickAt: now, openFrom: Math.min(from ?? lastInputAt, lastInputAt) }
  }
  if (from === null) return { ...state, lastTickAt: now }
  return { lastTickAt: now, openFrom: null, last: { from, to: Math.max(from, lastInputAt) } }
}

/** The stretch the briefing reports: the last one, when it lasted ten minutes and ended within twelve hours. */
export function shownAway(state: AwayState, now: number): AwayStretch | null {
  const last = state.last
  if (!last || last.to > now) return null
  return last.to - last.from >= MIN_SHOWN_MS && now - last.to < SHOWN_FOR_MS ? last : null
}

/** TC_AWAY=<fromEpochMs>,<toEpochMs> for screenshots; null when it is not two times in order. */
export function parseAwayOverride(value: string | undefined): AwayStretch | null {
  if (!value) return null
  const [from, to, ...rest] = value.split(',').map((part) => Number(part.trim()))
  if (rest.length > 0 || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) return null
  return { from, to }
}

/** Reads a stored state defensively: settings can hold anything an older or newer version wrote. */
export function asAwayState(value: unknown): AwayState {
  if (typeof value !== 'object' || value === null) return NO_AWAY
  const v = value as Record<string, unknown>
  const time = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  const last = v['last'] as Record<string, unknown> | null | undefined
  const from = time(last?.['from'])
  const to = time(last?.['to'])
  return {
    lastTickAt: time(v['lastTickAt']),
    openFrom: time(v['openFrom']),
    last: from !== null && to !== null && from <= to ? { from, to } : null,
  }
}
