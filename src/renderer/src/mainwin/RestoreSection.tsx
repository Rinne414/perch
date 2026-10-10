import { useState } from 'react'
import { agentName } from '@shared/agents'
import { whenLabel } from '@shared/format'
import type { RestoreResult } from '@shared/ipc'
import { projectName } from '@shared/projects'
import type { AgentSession } from '@shared/types'
import { errorReason } from '../components/Power'
import { useToast } from '../components/Toast'

/** What 還原 did, in one line: how many tabs opened, and which folders were gone. */
function restoredText({ opened, missing }: RestoreResult): string {
  const gone = missing.map((cwd) => projectName(cwd) ?? cwd).join('、')
  if (opened === 0) return missing.length > 0 ? `資料夾都不見了：${gone}` : '這批已經處理過了'
  return missing.length > 0 ? `開了 ${opened} 個分頁；找不到資料夾：${gone}` : `開了 ${opened} 個分頁，都接回原本的對話了`
}

interface Props {
  readonly sessions: readonly AgentSession[]
  readonly at: number
  readonly dayStartHour: number
}

/**
 * After a restart: the sessions that were still open, all checked. One click reopens the checked
 * ones as Windows Terminal tabs, each resuming its conversation in its own folder.
 */
export function RestoreSection({ sessions, at, dayStartHour }: Props): React.JSX.Element | null {
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const show = useToast()
  if (sessions.length === 0) return null

  const chosen = sessions.filter((s) => !unchecked.has(s.id))
  const toggle = (id: string): void =>
    setUnchecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const restore = (): void => {
    setBusy(true)
    const skip = sessions.filter((s) => unchecked.has(s.id)).map((s) => s.id)
    window.api
      .restoreSessions(
        chosen.map((s) => s.id),
        skip,
      )
      .then((result) => show(restoredText(result)))
      .catch((err: unknown) => show(errorReason(err)))
      .finally(() => setBusy(false))
  }

  const skipAll = (): void => {
    setBusy(true)
    window.api
      .skipRestore(sessions.map((s) => s.id))
      .then(() => show('略過了。之後要接回，用下面各個 session 的「回去」'))
      .catch(() => show('沒有成功，再試一次看看'))
      .finally(() => setBusy(false))
  }

  return (
    <section className="restore" aria-labelledby="ag-restore">
      <div className="restore-head">
        <h2 id="ag-restore">重開機前開著的</h2>
        <span className="sub">{sessions.length} 個 session 還沒關就斷了，勾要接回的</span>
      </div>
      <ul>
        {sessions.map((s) => {
          const where = projectName(s.cwd) ?? s.cwd
          return (
            <li key={s.id}>
              <label className="restore-row" title={s.cwd ?? undefined}>
                <input type="checkbox" checked={!unchecked.has(s.id)} disabled={busy} onChange={() => toggle(s.id)} />
                <span className="main">
                  <span className="title">{where}</span>
                  <span className="sub">
                    {agentName(s.agent)}
                    {s.title && ` · 「${s.title}」`}
                  </span>
                </span>
                <span className="sub when">{whenLabel(s.updatedAt, at, dayStartHour)}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="restore-acts">
        <button className="btn primary" disabled={busy || chosen.length === 0} onClick={restore}>
          在 Windows Terminal 還原 {chosen.length} 個
        </button>
        <button className="btn ghost" disabled={busy} onClick={skipAll}>
          略過
        </button>
        <span className="sub">每個 session 一個分頁，在原本的資料夾接回對話</span>
      </div>
    </section>
  )
}
