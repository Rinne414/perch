import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { applyAgentEvent } from '../db/agents'
import { openDatabase } from '../db/connection'
import { getDayNote, listDayNotes, setDayNote } from '../db/dayNotes'
import { completeItem, createItem } from '../db/items'
import { addManualEntry, dayView } from './calendar'
import { collectExport, toMarkdown } from './export'
import { backfillObsidian, dayNoteMarkdown, writeObsidianDay } from './obsidian'
import { DEFAULT_SETTINGS } from './settings'

const at = (m: number, d: number, h: number, min = 0): number => new Date(2026, m - 1, d, h, min).getTime()
const NOW = at(9, 30, 12)
const H = DEFAULT_SETTINGS.dayStartHour

let db: DatabaseSync
let vault: string
beforeEach(() => {
  db = openDatabase(':memory:')
  vault = mkdtempSync(join(tmpdir(), 'perch-vault-'))
})
afterEach(() => {
  db.close()
  rmSync(vault, { recursive: true, force: true })
})

describe('day notes', () => {
  test('are kept per day, and an emptied note goes away', () => {
    setDayNote(db, '2026-09-30', '發了第一版', NOW)
    setDayNote(db, '2026-09-30', '發了第一版，下午上班', NOW + 1)
    expect(getDayNote(db, '2026-09-30')).toBe('發了第一版，下午上班')
    expect(dayView(db, '2026-09-30', NOW, DEFAULT_SETTINGS).note).toBe('發了第一版，下午上班')
    setDayNote(db, '2026-09-30', '   ', NOW + 2)
    expect(listDayNotes(db)).toEqual([])
  })

  test('go into both exports', () => {
    setDayNote(db, '2026-09-28', '第一行\n第二行', NOW)
    const data = collectExport(db, '0.2.0', NOW)
    expect(data.dayNotes).toEqual([{ day: '2026-09-28', text: '第一行\n第二行' }])
    expect(toMarkdown(data, DEFAULT_SETTINGS, NOW)).toContain('### 2026-09-28 週一\n\n> 第一行\n> 第二行\n')
  })
})

describe('Obsidian', () => {
  beforeEach(() => {
    setDayNote(db, '2026-09-29', '把更新做完了', NOW)
    completeItem(db, createItem(db, { kind: 'task', title: '回信' }, at(9, 29, 8)).id, at(9, 29, 10, 15))
    for (const [h, m] of [[11, 0], [11, 20], [11, 40]]) {
      applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 's', status: 'running', cwd: 'C:\\code\\perch', title: 'go', at: at(9, 29, h, m) }, NOW)
      applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 's', status: 'done', at: at(9, 29, h, m + 5) }, NOW)
    }
    addManualEntry(db, '2026-09-29', '下午3點 跟客戶開會', NOW, DEFAULT_SETTINGS)
  })

  test('a day becomes a note with the diary, what got done and a short timeline', () => {
    const md = dayNoteMarkdown(db, '2026-09-29', H)!
    expect(md.startsWith('---\ndate: 2026-09-29\nsource: Perch\n---\n\n# 2026-09-29 週二\n')).toBe(true)
    expect(md).toContain('## 筆記\n\n把更新做完了\n')
    expect(md).toContain('## 做完的事\n\n- 10:15 回信\n')
    expect(md).toContain('- 11:05 Agent：Claude Code · perch（3 次回覆，到 11:45）')
    expect(md).toContain('- 15:00 補記：跟客戶開會')
  })

  test('an empty day has no note', () => {
    expect(dayNoteMarkdown(db, '2026-09-27', H)).toBeNull()
  })

  test('only writes inside Perch/, and only when something changed', () => {
    expect(writeObsidianDay(db, vault, '2026-09-29', H)).toBe(true)
    const file = join(vault, 'Perch', '2026-09-29.md')
    const first = statSync(file).mtimeMs
    expect(writeObsidianDay(db, vault, '2026-09-29', H)).toBe(false)
    expect(statSync(file).mtimeMs).toBe(first)
    setDayNote(db, '2026-09-29', '改過了', NOW)
    expect(writeObsidianDay(db, vault, '2026-09-29', H)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('改過了')
    expect(readdirSync(vault)).toEqual(['Perch'])
  })

  test('the first write fills in the last 30 days that have anything', () => {
    setDayNote(db, '2026-08-01', '太久以前', NOW)
    expect(backfillObsidian(db, vault, NOW, H)).toBe(1)
    expect(readdirSync(join(vault, 'Perch'))).toEqual(['2026-09-29.md'])
  })
})
