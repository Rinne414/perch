import { useState } from 'react'
import { clock, daysAgoLabel, shortDayLabel } from '@shared/format'
import type { FocusState } from '@shared/ipc'
import type { UpcomingEntry } from '@shared/mainView'
import type { RoutineEntry, TodayEntry } from '@shared/now'
import type { Item } from '@shared/types'
import { FocusArea, FocusStart } from '../components/Focus'
import { CheckIcon, TrashIcon } from '../components/Icons'
import { useAction } from '../components/Toast'
import { useRemove } from '../components/useRemove'

/** How long the check mark stays visible before the row leaves. */
const COMPLETE_DELAY_MS = 380

export function useCompleting(action: () => Promise<void>): [boolean, () => void] {
  const [checked, setChecked] = useState(false)
  const run = (): void => {
    if (checked) return
    setChecked(true)
    setTimeout(() => void action().catch(() => setChecked(false)), COMPLETE_DELAY_MS)
  }
  return [checked, run]
}

/** Opens the inline editor: rename, move to another day, add a deadline, let go, delete. */
type OnEdit = (id: string) => void

function CheckButton({ item, onComplete }: { item: Item; onComplete: () => void }): React.JSX.Element {
  return (
    <button className="check" aria-label={`完成：${item.title}`} onClick={onComplete}>
      <CheckIcon />
    </button>
  )
}

function TitleButton({ item, sub, onEdit }: { item: Item; sub?: React.ReactNode; onEdit: OnEdit }): React.JSX.Element {
  return (
    <button className="main open" title="點一下修改" onClick={() => onEdit(item.id)}>
      <span className="title">{item.title}</span>
      {sub && <span className="sub">{sub}</span>}
    </button>
  )
}

/** Buttons that float over the row's right edge while it is pointed at, so they never take room from the title. */
function RowActs({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="row-acts">{children}</span>
}

/** Hover-only: deletes at once, with "復原" in the toast for a minute. */
function DeleteButton({ item }: { item: Item }): React.JSX.Element {
  const remove = useRemove()
  return (
    <button className="later icon" aria-label={`刪除：${item.title}`} title="刪除（1 分鐘內可以復原）" onClick={() => remove(item)}>
      <TrashIcon />
    </button>
  )
}

interface TodayRowProps {
  readonly entry: TodayEntry
  readonly now: number
  readonly focus: FocusState | null
  readonly onEdit: OnEdit
}

export function TodayRow({ entry, now, focus, onEdit }: TodayRowProps): React.JSX.Element {
  const { item, overdueDays, nextStep } = entry
  const [checked, complete] = useCompleting(() => window.api.complete(item.id))
  const timeLabel = item.dueHasTime && item.dueAt !== null && overdueDays === 0 ? clock(item.dueAt) : null
  const timePassed = timeLabel !== null && item.dueAt! < now
  const sub =
    overdueDays > 0 ? (
      <span className="late-text">逾期 {overdueDays} 天</span>
    ) : nextStep ? (
      <span className="next">
        下一步：<b>{nextStep.title}</b>
      </span>
    ) : null
  return (
    <li className={`row task${overdueDays > 0 ? ' late' : ''}${checked ? ' checked' : ''}`}>
      <CheckButton item={item} onComplete={complete} />
      <TitleButton item={item} sub={sub} onEdit={onEdit} />
      <div className="end">{timeLabel && <span className={timePassed ? 'late-text' : undefined}>{timeLabel}</span>}</div>
      <RowActs>
        {focus?.itemId !== item.id && <FocusStart item={item} nextStep={nextStep} />}
        <button className="later" onClick={() => void window.api.postpone(item.id)} title="今天不做，移到明天">
          明天
        </button>
        <DeleteButton item={item} />
      </RowActs>
      <FocusArea item={item} focus={focus} />
    </li>
  )
}

/** Finished today: struck through, and one click takes it back. */
export function DoneRow({ item }: { item: Item }): React.JSX.Element {
  const run = useAction()
  return (
    <li className="row task done-row">
      <button className="check on" aria-label={`取消完成：${item.title}`} onClick={() => run(() => window.api.reopen(item.id))}>
        <CheckIcon />
      </button>
      <div className="main">
        <span className="title">{item.title}</span>
      </div>
      <div className="end">{item.doneAt !== null && <span>{clock(item.doneAt)}</span>}</div>
    </li>
  )
}

export function UpcomingRow({ entry, today, onEdit }: { entry: UpcomingEntry; today: string; onEdit: OnEdit }): React.JSX.Element {
  const { item, day } = entry
  const [checked, complete] = useCompleting(() => window.api.complete(item.id))
  return (
    <li className={`row task${checked ? ' checked' : ''}`}>
      <CheckButton item={item} onComplete={complete} />
      <TitleButton item={item} onEdit={onEdit} />
      <div className="end">
        <span className={item.dueAt !== null ? 'due' : undefined}>
          {shortDayLabel(day, today)}
          {item.dueAt !== null && ' 截止'}
        </span>
      </div>
      <RowActs>
        <DeleteButton item={item} />
      </RowActs>
    </li>
  )
}

/** An undated idea from 隨手記: plan it for today in one click, or open it to give it a day. */
export function IdeaRow({ item, now, dayStartHour, onEdit }: { item: Item; now: number; dayStartHour: number; onEdit: OnEdit }): React.JSX.Element {
  const run = useAction()
  return (
    <li className="row idea">
      <span className="bullet" aria-hidden="true" />
      <TitleButton item={item} sub={`${daysAgoLabel(item.createdAt, now, dayStartHour)}記下`} onEdit={onEdit} />
      <div className="end" />
      <RowActs>
        <button className="later" onClick={() => run(() => window.api.plan(item.id, 'today'))}>
          排到今天
        </button>
        <DeleteButton item={item} />
      </RowActs>
    </li>
  )
}

export function RoutineRow({ entry }: { entry: RoutineEntry }): React.JSX.Element {
  const { item, daysSince, overdueBy } = entry
  const [checked, complete] = useCompleting(() => window.api.complete(item.id))
  const interval = item.intervalDays ?? 1
  const fill = Math.min(1, (interval + overdueBy) / (interval * 2))
  return (
    <li className={`row routine${checked ? ' checked' : ''}`}>
      <button className="check" aria-label={`做了：${item.title}`} onClick={complete}>
        <CheckIcon />
      </button>
      <div className="main">
        <div className="title">{item.title}</div>
        <div className="sub">目標每 {interval} 天</div>
      </div>
      <div className="end">
        <span>{daysSince === null ? '還沒做過' : `${daysSince} 天前`}</span>
        <span className="meter" aria-hidden="true">
          <i style={{ transform: `scaleX(${fill})` }} />
        </span>
      </div>
    </li>
  )
}
