import { describe, expect, test } from 'vitest'
import {
  briefingWindow,
  buildBriefing,
  durationLabel,
  durationParts,
  firstLineOf,
  quoteOf,
  stampLabel,
  unattendedSentence,
  type BriefingInput,
} from './briefing'
import type { AgentSession, AgentTurn, Item, SessionBrief } from './types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = new Date(2026, 10, 11, 12, 0).getTime()
/** The last restart: this morning at 08:00. */
const CUTOFF = NOW - 4 * HOUR

function session(id: string, over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: `claude-code:${id}`,
    agent: 'claude-code',
    sessionId: id,
    cwd: `C:\\code\\${id}`,
    name: null,
    title: null,
    status: 'running',
    detail: null,
    startedAt: NOW - HOUR,
    updatedAt: NOW - 10 * MIN,
    attentionAt: null,
    acknowledgedAt: null,
    endedAt: null,
    reopenedAt: null,
    ...over,
  }
}

/** A session that stopped at `at` and waits on the person. */
const waitingSession = (id: string, status: 'needs_input' | 'done' | 'failed', at: number, over: Partial<AgentSession> = {}): AgentSession =>
  session(id, { status, updatedAt: at, attentionAt: at, ...over })

function brief(s: AgentSession, over: Partial<SessionBrief> = {}): [string, SessionBrief] {
  return [
    s.id,
    {
      agentSessionId: s.id,
      firstPrompt: null,
      latestPrompt: null,
      latestReply: null,
      latestReplyAt: null,
      reportReply: null,
      reportReplyAt: null,
      promptCount: 0,
      turnCount: 0,
      ...over,
    },
  ]
}

let turnSeq = 0
const turn = (s: AgentSession, endedAt: number, reply: string): AgentTurn => ({
  id: ++turnSeq,
  agentSessionId: s.id,
  startedAt: endedAt - MIN,
  prompt: 'p',
  endedAt,
  reply,
  replyLen: reply.trim().length,
})

function idea(id: string, createdAt: number, over: Partial<Item> = {}): Item {
  return {
    id,
    kind: 'idea',
    title: id,
    notes: null,
    parentId: null,
    sortOrder: 0,
    priority: null,
    createdAt,
    updatedAt: createdAt,
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
  }
}

const input = (over: Partial<BriefingInput>): BriefingInput => ({
  now: NOW,
  dayStartHour: 4,
  cutoff: CUTOFF,
  sessions: [],
  briefs: new Map(),
  turns: [],
  others: [],
  items: [],
  away: null,
  spans: [],
  todoMarks: new Map(),
  ...over,
})

describe('等你決定', () => {
  test('holds sessions that ask or failed since the restart, longest waiting first, with what they ask', () => {
    const asks = waitingSession('ask', 'needs_input', NOW - 3 * MIN, { detail: '要執行 pnpm install' })
    const failed = waitingSession('fail', 'failed', NOW - 20 * MIN, { detail: 'API 錯誤：overloaded' })
    const done = waitingSession('done', 'done', NOW - 5 * MIN)

    const b = buildBriefing(input({ sessions: [failed, done, asks] }))

    expect(b.waiting.map((w) => [w.session.id, w.ask, w.waitingSince])).toEqual([
      [failed.id, 'API 錯誤：overloaded', NOW - 20 * MIN],
      [asks.id, '要執行 pnpm install', NOW - 3 * MIN],
    ])
  })

  test('without its own words it asks with the first line of its latest reply, shown once', () => {
    const s = waitingSession('a', 'needs_input', NOW - MIN)
    const b = buildBriefing(
      input({
        sessions: [s],
        briefs: new Map([brief(s, { latestReply: '**要不要我直接發版？**\n\n細節在下面', latestPrompt: '先跑測試\n再說' })]),
      }),
    )

    expect(b.waiting[0]).toMatchObject({ ask: '要不要我直接發版？', lastReply: null, latestPrompt: '先跑測試 再說' })
  })

  test('the latest reply is kept apart from the ask, and marked as done while away only when it came then', () => {
    const s = waitingSession('a', 'needs_input', NOW - MIN, { detail: 'Claude needs your permission to use Bash' })
    const briefs = new Map([brief(s, { latestReply: '改好三項設定。\n細節', latestReplyAt: NOW - 30 * MIN })])

    const away = buildBriefing(input({ sessions: [s], briefs, away: { from: NOW - HOUR, to: NOW - 5 * MIN } }))
    const here = buildBriefing(input({ sessions: [s], briefs, away: { from: NOW - 3 * HOUR, to: NOW - 2 * HOUR } }))

    expect(away.waiting[0]).toMatchObject({ lastReply: '改好三項設定。', repliedWhileAway: true })
    expect(here.waiting[0]).toMatchObject({ lastReply: '改好三項設定。', repliedWhileAway: false })
  })

  test('a session recorded before turns falls back to its stored title and never shows empty text', () => {
    const s = waitingSession('old', 'needs_input', NOW - MIN, { title: '修好登入頁' })

    const b = buildBriefing(input({ sessions: [s] }))

    expect(b.waiting[0]).toMatchObject({ ask: null, latestPrompt: '修好登入頁', lastReply: null, repliedWhileAway: false })
  })

  test('a stored title that only stands in for a background notice is not quoted as the person’s words', () => {
    const notice = waitingSession('n', 'needs_input', NOW - MIN, { title: '（背景工作通知）' })
    const pasted = session('p', { title: '（貼上的內容）' })

    const b = buildBriefing(input({ sessions: [notice, pasted] }))

    expect(b.waiting[0].latestPrompt).toBeNull()
    expect(b.running[0].latestPrompt).toBeNull()
  })

  test('seen sessions and sessions from before the restart are not waiting', () => {
    const seen = waitingSession('seen', 'needs_input', NOW - HOUR, { acknowledgedAt: NOW - 30 * MIN })
    const before = waitingSession('before', 'needs_input', CUTOFF - MIN)

    expect(buildBriefing(input({ sessions: [seen, before] })).waiting).toEqual([])
  })
})

