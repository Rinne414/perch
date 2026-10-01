import { useState } from 'react'
import { monthDay } from '@shared/format'
import type { Item } from '@shared/types'
import { CheckIcon, TrashIcon, WindowIcon } from '../components/Icons'
import { Dates, TitleField } from '../components/ItemFields'
import { sourceLabel } from './TaskRow'
import { useAction } from '../components/Toast'
import { useDrop, useRemove } from '../components/useRemove'
import './panel.css'

interface Props {
  readonly item: Item
  readonly steps: readonly Item[]
  readonly day: string
  readonly dayStartHour: number
  readonly onClose: () => void
}

/** After this many roll-overs the panel offers a way out instead of another try. */
const NUDGE_AFTER = 3

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
