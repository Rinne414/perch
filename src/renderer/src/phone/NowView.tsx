import { useEffect, useState } from 'react'
import { ago, clock } from '@shared/format'
import type { PhoneAgent, PhoneSnapshot, PhoneTarget, PhoneTodo } from '@shared/phone'
import { countdownReason, powerSummary } from '@shared/power'
import { call, messageOf } from './api'
import { GpuLines, PowerSheet } from './PowerSheet'
import { canPush, disablePush, enablePush } from './push'

const SECOND_MS = 1_000
const TARGETS: readonly { target: PhoneTarget; label: string; hint: string }[] = [
  { target: 'today', label: '今天', hint: '記點什麼… 例：明天下午3點 交報告' },
  { target: 'inbox', label: '隨手記', hint: '想到什麼先記下，之後再排' },
  { target: 'stash', label: '暫存', hint: '寫一則 memo，會一直留著' },
]

interface ViewProps {
  readonly snap: PhoneSnapshot
  /** Computer clock minus phone clock, so countdowns follow the computer. */
  readonly offset: number
  /** Something went wrong (often: the computer is off); the last known state stays on screen. */
  readonly problem: string | null
  readonly refresh: () => void
}

function useTick(ms: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

/** The computer starts a countdown on its next check, about a second later; look again then. */
const SETTLE_MS = 1_500

const refreshTwice = (refresh: () => void): void => {
  refresh()
  setTimeout(refresh, SETTLE_MS)
}

const cancelShutdown = (refresh: () => void): void => {
  call('POST', '/api/power', { action: 'cancel' }).then(refresh, refresh)
}

function Countdown({ snap, offset, refresh }: Omit<ViewProps, 'problem'>): React.JSX.Element | null {
  const now = useTick(250) + offset
  const { plan, countdownEndsAt, minuteMs } = snap.power
  if (!plan || countdownEndsAt === null) return null
  const left = Math.max(0, countdownEndsAt - now)
  return (
    <div className="p-count" role="alert">
      <div className="hd2">電腦要關機了</div>
      <div className="big">
        {Math.ceil(left / SECOND_MS)}
        <small>秒後</small>
      </div>
      <div className="ring2">
        <i style={{ width: `${Math.round(Math.min(1, 1 - left / minuteMs) * 100)}%` }} />
      </div>
      <p className="why">{countdownReason(plan, now)}</p>
      <button className="p-btn primary wide big-btn" onClick={() => cancelShutdown(refresh)}>
        取消關機
      </button>
    </div>
  )
}

function Computer({ snap, offset, refresh }: Omit<ViewProps, 'problem'>): React.JSX.Element {
  const [sheet, setSheet] = useState(false)
  const now = useTick(5 * SECOND_MS) + offset
  const { plan, countdownEndsAt, supported, minuteMs } = snap.power
  const summary = plan && countdownEndsAt === null ? powerSummary(plan, now, minuteMs) : null
  return (
    <div className="p-card">
      <div className="hd2">
        電腦
        <span className="push" />
        {supported && !plan && (
          <button className="p-btn sm" onClick={() => setSheet(true)}>
            排關機…
          </button>
        )}
      </div>
      {summary && (
        <div className="p-off">
          <div>
            <div className="t">{summary.title}</div>
            <div className="s">{summary.detail}</div>
            {summary.progress !== null && (
              <div className="prog">
                <i style={{ width: `${Math.round(summary.progress * 100)}%` }} />
              </div>
            )}
          </div>
          <button className="p-btn sm" onClick={() => cancelShutdown(refresh)}>
            取消
          </button>
        </div>
      )}
      <GpuLines gpus={snap.gpus} />
      {sheet && (
        <PowerSheet
          gpus={snap.gpus}
          onClose={() => setSheet(false)}
          onDone={() => {
            setSheet(false)
            refreshTwice(refresh)
          }}
        />
      )}
    </div>
  )
}

function Agents({ title, list, now, waiting }: { title: string; list: readonly PhoneAgent[]; now: number; waiting: boolean }): React.JSX.Element | null {
  if (list.length === 0) return null
  return (
    <section className="p-sec">
      <h2>
        {title}
        <small>{list.length} 個</small>
      </h2>
      {list.map((a) => (
        <div className="p-row" key={a.id}>
          <span className={`p-dot ${waiting ? (a.status === 'failed' ? 'late' : 'wait') : 'run'}`} />
          <div>
            <div className="t">{a.agent}</div>
            <div className="s">
              {waiting && <em>{a.statusLabel}</em>}
              {waiting && a.project && ' · '}
              {a.project}
              {!waiting && a.title && ` · 「${a.title}」`}
            </div>
          </div>
          <span className="e">{ago(a.at, now)}</span>
        </div>
      ))}
    </section>
  )
}

function todoEnd(t: PhoneTodo): string {
  return t.at === null ? '' : clock(t.at)
}

function Today({ todos }: { todos: readonly PhoneTodo[] }): React.JSX.Element {
  const done = todos.filter((t) => t.done).length
  return (
    <section className="p-sec">
      <h2>
        今天<small>{todos.length > 0 ? `做完 ${done} / ${todos.length}` : '沒有排事情'}</small>
      </h2>
      {todos.map((t) => (
        <div className={`p-row${t.done ? ' donef' : ''}`} key={t.id}>
          <span className={`p-dot ${t.done ? 'done' : t.overdueDays > 0 ? 'late' : 'open'}`} />
          <div>
            <div className="t">{t.title}</div>
            {t.overdueDays > 0 && <div className="s late">逾期 {t.overdueDays} 天</div>}
          </div>
          <span className="e">{todoEnd(t)}</span>
        </div>
      ))}
    </section>
  )
}

function NotifyRow({ on, refresh }: { on: boolean; refresh: () => void }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const toggle = (): void => {
    setError(null)
    ;(on ? disablePush() : enablePush()).then(refresh, (err: unknown) => setError(messageOf(err)))
  }
  return (
    <div className="p-notify">
      <span>{on ? '通知：開著' : '通知沒開'}</span>
      <button className="p-link" disabled={!on && !canPush()} onClick={toggle}>
        {on ? '關掉' : '開啟'}
      </button>
      {error && <p className="p-error">{error}</p>}
    </div>
  )
}

function CaptureBar({ refresh }: { refresh: () => void }): React.JSX.Element {
  const [target, setTarget] = useState<PhoneTarget>('today')
  const [text, setText] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const save = (): void => {
    if (!text.trim()) return
    call('POST', '/api/capture', { text, target })
      .then(() => {
        setText('')
        setNote('記下了')
        refresh()
      })
      .catch((err: unknown) => setNote(messageOf(err)))
  }
  return (
    <footer className="p-cap">
      <div className="p-seg" role="group" aria-label="記到哪裡">
        {TARGETS.map((t) => (
          <button key={t.target} className={t.target === target ? 'on' : undefined} aria-pressed={t.target === target} onClick={() => setTarget(t.target)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-in">
        <input
          id="phone-capture"
          aria-label="記一筆"
          placeholder={TARGETS.find((t) => t.target === target)?.hint}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setNote(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
          }}
        />
        <button className="p-btn primary" disabled={!text.trim()} onClick={save}>
          記下
        </button>
      </div>
      {note && <p className="p-hint">{note}</p>}
    </footer>
  )
}

/** 現在: the computer, its agents, today's list, and a line to write something down. */
export function NowView({ snap, offset, problem, refresh }: ViewProps): React.JSX.Element {
  const now = Date.now() + offset
  return (
    <>
      <div className="p-body">
        {problem && (
          <p className="p-error" role="alert">
            {problem}
          </p>
        )}
        <Countdown snap={snap} offset={offset} refresh={refresh} />
        <Computer snap={snap} offset={offset} refresh={refresh} />
        <Agents title="等你處理" list={snap.attention} now={now} waiting />
        <Agents title="執行中" list={snap.running} now={now} waiting={false} />
        <Today todos={snap.today} />
        <NotifyRow on={snap.notifications} refresh={refresh} />
      </div>
      <CaptureBar refresh={refresh} />
    </>
  )
}
