import { dayKey } from '@shared/day'
import { clock, dayLabel } from '@shared/format'
import { untilLabel, type Occurrence } from '@shared/schedule'
import './schedule.css'

type SlotState = 'upcoming' | 'now' | 'past'

const stateOf = (o: Occurrence, now: number): SlotState =>
  now >= o.endAt ? 'past' : now >= o.startAt ? 'now' : 'upcoming'

/** "還有 1 小時 20 分" before, "進行中 · 到 19:00" during, "已結束" after. */
function stateLabel(o: Occurrence, now: number): string {
  const state = stateOf(o, now)
  if (state === 'now') return `進行中 · 到 ${clock(o.endAt)}`
  if (state === 'past') return '已結束'
  return untilLabel(o.startAt - now)
}

/** When a fixed-time routine happens next, for its row in 例行. */
export function nextLabel(o: Occurrence | null, now: number): string {
  if (!o) return ''
  if (o.startAt <= now) return `進行中 · 到 ${clock(o.endAt)}`
  const today = dayKey(now, 0)
  const day = dayKey(o.startAt, 0)
  return day === today ? `今天 ${clock(o.startAt)} 開始` : `${dayLabel(day, today)} ${clock(o.startAt)}`
}

/** One slot of a fixed-time routine on today's list (float and main window). */
export function ScheduleRow({ occurrence: o, now }: { occurrence: Occurrence; now: number }): React.JSX.Element {
  const state = stateOf(o, now)
  return (
    <li className={`row slot-row ${state}`}>
      <span className="slot-dot" aria-hidden="true" />
      <div className="main">
        <div className="title">{o.item.title}</div>
        <div className="sub slot-time">
          {o.slot.start}–{o.slot.end}
        </div>
      </div>
      <div className="end">
        <span className="slot-state">{stateLabel(o, now)}</span>
      </div>
    </li>
  )
}
