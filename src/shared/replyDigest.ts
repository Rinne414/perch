/**
 * What a final reply says, pulled out of its own sections without a model: its conclusion, what it
 * leaves for the person, and what it says is not verified. Agents that end a turn with a report
 * mostly write those under headings (結論, 需要你做的事, 還沒驗證的, TL;DR, Next steps); this reads
 * them. A reply without such headings still gives its first paragraph as the conclusion.
 */
export interface ReplyDigest {
  /** The reply's conclusion as plain text, lines kept; null for an empty reply. */
  readonly conclusion: string | null
  /** True when the reply names its conclusion (結論, TL;DR); false when this is only how it opens. */
  readonly conclusionFromSection: boolean
  /**
   * What the reply leaves for the person to do or decide, one entry per point.
   * `'none'` when the reply has such a section and it says there is nothing;
   * `null` when the reply has no such section at all (unknown, which is not the same as nothing).
   */
  readonly todos: readonly string[] | 'none' | null
  /**
   * What the reply says not to take whole: not verified, a known problem, something to watch.
   * Empty when its section says there is nothing; null when it has no such section.
   */
  readonly unverified: readonly string[] | null
}

export const EMPTY_DIGEST: ReplyDigest = { conclusion: null, conclusionFromSection: false, todos: null, unverified: null }

export type Kind = 'conclusion' | 'todos' | 'unverified'

/** A heading line: Markdown hashes (1 to 6), or a bold or plain label on its own line (7). */
interface Heading {
  readonly level: number
  readonly title: string
  /** Text on the heading's own line, after its colon: "結論：改好了". */
  readonly inline: string
}

interface Section extends Heading {
  readonly lines: string[]
}

const LABEL_LEVEL = 7
/** A bold line longer than this is a sentence set in bold, not a label. */
const MAX_LABEL = 24
/** A plain "label：" line is shorter still: longer ones are sentences that happen to hold a colon. */
const MAX_PLAIN_LABEL = 16
const MAX_ITEM = 240
const MAX_CONCLUSION = 900
const MAX_FALLBACK = 400
const FALLBACK_ITEMS = 3

const BULLET = /^(?:[-*+•]|\d{1,3}[.)、])\s+/

/*
 * The three title patterns were tuned on 233 real final replies from one person's Claude Code
 * sessions (2026-11): 23% name a conclusion, 21% have a section left for the person, 27% one not
 * to take whole, 52% at least one. Titles the patterns got wrong on the way are in the tests.
 */
/** Not verified, a known problem, or something to watch: what tells the reader not to take the result whole. */
const UNVERIFIED =
  /(?:沒有|沒|未|尚未|還沒|没有|没)(?:被)?(?:驗證|验证|測試|测试|測過|跑過|確認)|not (?:yet )?(?:been )?(?:verified|tested)|unverified|untested|known (?:issues?|problems?|limitations?|gaps?)|已知(?:的)?(?:問題|限制|缺陷)|caveats?|limitations|^限制$|要注意|要留意|注意事項/i
const TODOS =
  /需要你|要你|請你|等你|待你|留給你|給你的|你(?:現在|還)?(?:需要|要|得|該|必須)?(?:做|決定|確認|處理|選|檢查|看一下|說一聲)|下一步|^(?:接下來|後續)(?:的事|要做的事?)?$|待辦|驗收|怎麼(?:試|測|驗)|next steps?|action (?:items?|required|needed)|to-?dos?\b|what (?:you|i need you)|you (?:need|must|should|have) to|your (?:turn|call|decision|action|next)|follow[- ]?ups?|needs? (?:your|you)\b|for you to|on your (?:side|end)|how to (?:test|verify|check)|acceptance check/i
/**
 * Not left for the person: the agent's own plan ("接下來我會…"), what it decided for them
 * ("我替你決定的"), and anything already done or checked ("驗收結果", "已完成", "你做的修改").
 */
