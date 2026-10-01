import { useState } from 'react'
import type { NowPayload } from '@shared/ipc'
import type { Item } from '@shared/types'
import { ScheduleRow } from '../components/ScheduleRow'
import { ItemEditor } from './ItemEditor'
import { DoneRow, IdeaRow, RoutineRow, TodayRow, UpcomingRow } from './rows'

interface Props {
  readonly payload: NowPayload
  readonly at: number
}

/** The float's to-do list: today (with what is already done), routines due, what comes later, and 隨手記. */
export function TodoTab({ payload, at }: Props): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const { view, focus, upcoming, upcomingCount, ideas, doneToday, dayStartHour } = payload
  const toggle = (id: string): void => setEditing((current) => (current === id ? null : id))
  const close = (): void => setEditing(null)
  const editor = (item: Item, nextStep: Item | null): React.JSX.Element => (
    <ItemEditor key={`edit-${item.id}`} item={item} nextStep={nextStep} day={view.day} dayStartHour={dayStartHour} onClose={close} />
  )

  const total = view.today.length + doneToday.length
  const nothing = total + view.routines.length + view.schedule.length + upcoming.length + ideas.length === 0

  return (
    <>
      {view.schedule.length > 0 && (
        <section className="sec" aria-labelledby="ft-schedule">
          <h2 id="ft-schedule">今天的行程</h2>
          <ul>
            {view.schedule.map((o) => (
              <ScheduleRow key={`${o.item.id}@${o.startAt}`} occurrence={o} now={at} />
            ))}
          </ul>
        </section>
      )}

      {total > 0 && (
        <section className="sec" aria-labelledby="ft-today">
          <h2 id="ft-today">
            今天
            <small>
              做完 {doneToday.length} / {total}
            </small>
          </h2>
          <ul>
            {view.today.map((e) =>
              editing === e.item.id ? (
                editor(e.item, e.nextStep)
              ) : (
                <TodayRow key={e.item.id} entry={e} now={at} focus={focus} onEdit={toggle} />
              ),
            )}
            {doneToday.map((item) => (
              <DoneRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}

      {view.routines.length > 0 && (
        <section className="sec" aria-labelledby="ft-routines">
          <h2 id="ft-routines">該做了</h2>
          <ul>
            {view.routines.map((e) => (
              <RoutineRow key={e.item.id} entry={e} />
            ))}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="sec" aria-labelledby="ft-later">
          <h2 id="ft-later">
            之後<small>{upcomingCount} 件</small>
          </h2>
          <ul>
            {upcoming.map((e) =>
              editing === e.item.id ? (
                editor(e.item, e.nextStep)
              ) : (
                <UpcomingRow key={e.item.id} entry={e} today={view.day} onEdit={toggle} />
              ),
            )}
          </ul>
          {upcomingCount > upcoming.length && (
            <button className="more" onClick={() => window.api.openMain('today')}>
              在控制台看全部 {upcomingCount} 件
            </button>
          )}
        </section>
      )}

      {ideas.length > 0 && (
        <section className="sec" aria-labelledby="ft-ideas">
          <h2 id="ft-ideas">
            隨手記<small>{view.inboxCount} 則還沒排</small>
          </h2>
          <ul>
            {ideas.map((item) =>
              editing === item.id ? (
                editor(item, null)
              ) : (
                <IdeaRow key={item.id} item={item} now={at} dayStartHour={dayStartHour} onEdit={toggle} />
              ),
            )}
          </ul>
          {view.inboxCount > ideas.length && (
            <button className="more" onClick={() => window.api.openMain('inbox')}>
              在控制台看全部 {view.inboxCount} 則
            </button>
          )}
        </section>
      )}

      {nothing && (
        <div className="empty">
          <p>現在沒有要處理的事。</p>
          <p className="faint">想到什麼就在下面記下來，或按 Ctrl+Alt+N。</p>
        </div>
      )}
    </>
  )
}
