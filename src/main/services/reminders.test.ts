import { describe, expect, test } from 'vitest'
import type { AgentSession, Item } from '@shared/types'
import { agentAlert, agentsToNotify, dueAlert, dueItemsToNotify } from './reminders'
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
  ...over,
})

const session = (over: Partial<AgentSession>): AgentSession => ({
  id: 'codex:1',
  agent: 'codex',
  sessionId: '1',
  cwd: 'L:\\code\\api-server',
  title: '加上分頁',
  status: 'done',
  detail: null,
  startedAt: 0,
  updatedAt: 0,
  attentionAt: at(29, 10),
  acknowledgedAt: null,
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

    expect(dueAlert(items)).toEqual({ title: '有 4 件事到期', body: 'a、b、c 等 4 件' })
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

  test('the alert names the agent, its state and the project', () => {
    expect(agentAlert(session({}))).toEqual({ title: 'Codex 完成 · api-server', body: '加上分頁' })
  })
})