const NOT_FOR_THE_PERSON =
  /我(?:會|要|將|打算|來)|替你|幫你|結果|通過|已(?:經|驗收|完成|處理|做)|完成了?$|(?<!要|請|等|待)你(?:做|問|說|改)的|怎麼(?:試|測|驗)的|\bI(?:'ll| will| plan| am going| took| did| made)\b|\bwhat you asked\b|\b(?:done|completed)\b/i
const CONCLUSION = /tl;?\s?dr|結論|结论|總結|总结|摘要|一句話|簡單說|簡單講|總之|重點整理|^重點$|\bsummary\b|\bconclusion\b|bottom line|in short|^結果$|^results?$|^outcome$/i

/** Which of the three a heading title names, if any. */
export function kindOf(title: string): Kind | null {
  if (UNVERIFIED.test(title)) return 'unverified'
  if (TODOS.test(title) && !NOT_FOR_THE_PERSON.test(title)) return 'todos'
  if (CONCLUSION.test(title)) return 'conclusion'
  return null
}

/** Inline Markdown taken off; every pattern is bounded, so a hostile line cannot stall it. */
function plain(text: string): string {
  return text
    .replace(/<br\s?\/?>/gi, ' ')
    .replace(/!?\[([^\]\n]{0,300})\]\([^)\n]{0,2000}\)/g, '$1')
    .replace(/\*\*([^*\n]{1,400})\*\*/g, '$1')
    .replace(/__([^_\n]{1,400})__/g, '$1')
    .replace(/`([^`\n]{1,400})`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const isColon = (c: string | undefined): boolean => c === ':' || c === '：'

function withoutEndColon(text: string): string {
  const t = text.trimEnd()
  return isColon(t[t.length - 1]) ? t.slice(0, -1).trimEnd() : t
}

/** Leading quote marks ("> ") taken off. */
function unquoted(line: string): string {
  let t = line.trim()
  while (t.startsWith('>')) t = t.slice(1).trimStart()
  return t
}

function hashHeading(t: string): Heading | null {
  let n = 0
  while (n < t.length && n < 7 && t[n] === '#') n++
  if (n === 0 || n > 6) return null
  if (n < t.length && t[n] !== ' ' && t[n] !== '\t') return null
  let end = t.length
  while (end > n && (t[end - 1] === '#' || t[end - 1] === ' ' || t[end - 1] === '\t')) end--
  const title = plain(t.slice(n, end))
  // "## 結論：改好了" keeps its words as the section's first line.
  const colon = firstColon(title)
  if (colon > 0 && colon < title.length - 1 && kindOf(title.slice(0, colon)) !== null) {
    return { level: n, title: title.slice(0, colon).trim(), inline: title.slice(colon + 1).trim() }
  }
  return { level: n, title: withoutEndColon(title), inline: '' }
}

function firstColon(text: string): number {
  const limit = Math.min(text.length, MAX_LABEL + 1)
  for (let i = 0; i < limit; i++) if (isColon(text[i])) return i
  return -1
}

const SENTENCE_END = /[。.!！?？]$/

/** "**結論**", "**結論：** 改好了", "**結論**：改好了". A bold sentence is not a label. */
function boldHeading(t: string): Heading | null {
  if (!t.startsWith('**')) return null
  const close = t.indexOf('**', 2)
  if (close < 0) return null
  const inner = t.slice(2, close).trim()
  const label = withoutEndColon(inner)
  const rest = t.slice(close + 2).trim()
  if (label === '' || label.length > MAX_LABEL) return null
  if (label !== inner) return { level: LABEL_LEVEL, title: plain(label), inline: plain(rest) }
  if (rest === '') return SENTENCE_END.test(label) ? null : { level: LABEL_LEVEL, title: plain(label), inline: '' }
  return isColon(rest[0]) ? { level: LABEL_LEVEL, title: plain(label), inline: plain(rest.slice(1)) } : null
}

/** "結論：改好了", "Next steps:", and a bare "TL;DR": only labels this file knows. */
function plainLabel(t: string): Heading | null {
  const colon = firstColon(t)
  if (colon < 0) return /^tl;?\s?dr$/i.test(t) ? { level: LABEL_LEVEL, title: t, inline: '' } : null
  const label = t.slice(0, colon).trim()
  if (label === '' || label.length > MAX_PLAIN_LABEL || BULLET.test(t) || t.startsWith('|') || kindOf(label) === null) return null
  return { level: LABEL_LEVEL, title: label, inline: plain(t.slice(colon + 1)) }
}

const isFence = (t: string): boolean => t.startsWith('```') || t.startsWith('~~~')

