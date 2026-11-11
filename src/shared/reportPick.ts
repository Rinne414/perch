/** What the pick needs to know about one turn, oldest first. */
export interface TurnShape {
  readonly id: number
  /** The person typed this turn's prompt. */
  readonly typed: boolean
  /** Characters of its reply; 0 when it has none. */
  readonly replyLength: number
}

/** Without any typed prompt, this many of the latest turns are looked at. */
const UNTYPED_LOOKBACK = 8

/**
 * Which turn holds a session's report. Not simply the latest reply: a background notice often
 * makes the agent answer again with one line after its real final report. So: among the turns
 * from the last typed prompt onward, the longest reply, a tie going to the later one. When that
 * round has no reply yet (the agent is still working on it), the round before it counts. A
 * session without typed prompts uses its last 8 turns. Null when there is no reply at all.
 */
export function pickReportTurn(turns: readonly TurnShape[]): number | null {
  const typed = turns.flatMap((t, i) => (t.typed ? [i] : []))
  const rounds = typed.length ? typed : [Math.max(0, turns.length - UNTYPED_LOOKBACK)]
  for (let r = rounds.length - 1; r >= 0; r--) {
    const end = r + 1 < rounds.length ? rounds[r + 1] : turns.length
    let best: number | null = null
    let bestLength = 0
    for (let i = rounds[r]; i < end; i++) {
      if (turns[i].replyLength > 0 && turns[i].replyLength >= bestLength) {
        best = turns[i].id
        bestLength = turns[i].replyLength
      }
    }
    if (best !== null) return best
  }
  return null
}

/**
 * The text of a session's report among its whole turns, trimmed; null without any reply. It picks
 * from the stored lengths, as the briefing's query does, so both always land on the same turn.
 */
export function reportText(turns: readonly { id: number; prompt: string | null; reply: string | null; replyLen: number }[]): string | null {
  const id = pickReportTurn(turns.map((t) => ({ id: t.id, typed: t.prompt !== null, replyLength: t.replyLen })))
  return turns.find((t) => t.id === id)?.reply?.trim() ?? null
}
