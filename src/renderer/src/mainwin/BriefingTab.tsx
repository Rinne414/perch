import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BriefingPayload } from '@shared/briefing'
import type { MainTab } from '@shared/ipc'
import { shortcutLabel } from '@shared/shortcut'
import type { AgentSession } from '@shared/types'
import { CaptureField } from '../components/CaptureField'
import { AsksPanel, laterKey } from './BriefingAsks'
import {
  calmScroll,
  defaultTab,
  firstSelection,
  groupOf,
  SelectionContext,
  useDeckLayout,
  type DeckGroup,
  type DeckLayout,
  type DeckSelection,
  type ReportTab,
} from './briefingDeck'
import { BriefingHero } from './BriefingHero'
import { LanesPanel } from './BriefingLanes'
import { LogPanel } from './BriefingLog'
import { MapPanel } from './BriefingMap'
import { ReportsPanel } from './BriefingReports'
import { IdeasPanel, TodosPanel } from './BriefingTodos'
import { SessionRecord } from './SessionRecord'
import { useBriefing } from './useBriefing'
import './deck.css'
import './deck-parts.css'
import './deck-map.css'
import './deck-lanes.css'
import './deck-cards.css'
import './deck-core.css'
import './deck-log.css'

interface Props {
  readonly dayStartHour: number
  readonly onNavigate: (tab: MainTab) => void
}

/** 晚點再說 only hides a card in this window, for as long as the window stays open. */
let laterKeys: ReadonlySet<string> = new Set()

function CaptureBar({ dayStartHour }: { dayStartHour: number }): React.JSX.Element {
  const [keys, setKeys] = useState<string | null>(null)
  useEffect(() => {
    // Only a hint: without it the bar still works, so a failed read just leaves it out.
    window.api
      .getAppInfo()
      .then((info) => setKeys(shortcutLabel(info.captureShortcut)))
      .catch(() => setKeys(null))
  }, [])
  return (
    <div className="bf-capture" role="group" aria-label="快速記錄">
      <label htmlFor="bf-capture">&gt;</label>
      <CaptureField id="bf-capture" target="inbox" dayStartHour={dayStartHour} placeholder="想到什麼先記下來，Enter 存。寫了日期就是截止日" />
      {keys && <span className="bf-keys">{keys} 隨時叫出來</span>}
    </div>
  )
}

/** The one selection, the report tab and 晚點再說; selecting scrolls the session's card into view. */
function useDeckState(b: BriefingPayload) {
  const [picked, setPicked] = useState<string | null>(null)
  const [tab, setTab] = useState<ReportTab | null>(null)
  const [later, setLater] = useState(laterKeys)
  const [scrollTo, setScrollTo] = useState<{ id: string; n: number } | null>(null)
  // A session that only worked in the window has a lane but no card; it can still be marked.
  const known = (id: string): boolean => groupOf(b, id) !== null || b.lanes.lanes.some((l) => l.id === id)
  const selected = picked && known(picked) ? picked : firstSelection(b)
  const keepLater = (next: ReadonlySet<string>): void => {
    laterKeys = next
    setLater(next)
  }
  const select = (id: string): void => {
    const group = groupOf(b, id)
    if (group && group !== 'waiting') setTab(group)
    if (group === 'waiting') keepLater(new Set([...later].filter((k) => !k.startsWith(`${id}@`))))
    setPicked(id)
    setScrollTo((prev) => ({ id, n: (prev?.n ?? 0) + 1 }))
  }
  useLayoutEffect(() => {
    if (!scrollTo) return
    const el = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(scrollTo.id)}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: calmScroll() })
  }, [scrollTo])
  const pickGroup = (group: DeckGroup): void => {
    const first = { waiting: b.waiting, done: b.done, running: b.running, left: b.left }[group][0]
    if (first) select(first.session.id)
  }
  return { selected, select, tab: tab ?? defaultTab(b, selected), setTab, later, keepLater, pickGroup }
}

interface DeckProps {
  readonly briefing: BriefingPayload
  readonly dayStartHour: number
  readonly layout: DeckLayout
  readonly onNavigate: (tab: MainTab) => void
  readonly onRecord: (session: AgentSession) => void
}

function Deck({ briefing: b, dayStartHour, layout, onNavigate, onRecord }: DeckProps): React.JSX.Element {
  const d = useDeckState(b)
  const selection: DeckSelection = { selected: d.selected, select: d.select, openRecord: onRecord }
  const asks = (
    <AsksPanel
      entries={b.waiting}
      at={b.at}
      later={d.later}
      onLater={(key) => d.keepLater(new Set([...d.later, key]))}
      onShowLater={() => d.keepLater(new Set([...d.later].filter((k) => !b.waiting.some((e) => laterKey(e) === k))))}
    />
  )
  const todos = <TodosPanel briefing={b} />
  const ideas = <IdeasPanel briefing={b} onOpenInbox={() => onNavigate('inbox')} capture={<CaptureBar dayStartHour={dayStartHour} />} />
  const map = <MapPanel briefing={b} />
  const lanes = <LanesPanel briefing={b} />
  const reports = <ReportsPanel briefing={b} tab={d.tab} onTab={d.setTab} />
  const log = <LogPanel briefing={b} />
  const columns: Readonly<Record<DeckLayout, readonly React.JSX.Element[][]>> = {
    three: [[asks, todos, ideas], [map, lanes], [reports, log]],
    two: [[map, lanes, log], [asks, reports, todos, ideas]],
    one: [[asks, map, reports, todos, lanes, log, ideas]],
  }
  return (
    <SelectionContext.Provider value={selection}>
      <BriefingHero briefing={b} onPick={d.pickGroup} />
      <div className={`bf-grid bf-grid--${layout}`}>
        {columns[layout].map((col, i) => (
          <div key={i} className="bf-col">
            {col.map((panel, j) => (
              <Fragment key={j}>{panel}</Fragment>
            ))}
          </div>
        ))}
      </div>
    </SelectionContext.Provider>
  )
}

/** 簡報: what happened while the person was away, on one screen, from what Perch already knows. */
export function BriefingTab({ dayStartHour, onNavigate }: Props): React.JSX.Element {
  const { briefing, error, reload } = useBriefing()
  const layout = useDeckLayout()
  const [record, setRecord] = useState<AgentSession | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)

  const opener = useRef<HTMLElement | null>(null)
  const open = useCallback((session: AgentSession): void => {
    savedScroll.current = root.current?.parentElement?.scrollTop ?? 0
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setRecord(session)
  }, [])
  // Coming back lands where the person was, on the control that opened the record; going in starts at the top.
  useLayoutEffect(() => {
    const pane = root.current?.parentElement
    if (pane) pane.scrollTop = record ? 0 : savedScroll.current
    if (!record && opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    if (!record) opener.current = null
  }, [record])

  return (
    <div className="bf" ref={root}>
      <h1 className="bf-vh">簡報</h1>
      {error && (
        <div className="bf-pn bf-problem" role="alert">
          <span>簡報更新失敗：{error}</span>
          <button className="bf-b" onClick={reload}>
            再試一次
          </button>
        </div>
      )}
      {briefing && record && <SessionRecord session={record} at={briefing.at} dayStartHour={briefing.dayStartHour} onBack={() => setRecord(null)} />}
      {/* Kept mounted under the record, so the selection and hidden cards are as they were on the way back. */}
      <div className="bf-deck" hidden={record !== null}>
        {briefing && <Deck briefing={briefing} dayStartHour={dayStartHour} layout={layout} onNavigate={onNavigate} onRecord={open} />}
      </div>
    </div>
  )
}
