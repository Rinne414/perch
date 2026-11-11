/** Quotes of the person's prompts and single reply lines are cut here; the full record has them whole. */
const MAX_QUOTE = 280
const MAX_LINE = 200

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** One Markdown mark at the start of a line: a heading's hashes, a quote, a list bullet or number. */
const LEADING_MARK = /^(?:#{1,6}(?=\s|$)|>|[-*+](?=\s)|\d+[.)](?=\s))\s*/
const HEADING = /^(?:>\s*)*#{1,6}(?:\s|$)/
const RULE = /^[-*_=`]{3,}$/

/** A line without its leading marks, however many are stacked ("> ## ", "- **…**"). */
function withoutMarks(line: string): string {
  let rest = line.trim()
  for (let before = ''; before !== rest; ) {
    before = rest
    rest = rest.replace(LEADING_MARK, '')
  }
  return rest.replace(/^\*\*(.+?)\*\*/, '$1').trim()
}

/**
 * The line a reply is recognised by: the first line with words in it, without Markdown marks.
 * A heading ("## 結論") names a section rather than saying anything, so the first line under
 * it wins; a reply of headings only gives its first heading. Null for empty text.
 */
export function firstLineOf(text: string | null): string | null {
  if (text === null) return null
  let heading: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = withoutMarks(raw)
    if (!line || RULE.test(line)) continue
    if (!HEADING.test(raw.trim())) return cut(line, MAX_LINE)
    heading ??= line
  }
  return heading === null ? null : cut(heading, MAX_LINE)
}

/** A prompt as one quoted line: white space folded, long ones shortened. */
export function quoteOf(text: string | null): string | null {
  if (text === null) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat ? cut(flat, MAX_QUOTE) : null
}
