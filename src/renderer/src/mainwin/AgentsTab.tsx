import { ago } from '@shared/format'
import type { MainPayload } from '@shared/ipc'
import { QUOTA_ALERT_PERCENT, QUOTA_LABEL, resetLabel, type QuotaSnapshot } from '@shared/quota'
import { AgentSection } from '../components/AgentCard'
import { useAction } from '../components/Toast'
import { RestoreSection } from './RestoreSection'
import './agents.css'

/** Claude Code's usage limits as its status line last reported them. */
function QuotaCard({ quota, at }: { quota: QuotaSnapshot; at: number }): React.JSX.Element {
  const age = ago(quota.at, at)
  return (
    <section className="quota" aria-labelledby="ag-quota">
      <div className="quota-head">
        <h2 id="ag-quota">Claude Code 額度</h2>
        <span className="sub">{age === '剛剛' ? '剛剛更新' : `${age}前更新`} · 只有 Claude Code 開著時才會更新</span>
      </div>
      {quota.windows.map((w) => {
        const used = Math.round(w.usedPercent)
        return (
          <div className="quota-row" key={w.key}>
            <span className="sub">{QUOTA_LABEL[w.key]}</span>
            <span className="qbar" role="progressbar" aria-label={`${QUOTA_LABEL[w.key]}已用`} aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
              <i className={w.usedPercent >= QUOTA_ALERT_PERCENT ? 'hot' : undefined} style={{ width: `${Math.min(100, w.usedPercent)}%` }} />
            </span>
            <b>{used}%</b>
            <span className="sub">{resetLabel(w.resetsAt, at)}</span>
          </div>
        )
      })}
    </section>
  )
}

/** Every agent session of the last week: what it was asked, what came back, and a way back into it. */
export function AgentsTab({ payload, at }: { payload: MainPayload; at: number }): React.JSX.Element {
  const { attention, running, recentAgents, quota, interrupted, dayStartHour } = payload
  const run = useAction()
  const nothing = attention.length + running.length + recentAgents.length + interrupted.length === 0
  return (
    <div className="agent-tab">
      <header className="ph">
        <h1>Agent</h1>
        <p>最近 7 天的 session</p>
        {attention.length > 1 && (
          <button className="btn push" onClick={() => run(() => window.api.acknowledgeAgents(attention.map((s) => s.id)))}>
            全部看過了
          </button>
        )}
      </header>
      <RestoreSection sessions={interrupted} at={at} dayStartHour={dayStartHour} />
      {quota && <QuotaCard quota={quota} at={at} />}
      <AgentSection id="ag-wait" title="等你處理" note={`${attention.length} 個`} sessions={attention} group="attention" at={at} />
      <AgentSection id="ag-run" title="執行中" note={`${running.length} 個`} sessions={running} group="running" at={at} />
      <AgentSection id="ag-recent" title="最近跑完" note="看過的會變淡，不會消失" sessions={recentAgents} group="recent" at={at} />
      {nothing && (
        <div className="mw-empty">
          <p>還沒有 agent 回報。</p>
          <p className="faint">到 設定 → Agent 連線，把用得到的 agent 裝上。</p>
        </div>
      )}
    </div>
  )
}
