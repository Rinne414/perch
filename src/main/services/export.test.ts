import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDatabase } from '../db/connection'
import { applyAgentEvent } from '../db/agents'
import { completeItem, createItem } from '../db/items'
import { addManualEntry } from './calendar'
import { collectExport, toMarkdown, writeExport, type ExportData } from './export'
import { createRoutine } from './manage'
import { DEFAULT_SETTINGS } from './settings'

const at = (m: number, d: number, h: number, min = 0): number => new Date(2026, m - 1, d, h, min).getTime()
const NOW = at(9, 30, 9, 15)

let db: DatabaseSync
let dir: string
beforeEach(() => {
  db = openDatabase(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'perch-export-'))

  const report = createItem(db, { kind: 'task', title: '交報告', dueAt: at(10, 2, 17), dueHasTime: true }, at(9, 28, 10))
  completeItem(db, createItem(db, { kind: 'task', title: '找資料', parentId: report.id }, at(9, 28, 10)).id, at(9, 29, 11))
  createItem(db, { kind: 'task', title: '寫結論', parentId: report.id }, at(9, 28, 10))
  createItem(db, { kind: 'task', title: '買禮物', plannedFor: '2026-10-03' }, at(9, 29, 12))
  createItem(db, { kind: 'idea', title: '研究\nSignPath' }, at(9, 29, 13))
  completeItem(db, createItem(db, { kind: 'task', title: '回信' }, at(9, 29, 8)).id, at(9, 29, 10, 15))
  createRoutine(db, '澆花', 3, at(9, 1, 9))
  createRoutine(db, '上班', null, at(9, 1, 9), { slots: [{ weekday: 3, start: '16:00', end: '19:00' }], remindMinutes: 30 })
  addManualEntry(db, '2026-09-29', '下午3點 跟客戶開會', NOW, DEFAULT_SETTINGS)
  applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 's1', status: 'done', cwd: 'C:\\code\\app', title: 'fix login' }, at(9, 29, 21, 3))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('export', () => {
  test('the JSON holds every item, the whole timeline and the agent sessions', () => {
    const data = collectExport(db, '0.1.0', NOW)
    expect(data).toMatchObject({ app: 'Perch', format: 1, version: '0.1.0', exportedAt: new Date(NOW).toISOString() })
    expect(data.items.map((i) => i.title)).toEqual(expect.arrayContaining(['交報告', '找資料', '回信', '澆花']))
    expect(data.timeline.some((e) => e.type === 'manual')).toBe(true)
    expect(data.agentSessions).toHaveLength(1)
  })

  test('the Markdown lists open work with its steps, 隨手記, routines and every day', () => {
    const md = toMarkdown(collectExport(db, '0.1.0', NOW), DEFAULT_SETTINGS, NOW)
    expect(md).toContain('2026-09-30 09:15 · Perch 0.1.0')
    expect(md).toContain('## 還沒做完\n\n- [ ] 交報告 · 截止 10/2 17:00\n  - [x] 找資料\n  - [ ] 寫結論\n- [ ] 買禮物 · 排在 10/3\n')
    expect(md).toContain('## 隨手記\n\n- [ ] 研究 SignPath\n')
    expect(md).toContain('- 澆花 · 每 3 天 · 還沒做過')
    expect(md).toContain('- 上班 · 週三 16:00–19:00\n')
    expect(md).toContain('### 2026-09-29 週二\n\n')
    expect(md).toContain('- 10:15 完成：回信')
    expect(md).toContain('- 15:00 補記：跟客戶開會')
    expect(md).toContain('- 21:03 Agent：Claude Code · app（fix login）')
    expect(md).not.toContain('回信 ·')
  })

  test('newer days come first', () => {
    addManualEntry(db, '2026-09-28', '晚上8點 看書', NOW, DEFAULT_SETTINGS)
    const md = toMarkdown(collectExport(db, '0.1.0', NOW), DEFAULT_SETTINGS, NOW)
    expect(md.indexOf('### 2026-09-29')).toBeLessThan(md.indexOf('### 2026-09-28'))
  })

  test('an empty database still gives a readable file', () => {
    const empty = openDatabase(':memory:')
    const md = toMarkdown(collectExport(empty, '0.1.0', NOW), DEFAULT_SETTINGS, NOW)
    empty.close()
    expect(md).toContain('## 還沒做完\n\n（沒有）')
    expect(md.endsWith('## 紀錄\n')).toBe(true)
  })

  test('writes both files, and the JSON reads back the same', () => {
    const { json, markdown } = writeExport(db, join(dir, 'out'), '0.1.0', DEFAULT_SETTINGS, NOW)
    expect(json).toBe(join(dir, 'out', 'perch-export-2026-09-30-0915.json'))
    expect(markdown.endsWith('perch-export-2026-09-30-0915.md')).toBe(true)
    const back = JSON.parse(readFileSync(json, 'utf8')) as ExportData
    expect(back).toEqual(JSON.parse(JSON.stringify(collectExport(db, '0.1.0', NOW))))
    expect(readFileSync(markdown, 'utf8')).toContain('# Perch 匯出')
  })
})
