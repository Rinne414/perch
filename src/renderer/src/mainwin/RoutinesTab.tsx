import { Fragment, useState } from 'react'
import { monthDay } from '@shared/format'
import type { MainPayload } from '@shared/ipc'
import type { RoutineState } from '@shared/lists'
import { CheckIcon, PlusIcon } from '../components/Icons'
import { useCompleting } from '../float/rows'
import { RoutineHistoryPanel } from './RoutineHistory'
import { useAction } from './Toast'
import { useRemove } from './useRemove'

const MAX_DAYS = 3650

interface FormProps {
  readonly initialTitle?: string
  /** Null starts the form as a tracker without an interval. */
  readonly initialDays?: number | null
  readonly submitLabel: string
  readonly onSubmit: (title: string, days: number | null) => void
  readonly onCancel: () => void
}

function RoutineForm({ initialTitle = '', initialDays = 7, submitLabel, onSubmit, onCancel }: FormProps): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle)
  const [days, setDays] = useState(initialDays === null ? '' : String(initialDays))
  const n = days === '' ? null : Number(days)
  const valid = title.trim().length > 0 && (n === null || (Number.isInteger(n) && n >= 1 && n <= MAX_DAYS))
  const submit = (): void => {
    if (valid) onSubmit(title.trim(), n)
  }
  const keys = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    }
  }
  return (
    <li className="inline routine-form">
      <div className="line">
        <input
          className="field"
          autoFocus
          value={title}
          placeholder="例如：運動、澆花、換牙刷"
          aria-label="名稱"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={keys}
        />
        <span className="hint">每</span>
        <input
          className="field num"
          inputMode="numeric"
          value={days}
          placeholder="—"
          aria-label="間隔天數（空著就只記上次）"
          onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
          onKeyDown={keys}
        />
        <span className="hint">天一次</span>
        <button className="btn primary" disabled={!valid} onClick={submit}>
          {submitLabel}
        </button>
        <button className="btn ghost" onClick={onCancel}>
          取消
        </button>
      </div>
      <p className="hint form-note">{n === null ? '天數空著：只記上次是什麼時候，永遠不會催你。' : '超過這個天數沒做，浮窗會提醒你。'}</p>
    </li>
  )
}

const sinceLabel = (daysSince: number | null): string =>
  daysSince === null ? '還沒做過' : daysSince === 0 ? '今天做過' : `${daysSince} 天前`

function RoutineRow({
  state,
  historyOpen,
  onEdit,
  onHistory,
}: {
  state: RoutineState
  historyOpen: boolean
  onEdit: () => void
  onHistory: () => void
}): React.JSX.Element {
  const { item, daysSince, dueIn, isDue } = state
  const [checked, complete] = useCompleting(() => window.api.complete(item.id))
  const remove = useRemove()
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
        <span className="acts">
          <button className="act" onClick={onHistory}>
            紀錄
          </button>
          <button className="act" onClick={onEdit}>
            編輯
          </button>
          <button className="act danger" onClick={() => remove(item)}>
            刪除
          </button>
        </span>
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
  { id: 'due', title: '該做了', pick: (r: RoutineState) => r.isDue },
  { id: 'waiting', title: '還沒到', pick: (r: RoutineState) => !r.isDue && r.dueIn !== null },
  { id: 'trackers', title: '只記上次', pick: (r: RoutineState) => r.dueIn === null },
] as const

export function RoutinesTab({ payload }: { payload: MainPayload }): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [history, setHistory] = useState<string | null>(null)
  const run = useAction()

  const list = (states: readonly RoutineState[]): React.JSX.Element[] =>
    states.map((s) =>
      editing === s.item.id ? (
        <RoutineForm
          key={s.item.id}
          initialTitle={s.item.title}
          initialDays={s.item.intervalDays}
          submitLabel="儲存"
          onCancel={() => setEditing(null)}
          onSubmit={(title, days) => {
            setEditing(null)
            run(() => window.api.updateRoutine(s.item.id, title, days))
          }}
        />
      ) : (
        <Fragment key={s.item.id}>
          {/* Keyed by the last completion so a routine that stays listed after "剛做完" starts fresh. */}
          <RoutineRow
            key={`${s.item.id}:${s.item.lastDoneAt}`}
            state={s}
            historyOpen={history === s.item.id}
            onEdit={() => setEditing(s.item.id)}
            onHistory={() => setHistory(history === s.item.id ? null : s.item.id)}
          />
          {history === s.item.id && <RoutineHistoryPanel routine={s.item} dayStartHour={payload.dayStartHour} />}
        </Fragment>
      ),
    )

  return (
    <>
      <header className="ph">
        <h1>例行</h1>
        <p>不會「做完」，只記上次是什麼時候做的</p>
        <button className="btn push" onClick={() => setAdding(true)} disabled={adding}>
          <PlusIcon /> 新增例行
        </button>
      </header>

      {adding && (
        <ul>
          <RoutineForm
            submitLabel="新增"
            onCancel={() => setAdding(false)}
            onSubmit={(title, days) => {
              setAdding(false)
              run(() => window.api.createRoutine(title, days))
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
          <p className="faint">運動、澆花、換牙刷…設個「每幾天一次」，太久沒做時浮窗會提醒你；不設天數就只記上次。</p>
        </div>
      )}
    </>
  )
}
