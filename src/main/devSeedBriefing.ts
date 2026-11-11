import type { DatabaseSync } from 'node:sqlite'
import type { AgentEvent } from '@shared/agentEvent'
import { applyAgentEvent } from './db/agents'
import { sessionCutoff } from './restore'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

type Step = Omit<AgentEvent, 'v' | 'agent' | 'sessionId'> & { readonly at: number }

/** The long, many-line report a finished session leaves: nothing left for the person, two points not verified. */
const LONG_REPLY = [
  '## 結論',
  'MiniMax-H3-Image 已經能在這台電腦出圖和改圖，4 MP 一張約 11 到 78 秒。節點併進 ComfyUI-MiniMaxH3-Tools，發了 0.2.0 和 0.2.1，兩版都通過 Comfy Registry 審核。',
  '',
  '## 你需要做的事',
  '沒有。',
  '',
  '## 做了什麼',
  '- 下載模型並放進 models/diffusion_models，沿用你原本的資料夾',
  '- 寫了文生圖、參考圖編輯兩個範例工作流',
  '- 節點包加上 H3 Image 的載入器和取樣器',
  '- 0.2.0 推上 GitHub，送 Comfy Registry 審核，通過',
  '- 0.2.1 修了 Windows 路徑有空格時找不到模型的問題，也通過了',
  '',
  '## 實測數字',
  '| 項目 | 第一次 | 重跑 | 備註 |',
  '|---|---|---|---|',
  '| 文生圖 4 MP | 78 秒 | 11 秒 | 同提示詞，模型已經在顯示卡上 |',
  '| 參考圖編輯 | 36 秒 | 28 秒 | 兩張參考圖 |',
  '',
  '自動測試 **453 通過**，用 `pytest -q` 跑的：',
  '```',
  'python -m pytest -q tests/ --maxfail=1 --durations=5 --basetemp=C:/ComfyUI-aki-v1.6/temp/pytest',
  '```',
  '',
  '## 還沒驗證的',
  '1. Linux 上沒跑過，路徑處理只看過程式碼',
  '2. 12 GB 的顯卡沒測，只在 24 GB 上跑',
  '',
  '## 復原方法',
  '節點包回到 0.1.4：在 ComfyUI Manager 裡選舊版本安裝；模型檔可以直接刪掉。',
].join('\n')

/** A report with a conclusion, one point left for the person and one not verified. */
const CALENDAR_REPLY = [
  '## 結論',
  '跨月那一列現在會補上個月和下個月的日期，顏色淡一級。26 個日曆測試都過。',
  '',
  '## 需要你做的事',
  '- 看一眼十二月和一月交界那一列，顏色太淡就跟它說',
  '',
  '## 還沒驗證的',
  '- 週一開始的週曆沒有測',
].join('\n')

/** TL;DR, and the point left for the person under a heading in its own words; nothing said about verifying. */
const README_REPLY = [
  '## TL;DR',
  '英文版寫好了，連結都換成相對路徑，中文版開頭加了語言切換。',
  '',
  '## 改了什麼',
  '- README.en.md 新增',
  '- 兩個版本的連結都改成相對路徑',
  '',
  '## 接下來要你說一聲的事',
  '- 英文 README 的截圖還是中文介面，要不要重拍',
].join('\n')

/** A running session's latest report, with what comes next. */
const COMPARE_REPLY = [
  '## 結論',
  '比較表寫好了，放在 docs/eag-compare.md。按姿勢／角度找圖目前做不到，要先有標籤。',
  '',
  '## 下一步',
  '- 比較表第 3 欄的數字是估的，要你給實測值',
].join('\n')

function play(db: DatabaseSync, agent: string, sessionId: string, steps: readonly Step[], now: number): void {
  for (const step of steps) applyAgentEvent(db, { v: 1, agent, sessionId, ...step }, now)
}