describe('做完了', () => {
  test('lists finished sessions newest first with the whole report and how much was typed', () => {
    const older = waitingSession('older', 'done', NOW - 2 * HOUR)
    const newer = waitingSession('newer', 'done', NOW - 10 * MIN, { startedAt: NOW - 3 * HOUR })
    const reply = 'MiniMax 已經能出圖。\n\n- 4 MP 一張 11 到 78 秒\n- 發了 0.2.1'
    const b = buildBriefing(
      input({
        sessions: [older, newer],
        briefs: new Map([brief(newer, { firstPrompt: 'A new model has come,\nhelp me deploy', latestReply: 'ok', reportReply: reply, promptCount: 21, turnCount: 24 })]),
      }),
    )

    expect(b.done.map((d) => d.session.id)).toEqual([newer.id, older.id])
    expect(b.done[0]).toMatchObject({
      finishedAt: NOW - 10 * MIN,
      promptCount: 21,
      firstPrompt: 'A new model has come, help me deploy',
      reply,
      hasTurns: true,
    })
  })

  test('a session without turns shows the line it left when it stopped, and no count or first prompt', () => {
    const s = waitingSession('old', 'done', NOW - 10 * MIN, { detail: 'RSS 已改用絕對網址' })
    const marked = waitingSession('marked', 'done', NOW - 20 * MIN, { detail: '## 三項設定改好了' })

    const b = buildBriefing(input({ sessions: [s, marked] }))

    expect(b.done[0]).toMatchObject({ promptCount: 0, firstPrompt: null, reply: 'RSS 已改用絕對網址', hasTurns: false })
    expect(b.done[1].reply).toBe('三項設定改好了')
  })

  test('a session with neither a reply nor a line has no reply at all, never an empty one', () => {
    const s = waitingSession('bare', 'done', NOW - 10 * MIN)
    const b = buildBriefing(input({ sessions: [s], briefs: new Map([brief(s, { latestReply: '  \n ', reportReply: '  \n ' })]) }))

    expect(b.done[0].reply).toBeNull()
  })

  test('one-shot runs and closed sessions are left out', () => {
    const oneShot = waitingSession('p', 'done', NOW - 10 * MIN, { startedAt: NOW - 11 * MIN, endedAt: NOW - 10 * MIN + 5_000 })
    const closed = waitingSession('closed', 'done', NOW - HOUR, { endedAt: NOW - 30 * MIN })

    const b = buildBriefing(input({ sessions: [oneShot, closed] }))

    expect(b.done).toEqual([])
    expect(b.bays).toEqual([])
  })
})

describe('還在跑', () => {
  test('lists running sessions since the restart, most recently active first, with the latest prompt', () => {
    const a = session('a', { updatedAt: NOW - 20 * MIN, title: '做浮窗' })
    const b = session('b', { updatedAt: NOW - MIN })
    const stale = session('stale', { updatedAt: CUTOFF - MIN })

    const out = buildBriefing(
      input({ sessions: [a, b, stale], briefs: new Map([brief(b, { latestPrompt: 'ok add them' })]) }),
    )

    expect(out.running.map((r) => [r.session.id, r.latestPrompt])).toEqual([
      [b.id, 'ok add them'],
      [a.id, '做浮窗'],
    ])
  })
})

