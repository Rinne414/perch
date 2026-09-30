import { agentName, STATUS_LABEL } from '@shared/agents'
import { ago } from '@shared/format'
import type { MainPayload } from '@shared/ipc'
import type { AgentSession } from '@shared/types'
import { project, ResumeButton } from '../float/rows'
import { useAction } from './Toast'
import './agents.css'

type Group = 'attention' | 'running' | 'recent'

function timeLabel(s: AgentSession, group: Group, at: number): string {
  if (group === 'running') {
    const took = ago(s.startedAt, at)
    return took === '剛剛' ? '剛開始' : `跑了 ${took}`
  }
  const took = ago(group === 'attention' ? (s.attentionAt ?? s.updatedAt) : s.updatedAt, at)
  return took === '剛剛' ? took : `${took}前`
}

/** A session was seen when it once needed the person and they marked it. */
const wasSeen = (s: AgentSession): boolean =>
  s.attentionAt !== null && s.acknowledgedAt !== null && s.acknowledgedAt >= s.attentionAt

function AgentCard({ session, group, at }: { session: AgentSession; group: Group; at: number }): React.JSX.Element {
  const run = useAction()
  const where = project(session.cwd)
  const seen = group === 'recent' && wasSeen(session)
  return (
    <li className={`row agent agent-${session.status}${seen ? ' seen' : ''}`}>
      <span className="dot" aria-hidden="true" />
      <div className="main">
        <div className="title">{agentName(session.agent)}</div>
        <div className="sub">
          <em>{STATUS_LABEL[session.status]}</em>
          {where && ` · ${where}`}
        </div>
        {session.title && <div className="sub prompt">「{session.title}」</div>}
        {session.detail && <div className="res">{session.detail}</div>}
      </div>
      <div className="end">
        <span>{timeLabel(session, group, at)}</span>
        <span className="agent-acts">
          <ResumeButton session={session} />
          {group === 'attention' && (
            <button className="ack" onClick={() => run(() => window.api.acknowledgeAgents([session.id]))}>
              看過了
            </button>
          )}
        </span>
      </div>
    </li>
  )
}

function Section({ id, title, note, sessions, group, at }: {
  id: string
  title: string
  note: string
  sessions: readonly AgentSession[]
  group: Group
  at: number
}): React.JSX.Element | null {
  if (sessions.length === 0) return null
  return (
    <section className="sec" aria-labelledby={id}>
      <h2 id={id}>
        {title}
        <small>{note}</small>
      </h2>
      <ul>
        {sessions.map((s) => (
          <AgentCard key={s.id} session={s} group={group} at={at} />
        ))}
      </ul>
    </section>
  )
}

/** Every agent session of the last week: what it was asked, what came back, and a way back into it. */
export function AgentsTab({ payload, at }: { payload: MainPayload; at: number }): React.JSX.Element {
  const { attention, running, recentAgents } = payload
  const run = useAction()
  const nothing = attention.length + running.length + recentAgents.length === 0
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
      <Section id="ag-wait" title="等你處理" note={`${attention.length} 個`} sessions={attention} group="attention" at={at} />
      <Section id="ag-run" title="執行中" note={`${running.length} 個`} sessions={running} group="running" at={at} />
      <Section id="ag-recent" title="最近跑完" note="看過的會變淡，不會消失" sessions={recentAgents} group="recent" at={at} />
      {nothing && (
        <div className="mw-empty">
          <p>還沒有 agent 回報。</p>
          <p className="faint">到 設定 → Agent 連線，把用得到的 agent 裝上。</p>
        </div>
      )}
    </div>
  )
}
