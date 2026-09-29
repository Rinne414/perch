import { useEffect, useState } from 'react'
import { dayTitle } from '@shared/format'
import { MAIN_TABS, type MainPayload, type MainTab } from '@shared/ipc'
import type { Item } from '@shared/types'
import {
  CalendarIcon,
  InboxIcon,
  RoutineIcon,
  SettingsIcon,
  TimelineIcon,
  TodayIcon,
  WindowIcon,
} from '../components/Icons'
import { InboxTab } from './InboxTab'
import { ItemDetail } from './ItemDetail'
import { RoutinesTab } from './RoutinesTab'
import { SettingsTab } from './SettingsTab'
import { TodayTab } from './TodayTab'
import { ToastProvider } from './Toast'
import { useMain } from './useMain'
import './main.css'

interface TabInfo {
  readonly label: string
  readonly icon: (p: { size?: number }) => React.JSX.Element
}

const TABS: Readonly<Record<MainTab, TabInfo>> = {
  today: { label: '今天', icon: TodayIcon },
  inbox: { label: '收件匣', icon: InboxIcon },
  routines: { label: '例行', icon: RoutineIcon },
  timeline: { label: '時間軸', icon: TimelineIcon },
  calendar: { label: '日曆', icon: CalendarIcon },
  settings: { label: '設定', icon: SettingsIcon },
}

const PLACEHOLDER: Partial<Record<MainTab, string>> = {
  timeline: '之後會在這裡回頭看每天做了什麼、agent 跑了什麼，漏記的也可以補上。',
  calendar: '之後會在這裡看整個月：哪天有截止、哪天排了什麼。',
}

function initialTab(): MainTab {
  const requested = new URLSearchParams(location.search).get('tab') as MainTab | null
  return requested && MAIN_TABS.includes(requested) ? requested : 'today'
}

function counts(payload: MainPayload | null): Partial<Record<MainTab, number>> {
  if (!payload) return {}
  const { view } = payload
  return {
    today: view.today.length,
    inbox: view.inbox.length,
    routines: view.routines.filter((r) => r.isDue).length,
  }
}

function Sidebar({ tab, payload, onPick }: { tab: MainTab; payload: MainPayload | null; onPick: (t: MainTab) => void }): React.JSX.Element {
  const n = counts(payload)
  const title = payload ? dayTitle(payload.view.day) : null
  const button = (t: MainTab): React.JSX.Element => {
    const { label, icon: Icon } = TABS[t]
    return (
      <button
        key={t}
        className={`nav${tab === t ? ' on' : ''}`}
        aria-current={tab === t ? 'page' : undefined}
        title={label}
        onClick={() => onPick(t)}
      >
        <Icon />
        <span className="label">{label}</span>
        {!!n[t] && <span className="n">{n[t]}</span>}
      </button>
    )
  }
  return (
    <nav className="side" aria-label="分頁">
      <p className="brand">
        {title?.date}
        <span>{title?.weekday}</span>
      </p>
      {MAIN_TABS.filter((t) => t !== 'settings').map(button)}
      <span className="gap" />
      {button('settings')}
    </nav>
  )
}

function TitleBar(): React.JSX.Element {
  return (
    <div className="bar">
      {(['minimize', 'maximize', 'close'] as const).map((kind) => (
        <button
          key={kind}
          className={`wc${kind === 'close' ? ' x' : ''}`}
          aria-label={{ minimize: '縮小', maximize: '放大', close: '關閉' }[kind]}
          onClick={() => window.api.windowAction(kind)}
        >
          <WindowIcon kind={kind} />
        </button>
      ))}
    </div>
  )
}

/** Finds an open task or idea shown somewhere in the lists. */
function findItem(payload: MainPayload, id: string | null): Item | null {
  if (!id) return null
  const { today, upcoming, inbox, old } = payload.view
  return (
    today.find((e) => e.item.id === id)?.item ??
    upcoming.find((e) => e.item.id === id)?.item ??
    inbox.find((i) => i.id === id) ??
    old.find((i) => i.id === id) ??
    null
  )
}

function Content({ tab, payload, at, selected, onOpen }: {
  tab: MainTab
  payload: MainPayload
  at: number
  selected: string | null
  onOpen: (id: string) => void
}): React.JSX.Element {
  switch (tab) {
    case 'today':
      return <TodayTab payload={payload} at={at} selected={selected} onOpen={onOpen} />
    case 'inbox':
      return <InboxTab payload={payload} at={at} selected={selected} onOpen={onOpen} />
    case 'routines':
      return <RoutinesTab payload={payload} />
    case 'settings':
      return <SettingsTab />
    default:
      return (
        <>
          <header className="ph">
            <h1>{TABS[tab].label}</h1>
          </header>
          <div className="mw-empty centered">
            <p className="strong">還在做</p>
            <p>{PLACEHOLDER[tab]}</p>
          </div>
        </>
      )
  }
}

export function MainWindow(): React.JSX.Element {
  const { payload, at, error } = useMain()
  const [tab, setTab] = useState<MainTab>(initialTab)
  const [selected, setSelected] = useState<string | null>(null)

  const pick = (t: MainTab): void => {
    setTab(t)
    setSelected(null)
  }
  useEffect(() => window.api.onNavigate(pick), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const detail = payload && (tab === 'today' || tab === 'inbox') ? findItem(payload, selected) : null

  return (
    <ToastProvider>
      <div className="mw">
        <Sidebar tab={tab} payload={payload} onPick={pick} />
        <div className="mw-body">
          <TitleBar />
          <div className={`mw-split${detail ? ' with-detail' : ''}`}>
            <main className="mw-pane" key={tab}>
              {payload ? (
                <Content
                  tab={tab}
                  payload={payload}
                  at={at}
                  selected={detail ? selected : null}
                  onOpen={(id) => setSelected(id === selected ? null : id)}
                />
              ) : (
                error && <p className="mw-empty">{error}</p>
              )}
            </main>
            {detail && payload && (
              <ItemDetail
                key={detail.id}
                item={detail}
                steps={payload.view.steps[detail.id] ?? []}
                day={payload.view.day}
                dayStartHour={payload.dayStartHour}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        </div>
      </div>
    </ToastProvider>
  )
}
