import { useState } from 'react'
import { agentName } from '@shared/agents'
import { ago, clock } from '@shared/format'
import type { BatchTarget } from '@shared/ipc'
import type { AgentSession, Item } from '@shared/types'
import { CheckIcon, ChevronIcon } from '../components/Icons'
import { project, ResumeButton } from '../float/rows'
import { useAction, useToast } from './Toast'

/** Agents still working: what each one was asked, where, for how long, and a way back in. */
export function RunningAgents({ sessions, at }: { sessions: readonly AgentSession[]; at: number }): React.JSX.Element | null {
  if (sessions.length === 0) return null
  return (
    <section className="sec" aria-labelledby="mw-running">
      <h2 id="mw-running">
        執行中<small>{sessions.length} 個</small>
      </h2>
      <ul>
        {sessions.map((s) => {
          const where = project(s.cwd)
          const took = ago(s.startedAt, at)
          return (
            <li key={s.id} className="row agent agent-running">
              <span className="dot" aria-hidden="true" />
              <div className="main">
                <div className="title">{agentName(s.agent)}</div>
                <div className="sub">
                  <em>執行中</em>
                  {where && ` · ${where}`}
                </div>
                {s.title && <div className="sub detail">{s.title}</div>}
              </div>
              <div className="end">
                <span title="從第一次回報算起">{took === '剛剛' ? '剛開始' : `跑了 ${took}`}</span>
                <span className="agent-acts">
                  <ResumeButton session={s} />
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function doneLabel(items: readonly Item[]): string {
  const dropped = items.filter((i) => i.droppedAt !== null).length
  const done = items.length - dropped
  return [done && `今天做完 ${done} 件`, dropped && `放下 ${dropped} 件`].filter(Boolean).join(' · ')
}

/** Finished and let-go items of the day, folded away; either can be taken back. */
export function DoneToday({ items }: { items: readonly Item[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const run = useAction()
  if (items.length === 0) return null
  return (
    <div className="sec">
      <button className="more" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronIcon open={open} />
        {doneLabel(items)}
      </button>
      {open && (
        <ul>
          {items.map((item) =>
            item.droppedAt !== null ? (
              <li key={item.id} className="row task dropped">
                <span className="bullet" aria-hidden="true" />
                <span className="main">
                  <span className="title">{item.title}</span>
                  <span className="sub">放下了</span>
                </span>
                <span className="end">
                  <button className="act" onClick={() => run(() => window.api.reopen(item.id))}>
                    撿回來
                  </button>
                </span>
              </li>
            ) : (
              <li key={item.id} className="row task checked">
                <button
                  className="check"
                  aria-label={`取消完成：${item.title}`}
                  onClick={() => run(() => window.api.reopen(item.id))}
                >
                  <CheckIcon />
                </button>
                <span className="main">
                  <span className="title">{item.title}</span>
                </span>
                <span className="end">{clock(item.doneAt!)}</span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}

const BATCH: readonly { target: BatchTarget; label: string; done: (n: number) => string }[] = [
  { target: 'today', label: '移到今天', done: (n) => `已把 ${n} 件移到今天` },
  { target: 'tomorrow', label: '移到明天', done: (n) => `已把 ${n} 件移到明天` },
  { target: 'none', label: '先不排日期', done: (n) => `${n} 件放回收件匣了` },
  { target: 'drop', label: '不做了', done: (n) => `放下了 ${n} 件` },
]

/** Shown only when two or more things slipped past their day: one calm way to deal with all of them. */
export function OverdueBatch({ ids }: { ids: readonly string[] }): React.JSX.Element {
  const show = useToast()
  const apply = (target: BatchTarget, done: (n: number) => string): void => {
    window.api
      .rescheduleOverdue(ids, target)
      .then((token) =>
        show(done(ids.length), () =>
          window.api.undoBatch(token).then((ok) => {
            if (!ok) throw new Error('Undo window passed')
          }),
        ),
      )
      .catch(() => show('沒有成功，再試一次看看'))
  }
  return (
    <div className="batch">
      <span>有 {ids.length} 件過了原本的日子：</span>
      {BATCH.map(({ target, label, done }) => (
        <button key={target} className="act" onClick={() => apply(target, done)}>
          {label}
        </button>
      ))}
    </div>
  )
}
