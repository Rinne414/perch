import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentEvent } from '@shared/agentEvent'
import { acknowledgeAgent, applyAgentEvent } from '../db/agents'
import { openDatabase } from '../db/connection'
import { createItem } from '../db/items'
import { markTodo } from '../db/todoMarks'
import { getBriefingPayload } from './briefing'
import { DEFAULT_SETTINGS } from './settings'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = new Date(2026, 10, 11, 12, 0).getTime()
const CUTOFF = NOW - 3 * HOUR

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

const report = (sessionId: string, over: Partial<AgentEvent>): void => {
  applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId, status: 'running', ...over }, over.at ?? NOW)
}

describe('getBriefingPayload', () => {
  test('sorts the database into the groups, with turns, the pile from long ago and the window replies', () => {
    report('wait', { at: NOW - 40 * MIN, title: '回來簡報', prompt: '畫一張指揮台' })
    report('wait', { at: NOW - 20 * MIN, status: 'done', reply: '畫好了。\n細節' })
    report('wait', { at: NOW - 5 * MIN, status: 'needs_input', detail: '這個方向對不對？' })
    report('done', { at: NOW - HOUR, title: '節點打包', prompt: 'make a nodes pack' })
    report('done', { at: NOW - 30 * MIN, status: 'done', reply: '發了 0.2.1\n\n兩版都過審' })
    report('run', { at: NOW - 2 * MIN, title: '膠水編程' })
    report('old', { at: NOW - 20 * DAY, status: 'done', detail: '跑完了' })
    report('older', { at: NOW - 40 * DAY, status: 'failed', detail: 'API 錯誤' })
    report('seen', { at: NOW - 10 * DAY, status: 'done' })
    acknowledgeAgent(db, 'claude-code:seen', NOW - 9 * DAY)
    createItem(db, { kind: 'idea', title: '縮圖只有文生圖有' }, NOW - DAY)

    const b = getBriefingPayload(db, NOW, DEFAULT_SETTINGS, CUTOFF, null)

    expect(b.waiting.map((w) => [w.session.sessionId, w.ask, w.latestPrompt, w.lastReply])).toEqual([
      ['wait', '這個方向對不對？', '畫一張指揮台', '畫好了。'],
    ])
    expect(b.done.map((d) => [d.session.sessionId, d.reply, d.promptCount, d.firstPrompt])).toEqual([
      ['done', '發了 0.2.1\n\n兩版都過審', 1, 'make a nodes pack'],
    ])
    expect(b.running.map((r) => r.session.sessionId)).toEqual(['run'])
    expect(b.unattended).toEqual({ count: 2, newestAt: NOW - 20 * DAY, oldestAt: NOW - 40 * DAY, failed: 1 })
    expect(b.left.map((e) => [e.session.sessionId, e.hasTurns])).toEqual([
      ['old', false],
      ['older', false],
    ])
    expect(b.timeline.map((t) => [t.label, t.line])).toEqual([
      ['節點打包', '發了 0.2.1'],
      ['回來簡報', '畫好了。'],
      ['回來簡報', '問你：這個方向對不對？'],
    ])
    expect(b.ideas.map((i) => i.item.title)).toEqual(['縮圖只有文生圖有'])
    expect(b.bays.flatMap((bay) => bay.rows.map((r) => r.state)).sort()).toEqual(['done', 'failed', 'running', 'unattended', 'waiting'])
    expect(b.lanes.lanes.map((l) => l.name)).toEqual(['回來簡報', '膠水編程', '節點打包'])
    expect(b.lanes.idle).toBe(2)
  })

  test('the report is the longest reply of the round, and its ticked points stay ticked', () => {
    report('rep', { at: NOW - HOUR, title: '修日曆', prompt: '修跨月' })
    report('rep', { at: NOW - 30 * MIN, status: 'done', reply: ['## 結論', '', '修好了。', '', '## 需要你做的事', '', '- 看一眼跨月', '- 重拍截圖'].join('\n') })
    report('rep', { at: NOW - 29 * MIN, status: 'done', reply: '好的' })

    const before = getBriefingPayload(db, NOW, DEFAULT_SETTINGS, CUTOFF, null)
    expect(before.done[0].reply?.startsWith('## 結論')).toBe(true)
    expect(before.todos.groups[0].rows.map((r) => r.text)).toEqual(['看一眼跨月', '重拍截圖'])

    markTodo(db, 'claude-code:rep', before.todos.groups[0].rows[0].key, NOW)
    const after = getBriefingPayload(db, NOW, DEFAULT_SETTINGS, CUTOFF, null)
    expect(after.todos.groups[0].rows.map((r) => r.text)).toEqual(['重拍截圖'])
  })

  test('the away stretch sets the window, and replies of closed sessions are still named', () => {
    report('gone', { at: NOW - 2 * HOUR, title: '一次性的', prompt: 'p' })
    report('gone', { at: NOW - 90 * MIN, status: 'done', reply: '跑完就關了' })
    report('gone', { at: NOW - 89 * MIN, status: 'cancelled', ended: true })

    const away = { from: NOW - 100 * MIN, to: NOW - 80 * MIN }
    const b = getBriefingPayload(db, NOW, DEFAULT_SETTINGS, CUTOFF, away)

    expect(b.window).toEqual(away)
    expect(b.timeline.map((t) => [t.label, t.line])).toEqual([['一次性的', '跑完就關了']])
    expect(b.done).toEqual([])
  })
})
