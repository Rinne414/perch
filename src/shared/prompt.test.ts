import { describe, expect, test } from 'vitest'
import { promptTitle } from './prompt'

describe('prompt titles', () => {
  test('are the first line of the person\'s own words', () => {
    expect(promptTitle('\n  修好登入頁  \n細節…')).toBe('修好登入頁')
  })

  test('skip a pasted block and use what was typed after it', () => {
    const prompt = ['<pasted_content id="a52e">', '別人寫的長文', '第二行', '</pasted_content>', '幫我看這段有沒有問題'].join('\n')
    expect(promptTitle(prompt)).toBe('幫我看這段有沒有問題')
  })

  test('name a prompt that is only a block the app added', () => {
    expect(promptTitle('<pasted_content id="a52e">\n很長的貼上內容\n</pasted_content>')).toBe('（貼上的內容）')
    expect(promptTitle('<task-notification>\n<task-id>b1</task-id>\n<summary>Agent done</summary>\n</task-notification>')).toBe(
      '（背景工作通知）',
    )
    expect(promptTitle('<something-new>x</something-new>')).toBe('（沒有文字）')
  })

  test('clean titles stored before, which are a lone tag line', () => {
    expect(promptTitle('<pasted_content id="a52e">')).toBe('（貼上的內容）')
    expect(promptTitle('<task-notification>')).toBe('（背景工作通知）')
  })

  test('keep ordinary text that happens to use angle brackets', () => {
    expect(promptTitle('<b>粗體</b> 要改成斜體')).toBe('<b>粗體</b> 要改成斜體')
    expect(promptTitle('<3 謝謝')).toBe('<3 謝謝')
    expect(promptTitle('x < y 的時候')).toBe('x < y 的時候')
  })

  test('shorten a very long line', () => {
    expect(promptTitle('字'.repeat(200))).toHaveLength(160)
  })
})
