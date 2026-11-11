/**
 * Just enough Markdown to read an agent's reply: headings, list items, bold, inline code, code
 * fences and tables. Everything else stays the literal text it was. The result is plain data,
 * so a view builds elements from it and nothing is ever parsed as HTML.
 */

export interface InlinePart {
  readonly kind: 'text' | 'bold' | 'code'
  readonly text: string
}

/** How a table column lines up, from its separator cell (":---", "---:", ":---:"); null when not set. */
export type CellAlign = 'left' | 'center' | 'right' | null
export type TableCell = readonly InlinePart[]

export type MarkdownBlock =
  | { readonly kind: 'heading'; readonly parts: readonly InlinePart[] }
  /** A table with a separator row: every row has as many cells as the header. */
  | {
      readonly kind: 'table'
      readonly align: readonly CellAlign[]
      readonly header: readonly TableCell[]
      readonly rows: readonly (readonly TableCell[])[]
    }
  /** A list item; `depth` 0 is the outer list. */
  | { readonly kind: 'item'; readonly marker: string; readonly depth: number; readonly parts: readonly InlinePart[] }
  /** A code fence, or pipe lines without a separator row, kept as monospace text. */
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'line'; readonly parts: readonly InlinePart[] }
  /** One or more empty lines. */
  | { readonly kind: 'gap' }

const INLINE = /\*\*([^*\n]+?)\*\*|`([^`\n]+)`/g

export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) })
    parts.push(m[1] !== undefined ? { kind: 'bold', text: m[1] } : { kind: 'code', text: m[2] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

// Every pattern here is anchored and has no two quantifiers that can trade the same characters,
// so it runs in time linear in the line; heading ends and table separators are cut by string code.
const FENCE = /^\s*(`{3,}|~{3,})/
const HEADING_START = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/
const SEPARATOR_CELL = /^:?-{3,}:?$/
/** A cell of a table's separator row: one or more dashes, a colon on either side for alignment. */
const ALIGN_CELL = /^:?-+:?$/
const MAX_DEPTH = 4

/** A heading's text: what follows the hashes, without trailing spaces or a closing run of hashes. */
function headingText(line: string): string | null {
  const start = HEADING_START.exec(line)
  if (!start) return null
  let text = line.slice(start[0].length).trimEnd()
  let end = text.length
  while (end > 0 && text[end - 1] === '#') end--
  // A closing run of hashes counts only when a space (or nothing) comes before it.
  if (end < text.length && (end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t')) text = text.slice(0, end).trimEnd()
  return text
}

/** "|---|:---:|" or "--- | ---": two or more cells of dashes, with optional colons. */
function isTableSeparator(line: string): boolean {
  const cells = line.trim().split('|')
  if (cells[0].trim() === '') cells.shift()
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.length >= 2 && cells.every((cell) => SEPARATOR_CELL.test(cell.trim()))
}

const isTableRow = (line: string | undefined): boolean => line !== undefined && line.includes('|')
const startsTable = (lines: readonly string[], i: number): boolean =>
  lines[i].trimStart().startsWith('|') || (isTableRow(lines[i]) && isTableSeparator(lines[i + 1] ?? ''))

/** Lines from `from` up to the closing fence (or the end), and where reading goes on. */
function readFence(lines: readonly string[], from: number, fence: string): { text: string; next: number } {
  const body: string[] = []
  let i = from + 1
  for (; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith(fence)) return { text: body.join('\n'), next: i + 1 }
    body.push(lines[i])
  }
  return { text: body.join('\n'), next: i }
}

const BACKSLASH = String.fromCharCode(92)

/**
 * A row's cells, trimmed. A pipe on the outer edge is not a cell border; a backslash before a pipe
 * makes it part of the cell. One pass over the line, so 100,000 pipes split as fast as a short row.
 */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let start = 0
  let cell = ''
  for (let i = 0; i < line.length; i++) {
    if (line[i] === BACKSLASH && line[i + 1] === '|') {
      cell += line.slice(start, i) + '|'
      start = i + 2
      i++
    } else if (line[i] === '|') {
      cells.push(cell + line.slice(start, i))
      cell = ''
      start = i + 1
    }
  }
  cells.push(cell + line.slice(start))
  const trimmed = cells.map((c) => c.trim())
  const from = trimmed.length > 1 && trimmed[0] === '' ? 1 : 0
  const to = trimmed.length - from > 1 && trimmed[trimmed.length - 1] === '' ? trimmed.length - 1 : trimmed.length
  return trimmed.slice(from, to)
}

/** The alignments of a separator row with `columns` cells; null when the line is not one. */
function alignments(line: string, columns: number): CellAlign[] | null {
  if (!line.includes('|')) return null
  const cells = splitRow(line)
  if (cells.length !== columns || !cells.every((c) => ALIGN_CELL.test(c))) return null
  return cells.map((c) => (c.startsWith(':') ? (c.endsWith(':') ? 'center' : 'left') : c.endsWith(':') ? 'right' : null))
}

/** Cells to the header's count: a short row gets empty cells, a long one loses the extra. */
const fit = (cells: readonly string[], columns: number): TableCell[] =>
  Array.from({ length: columns }, (_, k) => parseInline(cells[k] ?? ''))

/** A header row, its separator row and the rows under it; null when line `from` does not start one. */
function readGrid(lines: readonly string[], from: number): { block: MarkdownBlock; next: number } | null {
  if (!isTableRow(lines[from]) || from + 1 >= lines.length) return null
  const header = splitRow(lines[from])
  const align = alignments(lines[from + 1], header.length)
  if (!align) return null
  let i = from + 2
  const rows: TableCell[][] = []
  for (; i < lines.length && isTableRow(lines[i]) && lines[i].trim() !== ''; i++) rows.push(fit(splitRow(lines[i]), header.length))
  return { block: { kind: 'table', align, header: fit(header, header.length), rows }, next: i }
}

function readTable(lines: readonly string[], from: number): { text: string; next: number } {
  let i = from
  while (i < lines.length && isTableRow(lines[i]) && lines[i].trim() !== '') i++
  return { text: lines.slice(from, i).join('\n'), next: i }
}

function lineBlock(line: string): MarkdownBlock {
  const heading = headingText(line)
  if (heading !== null) return { kind: 'heading', parts: parseInline(heading) }
  const item = ITEM.exec(line)
  if (item) {
    const depth = Math.min(MAX_DEPTH, Math.floor(item[1].replace(/\t/g, '  ').length / 2))
    const marker = /\d/.test(item[2]) ? item[2] : '•'
    return { kind: 'item', marker, depth, parts: parseInline(item[3]) }
  }
  return { kind: 'line', parts: parseInline(line) }
}

export function parseMarkdown(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0
  while (i < lines.length) {
    const grid = readGrid(lines, i)
    if (grid) {
      blocks.push(grid.block)
      i = grid.next
      continue
    }
    const fence = FENCE.exec(lines[i])
    if (fence || startsTable(lines, i)) {
      const read = fence ? readFence(lines, i, fence[1]) : readTable(lines, i)
      blocks.push({ kind: 'code', text: read.text })
      i = read.next
      continue
    }
    if (lines[i].trim() === '') {
      if (blocks.length > 0 && blocks.at(-1)!.kind !== 'gap') blocks.push({ kind: 'gap' })
    } else {
      blocks.push(lineBlock(lines[i]))
    }
    i++
  }
  return blocks.at(-1)?.kind === 'gap' ? blocks.slice(0, -1) : blocks
}
