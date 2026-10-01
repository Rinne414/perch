import { useEffect, useRef, useState } from 'react'
import { addDays, dayKey } from '@shared/day'
import { clock, dayLabel } from '@shared/format'
import type { PlanTarget } from '@shared/ipc'
import type { Item } from '@shared/types'
import { DueEditor } from './DueEditor'
import { useAction } from './Toast'
import './item-fields.css'

const PLANS: readonly { target: PlanTarget; label: string }[] = [
  { target: 'today', label: '今天' },
  { target: 'tomorrow', label: '明天' },
  { target: 'none', label: '不排' },
]

interface TitleFieldProps {
  readonly item: Item
  readonly autoFocus?: boolean
  /** Enter or Esc after editing: the float closes its inline editor then. */
  readonly onDone?: () => void
}

/**
 * The task's name, saved on Enter or when the field loses focus. With `onDone` (the float's
 * inline editor) Enter saves and closes, and Esc closes without saving.
 */
export function TitleField({ item, autoFocus, onDone }: TitleFieldProps): React.JSX.Element {
  const [title, setTitle] = useState(item.title)
  const run = useAction()
  // The name last saved, so Enter followed by the blur of a closing editor renames only once.
  const saved = useRef(item.title)
  // Set once the inline editor is closing: a blur from then on must not save (Esc means "keep the old name").
  const closing = useRef(false)
  useEffect(() => {
    setTitle(item.title)
    saved.current = item.title
  }, [item.id, item.title])

  // Reads the field itself: Enter right after a paste can come before React has re-rendered the typed value.
  const save = (value: string): void => {
    const next = value.trim()
    if (!next) {
      setTitle(item.title)
      return
    }
    if (next === saved.current) return
    saved.current = next
    run(() => window.api.rename(item.id, next))
  }
  const close = (): void => {
    closing.current = true
    onDone?.()
  }
  return (
    <input
      className="detail-title"
      value={title}
      aria-label="名稱"
      spellCheck={false}
      autoFocus={autoFocus}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={(e) => closing.current || save(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          save(e.currentTarget.value)
          if (onDone) close()
          else e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          setTitle(item.title)
          e.stopPropagation()
          if (onDone) close()
        }
      }}
    />
  )
}

interface DatesProps {
  readonly item: Item
  readonly day: string
  readonly dayStartHour: number
}

/** 排在 (the planned day) and 截止 (a deadline with a reminder). */
export function Dates({ item, day, dayStartHour }: DatesProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const run = useAction()
  useEffect(() => setEditing(false), [item.id])

  const tomorrow = addDays(day, 1)
  const current: PlanTarget | null =
    item.plannedFor === null ? 'none' : item.plannedFor <= day ? 'today' : item.plannedFor === tomorrow ? 'tomorrow' : null
  const due =
    item.dueAt === null
      ? null
      : `${dayLabel(dayKey(item.dueAt, dayStartHour), day)}${item.dueHasTime ? ` ${clock(item.dueAt)}` : ''}`

  return (
    <div className="kv">
      <span>排在</span>
      <div className="chips">
        {PLANS.map(({ target, label }) => (
          <button
            key={target}
            className={`chip${current === target ? ' on' : ''}`}
            aria-pressed={current === target}
            onClick={() => run(() => window.api.plan(item.id, target))}
          >
            {label}
          </button>
        ))}
        {current === null && <span className="chip on">{dayLabel(item.plannedFor!, day)}</span>}
      </div>
      <span>截止</span>
      {editing ? (
        <DueEditor
          dayStartHour={dayStartHour}
          onCancel={() => setEditing(false)}
          onSubmit={(text) => {
            setEditing(false)
            run(() => window.api.setDue(item.id, text))
          }}
        />
      ) : due ? (
        <div className="due-line">
          <span className="due">{due}</span>
          <button className="act" onClick={() => setEditing(true)}>
            改
          </button>
          <button className="act" onClick={() => run(() => window.api.setDue(item.id, null))}>
            清除
          </button>
        </div>
      ) : (
        <button className="link" onClick={() => setEditing(true)}>
          + 加截止日（會提醒）
        </button>
      )}
    </div>
  )
}
