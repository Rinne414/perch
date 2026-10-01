import { useCallback, useEffect, useRef, useState } from 'react'
import { groupTimeline, type DayView, type TimelineEntry } from '@shared/calendar'
import { daysBetween } from '@shared/day'
import { clock, dayTitle } from '@shared/format'
import type { Item } from '@shared/types'
import { CheckIcon, WindowIcon } from '../components/Icons'
import { useCompleting } from '../float/rows'
import { useAction, useToast } from '../components/Toast'

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

/** Every reply of one agent in one project that day, folded into one line until opened. */
function AgentGroup({ title, replies }: { title: string; replies: readonly TimelineEntry[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const first = replies[0]
  const last = replies[replies.length - 1]
  const failed = replies.filter((r) => r.kind === 'agent-failed').length
  return (
    <li className="tl-entry agent tl-group">
      <time>{clock(first.at)}</time>
      <span className="pin" aria-hidden="true" />
      <span className="what">
        {title}
        <small>
          <span className="count">{replies.length} 次回覆</span> · 到 {clock(last.at)}
          {failed > 0 && <span className="late-text"> · {failed} 次失敗</span>}
          {!open && last.detail && <span className="last">最後：{last.detail}</span>}
        </small>
      </span>
      <button className="chev" aria-expanded={open} aria-label={`${open ? '收起' : '展開'} ${title} 的回覆`} onClick={() => setOpen(!open)}>
        {open ? '收起' : '展開'}
      </button>
      {open && (
        <ol className="replies">
          {replies.map((r) => (
            <li key={r.id} className={r.kind === 'agent-failed' ? 'failed' : undefined}>
              <time>{clock(r.at)}</time>
              <span>{r.detail ?? '（沒有文字）'}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}

const NOTE_SAVE_MS = 600

type NoteState = 'saved' | 'typing' | 'failed'
const NOTE_STATE: Readonly<Record<NoteState, string>> = { saved: '已存', typing: '存檔中…', failed: '沒有存到，再打一個字試試' }

/** The diary: saved a moment after typing stops, and right away when the day changes. */
function DayNote({ day, initial }: { day: string; initial: string }): React.JSX.Element {
  const [text, setText] = useState(initial)
  const [state, setState] = useState<NoteState>('saved')
  const pending = useRef<{ timer: number; text: string } | null>(null)

  const save = useCallback(
    (value: string) => {
      pending.current = null
      window.api
        .setDayNote(day, value)
        .then(() => setState('saved'))
        .catch(() => setState('failed'))
    },
    [day],
  )

  // Leaving the day (or the tab) must not lose the last few words.
  useEffect(
    () => () => {
      if (!pending.current) return
      window.clearTimeout(pending.current.timer)
      void window.api.setDayNote(day, pending.current.text)
    },
    [day],
  )

  const change = (value: string): void => {
    setText(value)
    setState('typing')
    if (pending.current) window.clearTimeout(pending.current.timer)
    pending.current = { timer: window.setTimeout(() => save(value), NOTE_SAVE_MS), text: value }
  }

  return (
    <div className="day-block">
      <div className="lbl-row">
        <label className="lbl" htmlFor={`note-${day}`}>
          筆記
        </label>
        <span className={`saved${state === 'failed' ? ' late-text' : ''}`} aria-live="polite">
          {text || state !== 'saved' ? NOTE_STATE[state] : ''}
        </span>
      </div>
      <textarea
        id={`note-${day}`}
        className="note-box"
        rows={3}
        value={text}
        placeholder="今天過得怎樣？想到什麼都可以寫"
        onChange={(e) => change(e.target.value)}
      />
    </div>
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
  const { done, routines, agentReplies, agentProjects, focusMinutes } = view.summary
  return (
    <div className="summary">
      <div className="stat"><b>{done}</b><span>完成的事</span></div>
      <div className="stat"><b>{routines}</b><span>例行</span></div>
      <div className="stat"><b>{agentReplies}</b><span>agent 回覆{agentProjects > 0 && `（${agentProjects} 個 project）`}</span></div>
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
      {lookingBack && <DayNote key={day} day={day} initial={view.note} />}
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
          <ul className="tl">
            {groupTimeline(view.timeline).map((line) =>
              line.kind === 'entry' ? (
                <Entry key={line.entry.id} entry={line.entry} />
              ) : (
                <AgentGroup key={`${line.title}@${line.replies[0].id}`} title={line.title} replies={line.replies} />
              ),
            )}
          </ul>
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
