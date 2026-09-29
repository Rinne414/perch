import { useCallback, useEffect, useState } from 'react'
import type { MainPayload } from '@shared/ipc'

/** Relative labels ("3 天前", the day itself) need a periodic refresh even without changes. */
const REFRESH_MS = 60_000

export interface MainState {
  readonly payload: MainPayload | null
  /** Timestamp the payload was built at, for relative labels. */
  readonly at: number
  readonly error: string | null
}

export function useMain(): MainState {
  const [state, setState] = useState<MainState>({ payload: null, at: Date.now(), error: null })

  const load = useCallback(() => {
    window.api
      .getMain()
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