/** The reply as sections; text before the first heading is a section with an empty title. Code is left out. */
function sectionsOf(reply: string): Section[] {
  const sections: Section[] = [{ level: 0, title: '', inline: '', lines: [] }]
  let fenced = false
  for (const raw of reply.split(/\r?\n/)) {
    const t = unquoted(raw)
    if (isFence(t)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const heading = hashHeading(t) ?? boldHeading(t) ?? plainLabel(t)
    if (heading) sections.push({ ...heading, lines: [] })
    else sections[sections.length - 1].lines.push(raw)
  }
  return sections
}

const CHECKED = /^\[[xX✓]\]\s*/
const UNCHECKED = /^\[\s?\]\s*/
const RULE = /^[-*_=]{3,}$/

const indentOf = (line: string): number => line.length - line.trimStart().length

function tableCells(t: string): string[] | null {
  if (!t.startsWith('|')) return null
  const cells = t.split('|').map((c) => c.trim())
  return cells.slice(1, cells[cells.length - 1] === '' ? -1 : undefined)
}

const isSeparatorRow = (cells: readonly string[]): boolean => cells.every((c) => c !== '' && /^:?-{1,}:?$/.test(c))

/**
 * The points a section makes: its top-level list items, table rows and paragraphs, in order.
 * Nested bullets are details and stay out; a ticked box is done and stays out; a line that only
 * introduces the list ("以下三件事：") is not a point.
 */
function pointsOf(lines: readonly string[]): string[] {
  const points: string[] = []
  let current: string[] | null = null
  let currentIsList = false
  let top = -1
  let headerRow = true
  /** Inside a nested or ticked item: the lines that follow it are not points either. */
  let skipping = false
  const close = (): void => {
    if (current) points.push(current.join(' '))
    current = null
    skipping = false
  }
  for (const raw of lines) {
    const t = unquoted(raw)
    if (t === '' || RULE.test(t)) {
      close()
      headerRow = true
      continue
    }
    const cells = tableCells(t)
    if (cells) {
      close()
      if (!isSeparatorRow(cells) && !headerRow) points.push(cells.filter(Boolean).join('，'))
      headerRow = false
      continue
    }
    const bullet = BULLET.exec(t)
    if (bullet) {
      const indent = indentOf(raw)
      if (top < 0 || indent < top) top = indent
      if (indent > top + 1) {
        skipping = true
        continue
      }
      // A paragraph ending in a colon right before a list only introduces it.
      if (current && !currentIsList && isColon(current[current.length - 1].trimEnd().slice(-1))) current = null
      close()
      const body = t.slice(bullet[0].length)
      if (CHECKED.test(body)) {
        skipping = true
        continue
      }
      current = [body.replace(UNCHECKED, '')]
      currentIsList = true
      continue
    }
    if (skipping) continue
    if (current) current.push(t)
    else {
      current = [t]
      currentIsList = false
    }
  }
  close()
  // Shortened, then told apart: two points that read the same on screen are one row, not two.
  return [...new Set(points.map((p) => cut(plain(p), MAX_ITEM)).filter((p) => p !== ''))]
}

const NOTHING = new Set([
  '沒有',
  '没有',
  '無',
  '沒有了',
  '沒事',
  '不用',
  '不需要',
  '目前沒有',
  '暫時沒有',
  '現在沒有',
  '這次沒有',
  'none',
  'nothing',
  'n/a',
  'no',
  'no action needed',
  'no action required',
  'nothing needed',
  'nothing required',
])
const BUT = /但|不過|可是|只是|除了|but|except|however/i
const NOTHING_FOR_YOU =
  /^(?:目前|現在|暫時|這次)?(?:沒有|不需要|不用|無須)[^，。,.；;]{0,14}(?:你|您)[^，。,.；;]{0,12}[。.！!]?$|^(?:no|nothing)\b[^.]{0,40}\b(?:needed|required|from you|for you|to do)\b\.?$/i
const MAX_NOTHING = 30

/** The one point of a section says there is nothing: "沒有。", "沒有，你什麼都不用做。", "Nothing needed from you." */
function saysNothing(points: readonly string[]): boolean {
  if (points.length !== 1) return false
  const text = points[0]
  if (text.length > MAX_NOTHING + 20 || BUT.test(text)) return false
  if (NOTHING_FOR_YOU.test(text)) return true
  const head = text.split(/[，。,.；;：:！!]/)[0].trim().toLowerCase()
  return NOTHING.has(head) && text.length <= MAX_NOTHING
}

/** The lines up to the first blank one: the rest of the paragraph a label's own text starts. */
function untilBlank(lines: readonly string[]): string[] {
  const end = lines.findIndex((l) => l.trim() === '')
  return end < 0 ? [...lines] : lines.slice(0, end)
}

/**
 * The first block under a label: up to the first blank line, or a whole list even when its items
 * are spaced out. A label has no end of its own, so what follows that block is other text.
 */
function firstBlock(lines: readonly string[]): string[] {
  const out: string[] = []
  let listed = false
  let gap = false
  for (const raw of lines) {
    const t = unquoted(raw)
    if (t === '') {
      gap = out.length > 0
      continue
    }
    const bullet = BULLET.test(t)
    if (gap && !(listed && (bullet || indentOf(raw) > 0))) break
    if (gap) out.push('')
    gap = false
    listed ||= bullet
    out.push(raw)
  }
  return out
}

/** A section's own lines: a hash heading owns everything up to the next heading, a label its first block. */
function bodyOf(s: Section): readonly string[] {
  if (s.level !== LABEL_LEVEL) return s.lines
  return s.inline === '' ? firstBlock(s.lines) : untilBlank(s.lines)
}

/** A section's lines with those of the sub-sections under it that are not a kind of their own. */
function withSubsections(sections: readonly Section[], index: number): string[] {
  // Plain loops: a section can hold a million lines, more than a call can take as arguments.
  const lines = [...bodyOf(sections[index])]
  for (let i = index + 1; i < sections.length && sections[i].level > sections[index].level; i++) {
    if (kindOf(sections[i].title) !== null) continue
    lines.push('')
    for (const line of bodyOf(sections[i])) lines.push(line)
  }
  return lines
}

function gather(sections: readonly Section[], kind: Kind): string[] | null {
  let found = false
  const points: string[] = []
  sections.forEach((s, i) => {
    // "下一步：我會先跑測試" is the agent's own plan, not something left for the person.
    if (kindOf(s.title) !== kind || (kind === 'todos' && NOT_FOR_THE_PERSON.test(s.inline))) return
    found = true
    for (const point of pointsOf([s.inline, ...withSubsections(sections, i)])) points.push(point)
  })
  // A section with nothing readable under it (only code, say) is unknown, not "nothing".
  return found && points.length > 0 ? [...new Set(points)] : null
}

function joinedWithin(points: readonly string[], max: number): string | null {
  let out = ''
  for (const p of points) {
    const next = out === '' ? p : `${out}\n${p}`
    if (next.length > max) return out === '' ? cut(p, max) : `${out}\n…`
    out = next
  }
  return out === '' ? null : out
}

/** Without a conclusion section: the first thing the reply says (a paragraph, or the start of a list). */
function openingOf(sections: readonly Section[]): string | null {
  for (const s of sections) {
    if (kindOf(s.title) !== null) continue
    // A short bold line no rule knows ("**修好了**") is still the reply talking.
    const said = s.level === LABEL_LEVEL ? [s.title, s.inline] : [s.inline]
    const points = pointsOf([...said, ...bodyOf(s)])
    if (points.length === 0) continue
    const startsWithList = said.every((line) => line === '') && BULLET.test(unquoted(firstText(s.lines)))
    return joinedWithin(points.slice(0, startsWithList ? FALLBACK_ITEMS : 1), MAX_FALLBACK)
  }
  return null
}

const firstText = (lines: readonly string[]): string => lines.find((l) => l.trim() !== '') ?? ''

/** Reads a reply once, line by line; safe on any text an agent can send. */
export function digestReply(reply: string | null): ReplyDigest {
  if (reply === null || reply.trim() === '') return EMPTY_DIGEST
  const sections = sectionsOf(reply)
  const concluded = sections.find((s) => kindOf(s.title) === 'conclusion')
  // A heading that carries its conclusion ("## 結論：可以發了") has said it; what follows elaborates.
  const concludedLines = concluded && (concluded.inline === '' ? bodyOf(concluded) : [concluded.inline, ...untilBlank(concluded.lines)])
  const conclusion = concludedLines ? joinedWithin(pointsOf(concludedLines), MAX_CONCLUSION) : null
  const todos = gather(sections, 'todos')
  const unverified = gather(sections, 'unverified')
  return {
    conclusion: conclusion ?? openingOf(sections),
    conclusionFromSection: conclusion !== null,
    todos: todos === null ? null : saysNothing(todos) ? 'none' : todos,
    unverified: unverified === null ? null : saysNothing(unverified) ? [] : unverified,
  }
}
