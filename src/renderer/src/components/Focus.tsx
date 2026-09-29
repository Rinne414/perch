import { useEffect, useState } from 'react'
import type { FocusState } from '@shared/ipc'
import type { Item } from '@shared/types'
import { PlayIcon } from './Icons'
import './focus.css'

const FIVE_MIN_MS = 5 * 60_000
const TICK_MS = 1000

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "5 分": start the timer on this task's next step (or the task itself). */
export function FocusStart({ item, nextStep }: { item: Item; nextStep: Item | null }): React.JSX.Element {
  return (
    <button
      className="later focus-start"
      title={`先做 5 分鐘：${nextStep?.title ?? item.title}`}
      onClick={() => void window.api.startFocus(item.id, nextStep?.id ?? null)}
    >
      <PlayIcon /> 5 分
    </button>
  )
}

function Running({ focus, onStopped }: { focus: FocusState; onStopped: (minutes: number) => void }): React.JSX.Element {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])
  const elapsed = now - focus.startedAt
  const stop = (): void => void window.api.stopFocus().then(onStopped)

  if (elapsed < FIVE_MIN_MS) {
    return (
      <div className="focus-line running" role="timer">
        <span className="focus-dot" aria-hidden="true" />
        <span className="focus-title">{focus.title}</span>
        <span className="focus-time">{mmss(FIVE_MIN_MS - elapsed)}</span>
        <button className="focus-btn" onClick={stop}>
          停
        </button>
      </div>
    )
  }
  const minutes = Math.floor(elapsed / 60_000)
  if (!focus.extended) {
    return (
      <div className="focus-line reached">
        <span>5 分鐘到了</span>
        <button className="focus-btn" onClick={() => void window.api.extendFocus()}>
          繼續
        </button>
        <button className="focus-btn" onClick={stop}>
          收工
        </button>
      </div>
    )
  }
  return (
    <div className="focus-line running">
      <span className="focus-dot" aria-hidden="true" />
      <span className="focus-title">{focus.title}</span>
      <span className="focus-time">已做 {minutes} 分</span>
      <button className="focus-btn" onClick={stop}>
        收工
      </button>
    </div>
  )
}

/** After stopping: say how long it was, and while it is fresh, offer to tick the step or write the next one. */
function Afterwards({ item, stepId, minutes, onDone }: { item: Item; stepId: string | null; minutes: number; onDone: () => void }): React.JSX.Element {
  const [next, setNext] = useState('')
  const add = (): void => {
    if (!next.trim()) return
    void window.api.addStep(item.id, next.trim()).then(onDone)
  }
  return (
    <div className="focus-after">
      <span>做了 {minutes} 分。</span>
      {stepId && (
        <button className="focus-btn" onClick={() => void window.api.complete(stepId).then(onDone)}>
          這步做完了
        </button>
      )}
      <input
        className="focus-next"
        value={next}
        placeholder="下一步是…（Enter 記下）"
        aria-label="下一步"
        onChange={(e) => setNext(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) add()
          if (e.key === 'Escape') onDone()
        }}
      />
      <button className="focus-btn" aria-label="收起" onClick={onDone}>
        ✕
      </button>
    </div>
  )
}

/** The timer line under a task: running, at five minutes, or just stopped. */
export function FocusArea({ item, focus }: { item: Item; focus: FocusState | null }): React.JSX.Element | null {
  const [after, setAfter] = useState<{ minutes: number; stepId: string | null } | null>(null)
  const mine = focus?.itemId === item.id ? focus : null
  if (mine) return <Running focus={mine} onStopped={(minutes) => minutes > 0 && setAfter({ minutes, stepId: mine.stepId })} />
  if (after) return <Afterwards item={item} stepId={after.stepId} minutes={after.minutes} onDone={() => setAfter(null)} />
  return null
}
