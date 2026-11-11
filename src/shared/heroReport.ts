import { shortSpan } from './spans'

/** What the first line points at, for its colour. */
export type HeroTone = 'wait' | 'fail' | 'done' | 'run' | 'none'

/** The two spoken lines at the top of the briefing. */
export interface HeroReport {
  /** Who to look at first and why; the counters beside it carry the counts. */
  readonly line1: string
  readonly tone: HeroTone
  /** What the reports leave and the pile, only the parts that apply; null when none do. */
  readonly line2: string | null
}

export interface HeroWaiting {
  readonly name: string
  readonly since: number
  readonly failed: boolean
  /** What it asks, or for a failed one what went wrong. */
  readonly ask: string | null
}

export interface HeroInput {
  readonly now: number
  /** The sessions in 等你決定, longest waiting first. */
  readonly waiting: readonly HeroWaiting[]
  readonly done: number
  readonly running: number
  /** The name of the first finished session. */
  readonly firstDone: string | null
  /** Open points the reports leave for the person. */
  readonly todoCount: number
  /** The 放著沒接 pile. */
  readonly pile: { readonly count: number; readonly oldestAt: number; readonly failed: number } | null
}

/** An ask is cut near this many characters; the card has it whole. */
export const ASK_CUT = 60
const ENDS_SENTENCE = /[。？！?!…]$/
export const NOTHING_RUNNING = '現在沒有 agent 在跑，也沒有在等你的。'

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** "：{ask}。" with the ask folded to one line and cut; empty without an ask. */
function saying(ask: string | null): string {
  const flat = ask?.replace(/\s+/g, ' ').trim()
  if (!flat) return '。'
  const short = cut(flat, ASK_CUT)
  return `：${short}${ENDS_SENTENCE.test(short) ? '' : '。'}`
}

function waitingLine(waiting: readonly HeroWaiting[], now: number): string {
  const first = waiting[0]
  if (first.failed) return `「${first.name}」失敗了${saying(first.ask)}`
  const age = shortSpan(now - first.since)
  if (waiting.length > 1) return `先看「${first.name}」，它等最久，${age}了${saying(first.ask)}`
  return `「${first.name}」在等你，${age}了${saying(first.ask)}`
}

function line1Of(input: HeroInput): Pick<HeroReport, 'line1' | 'tone'> {
  if (input.waiting.length) return { line1: waitingLine(input.waiting, input.now), tone: input.waiting[0].failed ? 'fail' : 'wait' }
  if (input.done > 0 && input.firstDone) {
    return { line1: `沒有 agent 在等你。${input.done} 個做完了，先看「${input.firstDone}」的報告。`, tone: 'done' }
  }
  if (input.running > 0) return { line1: `沒有 agent 在等你，${input.running} 個還在跑。`, tone: 'run' }
  return { line1: NOTHING_RUNNING, tone: 'none' }
}

function pileSentence(pile: NonNullable<HeroInput['pile']>, now: number): string {
  const age = shortSpan(now - pile.oldestAt)
  if (pile.count === 1) return `另外有 1 個放著沒接，放了 ${age}${pile.failed ? '，是失敗後沒處理' : ''}。`
  const failed = pile.failed === 0 ? '' : pile.failed === pile.count ? '，都是失敗後沒處理' : `，其中 ${pile.failed} 個是失敗後沒處理`
  return `另外有 ${pile.count} 個放著沒接，最久的放了 ${age}${failed}。`
}

/**
 * The report spoken at the top: line 1 says who to look at first (the one waiting longest, else
 * the first finished report); line 2 adds what the reports leave for the person and the pile.
 */
export function heroReport(input: HeroInput): HeroReport {
  const parts = [
    input.todoCount > 0 ? `報告裡留給你 ${input.todoCount} 件事。` : '',
    input.pile && input.pile.count > 0 ? pileSentence(input.pile, input.now) : '',
  ].filter(Boolean)
  return { ...line1Of(input), line2: parts.length ? parts.join('') : null }
}
