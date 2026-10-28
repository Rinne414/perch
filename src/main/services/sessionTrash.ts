import type { DatabaseSync } from 'node:sqlite'
import { restoreAgentSession, takeAgentSession, type SessionSnapshot } from '../db/agents'

/** How long a session taken off the list can still be put back. */
const UNDO_MS = 60_000

export interface SessionTrash {
  remove(db: DatabaseSync, id: string): void
  /** False when the undo window has passed. */
  restore(db: DatabaseSync, id: string): boolean
}

/** Taking agent sessions off the list, with the same one-minute undo as deleting a task. Kept in memory only. */
export function createSessionTrash(clock: () => number = Date.now): SessionTrash {
  const kept = new Map<string, { readonly row: SessionSnapshot; readonly at: number }>()
  const prune = (): void => {
    const cutoff = clock() - UNDO_MS
    for (const [id, entry] of kept) if (entry.at < cutoff) kept.delete(id)
  }
  return {
    remove(db, id) {
      prune()
      kept.set(id, { row: takeAgentSession(db, id), at: clock() })
    },
    restore(db, id) {
      prune()
      const entry = kept.get(id)
      if (!entry) return false
      kept.delete(id)
      restoreAgentSession(db, entry.row)
      return true
    },
  }
}
