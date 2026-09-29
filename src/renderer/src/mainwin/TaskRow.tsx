import { agentName } from '@shared/agents'
import type { Item } from '@shared/types'
import { CheckIcon } from '../components/Icons'
import { useCompleting } from '../float/rows'

interface Props {
  readonly item: Item
  readonly selected: boolean
  readonly late?: boolean
  readonly sub?: React.ReactNode
  readonly end?: React.ReactNode
  /** Buttons that appear while the pointer or keyboard is on the row. */
  readonly actions?: React.ReactNode
  /** A full-width line under the row, such as the running "先做 5 分鐘" timer. */
  readonly below?: React.ReactNode
  readonly onOpen: (id: string) => void
}

/** "Codex", "舊資料" — who put an item on the list, when it was not the user. */
export function sourceLabel(source: string): string | null {
  if (source === 'user') return null
  if (source.startsWith('agent:')) return agentName(source.slice('agent:'.length))
  if (source === 'import:legacy') return '舊資料'
  return source
}

/** A task or idea: check it off, or open it on the right to edit dates and steps. */
export function TaskRow({ item, selected, late, sub, end, actions, below, onOpen }: Props): React.JSX.Element {
  const [checked, complete] = useCompleting(() => window.api.complete(item.id))
  const classes = ['row', 'task', late && 'late', checked && 'checked', selected && 'selected'].filter(Boolean)
  return (
    <li className={classes.join(' ')}>
      <button className="check" aria-label={`完成：${item.title}`} onClick={complete}>
        <CheckIcon />
      </button>
      <button className="main open" aria-pressed={selected} onClick={() => onOpen(item.id)}>
        <span className="title">{item.title}</span>
        {sub && <span className="sub">{sub}</span>}
      </button>
      <div className="end">
        {actions && <span className="acts">{actions}</span>}
        {end}
      </div>
      {below}
    </li>
  )
}

/** Steps done out of all steps, e.g. "1/3", or null when there are none. */
export function stepCount(steps: readonly Item[] | undefined): string | null {
  if (!steps?.length) return null
  return `${steps.filter((s) => s.doneAt !== null).length}/${steps.length}`
}
