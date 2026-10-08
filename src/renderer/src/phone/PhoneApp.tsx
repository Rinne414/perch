import { useCallback, useEffect, useState } from 'react'
import { dayTitle } from '@shared/format'
import type { PhoneSnapshot } from '@shared/phone'
import { ApiError, call, messageOf, saveKey, storedKey } from './api'
import { NowView } from './NowView'
import { PairView, UnpairedView } from './PairView'

/** How often the page asks the computer while it is on screen; faster during the last minute. */
const POLL_MS = 5_000
const COUNTDOWN_POLL_MS = 2_000
const PAIR_HASH = /^#pair=([A-Za-z0-9_-]{10,64})$/

type Stage = { readonly kind: 'pair'; readonly code: string } | { readonly kind: 'unpaired' } | { readonly kind: 'ready' }

/** Reads a pairing code from the address and removes it at once, so it stays out of the history. */
function takePairCode(): string | null {
  const code = PAIR_HASH.exec(location.hash)?.[1] ?? null
  if (code) history.replaceState(null, '', '/')
  return code
}

function initialStage(): Stage {
  const code = takePairCode()
  if (code) return { kind: 'pair', code }
  return storedKey() ? { kind: 'ready' } : { kind: 'unpaired' }
}

interface Live {
  readonly snap: PhoneSnapshot | null
  readonly offset: number
  readonly problem: string | null
  readonly refresh: () => void
}

/** The computer's state, asked for while the page is visible; a removed phone goes back to unpaired. */
function useSnapshot(active: boolean, onUnpaired: () => void): Live {
  const [snap, setSnap] = useState<PhoneSnapshot | null>(null)
  const [offset, setOffset] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = useCallback(() => {
    call<PhoneSnapshot>('GET', '/api/state')
      .then((next) => {
        setSnap(next)
        setOffset(next.now - Date.now())
        setProblem(null)
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          saveKey(null)
          onUnpaired()
        } else setProblem(messageOf(err))
      })
  }, [onUnpaired])

  const counting = snap?.power.countdownEndsAt != null
  useEffect(() => {
    if (!active) return
    refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, counting ? COUNTDOWN_POLL_MS : POLL_MS)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, counting, refresh])

  return { snap, offset, problem, refresh }
}

function TopBar({ snap, problem }: { snap: PhoneSnapshot | null; problem: string | null }): React.JSX.Element {
  const title = snap ? dayTitle(snap.day) : null
  return (
    <header className="p-top">
      <span className="brand2">Perch</span>
      {title && (
        <span className="date">
          {title.date} {title.weekday}
        </span>
      )}
      {snap && (
        <span className={`p-conn${problem ? ' off' : ''}`}>
          <i />
          {problem ? '連不上' : snap.computer}
        </span>
      )}
    </header>
  )
}

export function PhoneApp(): React.JSX.Element {
  const [stage, setStage] = useState<Stage>(initialStage)
  const unpaired = useCallback(() => setStage({ kind: 'unpaired' }), [])

  // A QR code scanned while the page is already open only changes the #fragment, without a reload.
  useEffect(() => {
    const onHash = (): void => {
      const code = takePairCode()
      if (code) setStage({ kind: 'pair', code })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const live = useSnapshot(stage.kind === 'ready', unpaired)

  return (
    <main className="phone">
      <TopBar snap={stage.kind === 'ready' ? live.snap : null} problem={live.problem} />
      {stage.kind === 'pair' && <PairView code={stage.code} onDone={() => setStage({ kind: 'ready' })} />}
      {stage.kind === 'unpaired' && <UnpairedView />}
      {stage.kind === 'ready' &&
        (live.snap ? (
          <NowView snap={live.snap} offset={live.offset} problem={live.problem} refresh={live.refresh} />
        ) : (
          <div className="p-body">
            <p className={live.problem ? 'p-error' : 'p-hint'}>{live.problem ?? '正在連電腦…'}</p>
          </div>
        ))}
    </main>
  )
}
