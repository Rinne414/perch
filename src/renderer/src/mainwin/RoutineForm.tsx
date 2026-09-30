import { useState } from 'react'
import { normaliseTime } from '@shared/schedule'
import type { RoutineSchedule, ScheduleSlot } from '@shared/types'

const MAX_DAYS = 3650
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const REMINDERS: readonly { minutes: number | null; label: string }[] = [
  { minutes: null, label: '不提醒' },
  { minutes: 15, label: '15 分鐘前' },
  { minutes: 30, label: '30 分鐘前' },
  { minutes: 60, label: '1 小時前' },
]
const DEFAULT_REMIND = 30
const DEFAULT_SLOT = { start: '09:00', end: '10:00' }

type Kind = 'schedule' | 'interval' | 'tracker'
type Times = Readonly<Record<number, { start: string; end: string }>>

export interface RoutineDraft {
  readonly title: string
  readonly intervalDays: number | null
  readonly schedule: RoutineSchedule | null
}

interface Props {
  readonly initial?: RoutineDraft
  readonly submitLabel: string
  readonly onSubmit: (draft: RoutineDraft) => void
  readonly onCancel: () => void
}

const kindOf = (d: RoutineDraft | undefined): Kind =>
  d?.schedule ? 'schedule' : d && d.intervalDays === null ? 'tracker' : 'interval'

const timesOf = (schedule: RoutineSchedule | null | undefined): Times =>
  Object.fromEntries((schedule?.slots ?? []).map((s) => [s.weekday, { start: s.start, end: s.end }]))

function slotsFrom(times: Times): ScheduleSlot[] | null {
  const slots = Object.entries(times).map(([weekday, t]) => ({
    weekday: Number(weekday),
    start: normaliseTime(t.start),
    end: normaliseTime(t.end),
  }))
  if (slots.length === 0 || slots.some((s) => !s.start || !s.end || s.start === s.end)) return null
  return slots.sort((a, b) => a.weekday - b.weekday) as ScheduleSlot[]
}

/** Which weekdays and, for each one, from when to when. */
function WeeklyTimes({ times, onChange }: { times: Times; onChange: (next: Times) => void }): React.JSX.Element {
  const toggle = (weekday: number): void => {
    if (times[weekday]) {
      const { [weekday]: _removed, ...rest } = times
      onChange(rest)
      return
    }
    const last = Object.values(times).at(-1) ?? DEFAULT_SLOT
    onChange({ ...times, [weekday]: { ...last } })
  }
  const set = (weekday: number, key: 'start' | 'end', value: string): void =>
    onChange({ ...times, [weekday]: { ...times[weekday], [key]: value } })
  return (
    <>
      <span>星期</span>
      <div className="wd" role="group" aria-label="星期">
        {WEEKDAYS.map((name, weekday) => (
          <button key={name} className={times[weekday] ? 'on' : undefined} aria-pressed={!!times[weekday]} onClick={() => toggle(weekday)}>
            {name}
          </button>
        ))}
      </div>
      <span>時間</span>
      <div className="times">
        {Object.keys(times).length === 0 && <span className="hint">先選星期</span>}
        {Object.entries(times).map(([weekday, t]) => (
          <div className="line" key={weekday}>
            <span className="day-l">週{WEEKDAYS[Number(weekday)]}</span>
            <input className={`field time${normaliseTime(t.start) ? '' : ' bad'}`} value={t.start} placeholder="16:00" aria-label={`週${WEEKDAYS[Number(weekday)]}開始`} onChange={(e) => set(Number(weekday), 'start', e.target.value)} />
            <span className="hint">到</span>
            <input className={`field time${normaliseTime(t.end) ? '' : ' bad'}`} value={t.end} placeholder="19:00" aria-label={`週${WEEKDAYS[Number(weekday)]}結束`} onChange={(e) => set(Number(weekday), 'end', e.target.value)} />
          </div>
        ))}
      </div>
    </>
  )
}

/** New or edited routine: fixed weekly times, every N days, or only "last time". */
export function RoutineForm({ initial, submitLabel, onSubmit, onCancel }: Props): React.JSX.Element {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [kind, setKind] = useState<Kind>(kindOf(initial))
  const [days, setDays] = useState(String(initial?.intervalDays ?? 7))
  const [times, setTimes] = useState<Times>(timesOf(initial?.schedule))
  const [remind, setRemind] = useState<number | null>(initial?.schedule ? initial.schedule.remindMinutes : DEFAULT_REMIND)

  const n = Number(days)
  const slots = kind === 'schedule' ? slotsFrom(times) : null
  const valid =
    title.trim().length > 0 &&
    (kind === 'tracker' || (kind === 'interval' && Number.isInteger(n) && n >= 1 && n <= MAX_DAYS) || (kind === 'schedule' && slots !== null))

  const submit = (): void => {
    if (!valid) return
    onSubmit({
      title: title.trim(),
      intervalDays: kind === 'interval' ? n : null,
      schedule: kind === 'schedule' && slots ? { slots, remindMinutes: remind } : null,
    })
  }
  const keys = (e: React.KeyboardEvent): void => {
    // Enter on a text field saves; on a weekday or type button it only presses that button.
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !e.nativeEvent.isComposing) submit()
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <li className="inline routine-form" onKeyDown={keys}>
      <div className="form-grid">
        <span>名稱</span>
        <input className="field" autoFocus value={title} placeholder="例如：上班、運動、換牙刷" aria-label="名稱" onChange={(e) => setTitle(e.target.value)} />
        <span>類型</span>
        <div>
          <div className="seg" role="radiogroup" aria-label="類型">
            {(
              [
                ['schedule', '固定時間'],
                ['interval', '每幾天一次'],
                ['tracker', '只記上次'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : undefined} onClick={() => setKind(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {kind === 'schedule' && (
          <>
            <WeeklyTimes times={times} onChange={setTimes} />
            <span>提醒</span>
            <div className="chips">
              {REMINDERS.map((r) => (
                <button key={r.label} className={`chip${remind === r.minutes ? ' on' : ''}`} aria-pressed={remind === r.minutes} onClick={() => setRemind(r.minutes)}>
                  {r.label}
                </button>
              ))}
            </div>
          </>
        )}
        {kind === 'interval' && (
          <>
            <span>間隔</span>
            <div className="line">
              <span className="hint">每</span>
              <input className="field num" inputMode="numeric" value={days} aria-label="間隔天數" onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
              <span className="hint">天一次，超過就在浮窗提醒你</span>
            </div>
          </>
        )}
        {kind === 'tracker' && (
          <>
            <span />
            <span className="hint form-note">只記上次是什麼時候做的，永遠不會催你。</span>
          </>
        )}
      </div>
      <div className="line form-actions">
        <button className="btn ghost" onClick={onCancel}>
          取消
        </button>
        <button className="btn primary" disabled={!valid} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </li>
  )
}
