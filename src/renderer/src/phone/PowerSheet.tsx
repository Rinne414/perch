import { useState } from 'react'
import { DEFAULT_IDLE_MINUTES, IDLE_MINUTE_CHOICES, IDLE_UTILIZATION, leftLabel, nextClockTime, TIMER_PRESETS, timerClock, type GpuReading } from '@shared/power'
import { call, messageOf } from './api'

const presetLabel = (minutes: number): string => (minutes < 60 ? `${minutes} 分` : `${minutes / 60} 小時`)
const shortName = (name: string): string => name.replace(/^NVIDIA\s+(GeForce\s+)?/i, '')

/** One line per GPU: name, a bar, the utilization. */
export function GpuLines({ gpus, prefix = '' }: { gpus: readonly GpuReading[] | null; prefix?: string }): React.JSX.Element {
  if (!gpus) return <p className="p-hint">讀不到 GPU（要有 NVIDIA 顯示卡和驅動）</p>
  return (
    <>
      {gpus.map((g, i) => (
        <div className="p-gpu" key={`${i}-${g.name}`}>
          <span className="nm">{shortName(g.name)}</span>
          <span className="bar2">
            <i style={{ width: `${g.utilization}%` }} />
          </span>
          <b>
            {prefix}
            {g.utilization}%
          </b>
        </div>
      ))}
    </>
  )
}

interface SheetProps {
  readonly gpus: readonly GpuReading[] | null
  readonly onClose: () => void
  /** A shutdown was planned or started; the page reloads its state. */
  readonly onDone: () => void
}

/** 排關機 on the phone: the float's choices, plus 現在關機. Everything still counts down a minute on the computer. */
export function PowerSheet({ gpus, onClose, onDone }: SheetProps): React.JSX.Element {
  const [idle, setIdle] = useState(DEFAULT_IDLE_MINUTES)
  const [clock, setClock] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = Date.now()
  const typedAt = clock.trim() ? nextClockTime(clock, now) : null

  const act = (body: Record<string, unknown>): void => {
    setBusy(true)
    setError(null)
    call('POST', '/api/power', body)
      .then(onDone)
      .catch((err: unknown) => setError(messageOf(err)))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <button className="p-scrim" aria-label="關閉" onClick={onClose} />
      <div className="p-sheet" role="dialog" aria-label="排關機">
        <span className="grab" />
        <div className="ttl">
          排關機
          <span className="push" />
          <button className="p-btn ghost sm" onClick={onClose}>
            關閉
          </button>
        </div>

        <div className="part2">
          <span className="p-lbl">GPU 閒下來就關</span>
          <GpuLines gpus={gpus} prefix="現在 " />
          <div className="p-line">
            <span className="p-or">低於 {IDLE_UTILIZATION}% 連續</span>
            <div className="p-chips">
              {IDLE_MINUTE_CHOICES.map((m) => (
                <button key={m} className={`p-chip${m === idle ? ' on' : ''}`} aria-pressed={m === idle} onClick={() => setIdle(m)}>
                  {m}
                </button>
              ))}
            </div>
            <span className="p-or">分鐘</span>
          </div>
          <button className="p-btn primary wide" disabled={busy || !gpus} onClick={() => act({ action: 'gpu', idleMinutes: idle })}>
            GPU 閒了就關機
          </button>
        </div>

        <div className="part2">
          <span className="p-lbl">時間到就關</span>
          <div className="p-chips">
            {TIMER_PRESETS.map((m) => (
              <button key={m} className="p-chip" disabled={busy} onClick={() => act({ action: 'timer', minutes: m })}>
                {presetLabel(m)}
              </button>
            ))}
          </div>
          <div className="p-in">
            <input
              id="phone-clock"
              aria-label="幾點關機"
              placeholder="或打時間：23:30"
              inputMode="numeric"
              value={clock}
              onChange={(e) => setClock(e.target.value)}
            />
            <button className="p-btn" disabled={busy || typedAt === null} onClick={() => act({ action: 'timer', clock })}>
              排好
            </button>
          </div>
          {clock.trim() && (
            <p className="p-hint">{typedAt === null ? '打像 23:30 這樣的時間' : `${timerClock(typedAt, now)} 關機，還有 ${leftLabel(typedAt - now)}`}</p>
          )}
        </div>

        <div className="part2">
          <button className="p-btn danger wide" disabled={busy} onClick={() => act({ action: 'now' })}>
            現在關機
          </button>
          <p className="p-hint">不管選哪個，電腦都會先倒數 60 秒，這裡和電腦上都能取消。有程式沒存檔時，Windows 會停下來等人處理。</p>
        </div>
        {error && (
          <p className="p-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  )
}
