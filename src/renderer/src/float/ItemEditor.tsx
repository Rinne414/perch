import type { Item } from '@shared/types'
import { Dates, TitleField } from '../components/ItemFields'
import { useDrop, useRemove } from '../components/useRemove'

interface Props {
  readonly item: Item
  readonly nextStep: Item | null
  readonly day: string
  readonly dayStartHour: number
  readonly onClose: () => void
}

/** A task opened right where it sits in the float: rename, move, add a deadline, let go, delete. */
export function ItemEditor({ item, nextStep, day, dayStartHour, onClose }: Props): React.JSX.Element {
  const remove = useRemove()
  const drop = useDrop()
  return (
    <li
      className="edit"
      aria-label={`修改：${item.title}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <TitleField item={item} autoFocus onDone={onClose} />
      <Dates item={item} day={day} dayStartHour={dayStartHour} />
      {nextStep && (
        <p className="sub next">
          下一步：<b>{nextStep.title}</b>
        </p>
      )}
      <div className="edit-acts">
        <button
          className="btn danger"
          onClick={() => {
            onClose()
            remove(item)
          }}
        >
          刪除
        </button>
        <button
          className="btn ghost"
          title="不算完成，也不刪掉；控制台今天做完的清單裡撿得回來"
          onClick={() => {
            onClose()
            drop(item)
          }}
        >
          不做了
        </button>
        <button className="btn primary push" onClick={onClose}>
          好
        </button>
      </div>
    </li>
  )
}
