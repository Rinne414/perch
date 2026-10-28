import { describe, expect, test } from 'vitest'
import type { AgentSession, Item } from '@shared/types'
import { agentAlert, agentsToNotify, dueAlert, dueItemsToNotify, monthlyAlert, monthlyToNotify } from './reminders'
import { DEFAULT_SETTINGS } from './settings'

const at = (d: number, h: number, m = 0): number => new Date(2026, 8, d, h, m).getTime()

const item = (over: Partial<Item>): Item => ({
  id: 'x',
  kind: 'task',
  title: 't',
  notes: null,
  parentId: null,
  sortOrder: 0,
  priority: null,
  createdAt: 0,
  updatedAt: 0,
  dueAt: null,
  dueHasTime: false,
  plannedFor: null,
  doneAt: null,
  droppedAt: null,
  postponeCount: 0,
  intervalDays: null,
  lastDoneAt: null,
  notifiedAt: null,
  source: 'user',
  schedule: null,
  monthly: null,
  project: null,
  ...over,
})

const session = (over: Partial<AgentSession>): AgentSession => ({
  id: 'codex:1',
  agent: 'codex',
  sessionId: '1',
  cwd: 'L:\\code\\api-server',
  name: null,
  title: '加上分頁',
  status: 'done',
  detail: null,
  startedAt: 0,
  updatedAt: 0,
  attentionAt: at(29, 10),
  acknowledgedAt: null,
  endedAt: null,
  reopenedAt: null,
  ...over,
})

describe('dueItemsToNotify', () => {
  test('timed items fire at their time; date-only items at the morning hour', () => {
    const timed = item({ id: 'timed', dueAt: at(29, 14), dueHasTime: true })
    const dateOnly = item({ id: 'date', dueAt: at(29, 12) })
    const sent = item({ id: 'sent', dueAt: at(29, 8), dueHasTime: true, notifiedAt: at(29, 8) })

    expect(dueItemsToNotify([timed, dateOnly, sent], at(29, 8, 59), DEFAULT_SETTINGS)).toEqual([])
    expect(dueItemsToNotify([timed, dateOnly, sent], at(29, 9), DEFAULT_SETTINGS).map((i) => i.id)).toEqual(['date'])
    expect(dueItemsToNotify([timed, dateOnly], at(29, 14), DEFAULT_SETTINGS)).toHaveLength(2)
  })
})

describe('dueAlert', () => {
  test('folds many due items into one notification', () => {
    const items = ['a', 'b', 'c', 'd'].map((title) => item({ title }))

    expect(dueAlert(items)).toEqual({ title: '有 4 件事到了截止時間', body: 'a、b、c 等 4 件' })
  })
})

describe('agentsToNotify', () => {
  test('waits out the grace period, then announces each attention episode once', () => {
    const s = session({})

    expect(agentsToNotify([s], new Map(), at(29, 10) + 30_000)).toEqual([])
    expect(agentsToNotify([s], new Map(), at(29, 10) + 60_000)).toEqual([s])
    expect(agentsToNotify([s], new Map([[s.id, s.attentionAt!]]), at(29, 10) + 90_000)).toEqual([])
  })

  test('skips sessions already acknowledged', () => {
    const s = session({ acknowledgedAt: at(29, 10) + 1 })

    expect(agentsToNotify([s], new Map(), at(29, 11))).toEqual([])
  })

  test('skips sessions already closed, and sessions from before the last restart', () => {
    const closed = session({ endedAt: at(29, 10) + 5_000 })
    const old = session({})

    expect(agentsToNotify([closed], new Map(), at(29, 10) + 60_000)).toEqual([])
    expect(agentsToNotify([old], new Map(), at(29, 10) + 60_000, at(29, 10) + 30_000)).toEqual([])
  })

  test('the alert names the agent, its state and the project', () => {
    expect(agentAlert(session({}))).toEqual({ title: 'Codex 完成 · api-server', body: '加上分頁' })
  })
})

describe('monthlyToNotify', () => {
  // Rent on the 5th; it existed since August and September was paid.
  const rent = item({ kind: 'routine', title: '繳房租', monthly: { days: [5], leadDays: 0 }, createdAt: at(1, 9) - 30 * 86_400_000, lastDoneAt: at(5, 12) })
  const oct = (d: number, h: number): number => new Date(2026, 9, d, h).getTime()

  test('announces a date on the morning it opens, once', () => {
    expect(monthlyToNotify([rent], oct(5, 8), DEFAULT_SETTINGS)).toEqual([])
    expect(monthlyToNotify([rent], oct(5, 9), DEFAULT_SETTINGS)).toEqual([rent])
    expect(monthlyToNotify([{ ...rent, notifiedAt: oct(5, 9) }], oct(6, 9), DEFAULT_SETTINGS)).toEqual([])
  })

  test('a lead moves the morning earlier; the next month announces again', () => {
    const early = { ...rent, monthly: { days: [5], leadDays: 3 } }
    expect(monthlyToNotify([early], oct(2, 9), DEFAULT_SETTINGS)).toEqual([early])
    const announced = { ...rent, notifiedAt: oct(5, 9) }
    expect(monthlyToNotify([announced], new Date(2026, 10, 5, 9).getTime(), DEFAULT_SETTINGS)).toEqual([announced])
  })

  test('nothing once done, and nothing for a date already open when it was made', () => {
    expect(monthlyToNotify([{ ...rent, lastDoneAt: oct(5, 10) }], oct(5, 11), DEFAULT_SETTINGS)).toEqual([])
    expect(monthlyToNotify([{ ...rent, lastDoneAt: null, createdAt: oct(5, 14) }], oct(5, 15), DEFAULT_SETTINGS)).toEqual([])
  })

  test('the alert says the date', () => {
    expect(monthlyAlert([rent], oct(7, 9), DEFAULT_SETTINGS)).toEqual({ title: '該做了：繳房租', body: '10/5 · 晚了 2 天' })
    expect(monthlyAlert([rent, { ...rent, title: '繳卡費' }], oct(7, 9), DEFAULT_SETTINGS)?.title).toBe('有 2 件每月例行該做了')
  })
})
