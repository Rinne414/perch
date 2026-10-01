import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentStatus } from '@shared/types'
import { acknowledgeAgent, applyAgentEvent } from '../db/agents'
import { openDatabase } from '../db/connection'
import { completeItem, createItem, dropItem, getItem } from '../db/items'
import { captureText, dismissRecap, getNowPayload, postponeItem } from './now'
import { DEFAULT_SETTINGS } from './settings'

const at = (d: number, h: number, m = 0): number => new Date(2026, 8, d, h, m).getTime()
const NOW = at(29, 10)

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('captureText', () => {
  test('a dated line becomes a task due at that time', () => {
    const item = captureText(db, '明天下午3點 交報告', 'inbox', NOW, DEFAULT_SETTINGS)

    expect(item).toMatchObject({ kind: 'task', title: '交報告', dueAt: at(30, 15), dueHasTime: true })
  })

  test('an undated line typed in the float is planned for today', () => {
    expect(captureText(db, '買牛奶', 'today', NOW, DEFAULT_SETTINGS)).toMatchObject({
      kind: 'task',
      plannedFor: '2026-09-29',
    })
  })

  test('a fixed weekly time becomes a routine on those days, reminding 30 minutes before', () => {
    expect(captureText(db, '每週四 18:30-21:30 上班', 'today', NOW, DEFAULT_SETTINGS)).toMatchObject({
      kind: 'routine',
      title: '上班',
      intervalDays: null,
      schedule: { slots: [{ weekday: 4, start: '18:30', end: '21:30' }], remindMinutes: 30 },
    })
  })

  test('an undated line captured anywhere else waits in the inbox as an idea', () => {
    expect(captureText(db, '做一個會提醒 agent 的工具', 'inbox', NOW, DEFAULT_SETTINGS)).toMatchObject({
      kind: 'idea',
      plannedFor: null,
      dueAt: null,
    })
  })
})

describe('postponeItem', () => {
  test('a planned item moves to tomorrow without counting as procrastination', () => {
    const item = createItem(db, { kind: 'task', title: 'x', plannedFor: '2026-09-29' }, NOW)

    expect(postponeItem(db, item.id, NOW, DEFAULT_SETTINGS)).toMatchObject({
      plannedFor: '2026-09-30',
      postponeCount: 0,
    })
  })

  test('an overdue dated item moves to tomorrow at the same time and reminds again', () => {
    const item = createItem(db, { kind: 'task', title: 'x', dueAt: at(27, 14), dueHasTime: true }, NOW)

    const moved = postponeItem(db, item.id, NOW, DEFAULT_SETTINGS)

    expect(moved.dueAt).toBe(at(30, 14))
    expect(moved.notifiedAt).toBeNull()
  })

  test('a deadline after midnight but before the day starts moves a whole day too', () => {
    // 2 a.m. on the 30th still belongs to the 29th, the day being lived at NOW.
    const item = createItem(db, { kind: 'task', title: 'x', dueAt: at(30, 2), dueHasTime: true }, NOW)

    expect(postponeItem(db, item.id, NOW, DEFAULT_SETTINGS).dueAt).toBe(new Date(2026, 9, 1, 2).getTime())
  })
})

describe('getNowPayload', () => {
  test('shows yesterday’s recap until dismissed for the day', () => {
    const done = createItem(db, { kind: 'task', title: 'done yesterday' }, at(28, 9))
    completeItem(db, done.id, at(28, 20))

    expect(getNowPayload(db, NOW, DEFAULT_SETTINGS, true).recap).toMatchObject({ day: '2026-09-28', itemsDone: 1 })

    dismissRecap(db, NOW, DEFAULT_SETTINGS)
    expect(getNowPayload(db, NOW, DEFAULT_SETTINGS, true).recap).toBeNull()
    expect(getItem(db, done.id)?.doneAt).toBe(at(28, 20))
  })

  test('the float gets the start of the later list and the newest ideas, with the full counts', () => {
    for (let d = 1; d <= 7; d++) {
      createItem(db, { kind: 'task', title: `day ${d}`, plannedFor: `2026-10-0${d}` }, NOW)
    }
    ;['old idea', 'middle idea', 'new idea', 'newest idea'].forEach((title, i) => {
      createItem(db, { kind: 'idea', title }, NOW + i)
    })

    const payload = getNowPayload(db, NOW, DEFAULT_SETTINGS, true)

    expect(payload.upcoming.map((e) => e.item.title)).toEqual(['day 1', 'day 2', 'day 3', 'day 4', 'day 5'])
    expect(payload.upcomingCount).toBe(7)
    expect(payload.ideas.map((i) => i.title)).toEqual(['newest idea', 'new idea', 'middle idea'])
    expect(payload.view.inboxCount).toBe(4)
  })

  test('today’s done list leaves out what was let go', () => {
    const done = createItem(db, { kind: 'task', title: 'done', plannedFor: '2026-09-29' }, NOW)
    const dropped = createItem(db, { kind: 'task', title: 'dropped', plannedFor: '2026-09-29' }, NOW)
    completeItem(db, done.id, NOW + 1)
    dropItem(db, dropped.id, NOW + 2)

    expect(getNowPayload(db, NOW + 3, DEFAULT_SETTINGS, true).doneToday.map((i) => i.title)).toEqual(['done'])
  })

  test('recent agents are only the settled ones, newest first', () => {
    const ev = (sessionId: string, status: AgentStatus, t: number): void => {
      applyAgentEvent(db, { v: 1, agent: 'codex', sessionId, status, at: t }, t)
    }
    ev('running', 'running', NOW - 5)
    ev('waiting', 'needs_input', NOW - 4)
    ev('seen', 'done', NOW - 3)
    acknowledgeAgent(db, 'codex:seen', NOW - 2)
    ev('stopped', 'cancelled', NOW - 1)

    expect(getNowPayload(db, NOW, DEFAULT_SETTINGS, true).recentAgents.map((s) => s.sessionId)).toEqual([
      'stopped',
      'seen',
    ])
  })
})
