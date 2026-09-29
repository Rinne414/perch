import { useCallback, useEffect, useMemo, useState } from 'react'
import { parsePast } from '@shared/capture'
import { dayKey } from '@shared/day'
import { clock, dayTitle } from '@shared/format'
import type { RoutineHistory } from '@shared/ipc'
import type { Item } from '@shared/types'
import { WindowIcon } from '../components/Icons'
import { useAction, useToast } from './Toast'

interface Props {
  readonly routine: Item
  readonly dayStartHour: number
}

const QUICK = ['今天稍早', '昨天', '前天'] as const

const calendarKey = (ms: number): string => dayKey(ms, 0)

/**
 * A back-filled record only knows its day, which follows the app's day boundary.
 * A checked-off one has a real clock time, so it shows the calendar date with it.
 */
function recordLabel(at: number, backfilled: boolean, dayStartHour: number): string {
  if (backfilled) {
    const { date, weekday } = dayTitle(dayKey(at, dayStartHour))
    return `${date} ${weekday}`
  }
  const { date, weekday } = dayTitle(calendarKey(at))
  return `${date} ${weekday} ${clock(at)}`
}

/** A one-click fix when the real rhythm differs from the goal by a day or more. */
function suggestedInterval(routine: Item, averageDays: number | null): number | null {
  if (averageDays === null) return null
  const rounded = Math.max(1, Math.round(averageDays))
  return rounded === routine.intervalDays ? null : rounded
}

/** Every time a routine was done, its real rhythm, and a way to record one after the fact. */
export function RoutineHistoryPanel({ routine, dayStartHour }: Props): React.JSX.Element {
  const [history, setHistory] = useState<RoutineHistory | null>(null)
  const [when, setWhen] = useState('')
  const run = useAction()
  const show = useToast()

  const load = useCallback(() => {
    window.api
      .getRoutineHistory(routine.id)
      .then(setHistory)
      .catch(() => show('讀不到紀錄'))
  }, [routine.id, show])

  useEffect(() => {
    load()
    return window.api.onChanged(load)
  }, [load])

  const parsed = useMemo(() => (when.trim() ? parsePast(when.replace('今天稍早', '今天'), Date.now(), dayStartHour) : null), [when, dayStartHour])
  const record = (text: string): void => {
    const value = text.replace('今天稍早', '今天')
    if (parsePast(value, Date.now(), dayStartHour) === null) return
    setWhen('')
    run(() => window.api.recordRoutine(routine.id, value))
  }
  const suggestion = suggestedInterval(routine, history?.averageDays ?? null)

  return (
    <li className="inline history">
      <div className="records">
        {history?.records.length ? (
          history.records.map((r) => (
            <span key={r.id} className={`record${r.backfilled ? ' back' : ''}`} title={r.backfilled ? '事後補記的' : undefined}>
              {recordLabel(r.at, r.backfilled, dayStartHour)}
              <button
                className="record-x"
                aria-label={`刪掉這筆：${recordLabel(r.at, r.backfilled, dayStartHour)}`}
                title="記錯了，刪掉這筆"
                onClick={() => run(() => window.api.removeRoutineRecord(r.id))}
              >
                <WindowIcon kind="close" />
              </button>
            </span>
          ))
        ) : (
          <span className="hint">還沒有紀錄。做過的話可以在下面補記。</span>
        )}
      </div>
      {history?.averageDays != null && (
        <p className="hint rhythm">
          實際大約每 <b>{history.averageDays}</b> 天一次
          {routine.intervalDays !== null && `（目標每 ${routine.intervalDays} 天）`}
          {suggestion !== null && (
            <button
              className="link"
              onClick={() => run(() => window.api.updateRoutine(routine.id, routine.title, suggestion))}
            >
              {routine.intervalDays === null ? `每 ${suggestion} 天提醒我` : `改成每 ${suggestion} 天`}
            </button>
          )}
        </p>
      )}
      <div className="line">
        <span className="hint">補記</span>
        <input
          className="field"
          value={when}
          placeholder="什麼時候做的？例：昨天、前天晚上、9/27"
          aria-label="補記的時間"
          onChange={(e) => setWhen(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && record(when)}
        />
        <button className="btn" disabled={parsed === null} onClick={() => record(when)}>
          記上
        </button>
      </div>
      <div className="chips">
        {QUICK.map((q) => (
          <button key={q} className="chip" onClick={() => record(q)}>
            {q}
          </button>
        ))}
        {when.trim() && (
          <span className="hint">
            {parsed === null ? '看不懂，或是還沒發生的時間' : `讀到 ${recordLabel(parsed, true, dayStartHour)}`}
          </span>
        )}
      </div>
    </li>
  )
}
