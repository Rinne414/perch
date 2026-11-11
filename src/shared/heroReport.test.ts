import { describe, expect, test } from 'vitest'
import { heroReport, NOTHING_RUNNING, type HeroInput, type HeroWaiting } from './heroReport'

const NOW = new Date(2026, 10, 11, 14, 0).getTime()
const MIN = 60_000
const DAY = 86_400_000

const input = (over: Partial<HeroInput> = {}): HeroInput => ({
  now: NOW,
  waiting: [],
  done: 0,
  running: 0,
  firstDone: null,
  todoCount: 0,
  pile: null,
  ...over,
})

const waits = (name: string, minutes: number, ask: string | null, failed = false): HeroWaiting => ({ name, since: NOW - minutes * MIN, ask, failed })

describe('line 1', () => {
  test('several waiting: the one waiting longest, how long, and what it asks', () => {
    const r = heroReport(input({ waiting: [waits('Perch 回來簡報', 6, '這個方向對不對？'), waits('做浮窗', 2, 'x')], done: 3, running: 3 }))
    expect(r.line1).toBe('先看「Perch 回來簡報」，它等最久，6 分了：這個方向對不對？')
    expect(r.tone).toBe('wait')
  })

  test('one waiting: an ask without an end mark gets one; no ask, no colon', () => {
    expect(heroReport(input({ waiting: [waits('做浮窗', 2, '要執行 pnpm install')] })).line1).toBe('「做浮窗」在等你，2 分了：要執行 pnpm install。')
    expect(heroReport(input({ waiting: [waits('做浮窗', 2, null)] })).line1).toBe('「做浮窗」在等你，2 分了。')
  })

  test('a failed one says so, in the fail tone', () => {
    const r = heroReport(input({ waiting: [waits('爬蟲改成增量', 30, 'npm ERR! code ENOENT', true), waits('B', 1, 'x')] }))
    expect(r.line1).toBe('「爬蟲改成增量」失敗了：npm ERR! code ENOENT。')
    expect(r.tone).toBe('fail')
  })

  test('a long ask is cut near 60 characters', () => {
    expect(heroReport(input({ waiting: [waits('A', 1, '請'.repeat(80))] })).line1).toBe(`「A」在等你，1 分了：${'請'.repeat(59)}…`)
  })

  test('nobody waits: the first finished report', () => {
    const r = heroReport(input({ done: 2, running: 1, firstDone: 'README 翻成英文' }))
    expect(r.line1).toBe('沒有 agent 在等你。2 個做完了，先看「README 翻成英文」的報告。')
    expect(r.tone).toBe('done')
  })

  test('only running', () => {
    expect(heroReport(input({ running: 2 })).line1).toBe('沒有 agent 在等你，2 個還在跑。')
  })

  test('nothing at all', () => {
    expect(heroReport(input())).toEqual({ line1: NOTHING_RUNNING, tone: 'none', line2: null })
  })
})

describe('line 2', () => {
  test('what the reports leave, then the pile with its oldest and its failures', () => {
    const r = heroReport(input({ done: 1, todoCount: 4, pile: { count: 4, oldestAt: NOW - 34 * DAY, failed: 1 } }))
    expect(r.line2).toBe('報告裡留給你 4 件事。另外有 4 個放著沒接，最久的放了 34 天，其中 1 個是失敗後沒處理。')
  })

  test('only the parts that apply', () => {
    expect(heroReport(input({ done: 1, todoCount: 2 })).line2).toBe('報告裡留給你 2 件事。')
    expect(heroReport(input({ pile: { count: 3, oldestAt: NOW - 3 * DAY, failed: 0 } })).line2).toBe('另外有 3 個放著沒接，最久的放了 3 天。')
    expect(heroReport(input({ pile: { count: 2, oldestAt: NOW - 3 * DAY, failed: 2 } })).line2).toBe('另外有 2 個放著沒接，最久的放了 3 天，都是失敗後沒處理。')
    expect(heroReport(input({ pile: { count: 1, oldestAt: NOW - 5 * 3_600_000, failed: 1 } })).line2).toBe('另外有 1 個放著沒接，放了 5 小時，是失敗後沒處理。')
  })
})
