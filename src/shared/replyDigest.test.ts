import { describe, expect, test } from 'vitest'
import { digestReply, EMPTY_DIGEST, kindOf } from './replyDigest'

const REPORT = [
  '## TL;DR',
  '',
  '簡報分頁做出來了，審查找到的問題也修完了。**全部還沒 commit、沒發版**，所以今天還用不到。',
  '',
  '## 現在有什麼',
  '',
  '- **簡報分頁**：你離開了多久、等你決定的、做完了的報告。',
  '- **存檔**：存成筆記、存成 PDF。',
  '',
  '## 沒驗證的',
  '',
  '- 沒按過「開資料夾」和複製指令的按鈕（怕蓋掉你的剪貼簿）。',
  '- 真的 agent 從頭到尾跑一次進新資料表，還沒發生過。',
  '  - 要等發版。',
  '',
  '## 接下來要你說一聲的事',
  '',
  '- **commit 和發 0.8.0**：這是對外的動作，我沒做。',
  '- **花額度的三項**：自動短簡報、叫 session 自己寫完整報告。',
  '',
  '```',
  '## 這行在程式碼裡，不是標題',
  '- 也不是清單',
  '```',
].join('\n')

describe('digestReply on a report with sections', () => {
  const d = digestReply(REPORT)

  test('the conclusion is the TL;DR section, without marks', () => {
    expect(d.conclusion).toBe('簡報分頁做出來了，審查找到的問題也修完了。全部還沒 commit、沒發版，所以今天還用不到。')
  })

  test('what is left for the person is one entry per top-level point', () => {
    expect(d.todos).toEqual(['commit 和發 0.8.0：這是對外的動作，我沒做。', '花額度的三項：自動短簡報、叫 session 自己寫完整報告。'])
  })

  test('unverified points leave nested details and code out', () => {
    expect(d.unverified).toEqual(['沒按過「開資料夾」和複製指令的按鈕（怕蓋掉你的剪貼簿）。', '真的 agent 從頭到尾跑一次進新資料表，還沒發生過。'])
  })
})

describe('nothing, unknown, and the agent’s own plan are told apart', () => {
  test.each([
    ['## 你需要做的事\n沒有。', 'none'],
    ['## 你需要做的事\n\n- 沒有，你什麼都不用做。', 'none'],
    ['## 需要你做的事\n目前沒有需要你做的事。', 'none'],
    ['**What you need to do**\nNothing needed from you.', 'none'],
    ['## Next steps\nNone', 'none'],
  ])('%j says there is nothing', (reply, expected) => {
    expect(digestReply(reply).todos).toBe(expected)
  })

  test('a real point that starts with a negative word is still a point', () => {
    expect(digestReply('## 你需要做的事\n- 沒有安裝 Linux 的話，先裝一台虛擬機再跑測試').todos).toEqual(['沒有安裝 Linux 的話，先裝一台虛擬機再跑測試'])
    expect(digestReply('## 下一步\n沒有，但建議你更新一下節點包').todos).toEqual(['沒有，但建議你更新一下節點包'])
  })

  test('no such section is unknown', () => {
    expect(digestReply('改好了，測試都過。').todos).toBeNull()
    expect(digestReply('改好了，測試都過。').unverified).toBeNull()
  })

  test('a section holding only code is unknown, not nothing', () => {
    expect(digestReply('## 下一步\n```\npnpm install\n```').todos).toBeNull()
  })

  test('the agent’s own plan is not left for the person', () => {
    expect(digestReply('## 接下來我會做的\n- 跑測試').todos).toBeNull()
    expect(digestReply('下一步：我會先跑完整測試').todos).toBeNull()
  })

  test('"all verified" gives an empty list', () => {
    expect(digestReply('## 還沒驗證的\n沒有。').unverified).toEqual([])
  })
})

describe('headings in every shape agents write them', () => {
  test('bold labels, with the text on the same line or under it', () => {
    expect(digestReply('**結論：** 修好了，原因是時區。\n\n**還沒驗證的**\n- macOS').conclusion).toBe('修好了，原因是時區。')
    expect(digestReply('**結論**：修好了。').conclusion).toBe('修好了。')
    expect(digestReply('**結論**\n修好了。\n\n其他的話').conclusion).toBe('修好了。')
    expect(digestReply('**還沒驗證的**\n- macOS').unverified).toEqual(['macOS'])
  })

  test('plain labels and a heading that carries its text', () => {
    expect(digestReply('TL;DR: fixed the crash.\n\nDetails follow.').conclusion).toBe('fixed the crash.')
    expect(digestReply('## 結論：可以發了\n\n細節…').conclusion).toBe('可以發了')
    expect(digestReply('Next steps:\n1. Run the installer\n2. Tell me if the icon shows').todos).toEqual(['Run the installer', 'Tell me if the icon shows'])
  })

  test('a bold sentence is text, not a label', () => {
    expect(digestReply('**這一版可以發了。**\n\n細節在下面。').conclusion).toBe('這一版可以發了。')
  })

  test('a list item that holds a label word stays a list item', () => {
    const d = digestReply('## 做了什麼\n- 下一步：接上真的資料\n- 結論：先不做')
    expect(d.todos).toBeNull()
    expect(d.conclusion).toBe('下一步：接上真的資料\n結論：先不做')
  })

  test('sub-sections count under their section; a quoted report is read too', () => {
    const d = digestReply('## 你需要做的事\n### 馬上\n- A\n### 之後\n- B\n## 其他\n- C')
    expect(d.todos).toEqual(['A', 'B'])
    expect(digestReply('> ## 結論\n> 好了').conclusion).toBe('好了')
  })

  test('table rows are points; ticked boxes are done', () => {
    const d = digestReply('## 需要你決定\n| 事 | 選項 |\n|---|---|\n| 發版 | 現在或明天 |\n\n## Action items\n- [x] 已經做了\n- [ ] 還沒做')
    expect(d.todos).toEqual(['發版，現在或明天', '還沒做'])
  })

  test('a paragraph that only introduces the list is not a point', () => {
    expect(digestReply('## 下一步\n以下兩件事要你決定：\n- 要不要發版\n- 要不要開自動存檔').todos).toEqual(['要不要發版', '要不要開自動存檔'])
  })
})

