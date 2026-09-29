import { useEffect, useState } from 'react'
import { addDays, dayKey } from '@shared/day'
import { clock, dayLabel, monthDay } from '@shared/format'
import type { PlanTarget } from '@shared/ipc'
import type { Item } from '@shared/types'
import { CheckIcon, TrashIcon, WindowIcon } from '../components/Icons'
import { DueEditor } from './DueEditor'
import { sourceLabel } from './TaskRow'
import { useAction } from './Toast'
import { useDrop, useRemove } from './useRemove'

interface Props {
  readonly item: Item
  readonly steps: readonly Item[]
  readonly day: string
  readonly dayStartHour: number
  readonly onClose: () => void
}

/** After this many roll-overs the panel offers a way out instead of another try. */
const NUDGE_AFTER = 3

const PLANS: readonly { target: PlanTarget; label: string }[] = [
  { target: 'today', label: '今天' },
  { target: 'tomorrow', label: '明天' },
  { target: 'none', label: '不排' },
]

function TitleField({ item }: { item: Item }): React.JSX.Element {
  const [title, setTitle] = useState(item.title)
  const run = useAction()
  useEffect(() => setTitle(item.title), [item.id, item.title])

  const save = (): void => {
    const next = title.trim()
    if (!next) setTitle(item.title)
    else if (next !== item.title) run(() => window.api.rename(item.id, next))
  }
  return (
    <input
      className="detail-title"
      value={title}
      aria-label="名稱"
      spellCheck={false}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur()
        if (e.key === 'Escape') {
          setTitle(item.title)
          e.stopPropagation()
        }
      }}
    />
  )
}

function Dates({ item, day, dayStartHour }: Omit<Props, 'steps' | 'onClose'>): React.JSX.Element {
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

function Steps({ parent, steps }: { parent: Item; steps: readonly Item[] }): React.JSX.Element {
  const [text, setText] = useState('')
  const run = useAction()
  const remove = useRemove()
  const firstOpen = steps.find((s) => s.doneAt === null)?.id
  const done = steps.filter((s) => s.doneAt !== null).length

  const add = (): void => {
    const title = text.trim()
    if (!title) return
    setText('')
    run(() => window.api.addStep(parent.id, title))
  }

  return (
    <div className="steps-block">
      <p className="lbl">小步驟{steps.length > 0 && ` · ${done}/${steps.length}`}</p>
      {steps.length > 0 && (
        <ul className="steps">
          {steps.map((s) => (
            <li key={s.id} className={`step${s.doneAt ? ' done' : ''}${s.id === firstOpen ? ' next' : ''}`}>
              <button
                className="box"
                aria-label={s.doneAt ? `取消完成：${s.title}` : `完成：${s.title}`}
                onClick={() => run(() => (s.doneAt ? window.api.reopen(s.id) : window.api.complete(s.id)))}
              >
                <CheckIcon size={9} />
              </button>
              <span className="s">{s.title}</span>
              <button className="act icon" aria-label={`刪除步驟：${s.title}`} onClick={() => remove(s)}>
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        className="field"
        value={text}
        placeholder={steps.length ? '再加一步，Enter 存' : '拆成小步驟：第一步是什麼？'}
        aria-label="新步驟"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
      />
    </div>
  )
}

/** The right-hand panel for one task or idea: name, dates, steps, letting go, delete. */
export function ItemDetail({ item, steps, day, dayStartHour, onClose }: Props): React.JSX.Element {
  const remove = useRemove()
  const drop = useDrop()
  const from = sourceLabel(item.source)
  return (
    <aside className="item-panel" aria-label={item.title}>
      <div className="detail-top">
        <TitleField item={item} />
        <button className="wc small" aria-label="關閉詳情" title="關閉（Esc）" onClick={onClose}>
          <WindowIcon kind="close" />
        </button>
      </div>
      <Dates item={item} day={day} dayStartHour={dayStartHour} />
      <Steps parent={item} steps={steps} />
      {item.postponeCount >= NUDGE_AFTER && (
        <p className="nudge">
          這件事已經換過 {item.postponeCount} 次日子了。拆出一個更小的第一步，或者先放下，都可以。
        </p>
      )}
      <div className="detail-foot">
        <span>
          {monthDay(item.createdAt)} 記下{from && ` · 來自 ${from}`}
        </span>
        <button
          className="btn ghost"
          title="不算完成，也不刪掉；今天做完的清單裡還撿得回來"
          onClick={() => {
            onClose()
            drop(item)
          }}
        >
          不做了
        </button>
        <button
          className="btn danger"
          onClick={() => {
            onClose()
            remove(item)
          }}
        >
          刪除
        </button>
      </div>
    </aside>
  )
}
