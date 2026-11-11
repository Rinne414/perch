import { describe, expect, test } from 'vitest'
import { buildBriefing } from '@shared/briefing'
import type { AgentSession, AgentTurn } from '@shared/types'
import { briefingNoteMarkdown, nestHeadings, reportBaseName, safeFileName, sessionNoteMarkdown } from './reportNote'

describe('nestHeadings', () => {
  test('pushes a reply\'s headings down so its top one lands on the asked level', () => {
    expect(nestHeadings('## 結論\n好了\n### 細節\n- a', 3)).toBe('### 結論\n好了\n#### 細節\n- a')
  })

  test('leaves headings that are already deep enough, and text without headings', () => {
    expect(nestHeadings('#### 小節\n內容', 3)).toBe('#### 小節\n內容')
    expect(nestHeadings('只有一行 # 不是標題', 3)).toBe('只有一行 # 不是標題')
  })

  test('never touches a line inside a code fence, and stops at the sixth level', () => {
    const text = '# 標題\n```\n# 這是註解\n```\n###### 最深'
    expect(nestHeadings(text, 4)).toBe('#### 標題\n```\n# 這是註解\n```\n###### 最深')
  })
})

describe('a reply inside a note', () => {
  test('its headings sit under the note\'s own sections, not beside them', () => {
    const reply = '## 結論\n能用了。\n\n## 還沒驗證的\n- Linux'
    const note = sessionNoteMarkdown(session(), [turn(1, T(10, 23, 8), '幫我部署', T(11, 13, 15), reply)], 4)
    const headings = note.split('\n').filter((line) => line.startsWith('## '))
    expect(headings).toEqual(['## 最後的回覆', '## 你說過的話', '## 完整經過'])
    expect(note).toContain('### 結論')
    expect(note).toContain('#### 還沒驗證的')
  })
})

const MIN = 60_000
const HOUR = 60 * MIN
const T = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime()

const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  id: 'claude-code:abc',
  agent: 'claude-code',
  sessionId: 'abc',
  cwd: 'C:\\code\\ComfyUI-aki-v1.6',
  name: 'ComfyUI 新模型: 節點打包',
  title: null,
  status: 'done',
  detail: '## 打包好了',
  startedAt: T(10, 23, 8),
  updatedAt: T(11, 13, 15),
  attentionAt: T(11, 13, 15),
  acknowledgedAt: null,
  endedAt: null,
  reopenedAt: null,
  ...over,
})

const turn = (id: number, start: number, prompt: string | null, end: number | null, reply: string | null): AgentTurn => ({
  id,
  agentSessionId: 'claude-code:abc',
  startedAt: start,
  prompt,
  endedAt: end,
  reply,
  replyLen: reply?.trim().length ?? 0,
})

describe('sessionNoteMarkdown', () => {
  const turns = [
    turn(1, T(10, 23, 8), 'A new model has come,\nhelp me deploy', T(11, 1, 8), '模型跑起來了'),
    turn(2, T(11, 9, 0), null, T(11, 9, 5), '背景工作做完了'),
    turn(3, T(11, 12, 13), 'summarize this session', T(11, 13, 15), '## 結論\n發了 0.2.1'),
  ]

  test('starts with front matter for search and agents', () => {
    const note = sessionNoteMarkdown(session(), turns, 4)

    expect(note.split('\n').slice(0, 11)).toEqual([
      '---',
      'date: 2026-11-11',
      'source: Perch',
      'agent: "Claude Code"',
      'folder: "C:\\\\code\\\\ComfyUI-aki-v1.6"',
      'session: "claude-code:abc"',
      'started: "2026-11-10 23:08"',
      'finished: "2026-11-11 13:15"',
      'prompts: 2',
      '---',
      '',
    ])
  })

  test('has the last reply whole, every typed prompt with its time, and every turn', () => {
    const note = sessionNoteMarkdown(session(), turns, 4)

    expect(note).toContain('# ComfyUI 新模型: 節點打包\n')
    expect(note).toContain('## 最後的回覆\n\n### 結論\n發了 0.2.1\n')
    expect(note).toContain('## 你說過的話\n\n### 2026-11-10 23:08\n\nA new model has come,\nhelp me deploy\n\n### 2026-11-11 12:13\n\nsummarize this session\n')
    expect(note).toContain('### 2. 2026-11-11 09:00\n\n**你說**：（沒有，這一輪是背景通知或接著上一輪）\n\n**它回**（2026-11-11 09:05）\n\n背景工作做完了\n')
    expect(note.endsWith('發了 0.2.1\n')).toBe(true)
  })

  test('a session from before turns were kept says so and falls back to its stored line without marks', () => {
    const note = sessionNoteMarkdown(session(), [], 4)

    expect(note).toContain('prompts: 0')
    expect(note).toContain('## 最後的回覆\n\n打包好了\n')
    expect(note.match(/沒有逐句紀錄/g)).toHaveLength(2)
    expect(note).not.toContain('null')
  })
})

