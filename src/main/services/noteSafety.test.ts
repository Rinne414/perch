import { describe, expect, test } from 'vitest'
import { safeInline, safeQuote } from './noteSafety'

const BT = '```'

describe('safeQuote', () => {
  test('an ordinary reply with headings, lists, a table and a bash fence comes through unchanged', () => {
    const reply = [
      '## 結論',
      '做好了，**全部通過**，跑 `pnpm test`。',
      '',
      '- 第一點',
      '  - 細節',
      '1. 先做',
      '',
      '| 項目 | 秒 |',
      '|---|---|',
      '| 文生圖 | 78 |',
      '',
      `${BT}bash`,
      'pnpm test && pnpm run build',
      BT,
      '',
      'a < b，而且 5 > 3。',
    ].join('\n')

    expect(safeQuote(reply)).toBe(reply)
  })

  test('closes a fence left open, so it cannot swallow the rest of the note', () => {
    expect(safeQuote(`前面\n${BT}python\nprint(1)`)).toBe(`前面\n${BT}python\nprint(1)\n${BT}`)
    expect(safeQuote('~~~~\nx')).toBe('~~~~\nx\n~~~~')
  })

  test('only a fence of the same kind and at least as long closes one', () => {
    const text = `${'`'.repeat(4)}\n${BT}\nstill code\n~~~\n${'`'.repeat(4)}\nafter`
    expect(safeQuote(text)).toBe(text)
  })

  test('renames a fence language outside the allow-list to text; plain languages stay', () => {
    expect(safeQuote(`${BT}dataviewjs\ndv.list()\n${BT}`)).toBe(`${BT}text\ndv.list()\n${BT}`)
    expect(safeQuote(`${BT}DataView\nLIST\n${BT}`)).toBe(`${BT}text\nLIST\n${BT}`)
    expect(safeQuote(`~~~tasks\nnot done\n~~~`)).toBe(`~~~text\nnot done\n~~~`)
    expect(safeQuote(`${BT}python title="run.py"\nx\n${BT}`)).toBe(`${BT}python title="run.py"\nx\n${BT}`)
    expect(safeQuote(`${BT}\nno language\n${BT}`)).toBe(`${BT}\nno language\n${BT}`)
  })

  test('outside fences, images, embeds and HTML tags are escaped so they read the same but are not live', () => {
    expect(safeQuote('看 ![圖](C:/x.png) 和 ![[秘密筆記]]')).toBe('看 \\![圖](C:/x.png) 和 \\![[秘密筆記]]')
    expect(safeQuote('<img src=x onerror=alert(1)> 和 <div>x</div> 和 <!-- 藏起來 -->')).toBe(
      '\\<img src=x onerror=alert(1)> 和 \\<div>x\\</div> 和 \\<!-- 藏起來 -->',
    )
  })

  test('inside fences and inline code nothing is escaped, and an escape already there is left alone', () => {
    const fenced = `${BT}html\n<div>![x](y)</div>\n${BT}`
    expect(safeQuote(fenced)).toBe(fenced)
    expect(safeQuote('用 `<div>` 和 `![x](y)`')).toBe('用 `<div>` 和 `![x](y)`')
    expect(safeQuote('已經跳脫 \\![x] 和 \\<b>')).toBe('已經跳脫 \\![x] 和 \\<b>')
  })

  test('an unclosed backtick does not hide what follows it', () => {
    expect(safeQuote('a ` b ![x](y)')).toBe('a ` b \\![x](y)')
  })

  test('Windows line ends are read as line ends', () => {
    expect(safeQuote(`${BT}dataviewjs\r\nx\r\n${BT}`)).toBe(`${BT}text\nx\n${BT}`)
  })
})

describe('safeInline', () => {
  test('makes one line safe without treating it as a fence', () => {
    expect(safeInline(`${BT}dataviewjs ![[x]] <b>`)).toBe(`${BT}dataviewjs \\![[x]] \\<b>`)
  })
})
