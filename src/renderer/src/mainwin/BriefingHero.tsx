import { durationParts, stampLabel, type BriefingPayload } from '@shared/briefing'
import type { SessionState } from '@shared/sessionState'
import type { DeckGroup } from './briefingDeck'
import { Glyph } from './BriefingGlyphs'
import { SaveDayButton } from './BriefingSave'

interface Props {
  readonly briefing: BriefingPayload
  readonly onPick: (group: DeckGroup) => void
}

/** 你離開了 1 小時 25 分 12:32 → 13:57; without an away stretch, 最近 12 小時 and its span. */
function AwayBlock({ briefing }: { briefing: BriefingPayload }): React.JSX.Element {
  const { away, window: w, at, dayStartHour } = briefing
  const parts = away ? durationParts(away.to - away.from) : [{ value: 12, unit: '小時' as const }]
  return (
    <div className="bf-away">
      <div className="bf-lb">{away ? '你離開了' : '最近'}</div>
      <div className="bf-big">
        {parts.length === 0 ? (
          <span>
            0<small>分</small>
          </span>
        ) : (
          parts.map((p) => (
            <span key={p.unit}>
              {p.value}
              <small>{p.unit}</small>
            </span>
          ))
        )}
      </div>
      <div className="bf-span">
        <span>{stampLabel(w.from, at, dayStartHour)}</span>
        <span aria-label="到">→</span>
        <span>{stampLabel(w.to, at, dayStartHour)}</span>
      </div>
    </div>
  )
}

/** The names in 「」 set apart, so the eye lands on who to look at. */
function Named({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split(/(「[^」]*」)/).map((part, i) => (part.startsWith('「') ? <b key={i}>{part}</b> : part))}
    </>
  )
}

const COUNTERS: readonly { group: DeckGroup; state: SessionState; label: string }[] = [
  { group: 'waiting', state: 'waiting', label: '等你決定' },
  { group: 'done', state: 'done', label: '做完了' },
  { group: 'running', state: 'running', label: '還在跑' },
  { group: 'left', state: 'unattended', label: '放著沒接' },
]

function countOf(b: BriefingPayload, group: DeckGroup): number {
  if (group === 'waiting') return b.waiting.length
  if (group === 'done') return b.done.length
  if (group === 'running') return b.running.length
  return b.left.length
}

/** The top strip: how long the person was away, what to look at first, the four counts, and saving the day. */
export function BriefingHero({ briefing, onPick }: Props): React.JSX.Element {
  const { hero } = briefing
  return (
    <section className="bf-pn bf-hero" aria-label="這段時間的回報">
      <AwayBlock briefing={briefing} />
      <div className="bf-say">
        <p className={`bf-l1 bf-tone-${hero.tone}`}>
          <Named text={hero.line1} />
        </p>
        {hero.line2 && <p className="bf-l2">{hero.line2}</p>}
      </div>
      <div className="bf-cnt">
        {COUNTERS.map((c) => {
          const n = countOf(briefing, c.group)
          return (
            <button
              key={c.group}
              className={`bf-cnt-${c.state}`}
              disabled={n === 0}
              title={n ? `看第一個${c.label}的` : `沒有${c.label}的`}
              onClick={() => onPick(c.group)}
            >
              <Glyph state={c.state} size={16} />
              <span className="bf-v">{n}</span>
              <span className="bf-k">{c.label}</span>
            </button>
          )
        })}
      </div>
      <SaveDayButton />
    </section>
  )
}
