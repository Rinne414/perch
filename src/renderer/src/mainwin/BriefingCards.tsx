import { useState } from 'react'
import { sessionLabel } from '@shared/agents'
import { MAX_REPLY, stampLabel, type BriefingPayload, type DoneEntry } from '@shared/briefing'
import type { ReplyDigest } from '@shared/replyDigest'
import { FolderButton, ResumeButton } from '../components/AgentCard'
import { Markdown } from '../components/Markdown'
import { useFocusAfterRemoval, useMarkSeen, useSelection, whereLine } from './briefingDeck'
import { Glyph } from './BriefingGlyphs'
import { SaveButtons } from './BriefingSave'

/** A card shows this many points of a list until it is opened. */
const SHOWN_POINTS = 5

/** The first five points, then "還有 N 項" that opens the rest in place. */
function Points({ items, tone }: { items: readonly string[]; tone: 'todo' | 'note' }): React.JSX.Element {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, SHOWN_POINTS)
  return (
    <>
      <ul className={`bf-pts bf-pts--${tone}`}>
        {shown.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      {items.length > shown.length && (
        <button className="bf-b bf-b--sm bf-b--ghost" onClick={() => setAll(true)}>
          還有 {items.length - shown.length} 項
        </button>
      )}
    </>
  )
}

/** 結論 when the reply names it; 開頭 when it is only how the reply opens. */
const conclusionLabel = (d: ReplyDigest): string => (d.conclusionFromSection ? '結論' : '開頭')

/** The folded rows: the conclusion, the first point left for the person, and how much to watch. */
export function FoldedDigest({ digest }: { digest: ReplyDigest }): React.JSX.Element | null {
  const todos = todoList(digest)
  const notes = digest.unverified?.length ?? 0
  const watch = notes > 0 && <span className="bf-tag bf-tag--dim">要注意 {notes}</span>
  const leaves = !!todos?.length || digest.todos === 'none'
  if (!digest.conclusion && !leaves && !notes) return null
  return (
    <dl className="bf-sum">
      {digest.conclusion && (
        <>
          <dt>{conclusionLabel(digest)}</dt>
          <dd className="bf-clamp2">{digest.conclusion}</dd>
        </>
      )}
      {leaves && (
        <>
          <dt>留給你</dt>
          <dd className="bf-dd-row">
            {todos?.length ? (
              <>
                <span className="bf-clamp1">{todos[0]}</span>
                {todos.length > 1 && <span className="bf-tag bf-tag--warn">還有 {todos.length - 1} 件</span>}
              </>
            ) : (
              <span className="bf-tag bf-tag--done">報告寫：不用你做什麼</span>
            )}
            {watch}
          </dd>
        </>
      )}
      {!leaves && watch && (
        <>
          <dt />
          <dd>{watch}</dd>
        </>
      )}
    </dl>
  )
}

/** The points left for the person; null when the report says nothing or that there are none. */
const todoList = (d: ReplyDigest): readonly string[] | null => (d.todos === null || d.todos === 'none' ? null : d.todos)

/** The open rows: what the person first said, the conclusion, everything left for them, what to watch. */
function OpenDigest({ digest, firstPrompt }: { digest: ReplyDigest; firstPrompt: string | null }): React.JSX.Element {
  const todos = todoList(digest)
  return (
    <dl className="bf-sum">
      {firstPrompt && (
        <>
          <dt>你當初說</dt>
          <dd className="bf-q">「{firstPrompt}」</dd>
        </>
      )}
      {digest.conclusion && (
        <>
          <dt>{conclusionLabel(digest)}</dt>
          <dd className="bf-pre">{digest.conclusion}</dd>
        </>
      )}
      {(todos?.length || digest.todos === 'none') && (
        <>
          <dt>留給你</dt>
          <dd>{todos?.length ? <Points items={todos} tone="todo" /> : <span className="bf-tag bf-tag--done">報告寫：不用你做什麼</span>}</dd>
        </>
      )}
      {!!digest.unverified?.length && (
        <>
          <dt>要注意</dt>
          <dd>
            <Points items={digest.unverified} tone="note" />
          </dd>
        </>
      )}
    </dl>
  )
}

/** "Claude Code，在 ComfyUI-aki-v1.6，昨天 23:08 開始，你說了 3 句話" */
function metaLine(e: DoneEntry, b: BriefingPayload): string {
  const parts = [whereLine(e.session), `${stampLabel(e.session.startedAt, b.at, b.dayStartHour)} 開始`]
  if (e.promptCount > 0) parts.push(`你說了 ${e.promptCount} 句話`)
  return parts.join('，')
}

interface ActionProps {
  readonly e: DoneEntry
  readonly whole: boolean
  readonly onWhole: () => void
}

function DoneActions({ e, whole, onWhole }: ActionProps): React.JSX.Element {
  const markSeen = useMarkSeen()
  const refocus = useFocusAfterRemoval()
  const { openRecord } = useSelection()
  const s = e.session
  return (
    <div className="bf-row">
      {e.reply && (
        <button className="bf-b bf-b--pri" aria-expanded={whole} onClick={onWhole}>
          {whole ? '收起全文' : '展開全文'}
        </button>
      )}
      {e.hasTurns && (
        <button className="bf-b" onClick={() => openRecord(s)}>
          看完整紀錄
        </button>
      )}
      <ResumeButton session={s} label="接回這個對話" className="bf-b" />
      {s.cwd && <FolderButton cwd={s.cwd} labelled className="bf-b" />}
      <button
        className="bf-b"
        title="標成看過，它就不再算在做完了裡；提示裡可以復原"
        onClick={(ev) => {
          refocus(ev.currentTarget, 'article.bf-rp')
          markSeen([s.id], `「${sessionLabel(s)}」標成看過了`)
        }}
      >
        看完了
      </button>
      {/* One group, so a narrow card wraps it whole instead of leaving one button on a row. */}
      <span className="bf-save bf-push">
        <span className="bf-lb">存下來</span>
        <SaveButtons sessionId={s.id} />
      </span>
    </div>
  )
}

/** A finished session's report card: folded to its gist, open with everything it left. */
export function DoneCard({ e, b }: { e: DoneEntry; b: BriefingPayload }): React.JSX.Element {
  const { selected, select } = useSelection()
  const [whole, setWhole] = useState(false)
  const s = e.session
  const open = selected === s.id
  return (
    <article className={`bf-rp${open ? ' bf-sel' : ''}`} data-card={s.id} tabIndex={-1}>
      <button className="bf-rp-t" aria-expanded={open} onClick={() => select(s.id)}>
        <Glyph state="done" />
        <h3 title={sessionLabel(s)}>{sessionLabel(s)}</h3>
        <span className="bf-w">{stampLabel(e.finishedAt, b.at, b.dayStartHour)} 做完</span>
      </button>
      {open && <div className="bf-meta">{metaLine(e, b)}</div>}
      {open ? <OpenDigest digest={e.digest} firstPrompt={e.firstPrompt} /> : <FoldedDigest digest={e.digest} />}
      {open && whole && e.reply && (
        <div className="bf-well" tabIndex={0} aria-label="報告全文">
          <Markdown text={e.reply} />
          {e.replyCut && <p className="bf-note">報告很長，這裡只放前 {MAX_REPLY.toLocaleString()} 字；全文在「看完整紀錄」裡。</p>}
        </div>
      )}
      {open && <DoneActions e={e} whole={whole} onWhole={() => setWhole(!whole)} />}
    </article>
  )
}
