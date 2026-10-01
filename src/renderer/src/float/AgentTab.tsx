import type { NowPayload } from '@shared/ipc'
import { resetLabel } from '@shared/quota'
import { AgentSection } from '../components/AgentCard'
import { useAction } from '../components/Toast'

interface Props {
  readonly payload: NowPayload
  readonly at: number
}

/** The float's agent list: who waits on you, who is still working, and what finished lately. */
export function AgentTab({ payload, at }: Props): React.JSX.Element {
  const { view, recentAgents, quotaAlert } = payload
  const { attention, running } = view
  const run = useAction()
  const nothing = attention.length + running.length + recentAgents.length === 0
  const seeAll = attention.length > 1 && (
    <button className="all" onClick={() => run(() => window.api.acknowledgeAgents(attention.map((s) => s.id)))}>
      全部看過了
    </button>
  )

  return (
    <>
      {quotaAlert && (
        <p className="quota-line" role="status">
          Claude 5 小時已用 {Math.round(quotaAlert.usedPercent)}%
          <span>{resetLabel(quotaAlert.resetsAt, at)}</span>
        </p>
      )}
      <AgentSection
        id="fa-wait"
        title="等你處理"
        note={`${attention.length} 個`}
        sessions={attention}
        group="attention"
        at={at}
        layout="below"
        extra={seeAll}
      />
      <AgentSection id="fa-run" title="執行中" note={`${running.length} 個`} sessions={running} group="running" at={at} layout="below" />
      <AgentSection id="fa-recent" title="最近跑完" note="看過的會變淡" sessions={recentAgents} group="recent" at={at} layout="below" />
      {nothing && (
        <div className="empty">
          <p>還沒有 agent 回報。</p>
          <p className="faint">到 控制台 → 設定 → Agent 連線，把用得到的 agent 裝上。</p>
        </div>
      )}
    </>
  )
}
