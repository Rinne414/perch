import { describe, expect, test } from 'vitest'
import { buildNow } from './now'
import type { AgentSession, Item } from './types'

const DAY = 86_400_000
const NOW = new Date(2026, 8, 29, 10, 0).getTime()
const SETTINGS = { dayStartHour: 4, staleDays: 14 }

let seq = 0
function item(over: Partial<Item>): Item {
  seq++
  return {
    id: `i${seq}`,
    kind: 'task',
    title: `item ${seq}`,
    notes: null,
    parentId: null,
    sortOrder: 0,
    priority: null,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
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
    project: null,
    ...over,
  }
}

function session(over: Partial<AgentSession>): AgentSession {
  return {
    id: 'claude-code:s1',
    agent: 'claude-code',
    sessionId: 's1',
    cwd: null,
    title: null,
    status: 'running',
    detail: null,
    startedAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    attentionAt: null,
    acknowledgedAt: null,
    endedAt: null,
    ...over,
  }
}

describe('buildNow: today', () => {
  test('includes overdue, due-today and planned-today work, most urgent first', () => {
    const planned = item({ title: 'planned', plannedFor: '2026-09-29' })
    const atTwo = item({ title: 'at two', dueAt: new Date(2026, 8, 29, 14).getTime(), dueHasTime: true })
    const late = item({ title: 'late', dueAt: NOW - 2 * DAY })
    const tomorrow = item({ title: 'tomorrow', dueAt: NOW + DAY })

    const view = buildNow([planned, atTwo, late, tomorrow], [], NOW, SETTINGS)

    expect(view.today.map((e) => [e.item.title, e.overdueDays])).toEqual([
      ['late', 2],
      ['at two', 0],
      ['planned', 0],
    ])
  })

  test('shows the first open step as the next step', () => {
    const parent = item({ title: '寫週報', plannedFor: '2026-09-29' })
    const doneStep = item({ parentId: parent.id, sortOrder: 0, doneAt: NOW - 1 })
    const second = item({ parentId: parent.id, sortOrder: 1, title: '列出做完的事' })
    const third = item({ parentId: parent.id, sortOrder: 2, title: '寄出' })

    const view = buildNow([parent, doneStep, third, second], [], NOW, SETTINGS)

    expect(view.today).toHaveLength(1)
    expect(view.today[0].nextStep?.title).toBe('列出做完的事')
  })
})

describe('buildNow: inbox and old items', () => {
  test('undated items count as inbox until they go untouched for staleDays', () => {
    const fresh = item({ kind: 'idea', updatedAt: NOW - 3 * DAY })
    const old = item({ kind: 'idea', updatedAt: NOW - 20 * DAY })
    const scheduled = item({ plannedFor: '2026-10-05' })

    const view = buildNow([fresh, old, scheduled], [], NOW, SETTINGS)

    expect([view.inboxCount, view.staleCount, view.today.length]).toEqual([1, 1, 0])
  })
})

describe('buildNow: routines', () => {
  test('lists routines past their interval, the most overdue relative to its interval first', () => {
    const gym = item({ kind: 'routine', title: '運動', intervalDays: 3, lastDoneAt: NOW - 5 * DAY })
    const desk = item({ kind: 'routine', title: '整理桌面', intervalDays: 7, lastDoneAt: NOW - 12 * DAY })
    const fine = item({ kind: 'routine', title: '澆花', intervalDays: 7, lastDoneAt: NOW - 2 * DAY })
    const never = item({ kind: 'routine', title: '備份', intervalDays: 1, createdAt: NOW - 2 * DAY })

    const view = buildNow([gym, desk, fine, never], [], NOW, SETTINGS)

    expect(view.routines.map((r) => [r.item.title, r.daysSince, r.overdueBy])).toEqual([
      ['備份', null, 1],
      ['整理桌面', 12, 5],
      ['運動', 5, 2],
    ])
  })
})

describe('buildNow: agents', () => {
  test('a finished session needs attention until acknowledged, and again after a new event', () => {
    const waiting = session({ id: 'a', status: 'needs_input', attentionAt: NOW - 1000 })
    const seen = session({ id: 'b', status: 'done', attentionAt: NOW - 5000, acknowledgedAt: NOW - 4000 })
    const newAfterAck = session({ id: 'c', status: 'failed', attentionAt: NOW - 100, acknowledgedAt: NOW - 4000 })
    const cancelled = session({ id: 'd', status: 'cancelled', attentionAt: null })

    const view = buildNow([], [waiting, seen, newAfterAck, cancelled], NOW, SETTINGS)

    expect(view.attention.map((s) => s.id)).toEqual(['c', 'a'])
  })

  test('running sessions that went silent for half a day are dropped', () => {
    const live = session({ id: 'live' })
    const ghost = session({ id: 'ghost', updatedAt: NOW - 13 * 3_600_000 })

    expect(buildNow([], [live, ghost], NOW, SETTINGS).running.map((s) => s.id)).toEqual(['live'])
  })
})
