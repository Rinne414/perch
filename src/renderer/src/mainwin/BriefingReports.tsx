import { useRef } from 'react'
import { sessionLabel, STATUS_LABEL } from '@shared/agents'
import { durationLabel, unattendedSentence, type BriefingPayload, type LeftEntry, type RunningEntry } from '@shared/briefing'
import { ago } from '@shared/format'
import { FolderButton, ResumeButton } from '../components/AgentCard'
import { useFocusAfterRemoval, useMarkSeen, useSelection, whereLine, type ReportTab } from './briefingDeck'
import { DoneCard } from './BriefingCards'
import { Glyph } from './BriefingGlyphs'

const TABS: readonly { tab: ReportTab; label: string; glyph: 'done' | 'running' | 'unattended' }[] = [
  { tab: 'done', label: '做完了', glyph: 'done' },
  { tab: 'running', label: '還在跑', glyph: 'running' },
  { tab: 'left', label: '放著沒接', glyph: 'unattended' },
]

function RunningCard({ e, b }: { e: RunningEntry; b: BriefingPayload }): React.JSX.Element {
  const { selected, select, openRecord } = useSelection()
  const s = e.session
  const open = selected === s.id
  return (
    <article className={`bf-rp bf-rp--run${open ? ' bf-sel' : ''}`} data-card={s.id} tabIndex={-1}>
      <button className="bf-rp-t" aria-expanded={open} onClick={() => select(s.id)}>
        <Glyph state="running" />
        <h3 title={sessionLabel(s)}>{sessionLabel(s)}</h3>
        <span className="bf-w">跑了 {durationLabel(b.at - s.startedAt)}</span>
      </button>
      <div className="bf-meta">
        {whereLine(s)}，{ago(s.updatedAt, b.at) === '剛剛' ? '剛剛回報過' : `${ago(s.updatedAt, b.at)}前回報過`}
      </div>
      {open && (
        <dl className="bf-sum">
          {e.latestPrompt && (
            <>
              <dt>你最後交代的</dt>
              <dd className="bf-q">「{e.latestPrompt}」</dd>
            </>
          )}
          {e.digest.conclusion && (
            <>
              <dt>它上一次回覆</dt>
              <dd className="bf-pre">{e.digest.conclusion}</dd>
            </>
          )}
        </dl>
      )}
      {open && (
        <div className="bf-row">
          {e.hasTurns && (
            <button className="bf-b" onClick={() => openRecord(s)}>
              看完整紀錄
            </button>
          )}
          {s.cwd && <FolderButton cwd={s.cwd} labelled className="bf-b" />}
        </div>
      )}
    </article>
  )
}

function LeftActions({ e, onSeen }: { e: LeftEntry; onSeen: () => void }): React.JSX.Element {
  const { openRecord } = useSelection()
  const refocus = useFocusAfterRemoval()
  const s = e.session
  return (
    <div className="bf-row">
      <ResumeButton session={s} label="接回這個對話" className="bf-b" />
      {s.cwd && <FolderButton cwd={s.cwd} labelled className="bf-b" />}
      <button
        className="bf-b"
        title="標成看過，它就離開這一堆；提示裡可以復原"
        onClick={(ev) => {
          refocus(ev.currentTarget, 'article.bf-rp')
          onSeen()
        }}
      >
        看完了
      </button>
      {e.hasTurns && (
        <button className="bf-b" onClick={() => openRecord(s)}>
          看完整紀錄
        </button>
      )}
    </div>
  )
}

function LeftCard({ e, b, onSeen }: { e: LeftEntry; b: BriefingPayload; onSeen: () => void }): React.JSX.Element {
  const { selected, select } = useSelection()
  const s = e.session
  const open = selected === s.id
  const age = ago(s.updatedAt, b.at)
  return (
    <article className={`bf-rp bf-rp--left${open ? ' bf-sel' : ''}`} data-card={s.id} tabIndex={-1}>
      <button className="bf-rp-t" aria-expanded={open} onClick={() => select(s.id)}>
        <Glyph state={s.status === 'failed' ? 'failed' : 'unattended'} />
        <h3 title={sessionLabel(s)}>{sessionLabel(s)}</h3>
        <span className="bf-w">{age === '剛剛' ? '剛停下' : `放了 ${age}`}</span>
      </button>
      <div className="bf-meta">
        {STATUS_LABEL[s.status]}，{whereLine(s)}
      </div>
      {e.digest.conclusion && (
        <dl className="bf-sum">
          <dt>{e.digest.conclusionFromSection ? '結論' : '開頭'}</dt>
          <dd className={open ? 'bf-pre' : 'bf-clamp2'}>{e.digest.conclusion}</dd>
        </dl>
      )}
      {open && e.latestPrompt && (
        <dl className="bf-sum">
          <dt>你最後交代的</dt>
          <dd className="bf-q">「{e.latestPrompt}」</dd>
        </dl>
      )}
      {open && <LeftActions e={e} onSeen={onSeen} />}
    </article>
  )
}

