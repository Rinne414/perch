import { useState } from 'react'
import { agentName, resumeCommand, STATUS_LABEL } from '@shared/agents'
import { ago } from '@shared/format'
import { projectName } from '@shared/projects'
import type { PlanTarget } from '@shared/ipc'
import type { AgentSession } from '@shared/types'
import { FolderIcon } from './Icons'
import { useAction, useToast } from './Toast'
import './agent-card.css'

/** Which list a session sits in decides its time label and whether it can be marked as seen. */
export type AgentGroup = 'attention' | 'running' | 'recent'

/** Where the buttons go: beside the time (wide windows) or under the reply (the narrow float). */
export type ActsLayout = 'side' | 'below'

function timeLabel(s: AgentSession, group: AgentGroup, at: number): string {
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

/**
 * Opens the folder the agent worked in, in Explorer (Finder, the file manager).
 * An icon in lists; with `labelled`, a button that says 開資料夾.
 */
export function FolderButton({ cwd, labelled = false }: { cwd: string; labelled?: boolean }): React.JSX.Element {
  const show = useToast()
  const open = (): void => {
    window.api
      .openProjectFolder(cwd)
      .then((ok) => ok || show('找不到這個資料夾了，可能已經搬走或刪掉'))
      .catch(() => show('沒有打開，再試一次看看'))
  }
  if (labelled) {
    return (
      <button className="btn folder" title={cwd} onClick={open}>
        <FolderIcon />
        開資料夾
      </button>
    )
  }
  return (
    <button className="act icon folder" aria-label={`開資料夾：${projectName(cwd) ?? cwd}`} title={`開資料夾：${cwd}`} onClick={open}>
      <FolderIcon />
    </button>
  )
}

interface CardProps {
  readonly session: AgentSession
  readonly group: AgentGroup
  readonly at: number
  readonly layout?: ActsLayout
}

const NOTE_PLANS: readonly { plan: PlanTarget; label: string }[] = [
  { plan: 'today', label: '今天' },
  { plan: 'tomorrow', label: '明天' },
  { plan: 'none', label: '不排' },
]

/**
 * 記下來: turns what the agent left (its last line, ready to edit) into the person's own task,
 * filed under the folder the agent worked in.
 */
function NoteForm({ session, onClose }: { session: AgentSession; onClose: () => void }): React.JSX.Element {
  const [text, setText] = useState(session.detail ?? session.title ?? '')
  const [plan, setPlan] = useState<PlanTarget>('none')
  const show = useToast()
  const where = projectName(session.cwd)

  const save = (): void => {
    const line = text.trim()
    if (!line) return
    onClose()
    window.api
      .noteFromAgent(session.id, line, plan)
      .then((item) => show(`記下了「${item.title}」`, () => window.api.remove(item.id)))
      .catch(() => show('沒有記成功，再試一次看看'))
  }

  return (
    <div
      className="note-form"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onClose()
      }}
    >
      <input
        className="field"
        value={text}
        autoFocus
        placeholder="接下來要做什麼？句子裡可以寫日期（明天、週五）"
        aria-label="記成待辦"
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && save()}
      />
      <div className="chips">
        {NOTE_PLANS.map((p) => (
          <button key={p.plan} className={`chip${plan === p.plan ? ' on' : ''}`} aria-pressed={plan === p.plan} onClick={() => setPlan(p.plan)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="note-line">
        <span className="note-where">{where ? `放進 ${where} 專案` : ''}</span>
        <button className="btn ghost" onClick={onClose}>
          取消
        </button>
        <button className="btn primary" disabled={!text.trim()} onClick={save}>
          記下來
        </button>
      </div>
    </div>
  )
}

/** One agent session: what it was asked, what came back, and the ways back into it. */
export function AgentCard({ session, group, at, layout = 'side' }: CardProps): React.JSX.Element {
  const run = useAction()
  const [noting, setNoting] = useState(false)
  const where = projectName(session.cwd)
  const seen = group === 'recent' && wasSeen(session)
  const acts = (
    <span className={`agent-acts${layout === 'below' ? ' below' : ''}`}>
      {group === 'attention' && (
        <button className="ack" onClick={() => run(() => window.api.acknowledgeAgents([session.id]))}>
          看過了
        </button>
      )}
      <button className="later note" title="把接下來要做的事記成待辦" onClick={() => setNoting(true)}>
        記下來
      </button>
      <ResumeButton session={session} />
      {session.cwd && <FolderButton cwd={session.cwd} />}
    </span>
  )
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
        {layout === 'below' && acts}
        {noting && <NoteForm session={session} onClose={() => setNoting(false)} />}
      </div>
      <div className="end">
        <span>{timeLabel(session, group, at)}</span>
        {layout === 'side' && acts}
      </div>
    </li>
  )
}

interface SectionProps {
  readonly id: string
  readonly title: string
  readonly note: string
  readonly sessions: readonly AgentSession[]
  readonly group: AgentGroup
  readonly at: number
  readonly layout?: ActsLayout
  /** A button beside the heading, such as "全部看過了". */
  readonly extra?: React.ReactNode
}

export function AgentSection({ id, title, note, sessions, group, at, layout, extra }: SectionProps): React.JSX.Element | null {
  if (sessions.length === 0) return null
  return (
    <section className="sec" aria-labelledby={id}>
      <h2 id={id}>
        {title}
        <small>{note}</small>
        {extra}
      </h2>
      <ul>
        {sessions.map((s) => (
          <AgentCard key={s.id} session={s} group={group} at={at} layout={layout} />
        ))}
      </ul>
    </section>
  )
}
