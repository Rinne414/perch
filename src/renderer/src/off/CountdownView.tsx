import { useEffect, useRef } from 'react'
import { countdownReason } from '@shared/power'
import { PowerIcon } from '../components/Icons'
import { usePower, useTick } from '../components/Power'
import './countdown.css'

const TICK_MS = 250
const SECOND_MS = 1_000

const cancel = (): void => void window.api.cancelShutdown()

/**
 * The last minute before Perch shuts the computer down. 取消關機 has the focus and Esc also
 * cancels, so stray keys can only ever stop the shutdown.
 */
export function CountdownView(): React.JSX.Element {
  const state = usePower()
  const now = useTick(TICK_MS)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const counting = state?.plan != null && state.countdownEndsAt !== null

  useEffect(() => {
    if (counting) cancelRef.current?.focus()
  }, [counting])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The main process closes this window as soon as the countdown stops.
  if (!state?.plan || state.countdownEndsAt === null) return <main className="offw" />

  const leftMs = Math.max(0, state.countdownEndsAt - now)
  const done = Math.min(1, 1 - leftMs / state.minuteMs)
  return (
    <main className="offw" role="alertdialog" aria-label="即將關機" aria-describedby="off-why">
      <div className="hd">
        <PowerIcon size={16} />
        Perch 要關機了
      </div>
      <div className="big">
        {Math.ceil(leftMs / SECOND_MS)}
        <small>秒後</small>
      </div>
      <div className="ring">
        <i style={{ width: `${Math.round(done * 100)}%` }} />
      </div>
      <p className="why" id="off-why">
        {countdownReason(state.plan, now)}
      </p>
      <div className="acts">
        <button ref={cancelRef} className="b primary" onClick={cancel}>
          取消關機
        </button>
        <button className="b" onClick={() => void window.api.shutdownNow()}>
          現在關
        </button>
      </div>
      <p className="tiny">有程式沒存檔時，Windows 會停下來問你，不會強制關掉。</p>
    </main>
  )
}
