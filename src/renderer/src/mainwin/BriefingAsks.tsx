import { sessionLabel } from '@shared/agents'
import { durationLabel, type WaitingEntry } from '@shared/briefing'
import { ResumeButton } from '../components/AgentCard'
import { useSelection, whereLine } from './briefingDeck'
import { Panel } from './BriefingGlyphs'

/** Key for 晚點再說: a session that asks again later comes back. */
export const laterKey = (e: WaitingEntry): string => `${e.session.id}@${e.waitingSince}`

interface CardProps {
  readonly entry: WaitingEntry
  readonly at: number
  readonly onLater: () => void
}

function AskCard({ entry, at, onLater }: CardProps): React.JSX.Element {
  const { selected, select } = useSelection()
  const s = entry.session
  const name = sessionLabel(s)
  const failed = s.status === 'failed'
  const classes = ['bf-ask', failed && 'bf-ask--fail', selected === s.id && 'bf-sel'].filter(Boolean).join(' ')
  return (
    <article className={classes} data-card={s.id} tabIndex={-1} onClick={() => select(s.id)}>
      <div className="bf-ask-t">
        <h3 title={name}>{name}</h3>
        <span className="bf-w">等了 {durationLabel(at - entry.waitingSince)}</span>
      </div>
      {entry.ask && (
        <div className="bf-ask-q">
          <span className={`bf-tag ${failed ? 'bf-tag--fail' : 'bf-tag--wait'}`}>{failed ? '失敗了' : '它問你'}</span>
          <span>{entry.ask}</span>
        </div>
      )}
      {entry.latestPrompt && entry.latestPrompt !== name && (
        <div className="bf-said">
          <span className="bf-lb">你上一句說</span>
          <span>「{entry.latestPrompt}」</span>
        </div>
      )}
      {entry.lastReply && (
        <div className="bf-said">
          <span className="bf-lb">{entry.repliedWhileAway ? '你不在時它做完的' : '它先做完了'}</span>
          <span>{entry.lastReply}</span>
        </div>
      )}
      <div className="bf-row">
        <ResumeButton session={s} label="回去回答" className="bf-b bf-b--pri" />
        <button
          className="bf-b"
          title="先收起這張，不會改動什麼；它還是算在等你"
          onClick={(e) => {
            e.stopPropagation()
            onLater()
          }}
        >
          晚點再說
        </button>
        <span className="bf-meta bf-push">{whereLine(s)}</span>
      </div>
    </article>
  )
}

interface Props {
  readonly entries: readonly WaitingEntry[]
  readonly at: number
  readonly later: ReadonlySet<string>
  readonly onLater: (key: string) => void
  readonly onShowLater: () => void
}

/** 等你決定: always shown, longest waiting first, with one plain line when nobody waits. */
export function AsksPanel({ entries, at, later, onLater, onShowLater }: Props): React.JSX.Element {
  const shown = entries.filter((e) => !later.has(laterKey(e)))
  const hidden = entries.length - shown.length
  return (
    <Panel id="bf-h-wait" title="等你決定" glyph="waiting" count={entries.length} variant="wait">
      {entries.length === 0 && <p className="bf-note">現在沒有 agent 在等你。</p>}
      {shown.map((e) => (
        <AskCard key={e.session.id} entry={e} at={at} onLater={() => onLater(laterKey(e))} />
      ))}
      {hidden > 0 && (
        <div className="bf-row">
          <span className="bf-note">{shown.length === 0 ? `你說晚點再說的 ${hidden} 個先收起來了。` : `另外 ${hidden} 個先收起來了。`}</span>
          <button className="bf-b bf-b--sm bf-b--ghost" onClick={onShowLater}>
            再拿出來
          </button>
        </div>
      )}
    </Panel>
  )
}