function LeftTab({ b }: { b: BriefingPayload }): React.JSX.Element {
  const markSeen = useMarkSeen()
  const refocus = useFocusAfterRemoval()
  const ids = b.left.map((e) => e.session.id)
  return (
    <>
      {b.unattended && (
        <div className="bf-row bf-left-all">
          <p className="bf-note bf-grow">{unattendedSentence(b.unattended, b.at)}</p>
          <button
            className="bf-b bf-b--sm"
            title="全部標成看過；提示裡可以一次復原"
            onClick={(ev) => {
              refocus(ev.currentTarget, '.bf-left-all')
              markSeen(ids, `${ids.length} 個標成看過了`)
            }}
          >
            全部看完了（{ids.length} 個）
          </button>
        </div>
      )}
      {b.left.map((e) => (
        <LeftCard key={e.session.id} e={e} b={b} onSeen={() => markSeen([e.session.id], `「${sessionLabel(e.session)}」標成看過了`)} />
      ))}
    </>
  )
}

const EMPTY: Readonly<Record<ReportTab, string>> = {
  done: '還沒有做完等你看的。',
  running: '現在沒有 agent 在跑。',
  left: '沒有放著沒接的。',
}

interface Props {
  readonly briefing: BriefingPayload
  readonly tab: ReportTab
  readonly onTab: (tab: ReportTab) => void
}

interface TabsProps {
  readonly tab: ReportTab
  readonly counts: Readonly<Record<ReportTab, number>>
  readonly onTab: (tab: ReportTab) => void
}

/** The tab list: arrows move between tabs, Home and End go to the first and last. */
function ReportTabs({ tab, counts, onTab }: TabsProps): React.JSX.Element {
  const refs = useRef<Partial<Record<ReportTab, HTMLButtonElement | null>>>({})
  const onKey = (e: React.KeyboardEvent): void => {
    const at = TABS.findIndex((t) => t.tab === tab)
    const moves: Readonly<Record<string, number>> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 }
    if (!(e.key in moves)) return
    e.preventDefault()
    const next = TABS[(moves[e.key] + TABS.length) % TABS.length].tab
    onTab(next)
    refs.current[next]?.focus()
  }
  return (
    <div className="bf-tabs" role="tablist" aria-labelledby="bf-h-rp" onKeyDown={onKey}>
      {TABS.map((t) => (
        <button
          key={t.tab}
          ref={(el) => {
            refs.current[t.tab] = el
          }}
          id={`bf-tab-${t.tab}`}
          role="tab"
          aria-selected={tab === t.tab}
          aria-controls="bf-tabpanel"
          tabIndex={tab === t.tab ? 0 : -1}
          className={`bf-tab${tab === t.tab ? ' bf-on' : ''}`}
          onClick={() => onTab(t.tab)}
        >
          <Glyph state={t.glyph} />
          {t.label}
          <b>{counts[t.tab]}</b>
        </button>
      ))}
    </div>
  )
}

/** The reports, one tab per group: the selected session's card open, the others folded. */
export function ReportsPanel({ briefing: b, tab, onTab }: Props): React.JSX.Element {
  const counts: Readonly<Record<ReportTab, number>> = { done: b.done.length, running: b.running.length, left: b.left.length }
  return (
    <section className="bf-pn" aria-labelledby="bf-h-rp">
      <div className="bf-pn-h bf-pn-h--tabs">
        <h2 id="bf-h-rp" className="bf-vh">
          每個 session 的報告
        </h2>
        <ReportTabs tab={tab} counts={counts} onTab={onTab} />
        <span className="bf-rule" aria-hidden="true" />
        <span className="bf-hint" title="結論和留給你的事是從報告裡抓的">結論和留給你的事是從報告裡抓的</span>
      </div>
      <div className="bf-pn-b" id="bf-tabpanel" role="tabpanel" aria-labelledby={`bf-tab-${tab}`}>
        {counts[tab] === 0 && <p className="bf-note">{EMPTY[tab]}</p>}
        {tab === 'done' && b.done.map((e) => <DoneCard key={e.session.id} e={e} b={b} />)}
        {tab === 'running' && b.running.map((e) => <RunningCard key={e.session.id} e={e} b={b} />)}
        {tab === 'left' && <LeftTab b={b} />}
      </div>
    </section>
  )
}
