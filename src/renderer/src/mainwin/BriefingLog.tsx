import { useLayoutEffect, useRef } from 'react'
import { stampLabel, type BriefingPayload } from '@shared/briefing'
import { useSelection } from './briefingDeck'
import { Glyph, Panel } from './BriefingGlyphs'

/** More lines than this scroll inside the panel. */
const SHOWN_LINES = 10

/** 經過: every reply in the window as a console line, oldest first, and what each waiting session asks. */
export function LogPanel({ briefing }: { briefing: BriefingPayload }): React.JSX.Element | null {
  const { select } = useSelection()
  const list = useRef<HTMLOListElement>(null)
  const { timeline, at, dayStartHour } = briefing
  const scrolls = timeline.length > SHOWN_LINES
  // A list that scrolls starts at its newest line.
  useLayoutEffect(() => {
    const el = list.current
    if (el && scrolls) el.scrollTop = el.scrollHeight
  }, [scrolls, timeline.length])
  if (timeline.length === 0) return null
  return (
    <Panel id="bf-h-log" title="經過" hint="每一次回覆的第一句" count={timeline.length} variant="grow">
      <ol ref={list} className={`bf-log${scrolls ? ' bf-log--scroll' : ''}`} tabIndex={scrolls ? 0 : undefined} aria-label="這段時間每一次回覆">
        {timeline.map((t) => (
          <li key={`${t.sessionId}@${t.at}@${t.ask}`}>
            <button className={t.ask ? 'bf-log-ask' : undefined} onClick={() => select(t.sessionId)}>
              <time>{stampLabel(t.at, at, dayStartHour)}</time>
              <Glyph state={t.state} size={11} />
              <span className="bf-log-line">
                <b>{t.label}</b>
                <span className="bf-log-text">{t.line}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