describe('titles real reports use', () => {
  test.each([
    ['你要做的', 'todos'],
    ['需要你決定（回 1A 2B 就好）', 'todos'],
    ['還在等你決定的', 'todos'],
    ['3. 發 0.8.1（要你點頭）', 'todos'],
    ['下一步，你說一聲我就做', 'todos'],
    ['你可以這樣驗收', 'todos'],
    ['Undo / your next step', 'todos'],
    ['接下來', 'todos'],
    ['剩下要你做的', 'todos'],
    ['需要你做的（都不急）', 'todos'],
    ['驗收：請你試一次', 'todos'],
    ['驗收結果', null],
    ['驗收通過', null],
    ['已驗收', null],
    ['怎麼測的', null],
    ['你做的修改', null],
    ['What you asked', null],
    ['待辦已完成', null],
    ['Next steps I took', null],
    ['我替你決定的（都能改）', null],
    ['我替你做的決定（都可以撤回）', null],
    ['完整版接下來的段落', null],
    ['接下來我會做的', null],
    ['你要知道的', null],
    ['沒做、留給之後的', null],
    ['還沒驗證的', 'unverified'],
    ['沒驗證到的地方', 'unverified'],
    ['還沒確認的', 'unverified'],
    ['已知限制', 'unverified'],
    ['要注意的地方', 'unverified'],
    ['Not verified yet', 'unverified'],
    ['Known gaps', 'unverified'],
    ['驗證結果', null],
    ['TL;DR', 'conclusion'],
    ['先說結論', 'conclusion'],
    ['簡單說', 'conclusion'],
    ['一句話總結', 'conclusion'],
    ['build_summary_12_files（每個檔案一列）', null],
    ['做了什麼', null],
  ])('%s is %s', (title, kind) => {
    expect(kindOf(title)).toBe(kind)
  })
})

describe('without a conclusion section', () => {
  test('the first paragraph stands in', () => {
    expect(digestReply('改好了，跨月那一列會補上個月的日期。\n\n另外順手修了顏色。').conclusion).toBe('改好了，跨月那一列會補上個月的日期。')
  })

  test('a reply that opens with a list gives its first three points', () => {
    expect(digestReply('- 一\n- 二\n- 三\n- 四').conclusion).toBe('一\n二\n三')
  })

  test('a reply that is only a to-do section has no conclusion', () => {
    expect(digestReply('## 需要你做的事\n- 按更新').conclusion).toBeNull()
  })

  test('empty input', () => {
    expect(digestReply(null)).toBe(EMPTY_DIGEST)
    expect(digestReply('  \n ')).toBe(EMPTY_DIGEST)
  })
})

describe('hostile input stays fast', () => {
  const within = (ms: number, run: () => unknown): void => {
    const start = performance.now()
    run()
    expect(performance.now() - start).toBeLessThan(ms)
  }

  test('long runs of marks do not stall it', () => {
    within(500, () => digestReply(`${'#'.repeat(200_000)}x`))
    within(500, () => digestReply(`## 結論\n${'['.repeat(100_000)}`))
    within(500, () => digestReply(`## 下一步\n${'**'.repeat(100_000)}`))
    within(500, () => digestReply(`## 下一步\n${'- a\n'.repeat(50_000)}`))
    within(500, () => digestReply(`${'|'.repeat(100_000)}\n${' '.repeat(200_000)}x`))
  })

  test('a reply far past any cap is read without running out of stack', () => {
    const bullets = Array.from({ length: 150_000 }, (_, i) => `- 第 ${i} 件`).join('\n')
    const d = digestReply(`## 下一步\n${bullets}`)
    expect(Array.isArray(d.todos) && d.todos.length).toBe(150_000)
    const under = `## 你需要做的事\n### 細節\n${'一行字\n'.repeat(250_000)}`
    expect(() => digestReply(under)).not.toThrow()
  })

  test('two long points that read the same up to the cut are one row', () => {
    const same = '長'.repeat(300)
    const d = digestReply(`## 下一步\n- ${same}甲\n- ${same}乙`)
    expect(Array.isArray(d.todos) && d.todos.length).toBe(1)
  })

  test('a very long point is cut with a mark', () => {
    const d = digestReply(`## 下一步\n- ${'長'.repeat(1000)}`)
    expect(Array.isArray(d.todos) && d.todos[0].length).toBe(240)
    expect(Array.isArray(d.todos) && d.todos[0].endsWith('…')).toBe(true)
  })
})
