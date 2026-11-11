import { useEffect, useState } from 'react'
import { agentName, sessionLabel, STATUS_LABEL } from '@shared/agents'
import { firstLineOf } from '@shared/briefing'
import { localStamp } from '@shared/format'
import type { SessionRecord } from '@shared/ipc'
import { projectName } from '@shared/projects'
import { reportText } from '@shared/reportPick'
import type { AgentTurn } from '@shared/types'
import { Markdown } from '../components/Markdown'
import './print.css'

const NO_TURNS = '這個 session 在 Perch 開始留下完整紀錄之前就有了，沒有逐句紀錄。'

function Turn({ turn, n }: { turn: AgentTurn; n: number }): React.JSX.Element {
  return (
    <li className="pr-turn">
      <h3>
        {n}. {localStamp(turn.startedAt)}
      </h3>
      <p className="pr-who">你說</p>
      {turn.prompt !== null ? <p className="pr-said">{turn.prompt.trim()}</p> : <p className="pr-note">（沒有，這一輪是背景通知或接著上一輪）</p>}
      <p className="pr-who">它回{turn.endedAt !== null && `（${localStamp(turn.endedAt)}）`}</p>
      {turn.reply !== null ? <Markdown text={turn.reply.trim()} /> : <p className="pr-note">（這一輪沒有留下回覆）</p>}
    </li>
  )
}

function Record({ record }: { record: SessionRecord }): React.JSX.Element {
  const { session: s, turns } = record
  const typed = turns.filter((t) => t.prompt !== null)
  const lastReply = reportText(turns) ?? firstLineOf(s.detail)
  const where = projectName(s.cwd)
  const finished = s.attentionAt ?? s.updatedAt
  return (
    <main className="pr">
      <header>
        <h1>{sessionLabel(s)}</h1>
        <p className="pr-meta">
          {agentName(s.agent)}
          {where && `，在 ${where}`}，{STATUS_LABEL[s.status]}。從 {localStamp(s.startedAt)} 到 {localStamp(finished)}
          {typed.length > 0 && `，你說了 ${typed.length} 句話`}。
        </p>
        <p className="pr-meta small">由 Perch 在 {localStamp(Date.now())} 印出 · {s.id}</p>
      </header>
      <h2>最後的回覆</h2>
      {lastReply ? <Markdown text={lastReply} /> : <p className="pr-note">（沒有回覆）</p>}
      <h2>你說過的話</h2>
      {typed.length === 0 && <p className="pr-note">{NO_TURNS}</p>}
      {typed.map((t) => (
        <div key={t.id} className="pr-prompt">
          <p className="pr-who">{localStamp(t.startedAt)}</p>
          <p className="pr-said">{t.prompt?.trim()}</p>
        </div>
      ))}
      <h2>完整經過</h2>
      {turns.length === 0 && <p className="pr-note">{NO_TURNS}</p>}
      <ol className="pr-turns">
        {turns.map((t, i) => (
          <Turn key={t.id} turn={t} n={i + 1} />
        ))}
      </ol>
    </main>
  )
}

/** The page 存成 PDF prints: a light A4 page with the session's whole record. Never shown on screen. */
export function PrintView(): React.JSX.Element {
  const [record, setRecord] = useState<SessionRecord | null>(null)
  useEffect(() => {
    document.documentElement.classList.add('printing')
    const id = new URLSearchParams(location.search).get('session') ?? ''
    window.api
      .getSessionRecord(id)
      .then(setRecord)
      .catch(() => (document.body.dataset.ready = 'missing'))
  }, [])
  // The main process prints once the record is on the page.
  useEffect(() => {
    if (!record) return
    // The PDF's title.
    document.title = sessionLabel(record.session)
    requestAnimationFrame(() => (document.body.dataset.ready = 'yes'))
  }, [record])
  return record ? <Record record={record} /> : <main className="pr" />
}
