import type { DatabaseSync } from 'node:sqlite'
import { acknowledgeAgent, getAgentSession, unacknowledgeAgent } from '../db/agents'
import { transaction } from '../db/transaction'

/** How long marking sessions as seen can still be taken back, as with deleting a task. */
const UNDO_MS = 60_000

export interface AckUndo {
  /** Marks the sessions as seen; returns a token for `restore`. */
  acknowledge(db: DatabaseSync, ids: readonly string[], now: number): string
  /** Puts the marks back as they were; false when the undo window has passed. */
  restore(db: DatabaseSync, token: string): boolean
}

interface Kept {
  readonly at: number
  readonly before: readonly { readonly id: string; readonly acknowledgedAt: number | null }[]
}

/** 看過了 / 看完了 with one undo per press, however many sessions it marked. Kept in memory only. */
export function createAckUndo(clock: () => number = Date.now): AckUndo {
  const kept = new Map<string, Kept>()
  let seq = 0
  const prune = (): void => {
    const cutoff = clock() - UNDO_MS
    for (const [token, entry] of kept) if (entry.at < cutoff) kept.delete(token)
  }
  return {
    acknowledge(db, ids, now) {
      prune()
      const token = String(++seq)
      const before = transaction(db, () =>
        ids.flatMap((id) => {
          const session = getAgentSession(db, id)
          if (!session) return []
          acknowledgeAgent(db, id, now)
          return [{ id, acknowledgedAt: session.acknowledgedAt }]
        }),
      )
      kept.set(token, { at: now, before })
      return token
    },
    restore(db, token) {
      prune()
      const entry = kept.get(token)
      if (!entry) return false
      kept.delete(token)
      transaction(db, () => entry.before.forEach((b) => unacknowledgeAgent(db, b.id, entry.at, b.acknowledgedAt)))
      return true
    },
  }
}
