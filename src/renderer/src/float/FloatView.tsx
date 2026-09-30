import { agentName } from '@shared/agents'
import { dayTitle } from '@shared/format'
import type { Recap } from '@shared/recap'
import { CaptureField } from '../components/CaptureField'
import { MinusIcon, PinIcon } from '../components/Icons'
import { ScheduleRow } from '../components/ScheduleRow'
import { useNow } from '../hooks/useNow'
import { AgentRow, RoutineRow, TodayRow } from './rows'
import './float.css'

/** "Claude Code ×2、Codex": one name per agent, with a count when several sessions run. */
function runningLabel(agents: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const a of agents) counts.set(a, (counts.get(a) ?? 0) + 1)
  return [...counts].map(([a, n]) => (n > 1 ? `${agentName(a)} ×${n}` : agentName(a))).join('、')
}

function recapText(r: Recap): React.JSX.Element {
  const parts: React.JSX.Element[] = []
  if (r.itemsDone) parts.push(<span key="i">完成 <b>{r.itemsDone} 件</b></span>)
  if (r.routinesDone) parts.push(<span key="r">例行 <b>{r.routinesDone} 次</b></span>)
  if (r.agentsDone) parts.push(<span key="a"><b>{r.agentsDone} 個 agent</b> 跑完</span>)
  return <>昨天{parts.flatMap((p, i) => (i ? ['，', p] : [p]))}</>
}

export function FloatView(): React.JSX.Element {
  const { payload, at, error } = useNow()
  if (!payload) return <main className="float">{error && <p className="empty">{error}</p>}</main>

  const { view, recap, pinned, dayStartHour } = payload
  const { date, weekday } = dayTitle(view.day)
  const nothingNow = view.attention.length + view.today.length + view.routines.length + view.schedule.length === 0

  return (
    <main className="float">
      <header className="head">
        <h1 className="date">
          {date}
          <span>{weekday}</span>
        </h1>
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

      {recap && (
        <p className="recap">
          <span>{recapText(recap)}</span>
          <button onClick={() => void window.api.dismissRecap()}>收起</button>
        </p>
      )}

      <div className="scroll">
        {view.schedule.length > 0 && (
          <section className="sec" aria-labelledby="sec-schedule">
            <h2 id="sec-schedule">今天的行程</h2>
            <ul>
              {view.schedule.map((o) => (
                <ScheduleRow key={`${o.item.id}@${o.startAt}`} occurrence={o} now={at} />
              ))}
            </ul>
          </section>
        )}
        {view.attention.length > 0 && (
          <section className="sec" aria-labelledby="sec-agents">
            <div className="sec-head">
              <h2 id="sec-agents">等你處理</h2>
              {view.attention.length > 1 && (
                <button onClick={() => void window.api.acknowledgeAgents(view.attention.map((s) => s.id))}>
                  全部看過了
                </button>
              )}
            </div>
            <ul>
              {view.attention.map((s) => (
                <AgentRow key={s.id} session={s} now={at} />
              ))}
            </ul>
          </section>
        )}
        {view.running.length > 0 && (
          <p className="running">
            {view.attention.length > 0 ? '另外 ' : ''}
            {view.running.length} 個執行中：{runningLabel(view.running.map((s) => s.agent))}
          </p>
        )}

        {view.today.length > 0 && (
          <section className="sec" aria-labelledby="sec-today">
            <h2 id="sec-today">今天</h2>
            <ul>
              {view.today.map((e) => (
                <TodayRow key={e.item.id} entry={e} now={at} focus={payload.focus} />
              ))}
            </ul>
          </section>
        )}

        {view.routines.length > 0 && (
          <section className="sec" aria-labelledby="sec-routines">
            <h2 id="sec-routines">該做了</h2>
            <ul>
              {view.routines.map((e) => (
                <RoutineRow key={e.item.id} entry={e} />
              ))}
            </ul>
          </section>
        )}

        {nothingNow && (
          <div className="empty">
            <p>現在沒有要處理的事。</p>
            <p className="faint">想到什麼就按 Ctrl+Alt+N 記下來。</p>
          </div>
        )}
      </div>

      <footer className="cap">
        {view.inboxCount > 0 && (
          <button className="inbox" title="打開主視窗的隨手記" onClick={() => window.api.openMain('inbox')}>
            隨手記還有 {view.inboxCount} 件
          </button>
        )}
        <CaptureField
          id="float-capture"
          target="today"
          dayStartHour={dayStartHour}
          placeholder="記點什麼… 例：明天下午3點 交報告"
        />
      </footer>
    </main>
  )
}
