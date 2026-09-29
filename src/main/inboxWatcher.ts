import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import type { AppContext } from './context'
import { ingestInbox } from './services/ingest'

/** Several hooks often fire within milliseconds; read them in one pass. */
const DEBOUNCE_MS = 120

/**
 * Picks up agent events as soon as they land. The scheduler also calls `drain`
 * on every tick, so a missed file-system notification only delays an event.
 */
export function watchInbox(ctx: AppContext, dir: string): { drain: () => void; close: () => void } {
  mkdirSync(dir, { recursive: true })
  const drain = (): void => {
    try {
      if (ingestInbox(ctx.db, dir, Date.now()).applied > 0) ctx.broadcast()
    } catch (err) {
      process.stderr.write(`Inbox ingest failed: ${(err as Error).message}\n`)
    }
  }
  let timer: NodeJS.Timeout | undefined
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(dir, () => {
      clearTimeout(timer)
      timer = setTimeout(drain, DEBOUNCE_MS)
    })
  } catch (err) {
    process.stderr.write(`Inbox watch unavailable, relying on the scheduler: ${(err as Error).message}\n`)
  }
  drain()
  return {
    drain,
    close: () => {
      clearTimeout(timer)
      watcher?.close()
    },
  }
}