describe('放著沒接', () => {
  test('counts sessions left waiting from before the restart, with the newest and oldest age and the failed ones', () => {
    const pile = [
      waitingSession('p1', 'done', NOW - 5 * DAY),
      waitingSession('p2', 'failed', NOW - 31 * DAY),
      waitingSession('p3', 'needs_input', CUTOFF - MIN),
    ]
    const notPile = [
      waitingSession('seen', 'done', NOW - 3 * DAY, { acknowledgedAt: NOW - 2 * DAY }),
      waitingSession('closed', 'done', NOW - 3 * DAY, { endedAt: NOW - 2 * DAY }),
      session('ran', { updatedAt: NOW - 2 * DAY }),
      waitingSession('cancelled', 'done', NOW - 2 * DAY, { status: 'cancelled' }),
      waitingSession('recent', 'done', CUTOFF + MIN),
    ]

    const b = buildBriefing(input({ sessions: [...pile, ...notPile] }))

    expect(b.unattended).toEqual({ count: 3, newestAt: CUTOFF - MIN, oldestAt: NOW - 31 * DAY, failed: 1 })
  })

  test('lists the whole pile, most recently left first, with the latest prompt and whether a record exists', () => {
    const recent = waitingSession('p1', 'done', NOW - 5 * DAY, { title: '舊標題' })
    const old = waitingSession('p2', 'failed', NOW - 40 * DAY)
    const b = buildBriefing(
      input({
        sessions: [old, recent],
        briefs: new Map([brief(recent, { latestPrompt: '把 README\n翻成英文', turnCount: 3 })]),
      }),
    )

    expect(b.left.map((e) => [e.session.id, e.latestPrompt, e.hasTurns])).toEqual([
      [recent.id, '把 README 翻成英文', true],
      [old.id, null, false],
    ])
  })

  test('is absent when nothing was left behind', () => {
    expect(buildBriefing(input({ sessions: [waitingSession('a', 'done', NOW - MIN)] })).unattended).toBeNull()
  })

  test('a session seen once and waiting again since is back in the pile when the restart cut it off', () => {
    const s = waitingSession('again', 'done', CUTOFF - HOUR, { acknowledgedAt: CUTOFF - 2 * HOUR })

    expect(buildBriefing(input({ sessions: [s] })).unattended?.count).toBe(1)
  })
})

describe('這段時間的經過', () => {
  const s = waitingSession('a', 'done', NOW - MIN, { name: 'Perch 回來簡報' })

  test('lists every reply inside the away stretch, both ends included, oldest first, by its first line', () => {
    const away = { from: NOW - 2 * HOUR, to: NOW - 10 * MIN }
    const turns = [
      turn(s, NOW - 10 * MIN, '做完了，交出 4 頁總結'),
      turn(s, NOW - 2 * HOUR - 1, 'just before'),
      turn(s, NOW - 2 * HOUR, '0.2.1 推上 GitHub\n送審'),
      turn(s, NOW - 10 * MIN + 1, 'just after'),
    ]

    const b = buildBriefing(input({ sessions: [s], turns, away }))

    expect(b.window).toEqual(away)
    expect(b.timeline).toEqual([
      { at: NOW - 2 * HOUR, sessionId: s.id, label: 'Perch 回來簡報', line: '0.2.1 推上 GitHub', state: 'done', ask: false },
      { at: NOW - 10 * MIN, sessionId: s.id, label: 'Perch 回來簡報', line: '做完了，交出 4 頁總結', state: 'done', ask: false },
    ])
  })

  test('without an away stretch it covers the last 12 hours', () => {
    const turns = [turn(s, NOW - 12 * HOUR, 'edge'), turn(s, NOW - 12 * HOUR - 1, 'too old'), turn(s, NOW, 'now')]

    const b = buildBriefing(input({ sessions: [s], turns }))

    expect(b.window).toEqual({ from: NOW - 12 * HOUR, to: NOW })
    expect(b.timeline.map((t) => t.line)).toEqual(['edge', 'now'])
  })

  test('names replies of sessions outside the groups, and skips empty replies and unknown sessions', () => {
    const closed = session('closed', { name: '舊的', endedAt: NOW - HOUR, status: 'cancelled' })
    const ghost = session('ghost')
    const turns = [turn(closed, NOW - 2 * HOUR, 'from a closed one'), turn(s, NOW - HOUR, ' \n '), turn(ghost, NOW - HOUR, 'lost')]

    const b = buildBriefing(input({ sessions: [s], others: [closed], turns }))

    expect(b.timeline.map((t) => [t.label, t.line])).toEqual([['舊的', 'from a closed one']])
  })
})