describe('file names', () => {
  test('safeFileName removes what Windows refuses', () => {
    expect(safeFileName('a<b>c:d"e/f\\g|h?i*j')).toBe('a b c d e f g h i j')
    expect(safeFileName('  trailing dots... ')).toBe('trailing dots')
    expect(safeFileName('CON')).toBe('CON_')
    expect(safeFileName('lpt1')).toBe('lpt1_')
    expect(safeFileName('\u0007\t')).toBe('session')
    expect(safeFileName('長'.repeat(200))).toHaveLength(80)
  })

  test('the base name is the day the session started and its name', () => {
    expect(reportBaseName(session(), 4)).toBe('2026-11-10 ComfyUI 新模型 節點打包')
  })
})

describe('briefingNoteMarkdown', () => {
  test('has the away sentence, each section with states and first lines, the pile and the timeline', () => {
    const now = T(11, 13, 40)
    const asking = session({ id: 'claude-code:w', name: '做浮窗', status: 'needs_input', detail: '要執行 pnpm install', attentionAt: now - 6 * MIN, updatedAt: now - 6 * MIN })
    const left = session({ id: 'claude-code:u', name: '翻譯 README', updatedAt: now - 72 * HOUR, attentionAt: now - 72 * HOUR })
    const b = buildBriefing({
      now,
      dayStartHour: 4,
      cutoff: now - 24 * HOUR,
      sessions: [asking, session({ updatedAt: now - 20 * MIN, attentionAt: now - 20 * MIN }), left],
      briefs: new Map(),
      turns: [turn(9, now - 40 * MIN, 'p', now - 30 * MIN, '## 結論\n0.2.1 推上 GitHub')],
      spans: [],
      others: [],
      items: [],
      away: { from: now - 88 * MIN, to: now - 3 * MIN },
      todoMarks: new Map(),
    })

    const note = briefingNoteMarkdown(b)

    expect(note).toContain('date: 2026-11-11')
    expect(note).toContain('你離開了 1 小時 25 分（12:12 到 13:37）。')
    expect(note).toContain('## 等你決定（1）\n\n- **做浮窗**（等你回覆，ComfyUI-aki-v1.6，等了 6 分）：要執行 pnpm install')
    expect(note).toContain('## 做完了（1）\n\n- **ComfyUI 新模型: 節點打包**（ComfyUI-aki-v1.6，13:20 做完）：打包好了')
    expect(note).toContain('## 放著沒接（1）')
    expect(note).toContain('- **翻譯 README**（完成，放了 3 天）')
    expect(note).toContain('## 這段時間的經過\n\n- 13:10 0.2.1 推上 GitHub（ComfyUI 新模型: 節點打包）')
    expect(note).not.toContain('還在跑')
  })
})

describe('quoted text is made safe in notes (item 7)', () => {
  const fence = '```'
  test('a session note escapes embeds and HTML, renames a runnable fence, and closes one left open', () => {
    const turns = [
      turn(1, T(11, 9), '看 ![[秘密]] 然後 <script>x</script>', T(11, 10), `${fence}dataviewjs\ndv.list()\n${fence}\n然後\n${fence}python\nopen forever`),
    ]
    const note = sessionNoteMarkdown(session({ name: '名字 <b>粗</b>' }), turns, 4)

    expect(note).toContain('# 名字 \\<b>粗\\</b>')
    expect(note).toContain('看 \\![[秘密]] 然後 \\<script>x\\</script>')
    expect(note).toContain(`${fence}text\ndv.list()`)
    expect(note).not.toContain('dataviewjs')
    const fenceLines = note.split('\n').filter((line) => line.startsWith(fence)).length
    expect(fenceLines % 2).toBe(0)
  })

  test('the briefing note escapes what it quotes', () => {
    const now = T(11, 13, 40)
    const asking = session({ id: 'claude-code:w', name: '![[x]]', status: 'needs_input', detail: '<img src=x>', attentionAt: now - MIN, updatedAt: now - MIN })
    const b = buildBriefing({ now, dayStartHour: 4, cutoff: now - HOUR, sessions: [asking], briefs: new Map(), turns: [], spans: [], others: [], items: [], away: null, todoMarks: new Map() })

    const note = briefingNoteMarkdown(b)

    expect(note).toContain('- **\\![[x]]**（')
    expect(note).toContain('：\\<img src=x>')
  })
})

describe('notes say Perch rewrites them (item 11)', () => {
  test('both kinds carry the one-line comment, right under the title', () => {
    const now = T(11, 13, 40)
    const b = buildBriefing({ now, dayStartHour: 4, cutoff: now, sessions: [], briefs: new Map(), turns: [], spans: [], others: [], items: [], away: null, todoMarks: new Map() })
    const comment = '<!-- Perch 會改寫這個檔，這裡改的會被蓋掉；想寫的話請另開一個檔。 -->'

    expect(sessionNoteMarkdown(session(), [], 4)).toContain(`# ComfyUI 新模型: 節點打包\n\n${comment}\n`)
    expect(briefingNoteMarkdown(b)).toContain(`# 簡報 2026-11-11\n\n${comment}\n`)
  })
})
