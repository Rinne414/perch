import { useCallback, useEffect, useMemo, useState } from 'react'
import { monthGrid, type DayMarks } from '@shared/calendar'
import type { MainPayload } from '@shared/ipc'
import { DayPanel } from './DayPanel'
import { useToast } from './Toast'
import './calendar.css'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
/** A cell has room for two small labels; the rest become "+N". */
const MARKS_PER_CELL = 2

interface Month {
  readonly y: number
  readonly m: number
}

const monthOf = (day: string): Month => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) })
const shift = ({ y, m }: Month, by: number): Month => {
  const d = new Date(y, m - 1 + by, 1)
  return { y: d.getFullYear(), m: d.getMonth() + 1 }
}

function Marks({ marks }: { marks: DayMarks | undefined }): React.JSX.Element | null {
  if (!marks) return null
  const all = [
    ...marks.dues.map((t) => ({ kind: 'due', text: t })),
    ...marks.schedules.map((t) => ({ kind: 'sched', text: t })),
    ...(marks.done ? [{ kind: 'done', text: `${marks.done} 件` }] : []),
  ]
  if (all.length === 0) return null
  // When something is left over, "+N" takes the last place so the cell never grows.
  const shown = all.length > MARKS_PER_CELL ? all.slice(0, MARKS_PER_CELL - 1) : all
  return (
    <span className="marks">
      {shown.map((m, i) => (
        <span key={i} className={`mark ${m.kind}`}>
          {m.text}
        </span>
      ))}
      {all.length > shown.length && <span className="mark more">+{all.length - shown.length}</span>}
    </span>
  )
}

/** The month like the Windows tray calendar, with the chosen day opened on the right. */
export function CalendarTab({ payload }: { payload: MainPayload }): React.JSX.Element {
  const today = payload.view.day
  const [month, setMonth] = useState<Month>(() => monthOf(today))
  const [selected, setSelected] = useState(today)
  const [marks, setMarks] = useState<Readonly<Record<string, DayMarks>>>({})
  const show = useToast()
  const cells = useMemo(() => monthGrid(month.y, month.m), [month])

  const load = useCallback(() => {
    window.api
      .getMonth(cells[0], cells[cells.length - 1])
      .then((list) => setMarks(Object.fromEntries(list.map((d) => [d.day, d]))))
      .catch(() => show('讀不到這個月的資料'))
  }, [cells, show])
  useEffect(() => {
    load()
    return window.api.onChanged(load)
  }, [load])

  const goToday = (): void => {
    setMonth(monthOf(today))
    setSelected(today)
  }

  return (
    <div className="cal-wrap">
      <section className="cal" aria-label="月曆">
        <div className="cal-head">
          <h1>
            {month.y} 年 {month.m} 月
          </h1>
          <button className="btn" onClick={goToday}>
            今天
          </button>
          <button className="cal-nav" aria-label="上個月" onClick={() => setMonth(shift(month, -1))}>
            ‹
          </button>
          <button className="cal-nav" aria-label="下個月" onClick={() => setMonth(shift(month, 1))}>
            ›
          </button>
        </div>
        <div className="weekdays" aria-hidden="true">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="month" role="grid">
          {cells.map((day) => {
            const classes = [
              'day',
              monthOf(day).m !== month.m && 'other',
              day === today && 'today',
              day === selected && 'sel',
            ].filter(Boolean)
            return (
              <button key={day} className={classes.join(' ')} aria-pressed={day === selected} aria-label={day} onClick={() => setSelected(day)}>
                <span className="d">{Number(day.slice(8))}</span>
                <Marks marks={marks[day]} />
              </button>
            )
          })}
        </div>
        <div className="legend" aria-hidden="true">
          <span><i className="sched" />固定行程</span>
          <span><i className="due" />截止</span>
          <span><i className="done" />那天做完的</span>
        </div>
      </section>
      <DayPanel day={selected} today={today} />
    </div>
  )
}