describe('提過、還沒做的', () => {
  test('the newest five open ideas with their project, and how many there are', () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => idea(`i${i}`, NOW - i * HOUR)),
      idea('task', NOW, { kind: 'task' }),
      idea('step', NOW, { parentId: 'i0' }),
      idea('dropped', NOW, { droppedAt: NOW }),
      idea('done', NOW, { doneAt: NOW }),
      idea('proj', NOW - 30 * MIN, { project: 'C:\\code\\sd-image-sorter' }),
    ]

    const b = buildBriefing(input({ items }))

    expect(b.ideaCount).toBe(7)
    expect(b.ideas.map((e) => [e.item.id, e.project])).toEqual([
      ['i0', null],
      ['proj', 'sd-image-sorter'],
      ['i1', null],
      ['i2', null],
      ['i3', null],
    ])
  })
})

describe('the map, the lanes, the to-dos and the spoken report', () => {
  const ask = waitingSession('ask', 'needs_input', NOW - MIN, { name: '問一下', detail: '要不要發版？' })
  const failed = waitingSession('fail', 'failed', NOW - 2 * MIN)
  const run = session('run', { updatedAt: NOW - 3 * MIN })
  const done = waitingSession('done', 'done', NOW - 4 * MIN, { name: '修日曆' })
  const leftFailed = waitingSession('leftfail', 'failed', NOW - 9 * DAY, { cwd: done.cwd })
  const seen = waitingSession('seen', 'done', NOW - MIN, { acknowledgedAt: NOW })
  const report = '## 結論\n\n修好了。\n\n## 需要你做的事\n\n- 看一眼跨月那一列\n- 重拍截圖'

  test('every grouped session sits in a bay; a failed one from the pile makes its bay 失敗', () => {
    const b = buildBriefing(input({ sessions: [ask, failed, run, done, leftFailed, seen] }))

    expect(b.bays.flatMap((bay) => bay.rows.map((r) => r.id)).sort()).toEqual([ask.id, failed.id, run.id, done.id, leftFailed.id].sort())
    expect(b.bays.find((bay) => bay.name === 'done')?.state).toBe('failed')
  })

  test('lanes come from the spans; idle sessions of the pile are only counted', () => {
    const spans = [{ agentSessionId: done.id, startedAt: NOW - HOUR, endedAt: NOW - 4 * MIN }]
    const b = buildBriefing(input({ sessions: [ask, run, done, leftFailed], spans }))

    expect(b.lanes.lanes.map((l) => l.id)).toEqual([ask.id, run.id, done.id])
    expect(b.lanes.idle).toBe(1)
  })

  test('the reports leave their points, ticked ones gone; the spoken report counts them', () => {
    const briefs = new Map([brief(done, { reportReply: report, reportReplyAt: NOW - 4 * MIN, turnCount: 2 })])
    const b = buildBriefing(input({ sessions: [ask, done], briefs }))

    expect(b.done[0].digest.todos).toEqual(['看一眼跨月那一列', '重拍截圖'])
    expect(b.todos.groups.map((g) => [g.name, g.rows.map((r) => r.text)])).toEqual([['修日曆', ['看一眼跨月那一列', '重拍截圖']]])
    expect(b.hero.line1).toBe('「問一下」在等你，1 分了：要不要發版？')
    expect(b.hero.line2).toBe('報告裡留給你 2 件事。')

    const key = b.todos.groups[0].rows[0].key
    const after = buildBriefing(input({ sessions: [ask, done], briefs, todoMarks: new Map([[done.id, new Set([key])]]) }))
    expect(after.todos.total).toBe(1)
  })

  test('經過 adds what each waiting session asks, at the time it stopped', () => {
    const b = buildBriefing(input({ sessions: [ask, failed], turns: [turn(ask, NOW - 30 * MIN, '先做了一半')] }))

    expect(b.timeline.map((t) => [t.line, t.state, t.ask])).toEqual([
      ['先做了一半', 'waiting', false],
      ['問你：要不要發版？', 'waiting', true],
    ])
  })
})

