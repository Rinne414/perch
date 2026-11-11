import { useState } from 'react'
import { stampLabel, type BriefingPayload, type IdeaEntry } from '@shared/briefing'
import type { TodoGroup, TodoRow } from '@shared/todos'
import { useAction, useToast } from '../components/Toast'
import { useDrop } from '../components/useRemove'
import { useFocusAfterRemoval, useSelection } from './briefingDeck'
import { Panel } from './BriefingGlyphs'

const rowKey = (sessionId: string, key: string): string => `${sessionId}:${key}`

/**
 * 處理了 and 排到今天 for one report point. The row leaves at once; the toast's 復原 takes the
 * tick back (and the task 排到今天 made).
 */
function useTodoActions(hide: (id: string, on: boolean) => void) {
  const show = useToast()
  const refocus = useFocusAfterRemoval()
  const failed = (id: string) => () => {
    hide(id, false)
    show('沒有成功，再試一次看看')
  }
  const handled = (g: TodoGroup, r: TodoRow, from: Element): void => {
    const id = rowKey(g.sessionId, r.key)
    refocus(from, 'li.bf-td')
    hide(id, true)
    window.api
      .markTodo(g.sessionId, r.key)
      .then(() => show('標成處理了', () => window.api.unmarkTodo(g.sessionId, r.key).then(() => hide(id, false))))
      .catch(failed(id))
  }
  const today = (g: TodoGroup, r: TodoRow, from: Element): void => {
    const id = rowKey(g.sessionId, r.key)
    refocus(from, 'li.bf-td')
    hide(id, true)
    window.api
      .noteFromAgent(g.sessionId, r.text, 'today')
      .then(async (item) => {
        // The task exists now: that is the result. If the tick does not stick, the row only comes
        // back on the next refresh; offering a retry here would make a second task.
        const ticked = await window.api.markTodo(g.sessionId, r.key).then(
          () => true,
          () => false,
        )
        show('排到今天了', async () => {
          await window.api.remove(item.id)
          if (ticked) await window.api.unmarkTodo(g.sessionId, r.key)
          hide(id, false)
        })
      })
      .catch(failed(id))
  }
  return { handled, today }
}

/** When the report is from, as the rest of the briefing says times. */
interface Clock {
  readonly at: number
  readonly dayStartHour: number
}

function Source({ g, clock }: { g: TodoGroup; clock: Clock }): React.JSX.Element {
  const { select } = useSelection()
  const when = g.reportAt === null ? '' : `，${stampLabel(g.reportAt, clock.at, clock.dayStartHour)}`
  return (
    <button className="bf-src" title="看這份報告" onClick={() => select(g.sessionId)}>
      來自「{g.name}」{when}
    </button>
  )
}

interface RowsProps {
  readonly g: TodoGroup
  readonly hidden: ReadonlySet<string>
  readonly actions: ReturnType<typeof useTodoActions>
  readonly clock: Clock
}

function GroupRows({ g, hidden, actions, clock }: RowsProps): React.JSX.Element {
  const { select } = useSelection()
  const rows = g.rows.filter((r) => !hidden.has(rowKey(g.sessionId, r.key)))
  return (
    <>
      {rows.map((r) => (
        <li key={r.key} className="bf-td">
          <button className="bf-cb" aria-label={`處理了：${r.text}`} title="處理了" onClick={(e) => actions.handled(g, r, e.currentTarget)} />
          <span className="bf-tx">{r.text}</span>
          <Source g={g} clock={clock} />
          <button className="bf-b bf-b--sm" title="記成今天的待辦，放在這個專案下" onClick={(e) => actions.today(g, r, e.currentTarget)}>
            排到今天
          </button>
        </li>
      ))}
      {g.more > 0 && (
        <li className="bf-td bf-td--more">
          <button className="bf-src" title={`看「${g.name}」的報告`} onClick={() => select(g.sessionId)}>
            這份報告還有 {g.more} 件
          </button>
        </li>
      )}
    </>
  )
}

/** 報告裡留給你的事: the points each report leaves for the person, ticked off here. */
export function TodosPanel({ briefing }: { briefing: BriefingPayload }): React.JSX.Element {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const hide = (id: string, on: boolean): void =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const actions = useTodoActions(hide)
  const { groups } = briefing.todos
  const left = groups.reduce((n, g) => n + g.rows.filter((r) => !hidden.has(rowKey(g.sessionId, r.key))).length + g.more, 0)
  return (
    <Panel id="bf-h-todo" title="報告裡留給你的事" hint="從每份報告「需要你做的事」那一段抓的" count={left}>
      {left === 0 ? (
        <p className="bf-note">這幾份報告都沒有留事情給你。</p>
      ) : (
        <ul className="bf-list">
          {groups.map((g) => (
            <GroupRows key={g.sessionId} g={g} hidden={hidden} actions={actions} clock={{ at: briefing.at, dayStartHour: briefing.dayStartHour }} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function IdeaRow({ entry }: { entry: IdeaEntry }): React.JSX.Element {
  const run = useAction()
  const drop = useDrop()
  const { item, project } = entry
  return (
    <li className="bf-td bf-td--idea">
      <span className="bf-tx">{item.title}</span>
      <span className="bf-src bf-src--plain">{project ?? '沒有專案'}</span>
      <span className="bf-td-acts">
        <button className="bf-b bf-b--sm" onClick={() => run(() => window.api.plan(item.id, 'today'))}>
          排到今天
        </button>
        <button className="bf-b bf-b--sm bf-b--ghost" title="放下這件事；之後的提示可以復原" onClick={() => drop(item)}>
          不做了
        </button>
      </span>
    </li>
  )
}

interface IdeasProps {
  readonly briefing: BriefingPayload
  readonly onOpenInbox: () => void
  /** The quick-capture field: what is typed there lands in 隨手記, where these come from. */
  readonly capture: React.ReactNode
}

/** 提過、還沒做的: the newest open ideas from 隨手記, and a field to add one. */
export function IdeasPanel({ briefing, onOpenInbox, capture }: IdeasProps): React.JSX.Element {
  const { ideas, ideaCount } = briefing
  return (
    <Panel id="bf-h-idea" title="提過、還沒做的" hint={ideaCount > ideas.length ? `${ideaCount} 個裡最新的 ${ideas.length} 個` : undefined} count={ideaCount} variant={ideaCount > 0 ? 'grow' : undefined}>
      {ideaCount === 0 ? (
        <p className="bf-note">隨手記裡沒有還沒做的想法。</p>
      ) : (
        <ul className="bf-list">
          {ideas.map((e) => (
            <IdeaRow key={e.item.id} entry={e} />
          ))}
        </ul>
      )}
      {ideaCount > ideas.length && (
        <button className="bf-b bf-b--sm bf-b--ghost bf-self-start" onClick={onOpenInbox}>
          全部 {ideaCount} 個在隨手記
        </button>
      )}
      <div className="bf-push-down">{capture}</div>
    </Panel>
  )
}
