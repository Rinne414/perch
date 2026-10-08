import { useEffect, useState } from 'react'
import {
  allIdle,
  DEFAULT_IDLE_MINUTES,
  IDLE_MINUTE_CHOICES,
  IDLE_UTILIZATION,
  leftLabel,
  nextClockTime,
  powerSummary,
  TIMER_PRESETS,
  timerClock,
  type GpuReading,
  type PowerState,
} from '@shared/power'
import { PowerIcon, WindowIcon } from './Icons'
import './power.css'

const GPU_REFRESH_MS = 3_000
const LINE_REFRESH_MS = 5_000
const SECOND_MS = 1_000

/** Electron wraps errors thrown in the main process; only the reason is for people. */
export const errorReason = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** The planned shutdown, kept current by the main process; null until the first answer. */
export function usePower(): PowerState | null {
  const [state, setState] = useState<PowerState | null>(null)
  useEffect(() => {
    let live = true
    let pushed = false
    window.api
      .getPower()
      .then((s) => live && !pushed && setState(s)) // a push that came first is newer
      .catch(() => undefined) // The button just stays hidden.
    const off = window.api.onPower((s) => {
      pushed = true
      setState(s)
    })
    return () => {
      live = false
      off()
    }
  }, [])
  return state
}

/** Re-renders every `ms` so "還有 N 分" and countdowns stay true; returns the time of the last tick. */
export function useTick(ms: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

/** undefined while the first reading runs; null when there is no NVIDIA GPU to read. */
function useGpuReading(): readonly GpuReading[] | null | undefined {
  const [gpus, setGpus] = useState<readonly GpuReading[] | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    const read = (): void => {
      window.api
        .readGpus()
        .then((g) => live && setGpus(g))
        .catch(() => live && setGpus(null))
    }
    read()
    const timer = setInterval(read, GPU_REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])
  return gpus
}

const presetLabel = (minutes: number): string => (minutes < 60 ? `${minutes} 分` : `${minutes / 60} 小時`)
/** "NVIDIA GeForce RTX 3090" → "RTX 3090": the panel is narrow. */
const shortName = (name: string): string => name.replace(/^NVIDIA\s+(GeForce\s+)?/i, '')

interface ButtonProps {
  readonly state: PowerState
  readonly open: boolean
  readonly onToggle: () => void
}

/** The header button: yellow while a shutdown is planned. */
export function PowerButton({ state, open, onToggle }: ButtonProps): React.JSX.Element {
  const label = state.plan ? '關機計時（已排好）' : '關機計時'
  return (
    <button
      className={`win${state.plan ? ' on' : ''}${open ? ' open' : ''}`}
      aria-label={label}
      title={label}
      aria-expanded={open}
      onClick={onToggle}
    >
      <PowerIcon />
    </button>
  )
}

/** Under the header on every tab while a shutdown is planned. */
export function PowerLine({ state }: { state: PowerState }): React.JSX.Element | null {
  const counting = state.countdownEndsAt !== null
  useTick(counting ? SECOND_MS : LINE_REFRESH_MS)
  if (!state.plan) return null
  const now = Date.now()
  const summary = powerSummary(state.plan, now, state.minuteMs)
  const title = counting ? `${Math.max(0, Math.ceil((state.countdownEndsAt! - now) / SECOND_MS))} 秒後關機` : summary.title
  const detail = counting ? '倒數視窗開著，按取消就不會關' : summary.detail
  return (
    <div className="off-line" role="status">
      <PowerIcon size={16} />
      <div className="off-text">
        <div className="t">{title}</div>
        <div className="d">{detail}</div>
        {!counting && summary.progress !== null && (
          <div className="prog">
            <i style={{ width: `${Math.round(summary.progress * 100)}%` }} />
          </div>
        )}
      </div>
      <button className="act hi" onClick={() => void window.api.cancelShutdown()}>
        取消
      </button>
    </div>
  )
}

