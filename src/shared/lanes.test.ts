import { describe, expect, test } from 'vitest'
import { buildLanes, lanePad, rulerTicks, type LaneSource, type TurnSpan } from './lanes'
import type { SessionGroup } from './sessionState'
import type { AgentSession, AgentStatus } from './types'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 10, 11, 14, 0).getTime()

function source(id: string, group: SessionGroup | null, over: Partial<AgentSession> = {}, since = NOW - 5 * MIN): LaneSource {
  const status: AgentStatus = group === 'waiting' ? 'needs_input' : group === 'running' ? 'running' : 'done'
  return {
    group,
    since,
    session: {
      id,
      agent: 'claude-code',
      sessionId: id,
      cwd: null,
      name: id,
      title: null,
      status,
      detail: null,
      startedAt: NOW - 3 * HOUR,
      updatedAt: since,
      attentionAt: since,
      acknowledgedAt: null,
      endedAt: null,
      reopenedAt: null,
      ...over,
    },
  }
}

const span = (agentSessionId: string, startedAt: number, endedAt: number | null): TurnSpan => ({ agentSessionId, startedAt, endedAt })

describe('window', () => {
  test('with an away stretch: from its start less the pad, to now', () => {
    const away = { from: NOW - 85 * MIN, to: NOW - 3 * MIN }
    const view = buildLanes(NOW, away, [source('d', 'done')], [span('d', NOW - 30 * MIN, NOW - 5 * MIN)], 4)

    expect(view.from).toBe(away.from - lanePad(82 * MIN))
    expect(view.to).toBe(NOW)
  })

  test('without one: from the earliest bar less the pad, never more than 12 hours back', () => {
    const near = buildLanes(NOW, null, [source('d', 'done')], [span('d', NOW - 60 * MIN, NOW - 10 * MIN)], 4)
    const far = buildLanes(NOW, null, [source('r', 'running')], [span('r', NOW - 30 * HOUR, null)], 4)

    expect(near.from).toBe(NOW - 60 * MIN - lanePad(60 * MIN))
    expect(far.from).toBe(NOW - 12 * HOUR)
  })
})

