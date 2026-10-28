import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { monthGrid, type DayMarks } from '@shared/calendar'
import type { MainPayload } from '@shared/ipc'
import { DayPanel } from './DayPanel'
import { useToast } from '../components/Toast'
import './calendar.css'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
/** The fewest labels a cell shows; taller cells (a taller window) show more, the rest become "+N". */
const MIN_MARKS = 2
/** Height a cell needs for its date and padding, and for each label line (17px line + 2px gap). */
const CELL_TOP_PX = 35
const MARK_LINE_PX = 19
const MONTH_GAP_PX = 4

/** How many labels fit in one cell of the month grid as it is drawn now. */
function useMarksPerCell(rows: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState(MIN_MARKS)
  useEffect(() => {
    const grid = ref.current
    if (!grid) return
    const measure = (): void => {
      const cell = (grid.clientHeight - (rows - 1) * MONTH_GAP_PX) / rows
      setFit(Math.max(MIN_MARKS, Math.floor((cell - CELL_TOP_PX + 2) / MARK_LINE_PX)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [rows])
  return [ref, fit]
}

interface Month {
  readonly y: number
  readonly m: number
}

const monthOf = (day: string): Month => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) })
const shift = ({ y, m }: Month, by: number): Month => {
  const d = new Date(y, m - 1 + by, 1)
  return { y: d.getFullYear(), m: d.getMonth() + 1 }
}

/**
 * What the person planned or finished that day as labels, and agent work as one quiet count at
 * the bottom; the folder names are in its tooltip and in the day panel.
 */
function Marks({ marks, fit }: { marks: DayMarks | undefined; fit: number }): React.JSX.Element | null {
  if (!marks) return null
  const all = [
    ...marks.dues.map((t) => ({ kind: 'due', text: t })),
    ...marks.schedules.map((t) => ({ kind: 'sched', text: t })),
    ...(marks.done ? [{ kind: 'done', text: `${marks.done} 件` }] : []),
  ]
  const projects = marks.projects.length
  // The agent line takes one place; when labels are left over, "+N" takes the last one, so the cell never grows.
  const room = Math.max(1, fit - (projects > 0 ? 1 : 0))
  const shown = all.length > room ? all.slice(0, room - 1) : all
  return (
    <>
      {all.length > 0 && (
        <span className="marks">
          {shown.map((m, i) => (
            <span key={i} className={`mark ${m.kind}`} title={m.text}>
              {m.text}
            </span>
          ))}
          {all.length > shown.length && (
            <span className="mark more" title={all.slice(shown.length).map((m) => m.text).join('\n')}>
              +{all.length - shown.length}
            </span>
          )}
        </span>
      )}
      {projects > 0 && (
        <span className="agent-line" title={marks.projects.join('\n')}>
          {projects} 個專案
        </span>
      )}
    </>
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
  const [gridRef, fit] = useMarksPerCell(cells.length / 7)

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
        <div className="month" role="grid" ref={gridRef}>
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
                <Marks marks={marks[day]} fit={fit} />
              </button>
            )
          })}
        </div>
        <div className="legend" aria-hidden="true">
          <span><i className="sched" />固定行程、每月例行</span>
          <span><i className="due" />截止</span>
          <span><i className="done" />那天做完的</span>
          <span><i className="agent" />agent 做事的專案數（點那天看是哪些）</span>
        </div>
      </section>
      <DayPanel day={selected} today={today} dayStartHour={payload.dayStartHour} />
    </div>
  )
}
