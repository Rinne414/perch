import type { SessionState } from '@shared/sessionState'

interface GlyphProps {
  readonly state: SessionState
  readonly size?: number
  readonly className?: string
}

/** The state shapes of 簡報: diamond waits, a play triangle runs, a dot is done, a ring was left, a cross failed. */
function shape(state: SessionState): React.JSX.Element {
  switch (state) {
    case 'waiting':
      return <path className="bf-g-wait" d="M9 1l8 8-8 8-8-8z" />
    case 'running':
      return <path className="bf-g-run" d="M3.5 2.2L16 9 3.5 15.8z" />
    case 'done':
      return <circle className="bf-g-done" cx="9" cy="9" r="7" />
    case 'unattended':
      return <circle className="bf-g-left" cx="9" cy="9" r="6" fill="none" strokeWidth="2.6" />
    case 'failed':
      return <path className="bf-g-fail" d="M3.5 3.5l11 11M14.5 3.5l-11 11" strokeWidth="3" strokeLinecap="round" />
  }
}

export function Glyph({ state, size = 14, className }: GlyphProps): React.JSX.Element {
  return (
    <svg className={className ?? 'bf-g'} aria-hidden="true" width={size} height={size} viewBox="0 0 18 18">
      {shape(state)}
    </svg>
  )
}

/** "02", "12": the header counters keep two digits. */
export const twoDigits = (n: number): string => String(n).padStart(2, '0')

interface PanelProps {
  readonly id: string
  readonly title: string
  readonly glyph?: SessionState
  /** A short line on what the panel holds, between the rule and the counter. */
  readonly hint?: string
  readonly count?: number
  /** `wait` frames the panel amber; `grow` lets it take the column's free height. */
  readonly variant?: 'wait' | 'grow'
  /** Replaces the title row's start, for a tab list. */
  readonly head?: React.ReactNode
  readonly bodyClass?: string
  readonly children: React.ReactNode
}

/** One framed panel: corner brackets, a header strip with title, rule, hint and counter. */
export function Panel({ id, title, glyph, hint, count, variant, head, bodyClass, children }: PanelProps): React.JSX.Element {
  return (
    <section className={['bf-pn', variant && `bf-pn--${variant}`].filter(Boolean).join(' ')} aria-labelledby={id}>
      <div className={`bf-pn-h${head ? ' bf-pn-h--tabs' : ''}`}>
        {glyph && <Glyph state={glyph} />}
        <h2 id={id} className={head ? 'bf-vh' : undefined} tabIndex={-1}>
          {title}
        </h2>
        {head}
        <span className="bf-rule" aria-hidden="true" />
        {hint && (
          <span className="bf-hint" title={hint}>
            {hint}
          </span>
        )}
        {count !== undefined && <span className="bf-n">{twoDigits(count)}</span>}
      </div>
      <div className={['bf-pn-b', bodyClass].filter(Boolean).join(' ')}>{children}</div>
    </section>
  )
}
