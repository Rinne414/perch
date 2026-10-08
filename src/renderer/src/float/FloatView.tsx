import { useCallback, useEffect, useState } from 'react'
import { dayTitle } from '@shared/format'
import { FLOAT_TABS, type FloatTab, type NowPayload } from '@shared/ipc'
import type { Recap } from '@shared/recap'
import { CaptureField } from '../components/CaptureField'
import { MinusIcon, PanelIcon, PinIcon } from '../components/Icons'
import { PowerButton, PowerLine, PowerPanel, usePower } from '../components/Power'
import { ToastProvider } from '../components/Toast'
import { useNow } from '../hooks/useNow'
import { AgentTab } from './AgentTab'
import { StashTab } from './StashTab'
import { TodoTab } from './TodoTab'
import './float.css'

/** Remembers the last tab on this computer only; losing it just means starting on 待辦. */
const TAB_KEY = 'perch.floatTab'
const TAB_LABEL: Readonly<Record<FloatTab, string>> = { todo: '待辦', agents: 'Agent', stash: '暫存' }

const isFloatTab = (v: unknown): v is FloatTab => FLOAT_TABS.includes(v as FloatTab)

function initialTab(): FloatTab {
  const requested = new URLSearchParams(location.search).get('tab')
  if (isFloatTab(requested)) return requested
  try {
    const saved = localStorage.getItem(TAB_KEY)
    if (isFloatTab(saved)) return saved
  } catch {
    // Storage can be unavailable; the to-do tab is a fine start.
  }
  return 'todo'
}

/** The open tab; a clicked notification switches to the tab it is about. */
function useFloatTab(): [FloatTab, (tab: FloatTab) => void] {
  const [tab, setTab] = useState(initialTab)
  const pick = useCallback((next: FloatTab) => {
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // Only a convenience.
    }
  }, [])
  useEffect(() => window.api.onFloatTab(pick), [pick])
  return [tab, pick]
}

function recapText(r: Recap): React.JSX.Element {
  const parts: React.JSX.Element[] = []
  if (r.itemsDone) parts.push(<span key="i">完成 <b>{r.itemsDone} 件</b></span>)
  if (r.routinesDone) parts.push(<span key="r">例行 <b>{r.routinesDone} 次</b></span>)
  if (r.agentsDone) parts.push(<span key="a"><b>{r.agentsDone} 個 agent</b> 跑完</span>)
  return <>昨天{parts.flatMap((p, i) => (i ? ['，', p] : [p]))}</>
}

function Tabs({ tab, payload, onPick }: { tab: FloatTab; payload: NowPayload; onPick: (t: FloatTab) => void }): React.JSX.Element {
  const { today, attention, running } = payload.view
  const button = (t: FloatTab, label: string, badge: React.ReactNode): React.JSX.Element => (
    <button role="tab" aria-selected={tab === t} className={tab === t ? 'on' : undefined} onClick={() => onPick(t)}>
      {label}
      {badge}
    </button>
  )
  return (
    <nav className="ftabs" role="tablist" aria-label="浮窗分頁">
      {button('todo', '待辦', today.length > 0 && <span className="n">{today.length}</span>)}
      {button(
        'agents',
        'Agent',
        attention.length > 0 ? (
          <span className="n wait" title={`${attention.length} 個等你處理`}>
            {attention.length}
          </span>
        ) : (
          running.length > 0 && <span className="run-dot" title={`${running.length} 個執行中`} />
        ),
      )}
      {button('stash', '暫存', null)}
    </nav>
  )
}

function FloatBody(): React.JSX.Element {
  const { payload, at, error } = useNow()
  const [tab, pickTab] = useFloatTab()
  const power = usePower()
  const [powerOpen, setPowerOpen] = useState(false)
  if (!payload) return <main className="float">{error && <p className="empty">{error}</p>}</main>

  const { recap, pinned, dayStartHour } = payload
  const { date, weekday } = dayTitle(payload.view.day)

  return (
    <main className="float">
      <header className="head">
        <h1 className="date">
          {date}
          <span>{weekday}</span>
        </h1>
        <button className="hb" title="打開控制台" onClick={() => window.api.openMain()}>
          <PanelIcon />
          控制台
        </button>
        {power?.supported && <PowerButton state={power} open={powerOpen} onToggle={() => setPowerOpen((o) => !o)} />}
        <button
          className={`win${pinned ? ' on' : ''}`}
          aria-label={pinned ? '取消置頂' : '置頂'}
          title={pinned ? '取消置頂' : '置頂'}
          onClick={() => void window.api.setPinned(!pinned)}
        >
          <PinIcon />
        </button>
        <button className="win" aria-label="收到系統匣" title="收到系統匣" onClick={() => window.api.hideWindow()}>
          <MinusIcon />
        </button>
      </header>

      {power?.supported && powerOpen && <PowerPanel state={power} onClose={() => setPowerOpen(false)} />}
      {power?.plan && <PowerLine state={power} />}

      {recap && (
        <p className="recap">
          <span>{recapText(recap)}</span>
          <button onClick={() => void window.api.dismissRecap()}>收起</button>
        </p>
      )}

      <Tabs tab={tab} payload={payload} onPick={pickTab} />

      <div className="scroll" role="tabpanel" aria-label={TAB_LABEL[tab]}>
        {tab === 'todo' && <TodoTab payload={payload} at={at} />}
        {tab === 'agents' && <AgentTab payload={payload} at={at} />}
        {tab === 'stash' && <StashTab at={at} dayStartHour={dayStartHour} />}
      </div>

      <footer className="cap">
        {tab === 'todo' && (
          <CaptureField
            id="float-capture"
            target="today"
            dayStartHour={dayStartHour}
            placeholder="記點什麼… 例：明天下午3點 交報告"
          />
        )}
        {tab === 'agents' && (
          <button className="link" onClick={() => window.api.openMain('agents')}>
            在控制台看最近 7 天的 agent 紀錄 →
          </button>
        )}
        {tab === 'stash' && (
          <button className="link" onClick={() => window.api.openMain('stash')}>
            在控制台搜尋、改說明 →
          </button>
        )}
      </footer>
    </main>
  )
}

/** The small always-at-hand window: 待辦 and Agent, each one click away. */
export function FloatView(): React.JSX.Element {
  return (
    <ToastProvider>
      <FloatBody />
    </ToastProvider>
  )
}
