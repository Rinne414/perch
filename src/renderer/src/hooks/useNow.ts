import { useCallback, useEffect, useState } from 'react'
import type { NowPayload } from '@shared/ipc'

/** Relative times ("5 分鐘") and the day boundary need a periodic refresh even without changes. */
const REFRESH_MS = 60_000

export interface NowState {
  readonly payload: NowPayload | null
  /** Timestamp the payload was built at, for relative time labels. */
  readonly at: number
  readonly error: string | null
}

export function useNow(): NowState {
  const [state, setState] = useState<NowState>({ payload: null, at: Date.now(), error: null })

  const load = useCallback(() => {
    window.api
      .getNow()
      .then((payload) => setState({ payload, at: Date.now(), error: null }))
      .catch((err: Error) => setState((s) => ({ ...s, error: err.message })))
  }, [])

  useEffect(() => {
    load()
    const off = window.api.onChanged(load)
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [load])

  return state
}
