import { describe, expect, test } from 'vitest'
import { parseInline, parseMarkdown } from './markdown'

const text = (t: string) => ({ kind: 'text', text: t })

describe('parseInline', () => {
  test('finds bold and inline code and keeps the rest literal', () => {
    expect(parseInline('跑 `pnpm test`，**全部通過**，其他 *不動* 和 __這個__')).toEqual([
      text('跑 '),
      { kind: 'code', text: 'pnpm test' },
      text('，'),
      { kind: 'bold', text: '全部通過' },
      text('，其他 *不動* 和 __這個__'),
    ])
  })

  test('an unclosed mark stays as it was', () => {
    expect(parseInline('a ** b ` c')).toEqual([text('a ** b ` c')])
    expect(parseInline('')).toEqual([])
  })
})

describe('parseMarkdown', () => {
  test('headings lose their hashes, list items keep a marker and their depth', () => {
    expect(parseMarkdown('## 結論\n- 第一點\n  - 細節\n1. 先做\n2) 再做\n* 星號 **粗**')).toEqual([
      { kind: 'heading', parts: [text('結論')] },
      { kind: 'item', marker: '•', depth: 0, parts: [text('第一點')] },
      { kind: 'item', marker: '•', depth: 1, parts: [text('細節')] },
      { kind: 'item', marker: '1.', depth: 0, parts: [text('先做')] },
      { kind: 'item', marker: '2)', depth: 0, parts: [text('再做')] },
      { kind: 'item', marker: '•', depth: 0, parts: [text('星號 '), { kind: 'bold', text: '粗' }] },
    ])
  })

  test('code fences become one monospace block, closed or not, with nothing inside formatted', () => {
    expect(parseMarkdown('前\n```ts\nconst a = **1**\n# not a heading\n```\n後')).toEqual([
      { kind: 'line', parts: [text('前')] },
      { kind: 'code', text: 'const a = **1**\n# not a heading' },
      { kind: 'line', parts: [text('後')] },
    ])
    expect(parseMarkdown('~~~\nopen to the end\nstill code')).toEqual([{ kind: 'code', text: 'open to the end\nstill code' }])
  })

  test('a table with a separator row becomes rows of cells, aligned as the separator says', () => {
    expect(parseMarkdown('| 項目 | 秒 | 備註 |\n|:---|---:|:-:|\n| **文生圖** | 78 | `4 MP` |\n\n結束')).toEqual([
      {
        kind: 'table',
        align: ['left', 'right', 'center'],
        header: [[text('項目')], [text('秒')], [text('備註')]],
        rows: [[[{ kind: 'bold', text: '文生圖' }], [text('78')], [{ kind: 'code', text: '4 MP' }]]],
      },
      { kind: 'gap' },
      { kind: 'line', parts: [text('結束')] },
    ])
  })

  test('leading and trailing pipes are optional; a backslash keeps a pipe inside a cell', () => {
    expect(parseMarkdown('a | b\n--- | ---\n1 | x \\| y')).toEqual([
      { kind: 'table', align: [null, null], header: [[text('a')], [text('b')]], rows: [[[text('1')], [text('x | y')]]] },
    ])
  })

  test('a ragged row is filled with empty cells or cut to the header', () => {
    const [table] = parseMarkdown('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |')
    expect(table).toMatchObject({ rows: [[[text('1')], [], []], [[text('1')], [text('2')], [text('3')]]] })
  })

  test('pipe lines without a separator row stay a monospace block', () => {
    expect(parseMarkdown('| 項目 | 秒 |\n| 文生圖 | 78 |')).toEqual([{ kind: 'code', text: '| 項目 | 秒 |\n| 文生圖 | 78 |' }])
    expect(parseMarkdown('| a | b | c |\n|---|---|')).toEqual([{ kind: 'code', text: '| a | b | c |\n|---|---|' }])
  })

  test('a line of 100,000 pipes returns at once, alone or as a whole table', () => {
    const pipes = '|'.repeat(100_000)
    const t0 = performance.now()
    expect(parseMarkdown(pipes)[0].kind).toBe('code')
    const wide = parseMarkdown(`${'a|'.repeat(50_000)}\n${'-|'.repeat(50_000)}\n${pipes}`)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(wide[0]).toMatchObject({ kind: 'table' })
  })

  test('a lone pipe in a sentence is not a table', () => {
    expect(parseMarkdown('用 a | b 分開\n下一行')).toEqual([
      { kind: 'line', parts: [text('用 a | b 分開')] },
      { kind: 'line', parts: [text('下一行')] },
    ])
  })

  test('everything else stays literal; runs of empty lines become one gap, none at the ends', () => {
    expect(parseMarkdown('\n\n> 引用\n---\n#沒有空格\n\n\n\n最後\n\n')).toEqual([
      { kind: 'line', parts: [text('> 引用')] },
      { kind: 'line', parts: [text('---')] },
      { kind: 'line', parts: [text('#沒有空格')] },
      { kind: 'gap' },
      { kind: 'line', parts: [text('最後')] },
    ])
  })

  test('a closing run of hashes and trailing spaces come off a heading; hashes inside a word stay', () => {
    expect(parseMarkdown('## 結論 ##  ')).toEqual([{ kind: 'heading', parts: [text('結論')] }])
    expect(parseMarkdown('# C#')).toEqual([{ kind: 'heading', parts: [text('C#')] }])
    expect(parseMarkdown('### ###')).toEqual([{ kind: 'heading', parts: [] }])
    expect(parseMarkdown('    # four spaces is not a heading')[0].kind).toBe('line')
  })

  test('lines with 200,000 spaces parse in well under a second (no backtracking)', () => {
    const long = ' '.repeat(200_000)
    const inputs = [`# a${long}x`, `${long}x`, `a | b\n${long}x`, `a | b\n|${long}x`, `- a${long}x`, `${long}\`\`\`x`, `**a${long}`]
    const t0 = performance.now()
    for (const input of inputs) parseMarkdown(input)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(parseMarkdown(`# a${long}x`)).toEqual([{ kind: 'heading', parts: [text(`a${long}x`)] }])
  })

  test('Windows line ends read the same', () => {
    expect(parseMarkdown('# 標題\r\n內容')).toEqual(parseMarkdown('# 標題\n內容'))
  })
})
