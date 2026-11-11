const MAX_TITLE = 160

/** What to show when a prompt holds nothing but a block the agent's app put there. */
const BLOCK_LABELS: Readonly<Record<string, string>> = {
  pasted_content: '（貼上的內容）',
  'task-notification': '（背景工作通知）',
  'system-reminder': '（系統提醒）',
  'command-name': '（指令）',
  'local-command-stdout': '（指令輸出）',
}
const OTHER_BLOCK = '（沒有文字）'

const PLACEHOLDERS: ReadonlySet<string> = new Set([...Object.values(BLOCK_LABELS), OTHER_BLOCK])

/** A title `promptTitle` made up for a prompt without words of the person's own, such as （背景工作通知）. */
export const isPlaceholderTitle = (title: string): boolean => PLACEHOLDERS.has(title)

const OPENING = /^<([A-Za-z][\w-]*)(?:\s[^>]*)?>/
const isTagLine = (line: string): boolean => OPENING.test(line) && line.endsWith('>')

/** Blocks the agent's app adds on its own: reminders, background task notices, slash-command echoes. */
const HARNESS_NAME = /^(?:system-reminder|task-notification|local-command-[\w-]+|command-(?:name|message|args))$/
const PASTED_NAME = 'pasted_content'
const NAME_CHAR = /[\w-]/
const SPACE = /\s/
/** Prompts the agent's app sends for someone else: another session's message, or the Esc key. */
const NOT_TYPED = [/^Another Claude session sent a message/, /^\[Request interrupted by user/]

/**
 * A closing tag may carry attributes: Claude Code writes `</pasted_content id="…">`. The `>` is
 * looked for only a little way and on the same line, so a stray `</name` costs next to nothing.
 */
const CLOSER_ATTR_LIMIT = 200

/** Where the closing tag whose name ends at `after` ends (just past its `>`); -1 when it is not one. */
function closerEnd(text: string, after: number): number {
  const next = text[after] ?? ''
  if (next !== '>' && !SPACE.test(next)) return -1
  const limit = Math.min(text.length, after + CLOSER_ATTR_LIMIT)
  for (let i = after; i < limit; i++) {
    if (text[i] === '>') return i + 1
    if (text[i] === '<' || text[i] === '\n') return -1
  }
  return -1
}

/** Whether `line` holds the closing tag of `tag`, with or without attributes. */
function closesOn(line: string, tag: string): boolean {
  const closer = `</${tag}`
  for (let at = line.indexOf(closer); at >= 0; at = line.indexOf(closer, at + 1)) {
    if (closerEnd(line, at + closer.length) >= 0) return true
  }
  return false
}

/**
 * The next index of `needle` at or after `from`. Asked with `from` that never goes back, it reuses
 * its last answer while that still holds, so a whole scan stays linear.
 */
function finder(text: string, needle: string): (from: number) => number {
  let asked = -1
  let found = -1
  return (from) => {
    if (asked >= 0 && from >= asked && (found === -1 || from <= found)) return found
    asked = from
    found = text.indexOf(needle, from)
    return found
  }
}

interface Span {
  readonly start: number
  readonly end: number
}

/** An opening tag at `lt`: its name and where it ends; null when there is no tag there. */
function openingAt(text: string, lt: number, nextGt: (from: number) => number): { name: string; end: number } | null {
  let i = lt + 1
  while (i < text.length && NAME_CHAR.test(text[i])) i++
  if (i === lt + 1 || !/[A-Za-z]/.test(text[lt + 1])) return null
  const name = text.slice(lt + 1, i)
  if (text[i] === '>') return { name, end: i + 1 }
  if (i >= text.length || !SPACE.test(text[i])) return null
  const gt = nextGt(i)
  return gt < 0 ? null : { name, end: gt + 1 }
}

/**
 * The first closing tag `</name>` (attributes allowed before the `>`) at or after `from`. Openers are met left to right, so `from`
 * only grows: an answer stays good while `from` has not passed it, and no closer is looked at twice.
 */
function closerFinder(text: string): (name: string, from: number) => Span | null {
  const memo = new Map<string, { asked: number; found: Span | null; next: (from: number) => number }>()
  return (name, from) => {
    const m = memo.get(name) ?? { asked: -1, found: null, next: finder(text, `</${name}`) }
    memo.set(name, m)
    if (m.asked >= 0 && from >= m.asked && (m.found === null || from <= m.found.start)) return m.found
    let at = m.next(from)
    let found: Span | null = null
    while (at >= 0 && !found) {
      const end = closerEnd(text, at + 2 + name.length)
      if (end >= 0) found = { start: at, end }
      else at = m.next(at + 1)
    }
    m.asked = from
    m.found = found
    return found
  }
}

/** Takes out (or, with `keepInner`, unwraps) every `<name …>…</name>` block whose name passes `is`. */
function stripBlocks(text: string, is: (name: string) => boolean, keepInner: boolean): string {
  const nextGt = finder(text, '>')
  const closer = closerFinder(text)
  let out = ''
  let from = 0
  let lt = text.indexOf('<')
  while (lt >= 0) {
    const open = openingAt(text, lt, nextGt)
    const close = open && is(open.name) ? closer(open.name, open.end) : null
    if (open && close) {
      out += text.slice(from, lt) + (keepInner ? text.slice(open.end, close.start) : '')
      from = close.end
      lt = text.indexOf('<', from)
    } else {
      lt = text.indexOf('<', lt + 1)
    }
  }
  return out + text.slice(from)
}

/**
 * What the person themselves typed or pasted into a prompt, whole; null when they typed nothing.
 * Claude Code also fires its prompt hook for background-task notices and messages from other
 * sessions: those are not the person's words. Pasted text is, so its inner text stays. It runs inside
 * the hook, so it reads the text once from start to end, whatever tags it is full of.
 */
export function typedPrompt(text: string): string | null {
  const withoutHarness = stripBlocks(text, (name) => HARNESS_NAME.test(name), false)
  const own = stripBlocks(withoutHarness, (name) => name === PASTED_NAME, true).trim()
  return own === '' || NOT_TYPED.some((pattern) => pattern.test(own)) ? null : own
}

/**
 * The line a person recognises a prompt by: its first line of their own words.
 * Blocks the agent's app wraps in tags (pasted text, background task notices) are skipped;
 * a prompt that is only such a block gets a short label instead of raw markup.
 * Also cleans titles stored before this existed, which may be a lone tag line.
 */
export function promptTitle(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  let open: string | null = null
  let firstBlock: string | null = null
  for (const line of lines) {
    if (open) {
      if (closesOn(line, open)) open = null
      continue
    }
    if (!line) continue
    const tag = OPENING.exec(line)?.[1]
    if (tag && (isTagLine(line) || !closesOn(line, tag))) {
      firstBlock ??= tag
      // A block that does not close on its own line runs until its closing tag.
      if (!closesOn(line, tag) && !line.endsWith('/>')) open = tag
      continue
    }
    return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line
  }
  return firstBlock ? (BLOCK_LABELS[firstBlock] ?? OTHER_BLOCK) : OTHER_BLOCK
}
