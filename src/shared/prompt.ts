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

const OPENING = /^<([A-Za-z][\w-]*)(?:\s[^>]*)?>/
const isTagLine = (line: string): boolean => OPENING.test(line) && line.endsWith('>')

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
      if (line.includes(`</${open}>`)) open = null
      continue
    }
    if (!line) continue
    const tag = OPENING.exec(line)?.[1]
    if (tag && (isTagLine(line) || !line.includes(`</${tag}>`))) {
      firstBlock ??= tag
      // A block that does not close on its own line runs until its closing tag.
      if (!line.includes(`</${tag}>`) && !line.endsWith('/>')) open = tag
      continue
    }
    return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line
  }
  return firstBlock ? (BLOCK_LABELS[firstBlock] ?? OTHER_BLOCK) : OTHER_BLOCK
}
