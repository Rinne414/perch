import { describe, expect, test } from 'vitest'
import { asAwayState, NO_AWAY, parseAwayOverride, shownAway, stepAway, type AwayState } from './away'

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const T0 = new Date(2026, 10, 11, 10, 0).getTime()
const TICK = 20 * SEC

/** Ticks every 20 seconds from `from` to `to`, with the idle time each tick would see. */
function run(state: AwayState, from: number, to: number, idleAt: (t: number) => number): AwayState {
  let s = state
  for (let t = from; t <= to; t += TICK) s = stepAway(s, t, idleAt(t) / SEC)
  return s
}

describe('stepAway: idle input', () => {
  test('under five minutes of no input is not away', () => {
    const s = run(NO_AWAY, T0, T0 + 10 * MIN, (t) => (t - T0) % (4 * MIN))

    expect(s).toEqual({ lastTickAt: T0 + 10 * MIN, openFrom: null, last: null })
  })

  test('five minutes without input opens a stretch that began when the input stopped', () => {
    const s = stepAway({ ...NO_AWAY, lastTickAt: T0 - TICK }, T0, 300)

    expect(s.openFrom).toBe(T0 - 5 * MIN)
    expect(s.last).toBeNull()
  })

  test('the stretch ends at the first input after it', () => {
    const left = T0
    const back = T0 + HOUR + 28 * MIN
    const s = run(NO_AWAY, T0, back + MIN, (t) => (t < back ? t - left : t - back))

    expect(s).toEqual({ lastTickAt: expect.any(Number), openFrom: null, last: { from: left, to: back } })
  })

  test('staying away keeps the start where it was', () => {
    const s = run(NO_AWAY, T0 + 5 * MIN, T0 + 2 * HOUR, (t) => t - T0)

    expect(s.openFrom).toBe(T0)
  })
})

describe('stepAway: gaps between ticks', () => {
  test('more than five minutes between ticks counts as away, from the last tick to the input that followed', () => {
    const s = stepAway({ ...NO_AWAY, lastTickAt: T0 }, T0 + 3 * HOUR, 30)

    expect(s).toEqual({ lastTickAt: T0 + 3 * HOUR, openFrom: null, last: { from: T0, to: T0 + 3 * HOUR - 30 * SEC } })
  })

  test('exactly five minutes between ticks is not a gap', () => {
    expect(stepAway({ ...NO_AWAY, lastTickAt: T0 }, T0 + 5 * MIN, 0).last).toBeNull()
  })

  test('a gap followed by no input stays open from the earlier of the last tick and the last input', () => {
    const fromTick = stepAway({ ...NO_AWAY, lastTickAt: T0 }, T0 + HOUR, 10 * 60)
    const fromInput = stepAway({ ...NO_AWAY, lastTickAt: T0 }, T0 + HOUR, 90 * 60)

    expect(fromTick.openFrom).toBe(T0)
    expect(fromInput.openFrom).toBe(T0 - 30 * MIN)
  })

  test('a gap inside a stretch keeps the stretch start', () => {
    const s = stepAway({ lastTickAt: T0, openFrom: T0 - 10 * MIN, last: null }, T0 + 2 * HOUR, 5)

    expect(s.last).toEqual({ from: T0 - 10 * MIN, to: T0 + 2 * HOUR - 5 * SEC })
  })

  test('the first tick ever has no gap to measure', () => {
    expect(stepAway(NO_AWAY, T0, 0)).toEqual({ lastTickAt: T0, openFrom: null, last: null })
  })
})

describe('shownAway', () => {
  const ended = (minutes: number, agoMs: number, now = T0 + 20 * HOUR): AwayState => ({
    lastTickAt: now,
    openFrom: null,
    last: { from: now - agoMs - minutes * MIN, to: now - agoMs },
  })
  const NOW = T0 + 20 * HOUR

  test('shows a stretch of ten minutes or more that ended less than twelve hours ago', () => {
    expect(shownAway(ended(10, 0), NOW)).toEqual({ from: NOW - 10 * MIN, to: NOW })
    expect(shownAway(ended(88, 12 * HOUR - 1), NOW)).not.toBeNull()
  })

  test('hides shorter stretches and ones that ended twelve hours ago or more', () => {
    expect(shownAway(ended(9.99, 0), NOW)).toBeNull()
    expect(shownAway(ended(88, 12 * HOUR), NOW)).toBeNull()
    expect(shownAway(NO_AWAY, NOW)).toBeNull()
  })

  test('the last stretch counts, so a short break after a long absence shows nothing', () => {
    const longAbsence = stepAway({ ...NO_AWAY, lastTickAt: NOW - 3 * HOUR }, NOW - HOUR, 0)
    const breakFrom = NOW - 6 * MIN
    const afterBreak = run(longAbsence, NOW - HOUR + TICK, NOW, (t) => (t >= breakFrom && t < NOW ? t - breakFrom : 0))

    expect(shownAway(longAbsence, NOW)).toEqual({ from: NOW - 3 * HOUR, to: NOW - HOUR })
    expect(afterBreak.last).toEqual({ from: breakFrom, to: NOW })
    expect(shownAway(afterBreak, NOW)).toBeNull()
  })

  test('a stretch that ends in the future (clock changed) is not shown', () => {
    expect(shownAway({ ...NO_AWAY, last: { from: NOW, to: NOW + HOUR } }, NOW)).toBeNull()
  })
})

describe('parseAwayOverride', () => {
  test('reads two epoch times in order', () => {
    expect(parseAwayOverride(`${T0},${T0 + HOUR}`)).toEqual({ from: T0, to: T0 + HOUR })
    expect(parseAwayOverride(` ${T0} , ${T0 + 1} `)).toEqual({ from: T0, to: T0 + 1 })
  })

  test('ignores anything else', () => {
    for (const bad of [undefined, '', 'x,y', `${T0}`, `${T0 + 1},${T0}`, `${T0},${T0}`, `1,2,3`]) {
      expect(parseAwayOverride(bad)).toBeNull()
    }
  })
})

describe('asAwayState', () => {
  test('keeps what is valid and drops the rest', () => {
    expect(asAwayState({ lastTickAt: T0, openFrom: 'x', last: { from: T0, to: T0 + 1 } })).toEqual({
      lastTickAt: T0,
      openFrom: null,
      last: { from: T0, to: T0 + 1 },
    })
    expect(asAwayState({ last: { from: T0 + 1, to: T0 } }).last).toBeNull()
    expect(asAwayState(null)).toEqual(NO_AWAY)
    expect(asAwayState('nonsense')).toEqual(NO_AWAY)
  })
})