function seedFinished(db: DatabaseSync, now: number, cwd: (name: string) => string): void {
  const yesterday = new Date(now - DAY)
  const lateLastNight = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 8).getTime()
  play(db, 'claude-code', 'b2', [
    { at: lateLastNight, status: 'running', cwd: cwd('ComfyUI-aki-v1.6'), name: 'ComfyUI 新模型工作流與節點打包', prompt: 'A new model has come, help me deploy and run, make an optimized workflow, and see if we can make a nodes pack.' },
    { at: lateLastNight + 2 * HOUR, status: 'done', reply: '模型跑起來了，第一張圖 78 秒。\n接下來做工作流。' },
    { at: now - 3 * HOUR, status: 'running', prompt: 'ok, release it' },
    { at: now - 80 * MIN, status: 'done', reply: '0.2.1 推上 GitHub，送 Comfy Registry 審核\n\n審核通常要一兩個小時。' },
    { at: now - 70 * MIN, status: 'running', prompt: 'summarize this session and give me a pdf' },
    { at: now - 8 * MIN, status: 'done', reply: LONG_REPLY },
    // A background notice answered with one line after the real report: the report stays the long one.
    { at: now - 7 * MIN, status: 'done', reply: '好，PDF 也存好了。' },
  ], now)
  play(db, 'claude-code', 'd1', [
    { at: now - 70 * MIN, status: 'running', cwd: cwd('perch'), name: '修日曆跨月的格子', prompt: '日曆跨月那一列空著，補上前後月的日期' },
    { at: now - 36 * MIN, status: 'done', reply: CALENDAR_REPLY },
  ], now)
  // A reply without headings: its first paragraph is how the card opens.
  play(db, 'codex', 'x1', [
    { at: now - 40 * MIN, status: 'running', cwd: cwd('api-server'), title: '加上分頁', prompt: '列表加上分頁，每頁 50 筆' },
    { at: now - 15 * MIN, status: 'done', reply: '分頁做好了，每頁 50 筆，網址會帶頁碼，重新整理也會停在同一頁。\n\n舊的 offset 參數還留著，以前的連結都能用。' },
  ], now)
  play(db, 'claude-code', 'r1', [
    { at: now - 2 * HOUR, status: 'running', cwd: cwd('api-server'), name: 'README 翻成英文', prompt: '把 README 翻成英文，術語照原本的' },
    { at: now - 69 * MIN, status: 'done', reply: README_REPLY },
  ], now)
}

/**
 * Sessions for the 簡報 tab, with whole prompts and replies: one asking; finished ones whose reports
 * say there is nothing to do, leave one point, or leave one under a TL;DR; one still running whose
 * report has a next step and has been quiet a while; and four left from before the last restart.
 */
export function seedBriefing(db: DatabaseSync, now: number, cwd: (name: string) => string): void {
  seedFinished(db, now, cwd)
  play(db, 'claude-code', 'b1', [
    { at: now - 2 * HOUR, status: 'running', cwd: cwd('perch'), name: 'Perch 回來簡報', prompt: '幫我想想，回來的時候怎麼一眼看到 agent 們做了什麼' },
    { at: now - 100 * MIN, status: 'done', reply: '畫了兩個版本的樣稿，放在畫布上。' },
    { at: now - 95 * MIN, status: 'running', prompt: 'I think you should make it cooler. For sure you should keep most of the uiux is presenting useful informations.' },
    { at: now - 30 * MIN, status: 'done', reply: '改好三項設定，Perch 開始留下完整的話和完整的回覆，畫了這張圖。' },
    { at: now - 6 * MIN, status: 'needs_input', detail: '這個指揮台的方向對不對，哪裡還不夠？' },
  ], now)
  play(db, 'claude-code', 'b3', [
    { at: now - 2 * DAY - 3 * HOUR, status: 'running', cwd: cwd('sd-image-sorter'), name: '膠水編程與 EAG 對比', prompt: '比較一下 EAG 和我們的分類器' },
    { at: now - 50 * MIN, status: 'done', reply: COMPARE_REPLY },
    { at: now - 45 * MIN, status: 'running', prompt: 'ok add them. For 按姿勢／角度找圖, I think it can be first using tagger to tag the images, and then search with keywords?' },
    // Quiet for a while: the lanes say it may be stuck.
    { at: now - 14 * MIN, status: 'running' },
  ], now)
  seedLeftBehind(db, cwd)
}

/** Waiting sessions from before the restart: the 放著沒接 pile. Their times hang off the restart, so they always sit before it. */
function seedLeftBehind(db: DatabaseSync, cwd: (name: string) => string): void {
  const cutoff = sessionCutoff()
  const left: readonly [string, string, AgentEvent['status'], number, string][] = [
    ['u1', '翻譯說明文件', 'done', HOUR, 'docs'],
    ['u2', '升級 electron-builder', 'needs_input', 3 * DAY, 'perch'],
    ['u3', '研究 LoRA 訓練參數', 'done', 12 * DAY, 'lora-lab'],
    ['u4', '清理舊的 workflow', 'failed', 31 * DAY, 'ComfyUI-aki-v1.6'],
  ]
  for (const [id, name, status, before, folder] of left) {
    const at = cutoff - before
    // The newest one has whole prompts and replies, so its full record can be opened from the pile.
    const words = id === 'u1' ? { prompt: '把說明文件翻成英文，術語照原本的' } : {}
    const reply = id === 'u1' ? { reply: '## 翻好了\n- docs/en 新增\n- 術語表放在最後' } : {}
    applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: id, status: 'running', cwd: cwd(folder), name, at: at - 20 * MIN, ...words }, at)
    applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: id, status, at, detail: status === 'failed' ? 'API 錯誤：overloaded' : undefined, ...reply }, at)
  }
}
