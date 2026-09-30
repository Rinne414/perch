import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { acknowledgeAgent, applyAgentEvent } from '../db/agents'
import { openDatabase } from '../db/connection'
import { listEvents } from '../db/events'
import { completeItem, createItem, dropItem, getItem, listOpenItems, reopenItem } from '../db/items'
import { buildRecap } from '@shared/recap'
import { agentSourceUsage, clearAgentData } from '../db/sources'
import {
  addStep,
  createBatchUndo,
  createRoutine,
  createTrash,
  getMainPayload,
  planItem,
  rescheduleOverdue,
  setDue,
  updateRoutine,
} from './manage'
import { DEFAULT_SETTINGS } from './settings'

const at = (d: number, h: number, m = 0): number => new Date(2026, 8, d, h, m).getTime()
const NOW = at(30, 10)

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('planItem', () => {
  test('planning an idea turns it into a task for that day', () => {
    const idea = createItem(db, { kind: 'idea', title: '研究 Hindsight' }, NOW)

    expect(planItem(db, idea.id, 'today', NOW, DEFAULT_SETTINGS)).toMatchObject({ kind: 'task', plannedFor: '2026-09-30' })
    expect(planItem(db, idea.id, 'tomorrow', NOW, DEFAULT_SETTINGS).plannedFor).toBe('2026-10-01')
  })

  test('"none" takes the plan away and puts the item back in the inbox', () => {
    const task = createItem(db, { kind: 'task', title: '寫週報', plannedFor: '2026-09-30' }, NOW)

    planItem(db, task.id, 'none', NOW, DEFAULT_SETTINGS)

    expect(getMainPayload(db, NOW, DEFAULT_SETTINGS).view.inbox.map((i) => i.id)).toEqual([task.id])
  })
})

describe('setDue', () => {
  test('reads the date from typed text and resets the reminder', () => {
    const task = createItem(db, { kind: 'idea', title: '交季報' }, NOW)

    const due = setDue(db, task.id, '10/2 下午5點', NOW, DEFAULT_SETTINGS)

    expect(due).toMatchObject({ kind: 'task', dueAt: new Date(2026, 9, 2, 17).getTime(), dueHasTime: true, notifiedAt: null })
  })

  test('null clears the deadline; text without a date is refused', () => {
    const task = createItem(db, { kind: 'task', title: 'x', dueAt: NOW, dueHasTime: true }, NOW)

    expect(() => setDue(db, task.id, '隨便', NOW, DEFAULT_SETTINGS)).toThrow('No date')
    expect(setDue(db, task.id, null, NOW, DEFAULT_SETTINGS)).toMatchObject({ dueAt: null, dueHasTime: false })
  })
})

describe('steps', () => {
  test('a finished step shows in the timeline under its parent but not in the day count', () => {
    const parent = createItem(db, { kind: 'task', title: '寫週報', plannedFor: '2026-09-30' }, NOW)
    const step = addStep(db, parent.id, '寄給主管', NOW)

    completeItem(db, step.id, NOW + 1)

    const done = listEvents(db, NOW, NOW + 2).filter((e) => e.type === 'item.done')
    expect(done).toEqual([expect.objectContaining({ title: '寄給主管', data: { stepOf: '寫週報' } })])
    expect(getMainPayload(db, NOW + 2, DEFAULT_SETTINGS).view.steps[parent.id].map((s) => s.doneAt)).toEqual([NOW + 1])
  })

  test('steps cannot hang under a step or a routine', () => {
    const parent = createItem(db, { kind: 'task', title: 'p' }, NOW)
    const step = addStep(db, parent.id, 's', NOW)
    const routine = createRoutine(db, '運動', 3, NOW)

    expect(() => addStep(db, step.id, 'x', NOW)).toThrow('Steps belong')
    expect(() => addStep(db, routine.id, 'x', NOW)).toThrow('Steps belong')
  })
})