function GpuNow({ gpus }: { gpus: readonly GpuReading[] | null | undefined }): React.JSX.Element {
  if (gpus === undefined) return <p className="tiny">正在讀 GPU…</p>
  if (gpus === null) return <p className="tiny">讀不到 GPU（要有 NVIDIA 顯示卡和驅動），這個選項不能用。</p>
  return (
    <>
      {gpus.map((g, i) => (
        <div className="gpu-now" key={`${i}-${g.name}`}>
          <span className="nm">{shortName(g.name)}</span>
          <span className="gpu-bar">
            <i style={{ width: `${g.utilization}%` }} />
          </span>
          <span className="pct">現在 {g.utilization}%</span>
        </div>
      ))}
    </>
  )
}

interface PanelProps {
  readonly state: PowerState
  readonly onClose: () => void
}

/** Opened from the header: shut down at a time, or once the GPU has been free for a while. */
export function PowerPanel({ state, onClose }: PanelProps): React.JSX.Element {
  const [clock, setClock] = useState('')
  const [idleMinutes, setIdleMinutes] = useState(DEFAULT_IDLE_MINUTES)
  const [error, setError] = useState<string | null>(null)
  const gpus = useGpuReading()
  const now = Date.now()
  const typedAt = clock.trim() ? nextClockTime(clock, now) : null

  const arm = (request: Promise<PowerState>): void => {
    setError(null)
    request.then(onClose).catch((err: unknown) => setError(errorReason(err)))
  }
  const armClock = (): void => {
    if (typedAt !== null) arm(window.api.armShutdownTimer({ clock }))
  }

  return (
    <div
      className="offp"
      role="dialog"
      aria-label="關機計時"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="hd">
        關機
        <span className="push" />
        <button className="act icon" aria-label="關閉" title="關閉" onClick={onClose}>
          <WindowIcon kind="close" />
        </button>
      </div>

      {state.plan && <p className="warn">已經排了：{powerSummary(state.plan, now, state.minuteMs).title}。再排一次會取代它。</p>}

      <div className="part">
        <span className="lbl">時間到就關</span>
        <div className="chips">
          {TIMER_PRESETS.map((m) => (
            <button key={m} className="chip" onClick={() => arm(window.api.armShutdownTimer({ minutes: m }))}>
              {presetLabel(m)}
            </button>
          ))}
        </div>
        <div className="line2">
          <span className="or">或在</span>
          <input
            id="off-clock"
            className="field"
            value={clock}
            placeholder="23:30"
            aria-label="幾點關機"
            inputMode="numeric"
            onChange={(e) => setClock(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) armClock()
            }}
          />
          <button className="btn" disabled={typedAt === null} onClick={armClock}>
            排好
          </button>
        </div>
        {clock.trim() !== '' && (
          <p className="tiny">
            {typedAt === null ? '打像 23:30 這樣的時間' : `${timerClock(typedAt, now)} 關機，還有 ${leftLabel(typedAt - now)}`}
          </p>
        )}
      </div>

      <div className="part">
        <span className="lbl">GPU 閒下來就關</span>
        <GpuNow gpus={gpus} />
        <div className="line2 wrap">
          <span className="or">低於 {IDLE_UTILIZATION}% 連續</span>
          <div className="chips">
            {IDLE_MINUTE_CHOICES.map((m) => (
              <button key={m} className={`chip${m === idleMinutes ? ' on' : ''}`} aria-pressed={m === idleMinutes} onClick={() => setIdleMinutes(m)}>
                {m}
              </button>
            ))}
          </div>
          <span className="or">分鐘</span>
        </div>
        {allIdle(gpus ?? null) && <p className="warn">GPU 現在就是閒的，{idleMinutes} 分鐘後就會開始倒數。</p>}
        <button className="btn primary" disabled={!gpus} onClick={() => arm(window.api.armShutdownOnGpu(idleMinutes))}>
          GPU 閒了就關機
        </button>
      </div>

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <p className="tiny">關機前會先倒數 60 秒，隨時可以取消。有程式沒存檔時，Windows 會停下來問你，不會強制關。</p>
    </div>
  )
}
