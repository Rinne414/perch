import { Fragment, useState } from 'react'
import { dayKey } from '@shared/day'
import { clock, dayLabel } from '@shared/format'
import type { MainPayload } from '@shared/ipc'
import type { UpcomingEntry } from '@shared/mainView'
import { routineEntry, type TodayEntry } from '@shared/now'
import type { Item } from '@shared/types'
import { CaptureField } from '../components/CaptureField'
import { DueEditor } from '../components/DueEditor'
import { FocusArea, FocusStart } from '../components/Focus'
import { ScheduleRow } from '../components/ScheduleRow'
import { AgentCard } from '../components/AgentCard'
import { RoutineRow } from '../float/rows'
import { stepCount, TaskRow } from './TaskRow'
import { DoneToday, OverdueBatch } from './TodaySections'
import { useAction } from '../components/Toast'

interface Props {
  readonly payload: MainPayload
  readonly at: number
  readonly selected: string | null
  readonly onOpen: (id: string) => void
}

function NextStep({ step, count }: { step: Item | null; count: string | null }): React.JSX.Element | null {
  if (!step && !count) return null
  return (
    <>
      {step && (
        <>
          下一步：<b>{step.title}</b>
        </>
      )}
      {step && count && ' · '}
      {count}
    </>
  )
}

/** "23:30 截止" for a deadline with a time today; nothing for a planned item. */
function dueToday(entry: TodayEntry, at: number): React.JSX.Element | null {
  const { item, overdueDays } = entry
  if (item.dueAt === null || !item.dueHasTime || overdueDays > 0) return null
  return <span className={item.dueAt < at ? 'late-text' : 'due'}>{clock(item.dueAt)} 截止</span>
}

function upcomingLabel(entry: UpcomingEntry, today: string, dayStartHour: number): React.JSX.Element {
  const { item, day } = entry
  const dueThatDay = item.dueAt !== null && dayKey(item.dueAt, dayStartHour) === day
  return (
    <span className={dueThatDay ? 'due' : undefined}>
      {dayLabel(day, today)}
      {dueThatDay && item.dueHasTime && ` ${clock(item.dueAt!)}`}
      {dueThatDay && ' 截止'}
    </span>
  )
}

/** 截止日 typed right under a row, like in 隨手記. */
function DueLine({ item, dayStartHour, onClose }: { item: Item; dayStartHour: number; onClose: () => void }): React.JSX.Element {
  const run = useAction()
  return (
    <li className="inline">
      <DueEditor
        dayStartHour={dayStartHour}
        onCancel={onClose}
        onSubmit={(text) => {
          onClose()
          run(() => window.api.setDue(item.id, text))
        }}
      />
    </li>
  )
}

export function TodayTab({ payload, at, selected, onOpen }: Props): React.JSX.Element {
  const { view, attention, dayStartHour } = payload
  const run = useAction()
  const [dating, setDating] = useState<string | null>(null)
  const dueButton = (item: Item): React.JSX.Element => (
    <button className="act" aria-expanded={dating === item.id} title="設一個截止日，到時會提醒" onClick={() => setDating(dating === item.id ? null : item.id)}>
      {item.dueAt === null ? '截止日' : '改截止'}
    </button>
  )
  const dueRoutines = view.routines.filter((r) => r.isDue).map(routineEntry)
  const nothing =
    view.today.length + view.upcoming.length + attention.length + dueRoutines.length + view.schedule.length === 0
  const overdueIds = view.today.filter((e) => e.overdueDays > 0).map((e) => e.item.id)

  return (
    <>
      <header className="ph">
        <h1>今天</h1>
      </header>
      <CaptureField
        id="main-capture-today"
        target="today"
        dayStartHour={dayStartHour}
        placeholder="記點什麼… 寫了日期就是截止日，例：週五 交報告（沒寫日期就排今天）"
      />

      {view.schedule.length > 0 && (
        <section className="sec" aria-labelledby="mw-schedule">
          <h2 id="mw-schedule">今天的行程</h2>
          <ul>
            {view.schedule.map((o) => (
              <ScheduleRow key={`${o.item.id}@${o.startAt}`} occurrence={o} now={at} />
            ))}
          </ul>
        </section>
      )}

      {attention.length > 0 && (
        <section className="sec" aria-labelledby="mw-agents">
          <h2 id="mw-agents">
            等你處理<small>{attention.length} 個</small>
          </h2>
          <ul>
            {attention.map((s) => (
              <AgentCard key={s.id} session={s} group="attention" at={at} />
            ))}
          </ul>
        </section>
      )}

      {view.today.length > 0 && (
        <section className="sec" aria-labelledby="mw-today">
          <h2 id="mw-today">
            今天<small>{view.today.length} 件</small>
          </h2>
          <ul>
            {view.today.map((e) => (
              <Fragment key={e.item.id}>
                <TaskRow
                  item={e.item}
                  selected={selected === e.item.id}
                  late={e.overdueDays > 0}
                  onOpen={onOpen}
                  sub={
                    e.overdueDays > 0 ? (
                      <span className="late-text">逾期 {e.overdueDays} 天</span>
                    ) : (
                      <NextStep step={e.nextStep} count={stepCount(view.steps[e.item.id])} />
                    )
                  }
                  end={dueToday(e, at)}
                  actions={
                    <>
                      {payload.focus?.itemId !== e.item.id && <FocusStart item={e.item} nextStep={e.nextStep} />}
                      <button className="act" title="今天不做，移到明天" onClick={() => run(() => window.api.postpone(e.item.id))}>
                        明天
                      </button>
                      {dueButton(e.item)}
                    </>
                  }
                  below={<FocusArea item={e.item} focus={payload.focus} />}
                />
                {dating === e.item.id && <DueLine item={e.item} dayStartHour={dayStartHour} onClose={() => setDating(null)} />}
              </Fragment>
            ))}
          </ul>
          {overdueIds.length >= 2 && <OverdueBatch ids={overdueIds} />}
        </section>
      )}

      {dueRoutines.length > 0 && (
        <section className="sec" aria-labelledby="mw-routines">
          <h2 id="mw-routines">
            該做了<small>例行</small>
          </h2>
          <ul>
            {dueRoutines.map((e) => (
              <RoutineRow key={e.item.id} entry={e} />
            ))}
          </ul>
        </section>
      )}

      {view.upcoming.length > 0 && (
        <section className="sec" aria-labelledby="mw-upcoming">
          <h2 id="mw-upcoming">
            之後<small>排了日期、還沒到的</small>
          </h2>
          <ul>
            {view.upcoming.map((e) => (
              <Fragment key={e.item.id}>
                <TaskRow
                  item={e.item}
                  selected={selected === e.item.id}
                  onOpen={onOpen}
                  sub={<NextStep step={e.nextStep} count={stepCount(view.steps[e.item.id])} />}
                  end={upcomingLabel(e, view.day, dayStartHour)}
                  actions={
                    <>
                      <button className="act" onClick={() => run(() => window.api.plan(e.item.id, 'today'))}>
                        排到今天
                      </button>
                      {dueButton(e.item)}
                    </>
                  }
                />
                {dating === e.item.id && <DueLine item={e.item} dayStartHour={dayStartHour} onClose={() => setDating(null)} />}
              </Fragment>
            ))}
          </ul>
        </section>
      )}

      {nothing && (
        <div className="mw-empty">
          <p>今天沒有排事情。</p>
          <p className="faint">上面打一行就會排進今天；隨手記裡的事也可以排過來。</p>
        </div>
      )}

      <DoneToday items={view.doneToday} />
    </>
  )
}