describe('routines', () => {
  test('are created and edited with a whole number of days', () => {
    const routine = createRoutine(db, '運動', 3, NOW)

    expect(routine).toMatchObject({ kind: 'routine', intervalDays: 3, lastDoneAt: null })
    expect(updateRoutine(db, routine.id, '散步', 2, NOW)).toMatchObject({ title: '散步', intervalDays: 2 })
    expect(() => createRoutine(db, 'x', 0, NOW)).toThrow('Interval')
    expect(() => createRoutine(db, 'x', 1.5, NOW)).toThrow('Interval')
    expect(() => updateRoutine(db, createItem(db, { kind: 'task', title: 't' }, NOW).id, 't', 2, NOW)).toThrow(
      'Not a routine',
    )
  })
})

describe('dropping an item ("不做了")', () => {
  test('closes it without calling it done, and keeps it in history', () => {
    const task = createItem(db, { kind: 'task', title: '學 Rust', plannedFor: '2026-09-30' }, NOW)

    const dropped = dropItem(db, task.id, NOW + 1)

    expect(dropped).toMatchObject({ doneAt: NOW + 1, droppedAt: NOW + 1 })
    expect(listOpenItems(db)).toEqual([])
    expect(listEvents(db, NOW, NOW + 2).map((e) => e.type)).toEqual(['item.created', 'item.dropped'])
    expect(buildRecap('2026-09-30', listEvents(db, NOW, NOW + 2))).toBeNull()
    expect(getMainPayload(db, NOW + 2, DEFAULT_SETTINGS).view.doneToday).toEqual([
      expect.objectContaining({ id: task.id, droppedAt: NOW + 1 }),
    ])
  })

  test('picking it back up reopens it as if nothing happened', () => {
    const task = createItem(db, { kind: 'task', title: 'x' }, NOW)
    dropItem(db, task.id, NOW + 1)

    expect(reopenItem(db, task.id, NOW + 2)).toMatchObject({ doneAt: null, droppedAt: null })
  })

  test('a routine cannot be dropped', () => {
    const routine = createRoutine(db, '運動', 3, NOW)
    expect(() => dropItem(db, routine.id, NOW)).toThrow('routine')
  })
})

describe('rescheduleOverdue', () => {
  const overdue = (): string[] => [
    createItem(db, { kind: 'task', title: 'a', dueAt: at(27, 14), dueHasTime: true }, NOW).id,
    createItem(db, { kind: 'task', title: 'b', dueAt: at(28, 9), dueHasTime: true, plannedFor: '2026-09-28' }, NOW).id,
  ]

  test('"tomorrow" moves the deadlines and plans a day on, keeping their times', () => {
    const [a, b] = overdue()

    rescheduleOverdue(db, [a, b], 'tomorrow', NOW, DEFAULT_SETTINGS)

    expect(getItem(db, a)).toMatchObject({ dueAt: new Date(2026, 9, 1, 14).getTime(), notifiedAt: null })
    expect(getItem(db, b)).toMatchObject({ dueAt: new Date(2026, 9, 1, 9).getTime(), plannedFor: '2026-10-01' })
  })

  test('"none" takes the dates away and returns them to the inbox', () => {
    const ids = overdue()

    rescheduleOverdue(db, ids, 'none', NOW, DEFAULT_SETTINGS)

    expect(getMainPayload(db, NOW, DEFAULT_SETTINGS).view.inbox.map((i) => i.id).sort()).toEqual([...ids].sort())
  })

  test('"drop" lets them all go; the batch can be undone as a whole', () => {
    const ids = overdue()
    const before = ids.map((id) => getItem(db, id))
    const undo = createBatchUndo(() => NOW)

    const token = undo.save(db, ids)
    rescheduleOverdue(db, ids, 'drop', NOW, DEFAULT_SETTINGS)
    expect(listOpenItems(db)).toEqual([])

    expect(undo.restore(db, token, NOW + 1)).toBe(true)
    expect(ids.map((id) => getItem(db, id))).toEqual(
      before.map((i) => expect.objectContaining({ dueAt: i!.dueAt, plannedFor: i!.plannedFor, doneAt: null, droppedAt: null })),
    )
  })
})

