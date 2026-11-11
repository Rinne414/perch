import { useCallback, useEffect, useRef, useState } from 'react'
import type { BriefingPayload } from '@shared/briefing'
import { coalesce } from '@shared/coalesce'

/** Ages and durations ("等了 3 分") move on even when nothing reports. */
const REFRESH_MS = 60_000

export interface BriefingState {
  readonly briefing: BriefingPayload | null
  readonly error: string | null
  readonly reload: () => void
}

/** "Error invoking remote method 'briefing:get': Error: disk I/O error" reads as "disk I/O error". */
export const reasonOf = (message: string): string => message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '') || message

/**
 * The briefing, refreshed whenever the other tabs refresh and once a minute. One request at a
 * time: changes that arrive while one is out end in exactly one more read after it.
 */
export function useBriefing(): BriefingState {
  const [state, setState] = useState<Omit<BriefingState, 'reload'>>({ briefing: null, error: null })
  const run = useRef<() => void>(() => undefined)

  useEffect(() => {
    const loader = coalesce(() =>
      window.api
        .getBriefing()
        .then((briefing) => setState({ briefing, error: null }))
        .catch((err: Error) => setState((s) => ({ ...s, error: reasonOf(err.message) }))),
    )
    run.current = loader.run
    loader.run()
    const off = window.api.onChanged(loader.run)
    const timer = setInterval(loader.run, REFRESH_MS)
    return () => {
      loader.stop()
      off()
      clearInterval(timer)
    }
  }, [])

  const reload = useCallback(() => run.current(), [])
  return { ...state, reload }
}