describe('bars and marks', () => {
  test('a turn begun before the window fades in at its edge; a running turn is open to now', () => {
    const view = buildLanes(NOW, null, [source('r', 'running', { updatedAt: NOW - MIN })], [span('r', NOW - 20 * HOUR, NOW - 2 * HOUR), span('r', NOW - HOUR, null)], 4)

    expect(view.lanes[0].bars).toEqual([
      { from: NOW - 12 * HOUR, to: NOW - 2 * HOUR, start: NOW - 20 * HOUR, pre: true, open: false, silent: null },
      { from: NOW - HOUR, to: NOW, start: NOW - HOUR, pre: false, open: true, silent: null },
    ])
  })

  test('waiting: a diamond where it stopped and a dashed line to now; failed: a cross; finished: a dot', () => {
    const view = buildLanes(
      NOW,
      null,
      [source('w', 'waiting', {}, NOW - 6 * MIN), source('f', 'waiting', { status: 'failed' }, NOW - 9 * MIN), source('d', 'done', {}, NOW - 20 * MIN)],
      [span('w', NOW - HOUR, NOW - 6 * MIN), span('f', NOW - HOUR, NOW - 9 * MIN), span('d', NOW - HOUR, NOW - 20 * MIN)], 4,
    )
    const byId = Object.fromEntries(view.lanes.map((l) => [l.id, l]))

    expect(byId.w).toMatchObject({ end: { kind: 'wait', at: NOW - 6 * MIN }, holdFrom: NOW - 6 * MIN })
    expect(byId.f).toMatchObject({ end: { kind: 'fail', at: NOW - 9 * MIN }, holdFrom: null, state: 'failed' })
    expect(byId.d).toMatchObject({ end: { kind: 'done', at: NOW - 20 * MIN }, holdFrom: null })
  })

  test('an open bar is solid up to the last report; silent 10 minutes or more, a dashed stretch runs on to now', () => {
    const view = buildLanes(NOW, null, [source('r', 'running', { updatedAt: NOW - 8 * HOUR - 17 * MIN })], [span('r', NOW - 30 * HOUR, null)], 4)

    expect(view.lanes[0].bars).toEqual([
      { from: NOW - 12 * HOUR, to: NOW - 8 * HOUR - 17 * MIN, start: NOW - 30 * HOUR, pre: true, open: true, silent: { from: NOW - 8 * HOUR - 17 * MIN, to: NOW } },
    ])
    expect(view.workMs).toBe(12 * HOUR - 8 * HOUR - 17 * MIN)
  })

  test('quiet under 10 minutes, an open bar still runs solid to now; a running session without turns follows the same rule', () => {
    const recent = buildLanes(NOW, null, [source('r', 'running', { updatedAt: NOW - 9 * MIN })], [span('r', NOW - HOUR, null)], 4)
    const bare = buildLanes(NOW, null, [source('b', 'running', { startedAt: NOW - HOUR, updatedAt: NOW - 30 * MIN })], [], 4)

    expect(recent.lanes[0].bars[0]).toMatchObject({ to: NOW, open: true, silent: null })
    expect(bare.lanes[0].bars[0]).toMatchObject({ from: NOW - HOUR, to: NOW - 30 * MIN, open: true, silent: { from: NOW - 30 * MIN, to: NOW } })
  })

  test('a turn that never got a reply ends where the next one starts, not over it', () => {
    const view = buildLanes(
      NOW,
      null,
      [source('d', 'done', { updatedAt: NOW - 10 * MIN }, NOW - 10 * MIN)],
      [span('d', NOW - 2 * HOUR, null), span('d', NOW - HOUR, NOW - 10 * MIN)],
      4,
    )
    expect(view.lanes[0].bars.map((b) => [b.from, b.to])).toEqual([
      [NOW - 2 * HOUR, NOW - HOUR],
      [NOW - HOUR, NOW - 10 * MIN],
    ])
    expect(view.workMs).toBe(2 * HOUR - 10 * MIN)
  })

  test('bars that overlap count once in the work time', () => {
    const view = buildLanes(NOW, null, [source('d', 'done', {}, NOW - 10 * MIN)], [span('d', NOW - 2 * HOUR, NOW - 30 * MIN), span('d', NOW - HOUR, NOW - 10 * MIN)], 4)
    expect(view.workMs).toBe(2 * HOUR - 10 * MIN)
  })

  test('a finished dot sits at the end of its last bar, not where it first finished', () => {
    const view = buildLanes(NOW, null, [source('d', 'done', {}, NOW - 8 * MIN)], [span('d', NOW - HOUR, NOW - 8 * MIN), span('d', NOW - 7 * MIN, NOW - 7 * MIN)], 4)
    expect(view.lanes[0].end).toEqual({ kind: 'done', at: NOW - 7 * MIN })
  })

  test('a session without turns gets one bar from when it started (or the window) to its last report', () => {
    const view = buildLanes(NOW, null, [source('old', 'done', { startedAt: NOW - 2 * HOUR, updatedAt: NOW - HOUR }, NOW - HOUR)], [], 4)
    expect(view.lanes[0].bars).toEqual([{ from: NOW - 2 * HOUR, to: NOW - HOUR, start: NOW - 2 * HOUR, pre: false, open: false, silent: null }])
  })

  test('an open turn of a session no longer running ends at its last report, not now', () => {
    const view = buildLanes(NOW, null, [source('w', 'waiting', {}, NOW - 10 * MIN)], [span('w', NOW - HOUR, null)], 4)
    expect(view.lanes[0].bars[0]).toMatchObject({ to: NOW - 10 * MIN, open: false })
  })
})

describe('which lanes and in what order', () => {
  test('waiting, running, then the rest by when they ended, newest first; old finished ones are left out', () => {
    const view = buildLanes(
      NOW,
      null,
      [
        source('d-old', 'done', {}, NOW - 3 * HOUR),
        source('r', 'running', { updatedAt: NOW - MIN }),
        source('d-new', 'done', {}, NOW - 20 * MIN),
        source('w', 'waiting'),
        source('ancient', 'done', { startedAt: NOW - 40 * HOUR, updatedAt: NOW - 30 * HOUR }, NOW - 30 * HOUR),
        source('worked', null, { status: 'cancelled' }),
      ],
      [span('d-old', NOW - 4 * HOUR, NOW - 3 * HOUR), span('d-new', NOW - HOUR, NOW - 20 * MIN), span('w', NOW - HOUR, NOW - 5 * MIN), span('r', NOW - HOUR, null), span('worked', NOW - 2 * HOUR, NOW - 90 * MIN)], 4,
    )

    expect(view.lanes.map((l) => l.id)).toEqual(['w', 'r', 'd-new', 'worked', 'd-old'])
  })
})