describe('text helpers', () => {
  test('firstLineOf skips blank lines, Markdown markers, rules and section headings', () => {
    expect(firstLineOf('\n\n---\n## 結論\nMiniMax 已經能出圖。\nmore')).toBe('MiniMax 已經能出圖。')
    expect(firstLineOf('# 只有標題\n## 第二個')).toBe('只有標題')
    expect(firstLineOf('**做完了** 0.2.1 已發')).toBe('做完了 0.2.1 已發')
    expect(firstLineOf('- 第一點\n- 第二點')).toBe('第一點')
    expect(firstLineOf('> quoted')).toBe('quoted')
    expect(firstLineOf('## 三項設定改好了')).toBe('三項設定改好了')
    expect(firstLineOf('> ## 引用裡的標題\n> 引用的內容')).toBe('引用的內容')
    expect(firstLineOf('- **先看這裡** 細節')).toBe('先看這裡 細節')
    expect(firstLineOf('* 1. 疊在一起')).toBe('疊在一起')
    expect(firstLineOf('#3 號問題')).toBe('#3 號問題')
    expect(firstLineOf('   ')).toBeNull()
    expect(firstLineOf(null)).toBeNull()
    expect(firstLineOf('x'.repeat(300))).toHaveLength(200)
  })

  test('quoteOf folds white space and shortens', () => {
    expect(quoteOf('a\n\n  b\tc')).toBe('a b c')
    expect(quoteOf(' \n ')).toBeNull()
    expect(quoteOf('y'.repeat(400))?.endsWith('…')).toBe(true)
  })

  test('durations read as days, hours and minutes', () => {
    expect(durationParts(HOUR + 28 * MIN)).toEqual([
      { value: 1, unit: '小時' },
      { value: 28, unit: '分' },
    ])
    expect(durationLabel(3 * MIN + 59_000)).toBe('3 分')
    expect(durationLabel(5 * HOUR)).toBe('5 小時')
    expect(durationLabel(2 * DAY + 4 * HOUR + 10 * MIN)).toBe('2 天 4 小時')
    expect(durationLabel(30_000)).toBe('不到 1 分')
    expect(durationParts(-5)).toEqual([])
  })

  test('stampLabel shows the clock today, 昨天 and a date before', () => {
    expect(stampLabel(NOW - HOUR, NOW, 4)).toBe('11:00')
    expect(stampLabel(new Date(2026, 10, 10, 23, 8).getTime(), NOW, 4)).toBe('昨天 23:08')
    expect(stampLabel(new Date(2026, 10, 9, 9, 38).getTime(), NOW, 4)).toBe('11/9 09:38')
  })

  test('the unattended sentence names ages and failures without repeating itself', () => {
    const many = { count: 15, newestAt: NOW - 5 * DAY, oldestAt: NOW - 31 * DAY, failed: 1 }
    const one = { count: 1, newestAt: NOW - 2 * DAY, oldestAt: NOW - 2 * DAY, failed: 1 }

    expect(unattendedSentence(many, NOW)).toContain('最近的一個放了 5 天，最久的 31 天，其中 1 個是失敗後沒處理。')
    expect(unattendedSentence(one, NOW)).toContain('放了 2 天，都是失敗後沒處理。')
    expect(unattendedSentence({ ...one, failed: 0, newestAt: NOW, oldestAt: NOW }, NOW)).toContain('放了 不到 1 分鐘。')
  })

  test('briefingWindow is the away stretch or the last 12 hours', () => {
    expect(briefingWindow(NOW, { from: 1, to: 2 })).toEqual({ from: 1, to: 2 })
    expect(briefingWindow(NOW, null)).toEqual({ from: NOW - 12 * HOUR, to: NOW })
  })
})

describe('cost that grows with stored text (item 8)', () => {
  test('a finished session carries at most 50,000 characters of its reply, and says when it was cut', () => {
    const long = waitingSession('long', 'done', NOW - MIN)
    const short = waitingSession('short', 'done', NOW - 2 * MIN)
    const b = buildBriefing(
      input({
        sessions: [long, short],
        briefs: new Map([brief(long, { reportReply: 'x'.repeat(60_000), turnCount: 1 }), brief(short, { reportReply: 'ok', turnCount: 1 })]),
      }),
    )

    expect(b.done[0].reply).toHaveLength(50_000)
    expect(b.done[0].replyCut).toBe(true)
    expect(b.done[1]).toMatchObject({ reply: 'ok', replyCut: false })
  })

  test('a large pile is listed whole', () => {
    const pile = Array.from({ length: 70 }, (_, i) => waitingSession(`p${String(i).padStart(2, '0')}`, 'done', CUTOFF - (i + 1) * HOUR))

    const b = buildBriefing(input({ sessions: pile }))

    expect(b.left).toHaveLength(70)
    expect(b.unattended?.count).toBe(70)
    expect(b.bays.flatMap((bay) => bay.rows)).toHaveLength(70)
  })
})
