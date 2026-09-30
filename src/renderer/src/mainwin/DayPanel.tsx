import { useCallback, useEffect, useState } from 'react'
import type { DayView, TimelineEntry } from '@shared/calendar'
import { daysBetween } from '@shared/day'
import { clock, dayTitle } from '@shared/format'
import type { Item } from '@shared/types'
import { CheckIcon, WindowIcon } from '../components/Icons'
import { useCompleting } from '../float/rows'
import { useAction, useToast } from './Toast'

/** "今天", "明天", "3 天前", "5 天後". */
function relationLabel(day: string, today: string): string {
  const diff = daysBetween(today, day)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  if (diff === -2) return '前天'
  return diff < 0 ? `${-diff} 天前` : `${diff} 天後`
}

function ItemLine({ item, note }: { item: Item; note?: string }): React.JSX.Element {
  const [checked, complete] = useCompleting(() => window.api.complete(item.id))
  return (
    <li className={`row task${checked ? ' checked' : ''}`}>
      <button className="check" aria-label={`完成：${item.title}`} onClick={complete}>
        <CheckIcon />
      </button>
      <span className="main">
        <span className="title">{item.title}</span>
        {note && <span className="sub">{note}</span>}
      </span>
      <span className="end" />
    </li>
  )
}

function Entry({ entry }: { entry: TimelineEntry }): React.JSX.Element {
  const run = useAction()
  return (
    <li className={`tl-entry ${entry.kind}`}>
      <time>{entry.hasTime ? clock(entry.at) : ''}</time>
      <span className="pin" aria-hidden="true" />
      <span className="what">
        {entry.title}
        {entry.detail && <small>{entry.detail}</small>}
      </span>
      {entry.kind === 'manual' && (
        <button className="act icon" aria-label={`刪掉這筆：${entry.title}`} onClick={() => run(() => window.api.removeManualEntry(entry.id))}>
          <WindowIcon kind="close" />
        </button>
      )}
    </li>
  )
}

function LineInput({ placeholder, label, onEnter }: { placeholder: string; label: string; onEnter: (text: string) => Promise<unknown> }): React.JSX.Element {
  const [text, setText] = useState('')
  const show = useToast()
  const submit = (): void => {
    if (!text.trim()) return
    onEnter(text)
      .then(() => setText(''))
      .catch(() => show('沒有記上，可能是未來的時間，或看不懂'))
  }
  return (
    <input
      className="field"
      value={text}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
    />
  )
}

function Summary({ view }: { view: DayView }): React.JSX.Element {
  const { done, routines, agents, focusMinutes } = view.summary
  return (
    <div className="summary">
      <div className="stat"><b>{done}</b><span>完成的事</span></div>
      <div className="stat"><b>{routines}</b><span>例行</span></div>
      <div className="stat"><b>{agents}</b><span>agent 跑完</span></div>
      <div className="stat"><b>{focusMinutes} 分</b><span>先做 5 分鐘</span></div>
    </div>
  )
}

function Block({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="day-block">
      <p className="lbl">{label}</p>
      {children}
    </div>
  )
}

/** One day: what happened (past, today) and what is coming (today, future). */
export function DayPanel({ day, today }: { day: string; today: string }): React.JSX.Element {
  const [view, setView] = useState<DayView | null>(null)
  const show = useToast()
  const load = useCallback(() => {
    window.api
      .getDay(day)
      .then(setView)
      .catch(() => show('讀不到這天的資料'))
  }, [day, show])
  useEffect(() => {
    load()
    return window.api.onChanged(load)
  }, [load])

  const { date, weekday } = dayTitle(day)
  if (!view || view.day !== day) return <aside className="day-panel" aria-label={`${date} ${weekday}`} />
  const lookingBack = view.relation !== 'future'
  const quiet =
    view.timeline.length + view.schedule.length + view.planned.length + view.dues.length + view.routinesDue.length === 0

  return (
    <aside className="day-panel" aria-label={`${date} ${weekday}`}>
      <h2>
        {date} {weekday}
        <small>{relationLabel(day, today)}</small>
      </h2>
      {lookingBack && <Summary view={view} />}
      {view.schedule.length > 0 && (
        <Block label="行程">
          {view.schedule.map((o) => (
            <div className="slot" key={`${o.item.id}@${o.startAt}`}>
              <span className="t">{o.slot.start}–{o.slot.end}</span>
              <span>{o.item.title}</span>
              <span className="r">{o.item.schedule?.remindMinutes != null ? `${clock(o.startAt - o.item.schedule.remindMinutes * 60_000)} 提醒` : ''}</span>
            </div>
          ))}
        </Block>
      )}
      {view.planned.length > 0 && (
        <Block label={view.relation === 'today' ? '還要做' : '排在這天'}>
          <ul>{view.planned.map((i) => <ItemLine key={i.id} item={i} />)}</ul>
        </Block>
      )}
      {view.dues.length > 0 && (
        <Block label="這天截止">
          <ul>{view.dues.map((i) => <ItemLine key={i.id} item={i} note={i.dueHasTime && i.dueAt ? `${clock(i.dueAt)} 截止` : '截止'} />)}</ul>
        </Block>
      )}
      {view.routinesDue.length > 0 && (
        <Block label="例行，預計這天該做">
          <ul>
            {view.routinesDue.map((i) => (
              <li key={i.id} className="row">
                <span className="bullet" aria-hidden="true" />
                <span className="main"><span className="title">{i.title}</span><span className="sub">每 {i.intervalDays} 天</span></span>
                <span className="end" />
              </li>
            ))}
          </ul>
        </Block>
      )}
      {lookingBack && view.timeline.length > 0 && (
        <Block label="這天的經過">
          <ul className="tl">{view.timeline.map((e) => <Entry key={e.id} entry={e} />)}</ul>
        </Block>
      )}
      {quiet && <p className="faint">{lookingBack ? '這天沒有紀錄。' : '這天還沒有排任何事。'}</p>}
      <div className="day-input">
        {lookingBack ? (
          <LineInput label="補記一筆" placeholder="補記一筆，例：下午3點 跟客戶開會" onEnter={(t) => window.api.addManualEntry(day, t)} />
        ) : (
          <LineInput label="在這天加一件事" placeholder="在這天加一件事…" onEnter={(t) => window.api.captureOn(t, day)} />
        )}
      </div>
    </aside>
  )
}
