import { describe, expect, test } from 'vitest'
import { promptTitle, typedPrompt } from './prompt'

describe('typedPrompt', () => {
  test('is the whole prompt, as typed', () => {
    expect(typedPrompt('\n  修好登入頁\n\n  細節…  \n')).toBe('修好登入頁\n\n  細節…')
  })

  test('drops the blocks the app added around the person\'s words', () => {
    const prompt = [
      '<system-reminder>\nlong rules\n</system-reminder>',
      '<command-name>/review</command-name>',
      '<command-message>review</command-message>',
      '<command-args>src</command-args>',
      '<local-command-stdout>ok</local-command-stdout>',
      '<local-command-caveat>Caveat: ignore</local-command-caveat>',
      '幫我看這個',
    ].join('\n')
    expect(typedPrompt(prompt)).toBe('幫我看這個')
  })

  test.each([
    ['only a background notice', '<task-notification>\n<task-id>b1</task-id>\n<summary>Agent done</summary>\n</task-notification>'],
    ['only reminders and echoes', '<system-reminder>x</system-reminder>\n<local-command-stdout>y</local-command-stdout>'],
    ['a message from another session', 'Another Claude session sent a message: please stop'],
    ['a message from another session after a reminder', '<system-reminder>x</system-reminder>\nAnother Claude session sent a message'],
    ['an interrupted request', '[Request interrupted by user]'],
    ['an interrupted tool request', '[Request interrupted by user for tool use]'],
    ['nothing at all', ' \n '],
  ])('is null for %s', (_label, raw) => {
    expect(typedPrompt(raw)).toBeNull()
  })

  test('keeps the inner text of pasted content, whether or not anything was typed with it', () => {
    expect(typedPrompt('<pasted_content id="a52e">\n別人寫的長文\n第二行\n</pasted_content>')).toBe('別人寫的長文\n第二行')
    expect(typedPrompt('<pasted_content id="a52e">\n長文\n</pasted_content>\n幫我看這段')).toBe('長文\n\n幫我看這段')
  })

  test('removes a notice that arrives together with typed words', () => {
    expect(typedPrompt('<task-notification><summary>x</summary></task-notification>\n接著做')).toBe('接著做')
  })

  test('keeps ordinary text that happens to use angle brackets or mention a message', () => {
    expect(typedPrompt('<b>粗體</b> 要改成斜體')).toBe('<b>粗體</b> 要改成斜體')
    expect(typedPrompt('x < y 的時候，Another Claude session sent a message 是什麼')).toBe(
      'x < y 的時候，Another Claude session sent a message 是什麼',
    )
  })
})

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

describe('typedPrompt stays linear (it runs inside the hook)', () => {
  test('58,000 unclosed system-reminder openers take well under a second', () => {
    const input = `我打的字 ${'<system-reminder>'.repeat(58_000)}`
    const t0 = performance.now()
    const result = typedPrompt(input)
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(result).toBe(input.trim())
  })

  test('many unclosed pasted openers and unclosed tag starts are just as quick', () => {
    const inputs = ['<pasted_content>'.repeat(58_000) + 'x', '<system-reminder a'.repeat(30_000), '</system-reminder'.repeat(30_000)]
    const t0 = performance.now()
    for (const input of inputs) typedPrompt(input)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})

describe('pasted text the way Claude Code really writes it (the closing tag repeats the id)', () => {
  const pasted = '<pasted_content id="4b7f">\n貼上的一段需求文字\n</pasted_content id="4b7f">'

  test('typedPrompt keeps the pasted words and what was typed after them, without the tags', () => {
    expect(typedPrompt(`${pasted}\n\n照這個做`)).toBe('貼上的一段需求文字\n\n\n照這個做')
    expect(typedPrompt(pasted)).toBe('貼上的一段需求文字')
  })

  test('the title is the line the person typed, not the paste label', () => {
    expect(promptTitle(`${pasted}\n\n照這個做`)).toBe('照這個做')
    expect(promptTitle(pasted)).toBe('（貼上的內容）')
  })

  test('a closing tag of a longer name, or one that never ends, does not close the block', () => {
    expect(typedPrompt('<pasted_content>\n內容\n</pasted_contents>')).toBe('<pasted_content>\n內容\n</pasted_contents>')
    expect(typedPrompt('<system-reminder>\n提醒\n</system-reminder\n還在寫')).toBe('<system-reminder>\n提醒\n</system-reminder\n還在寫')
  })
})
