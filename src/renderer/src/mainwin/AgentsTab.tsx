import { useState } from 'react'
import { ago } from '@shared/format'
import type { MainPayload } from '@shared/ipc'
import { QUOTA_ALERT_PERCENT, QUOTA_LABEL, resetLabel, type QuotaSnapshot } from '@shared/quota'
import { restartTitle, restartWhen, type RestoreSummary } from '@shared/restore'
import { AgentCard, AgentSection } from '../components/AgentCard'
import { PowerIcon, RestoreIcon } from '../components/Icons'
import { useAction } from '../components/Toast'
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

const openRestore = (): void => void window.api.openRestore()

/** After a restart: how many sessions it cut off, and the way into the reopen window. */
function RestartLine({ summary }: { summary: RestoreSummary }): React.JSX.Element {
  return (
    <div className="rs-line" role="status">
      <PowerIcon size={15} />
      <div>
        <div className="t">{restartTitle(summary.restart, summary.interrupted)}</div>
        {summary.restart && <div className="sub">{restartWhen(summary.restart)}</div>}
      </div>
      <button className="btn" onClick={openRestore}>
        挑選接回
      </button>
    </div>
  )
}

interface FoldProps {
  readonly runs: MainPayload['backgroundRuns']
  readonly at: number
}

/** Runs other programs started for one answer, folded so they do not bury the person's own sessions. */
function BackgroundRuns({ runs, at }: FoldProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (runs.length === 0) return null
  return (
    <section className="sec agent-fold" aria-label="背景一次性任務">
      <div className="fold-row">
        <span>背景一次性任務 {runs.length} 個</span>
        <span className="sub">別的程式叫 agent 跑一次、跑完一分鐘內就關的</span>
        <button className="act push" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '收起' : '展開'}
        </button>
      </div>
      {open && (
        <ul>
          {runs.map((s) => (
            <AgentCard key={s.id} session={s} group="recent" at={at} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** Every agent session of the last week: what it was asked, what came back, and a way back into it. */
export function AgentsTab({ payload, at }: { payload: MainPayload; at: number }): React.JSX.Element {
  const { attention, running, recentAgents, backgroundRuns, quota, restore, cutoffAt } = payload
  const run = useAction()
  const nothing = attention.length + running.length + recentAgents.length + backgroundRuns.length === 0
  return (
    <div className="agent-tab">
      <header className="ph">
        <h1>Agent</h1>
        <p>最近 7 天的 session</p>
        <span className="push" />
        {attention.length > 1 && (
          <button className="btn" onClick={() => run(() => window.api.acknowledgeAgents(attention.map((s) => s.id)))}>
            全部看過了
          </button>
        )}
        {restore && (
          <button className="btn" title="挑最近用過、現在沒開著的 session，在 Windows Terminal 接回" onClick={openRestore}>
            <RestoreIcon />
            接回 session…
          </button>
        )}
      </header>
      {restore && restore.interrupted > 0 && <RestartLine summary={restore} />}
      {quota && <QuotaCard quota={quota} at={at} />}
      <AgentSection id="ag-wait" title="等你處理" note={`${attention.length} 個 · 只算還開著的`} sessions={attention} group="attention" at={at} />
      <AgentSection id="ag-run" title="執行中" note={`${running.length} 個`} sessions={running} group="running" at={at} />
      <AgentSection id="ag-recent" title="最近跑完" note="關掉的都放這裡；看過的會變淡" sessions={recentAgents} group="recent" at={at} cutoffAt={cutoffAt} />
      <BackgroundRuns runs={backgroundRuns} at={at} />
      {nothing && (
        <div className="mw-empty">
          <p>還沒有 agent 回報。</p>
          <p className="faint">到 設定 → Agent 連線，把用得到的 agent 裝上。</p>
        </div>
      )}
    </div>
  )
}
