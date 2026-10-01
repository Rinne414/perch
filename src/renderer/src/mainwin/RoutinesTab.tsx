import { Fragment, useState } from 'react'
import { monthDay } from '@shared/format'
import type { MainPayload } from '@shared/ipc'
import type { RoutineState } from '@shared/lists'
import { nextOccurrence, scheduleLabel } from '@shared/schedule'
import { CheckIcon, PlusIcon } from '../components/Icons'
import { nextLabel } from '../components/ScheduleRow'
import { useCompleting } from '../float/rows'
import { RoutineForm, type RoutineDraft } from './RoutineForm'
import { RoutineHistoryPanel } from './RoutineHistory'
import { useAction } from '../components/Toast'
import { useRemove } from '../components/useRemove'
import './routines.css'

const sinceLabel = (daysSince: number | null): string =>
  daysSince === null ? '還沒做過' : daysSince === 0 ? '今天做過' : `${daysSince} 天前`

interface RowProps {
  readonly state: RoutineState
  readonly now: number
  readonly historyOpen: boolean
  readonly onEdit: () => void
  readonly onHistory: () => void
}

function RowActions({ state, onEdit, onHistory }: Pick<RowProps, 'state' | 'onEdit' | 'onHistory'>): React.JSX.Element {
  const remove = useRemove()
  return (
    <span className="acts">
      {!state.item.schedule && (
        <button className="act" onClick={onHistory}>
          紀錄
        </button>
      )}
      <button className="act" onClick={onEdit}>
        編輯
      </button>
      <button className="act danger" onClick={() => remove(state.item)}>
        刪除
      </button>
    </span>
  )
}

/** A fixed-time routine: when it happens each week and when it happens next. */
function ScheduledRow({ state, now, onEdit, onHistory }: RowProps): React.JSX.Element {
  const { item } = state
  const remind = item.schedule!.remindMinutes
  return (
    <li className="row routine scheduled">
      <span className="slot-dot" aria-hidden="true" />
      <span className="main">
        <span className="title">{item.title}</span>
        <span className="sub">
          {scheduleLabel(item.schedule!)}
          {remind !== null && ` · ${remind >= 60 ? `${remind / 60} 小時` : `${remind} 分鐘`}前提醒`}
        </span>
      </span>
      <div className="end">
        <RowActions state={state} onEdit={onEdit} onHistory={onHistory} />
        <span className="when next">{nextLabel(nextOccurrence(item, now), now)}</span>
      </div>
    </li>
  )
}

function RoutineRow({ state, historyOpen, onEdit, onHistory }: RowProps): React.JSX.Element {
  const { item, daysSince, dueIn, isDue } = state
  const [checked, complete] = useCompleting(() => window.api.complete(item.id))
  const interval = item.intervalDays
  // Due: fills from half (just due) to full (twice the interval). Not due: how much of the wait has passed.
  const fill =
    interval === null || dueIn === null
      ? 0
      : isDue
        ? Math.min(1, (interval - dueIn) / (interval * 2))
        : Math.max(0.04, (interval - dueIn) / interval)
  return (
    <li className={`row routine${checked ? ' checked' : ''}${historyOpen ? ' selected' : ''}`}>
      <button className="check" aria-label={`做了：${item.title}`} title="剛做完" onClick={complete}>
        <CheckIcon />
      </button>
      <button className="main open" aria-expanded={historyOpen} onClick={onHistory}>
        <span className="title">{item.title}</span>
        <span className="sub">
          {interval === null ? '只記上次' : `每 ${interval} 天`}
          {item.lastDoneAt !== null && ` · 上次 ${monthDay(item.lastDoneAt)}`}
        </span>
      </button>
      <div className="end">
        <RowActions state={state} onEdit={onEdit} onHistory={onHistory} />
        <span className="when">{dueIn === null || isDue ? sinceLabel(daysSince) : `還有 ${dueIn} 天`}</span>
        {interval !== null && (
          <span className="meter" aria-hidden="true">
            <i className={isDue ? undefined : 'ok'} style={{ transform: `scaleX(${fill})` }} />
          </span>
        )}
      </div>
    </li>
  )
}

const SECTIONS = [
  { id: 'fixed', title: '固定行程', pick: (r: RoutineState) => r.item.schedule !== null },
  { id: 'due', title: '該做了', pick: (r: RoutineState) => r.isDue },
  { id: 'waiting', title: '還沒到', pick: (r: RoutineState) => !r.isDue && r.dueIn !== null },
  { id: 'trackers', title: '只記上次', pick: (r: RoutineState) => r.dueIn === null && r.item.schedule === null },
] as const

const draftOf = (s: RoutineState): RoutineDraft => ({
  title: s.item.title,
  intervalDays: s.item.intervalDays,
  schedule: s.item.schedule,
})

export function RoutinesTab({ payload, at }: { payload: MainPayload; at: number }): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [history, setHistory] = useState<string | null>(null)
  const run = useAction()

  const list = (states: readonly RoutineState[]): React.JSX.Element[] =>
    states.map((s) => {
      if (editing === s.item.id) {
        return (
          <RoutineForm
            key={s.item.id}
            initial={draftOf(s)}
            submitLabel="儲存"
            onCancel={() => setEditing(null)}
            onSubmit={(d) => {
              setEditing(null)
              run(() => window.api.updateRoutine(s.item.id, d.title, d.intervalDays, d.schedule))
            }}
          />
        )
      }
      const props: RowProps = {
        state: s,
        now: at,
        historyOpen: history === s.item.id,
        onEdit: () => setEditing(s.item.id),
        onHistory: () => setHistory(history === s.item.id ? null : s.item.id),
      }
      return (
        <Fragment key={s.item.id}>
          {/* Keyed by the last completion so a routine that stays listed after "剛做完" starts fresh. */}
          {s.item.schedule ? (
            <ScheduledRow {...props} />
          ) : (
            <RoutineRow key={`${s.item.id}:${s.item.lastDoneAt}`} {...props} />
          )}
          {history === s.item.id && !s.item.schedule && (
            <RoutineHistoryPanel routine={s.item} dayStartHour={payload.dayStartHour} />
          )}
        </Fragment>
      )
    })

  return (
    <>
      <header className="ph">
        <h1>例行</h1>
        <p>固定行程、每幾天一次、只記上次</p>
        <button className="btn push" onClick={() => setAdding(true)} disabled={adding}>
          <PlusIcon /> 新增例行
        </button>
      </header>

      {adding && (
        <ul>
          <RoutineForm
            submitLabel="新增"
            onCancel={() => setAdding(false)}
            onSubmit={(d) => {
              setAdding(false)
              run(() => window.api.createRoutine(d.title, d.intervalDays, d.schedule))
            }}
          />
        </ul>
      )}

      {SECTIONS.map(({ id, title, pick }) => {
        const states = payload.view.routines.filter(pick)
        if (states.length === 0) return null
        return (
          <section key={id} className="sec" aria-labelledby={`mw-${id}`}>
            <h2 id={`mw-${id}`}>
              {title}
              <small>{states.length} 件</small>
            </h2>
            <ul>{list(states)}</ul>
          </section>
        )
      })}

      {payload.view.routines.length === 0 && !adding && (
        <div className="mw-empty">
          <p>還沒有例行事項。</p>
          <p className="faint">上班、運動、換牙刷…固定時間的會出現在今天的行程；每幾天一次的，太久沒做時浮窗會提醒你。</p>
        </div>
      )}
    </>
  )
}