describe('time cell and idle sessions', () => {
  test('each lane carries the short time the map shows', () => {
    const view = buildLanes(
      NOW,
      null,
      [source('w', 'waiting', {}, NOW - 6 * MIN), source('r', 'running', { startedAt: NOW - 5 * MIN }), source('d', 'done', {}, new Date(2026, 10, 11, 13, 52).getTime())],
      [span('w', NOW - HOUR, NOW - 6 * MIN), span('d', NOW - HOUR, NOW - 8 * MIN)],
      4,
    )
    expect(view.lanes.map((l) => l.time)).toEqual(['等 6 分', '跑 5 分', '13:52'])
  })

  test('sessions of the briefing that did nothing in the window are counted, not drawn', () => {
    const old = { startedAt: NOW - 40 * HOUR, updatedAt: NOW - 30 * HOUR }
    const view = buildLanes(NOW, null, [source('d', 'done'), source('u1', 'unattended', old, NOW - 30 * HOUR), source('u2', 'unattended', old, NOW - 30 * HOUR), source('x', null, old)], [span('d', NOW - HOUR, NOW - 5 * MIN)], 4)
    expect(view.lanes.map((l) => l.id)).toEqual(['d'])
    expect(view.idle).toBe(2)
  })
})

describe('figures', () => {
  test('work time inside the window, the running one quiet longest, the one waiting longest', () => {
    const view = buildLanes(
      NOW,
      null,
      [source('r1', 'running', { updatedAt: NOW - 47 * MIN }), source('r2', 'running', { updatedAt: NOW - MIN }), source('w1', 'waiting', {}, NOW - 6 * MIN), source('w2', 'waiting', {}, NOW - 2 * MIN)],
      [span('r1', NOW - 2 * HOUR, null), span('w1', NOW - HOUR, NOW - 6 * MIN)], 4,
    )

    expect(view.quiet).toEqual({ name: 'r1', ms: 47 * MIN })
    expect(view.longestWait).toEqual({ name: 'w1', ms: 6 * MIN })
    // r1 has not reported for 47 minutes: only its solid part, up to that report, counts.
    expect(view.workMs).toBe(2 * HOUR - 47 * MIN + 54 * MIN + (3 * HOUR - 2 * MIN) + 3 * HOUR)
  })

  test('figures that do not apply are null; a running one quiet under 10 minutes is not stuck', () => {
    const view = buildLanes(NOW, null, [source('d', 'done'), source('r', 'running', { updatedAt: NOW - 9 * MIN })], [span('d', NOW - HOUR, NOW - 5 * MIN)], 4)
    expect(view.quiet).toBeNull()
    expect(view.longestWait).toBeNull()
  })

  test('with an away stretch, the work time counts only what fell inside it', () => {
    const away = { from: NOW - 2 * HOUR, to: NOW - 30 * MIN }
    const view = buildLanes(NOW, away, [source('d', 'done', {}, NOW - 10 * MIN)], [span('d', NOW - 3 * HOUR, NOW - 90 * MIN), span('d', NOW - 40 * MIN, NOW - 10 * MIN)], 4)
    expect(view.workMs).toBe(30 * MIN + 10 * MIN)
  })
})

describe('rulerTicks', () => {
  test('two hours get a label every 30 minutes on the clock, small ticks halfway', () => {
    const ticks = rulerTicks(new Date(2026, 10, 11, 12, 0).getTime(), new Date(2026, 10, 11, 14, 0).getTime())
    expect(ticks.filter((t) => t.label).map((t) => t.label)).toEqual(['12:00', '12:30', '13:00', '13:30', '14:00'])
    expect(ticks).toHaveLength(9)
  })

  test('twelve hours get a label every 2 hours', () => {
    const ticks = rulerTicks(new Date(2026, 10, 11, 2, 0).getTime(), new Date(2026, 10, 11, 14, 0).getTime())
    expect(ticks.filter((t) => t.label).map((t) => t.label)).toEqual(['02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00'])
  })
})
