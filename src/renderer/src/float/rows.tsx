import { useState } from 'react'
import { agentName, resumeCommand, STATUS_LABEL } from '@shared/agents'
import { ago, clock } from '@shared/format'
import type { RoutineEntry, TodayEntry } from '@shared/now'
import type { FocusState } from '@shared/ipc'
import type { AgentSession } from '@shared/types'
import { FocusArea, FocusStart } from '../components/Focus'
import { CheckIcon } from '../components/Icons'

/** How long the check mark stays visible before the row leaves. */
const COMPLETE_DELAY_MS = 380

export const project = (cwd: string | null): string | null => cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? null

export function useCompleting(action: () => Promise<void>): [boolean, () => void] {
  const [checked, setChecked] = useState(false)
  const run = (): void => {
    if (checked) return
    setChecked(true)
    setTimeout(() => void action().catch(() => setChecked(false)), COMPLETE_DELAY_MS)
  }
  return [checked, run]
}

/** How long "已複製" stays on the button. */
const COPIED_MS = 1500

/** Copies the command that reopens the session, so going back is one paste away. */
export function ResumeButton({ session }: { session: AgentSession }): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)
  const command = resumeCommand(session)
  if (!command) return null
  return (
    <button
      className="later resume"
      title={`複製回到這個 session 的指令，貼到終端機就能繼續：\n${command}`}
      onClick={() => {
        window.api.copyText(command)
        setCopied(true)
        setTimeout(() => setCopied(false), COPIED_MS)
      }}
    >
      {copied ? '已複製' : '回去'}
    </button>
  )
}

export function AgentRow({ session, now }: { session: AgentSession; now: number }): React.JSX.Element {
  const where = project(session.cwd)
  return (
    <li className={`row agent agent-${session.status}`}>
      <span className="dot" aria-hidden="true" />
      <div className="main">
        <div className="title">{agentName(session.agent)}</div>
        <div className="sub">
          <em>{STATUS_LABEL[session.status]}</em>
          {where && ` · ${where}`}
        </div>
        {(session.detail ?? session.title) && <div className="sub detail">{session.detail ?? session.title}</div>}
      </div>
      <div className="end">
        <span>{ago(session.attentionAt ?? session.updatedAt, now)}</span>
        <span className="agent-acts">
          <ResumeButton session={session} />
          <button className="ack" onClick={() => void window.api.acknowledgeAgents([session.id])}>
            看過了
          </button>
        </span>
      </div>
    </li>
  )
}

interface TodayRowProps {
  readonly entry: TodayEntry
  readonly now: number
  readonly focus: FocusState | null
}

export function TodayRow({ entry, now, focus }: TodayRowProps): React.JSX.Element {
  const { item, overdueDays, nextStep } = entry
  const [checked, complete] = useCompleting(() => window.api.complete(item.id))
  const timeLabel = item.dueHasTime && item.dueAt !== null && overdueDays === 0 ? clock(item.dueAt) : null
  const timePassed = timeLabel !== null && item.dueAt! < now
  return (
    <li className={`row task${overdueDays > 0 ? ' late' : ''}${checked ? ' checked' : ''}`}>
      <button className="check" aria-label={`完成：${item.title}`} onClick={complete}>
        <CheckIcon />
      </button>
      <div className="main">
        <div className="title">{item.title}</div>
        {overdueDays > 0 && <div className="sub late-text">逾期 {overdueDays} 天</div>}
        {nextStep && (
          <div className="sub next">
            下一步：<b>{nextStep.title}</b>
          </div>
        )}
      </div>
      <div className="end">
        {timeLabel && <span className={timePassed ? 'late-text' : undefined}>{timeLabel}</span>}
        <span className="agent-acts">
          {focus?.itemId !== item.id && <FocusStart item={item} nextStep={nextStep} />}
          <button className="later" onClick={() => void window.api.postpone(item.id)} title="今天不做，移到明天">
            明天
          </button>
        </span>
      </div>
      <FocusArea item={item} focus={focus} />
    </li>
  )
}

export function RoutineRow({ entry }: { entry: RoutineEntry }): React.JSX.Element {
  const { item, daysSince, overdueBy } = entry
  const [checked, complete] = useCompleting(() => window.api.complete(item.id))
  const interval = item.intervalDays ?? 1
  const fill = Math.min(1, (interval + overdueBy) / (interval * 2))
  return (
    <li className={`row routine${checked ? ' checked' : ''}`}>
      <button className="check" aria-label={`做了：${item.title}`} onClick={complete}>
        <CheckIcon />
      </button>
      <div className="main">
        <div className="title">{item.title}</div>
        <div className="sub">目標每 {interval} 天</div>
      </div>
      <div className="end">
        <span>{daysSince === null ? '還沒做過' : `${daysSince} 天前`}</span>
        <span className="meter" aria-hidden="true">
          <i style={{ transform: `scaleX(${fill})` }} />
        </span>
      </div>
    </li>
  )
}