describe('trash', () => {
  test('a deleted item comes back with its steps within the undo window', () => {
    let clock = NOW
    const trash = createTrash(() => clock)
    const parent = createItem(db, { kind: 'task', title: '搬家', plannedFor: '2026-09-30' }, NOW)
    addStep(db, parent.id, '找紙箱', NOW)
    const before = listOpenItems(db)

    trash.remove(db, parent.id)
    expect(listOpenItems(db)).toEqual([])

    clock += 30_000
    expect(trash.restore(db, parent.id)).toBe(true)
    expect(listOpenItems(db)).toEqual(before)
  })

  test('the undo window closes after a minute', () => {
    let clock = NOW
    const trash = createTrash(() => clock)
    const item = createItem(db, { kind: 'idea', title: 'x' }, NOW)

    trash.remove(db, item.id)
    clock += 61_000

    expect(trash.restore(db, item.id)).toBe(false)
    expect(getItem(db, item.id)).toBeNull()
  })
})

test('undoing a step whose task was deleted meanwhile does nothing', () => {
  const trash = createTrash(() => NOW)
  const parent = createItem(db, { kind: 'task', title: 'p' }, NOW)
  const step = addStep(db, parent.id, 's', NOW)

  trash.remove(db, step.id)
  trash.remove(db, parent.id)

  expect(trash.restore(db, step.id)).toBe(false)
  expect(trash.restore(db, parent.id)).toBe(true)
})

test('the main window lists sessions still working, apart from those waiting on you', () => {
  applyAgentEvent(db, { v: 1, agent: 'codex', sessionId: 'a', status: 'running', title: '加上分頁', at: NOW - 60_000 }, NOW)
  applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 'b', status: 'needs_input', at: NOW - 30_000 }, NOW)

  const payload = getMainPayload(db, NOW, DEFAULT_SETTINGS)

  expect(payload.running.map((s) => s.id)).toEqual(['codex:a'])
  expect(payload.attention.map((s) => s.id)).toEqual(['claude-code:b'])
})

test('sessions already seen stay listed under recent agents instead of disappearing', () => {
  applyAgentEvent(db, { v: 1, agent: 'codex', sessionId: 'a', status: 'done', at: NOW - 60_000 }, NOW)
  applyAgentEvent(db, { v: 1, agent: 'codex', sessionId: 'b', status: 'failed', at: NOW - 30_000 }, NOW)
  acknowledgeAgent(db, 'codex:a', NOW)

  const payload = getMainPayload(db, NOW, DEFAULT_SETTINGS)

  expect(payload.attention.map((s) => s.id)).toEqual(['codex:b'])
  expect(payload.recentAgents.map((s) => s.id)).toEqual(['codex:a'])
})

describe('agent sources', () => {
  test('counts and clears everything one agent wrote, leaving the rest', () => {
    applyAgentEvent(db, { v: 1, agent: 'codex', sessionId: 'a', status: 'done', at: NOW }, NOW)
    applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 'b', status: 'running', at: NOW }, NOW)
    createItem(db, { kind: 'idea', title: 'from codex', source: 'agent:codex' }, NOW)
    const mine = createItem(db, { kind: 'idea', title: 'mine' }, NOW)

    expect(agentSourceUsage(db)).toEqual([
      { agent: 'claude-code', sessions: 1, events: 0, items: 0 },
      { agent: 'codex', sessions: 1, events: 2, items: 1 },
    ])
    expect(clearAgentData(db, 'codex')).toBe(4)
    expect(agentSourceUsage(db).map((u) => u.agent)).toEqual(['claude-code'])
    expect(getItem(db, mine.id)).not.toBeNull()
  })
})
