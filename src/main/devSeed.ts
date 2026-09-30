import { app } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { addDays, dayKey } from '@shared/day'
import { acknowledgeAgent, applyAgentEvent } from './db/agents'
import { completeItem, createItem, listOpenItems } from './db/items'
import { transaction } from './db/transaction'

const MIN = 60_000
const DAY = 86_400_000

/**
 * Development aid: with TC_SEED=1 and an empty database, fill it with the same
 * sample data the design mockups used, so the UI can be judged with real rows.
 */
export function seedIfRequested(db: DatabaseSync, dayStartHour: number): void {
  if (process.env['TC_SEED'] !== '1' || app.isPackaged || listOpenItems(db).length > 0) return
  const now = Date.now()
  const today = dayKey(now, dayStartHour)
  const at = (h: number, m = 0): number => {
    const d = new Date(now)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime()
  }
  const cwd = (name: string): string => `C:\\code\\${name}`

  transaction(db, () => {
    createItem(db, { kind: 'task', title: '繳電話費', dueAt: now - DAY }, now - 3 * DAY)
    createItem(db, { kind: 'task', title: '寄回舊手機', dueAt: now - 3 * DAY }, now - 6 * DAY)
    const report = createItem(db, { kind: 'task', title: '寫週報', plannedFor: today }, now - 3 * DAY)
    db.prepare('UPDATE items SET postpone_count = 3 WHERE id = ?').run(report.id)
    createItem(db, { kind: 'task', title: '列出這週做完的 3 件事', parentId: report.id }, now)
    createItem(db, { kind: 'task', title: '寄給主管', parentId: report.id }, now)
    createItem(db, { kind: 'task', title: '回 Alex 的信', dueAt: at(23, 30), dueHasTime: true }, now - DAY)
    const exercise = createItem(db, { kind: 'routine', title: '運動', intervalDays: 3 }, now - 30 * DAY)
    for (const daysAgo of [17, 12, 9, 5]) completeItem(db, exercise.id, now - daysAgo * DAY)
    createItem(db, { kind: 'routine', title: '換牙刷', lastDoneAt: now - 80 * DAY }, now - 200 * DAY)
    createItem(db, { kind: 'routine', title: '整理桌面', intervalDays: 7, lastDoneAt: now - 12 * DAY }, now - 30 * DAY)
    createItem(db, { kind: 'routine', title: '澆花', intervalDays: 7, lastDoneAt: now - 2 * DAY }, now - 30 * DAY)
    createItem(db, { kind: 'idea', title: '浮窗可以顯示 agent 花了多少時間' }, now - DAY)
    createItem(db, { kind: 'idea', title: '週末研究 Hindsight 的資料庫設計' }, now - 2 * DAY)
    createItem(db, { kind: 'idea', title: '買新的滑鼠墊', source: 'agent:codex' }, now - 5 * DAY)
    createItem(db, { kind: 'idea', title: '學 Rust 的所有權' }, now - 32 * DAY)
    createItem(db, { kind: 'idea', title: '重看 Sunsama 的每日規劃流程' }, now - 21 * DAY)
    createItem(db, { kind: 'task', title: '預約牙醫', plannedFor: addDays(today, 1) }, now - DAY)
    createItem(db, { kind: 'task', title: '交季報', dueAt: at(17) + 2 * DAY, dueHasTime: true }, now - DAY)
    createItem(db, { kind: 'task', title: '整理 Hindsight 筆記', plannedFor: addDays(today, 5) }, now - DAY)
    createItem(db, { kind: 'routine', title: '剪頭髮', intervalDays: 45 }, now - 7 * DAY)
    const work = {
      slots: [
        { weekday: 3, start: '16:00', end: '19:00' },
        { weekday: 4, start: '18:30', end: '21:30' },
      ],
      remindMinutes: 30,
    }
    createItem(db, { kind: 'routine', title: '上班', schedule: work }, now - 30 * DAY)
    const yesterdayWork = createItem(db, { kind: 'task', title: '修好登入頁' }, now - 2 * DAY)
    completeItem(db, yesterdayWork.id, now - DAY)
    const doneToday = createItem(db, { kind: 'task', title: '回覆房東', plannedFor: today }, now - DAY)
    completeItem(db, doneToday.id, now - 10 * MIN)

    applyAgentEvent(
      db,
      { v: 1, agent: 'codex', sessionId: 'y1', status: 'done', cwd: cwd('blog'), title: '修 RSS', detail: 'RSS 已改用絕對網址', at: now - DAY },
      now,
    )
    applyAgentEvent(
      db,
      { v: 1, agent: 'claude-code', sessionId: 'y2', status: 'failed', cwd: cwd('blog'), title: '升級 Astro', detail: 'API 錯誤：overloaded', at: now - DAY - 3 * 3_600_000 },
      now,
    )
    acknowledgeAgent(db, 'claude-code:y2', now - DAY)
    applyAgentEvent(
      db,
      { v: 1, agent: 'claude-code', sessionId: 'c1', status: 'running', cwd: cwd('perch'), title: '做浮窗', at: now - 20 * MIN },
      now,
    )
    applyAgentEvent(
      db,
      { v: 1, agent: 'claude-code', sessionId: 'c1', status: 'needs_input', detail: '要執行 pnpm install', at: now - 2 * MIN },
      now,
    )
    applyAgentEvent(
      db,
      { v: 1, agent: 'codex', sessionId: 'x1', status: 'done', cwd: cwd('api-server'), title: '加上分頁', at: now - 15 * MIN },
      now,
    )
    applyAgentEvent(db, { v: 1, agent: 'gemini-cli', sessionId: 'g1', status: 'running', cwd: cwd('docs'), at: now - 5 * MIN }, now)
    applyAgentEvent(db, { v: 1, agent: 'grok-build', sessionId: 'k1', status: 'running', cwd: cwd('game'), at: now - MIN }, now)
  })
}
