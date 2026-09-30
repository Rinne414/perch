import { Fragment, useState } from 'react'
import { daysAgoLabel } from '@shared/format'
import type { MainPayload } from '@shared/ipc'
import type { Item } from '@shared/types'
import { CaptureField } from '../components/CaptureField'
import { ChevronIcon } from '../components/Icons'
import { DueEditor } from './DueEditor'
import { sourceLabel, stepCount, TaskRow } from './TaskRow'
import { useAction } from './Toast'
import { useRemove } from './useRemove'

interface Props {
  readonly payload: MainPayload
  readonly at: number
  readonly selected: string | null
  readonly onOpen: (id: string) => void
}

interface ListProps extends Props {
  readonly items: readonly Item[]
}

function InboxList({ items, payload, at, selected, onOpen }: ListProps): React.JSX.Element {
  const [dating, setDating] = useState<string | null>(null)
  const run = useAction()
  const remove = useRemove()

  return (
    <ul>
      {items.map((item) => {
        const from = sourceLabel(item.source)
        const steps = stepCount(payload.view.steps[item.id])
        return (
          <Fragment key={item.id}>
            <TaskRow
              item={item}
              selected={selected === item.id}
              onOpen={onOpen}
              sub={
                <>
                  {daysAgoLabel(item.createdAt, at, payload.dayStartHour)}記下
                  {from && <span className="src"> · {from}</span>}
                  {steps && ` · ${steps}`}
                </>
              }
              actions={
                <>
                  <button className="act" onClick={() => run(() => window.api.plan(item.id, 'today'))}>
                    排到今天
                  </button>
                  <button className="act" aria-expanded={dating === item.id} onClick={() => setDating(item.id)}>
                    截止日
                  </button>
                  <button className="act danger" onClick={() => remove(item)}>
                    刪除
                  </button>
                </>
              }
            />
            {dating === item.id && (
              <li className="inline">
                <DueEditor
                  dayStartHour={payload.dayStartHour}
                  onCancel={() => setDating(null)}
                  onSubmit={(text) => {
                    setDating(null)
                    run(() => window.api.setDue(item.id, text))
                  }}
                />
              </li>
            )}
          </Fragment>
        )
      })}
    </ul>
  )
}

export function InboxTab(props: Props): React.JSX.Element {
  const { payload } = props
  const { inbox, old } = payload.view
  const [showOld, setShowOld] = useState(false)

  return (
    <>
      <header className="ph">
        <h1>隨手記</h1>
        <p>還沒排日期的事</p>
      </header>
      <CaptureField
        id="main-capture-inbox"
        target="inbox"
        dayStartHour={payload.dayStartHour}
        placeholder="想到什麼先丟進來…（寫了日期就直接排上）"
      />

      {inbox.length > 0 ? (
        <section className="sec" aria-label="隨手記">
          <InboxList {...props} items={inbox} />
        </section>
      ) : (
        <div className="mw-empty">
          <p>隨手記是空的。</p>
          <p className="faint">在任何地方按 Ctrl+Alt+N，想到的事就會進來這裡。</p>
        </div>
      )}

      {old.length > 0 && (
        <section className="sec old">
          <button className="more" aria-expanded={showOld} onClick={() => setShowOld(!showOld)}>
            <ChevronIcon open={showOld} />
            舊的 · {old.length} 件<small>超過 {payload.staleDays} 天沒動</small>
          </button>
          {showOld && <InboxList {...props} items={old} />}
        </section>
      )}
    </>
  )
}
