import type { Ref } from 'react'
import type { BayRow } from '@shared/bays'
import { STATE_NAME, STATE_ORDER, stateRank, type SessionState } from '@shared/sessionState'
import { useSelection } from './briefingDeck'

/** Above this many sessions the ring has one arc per state, sized by count. */
export const MAX_RING_SEGMENTS = 60
const RING_R = 109
const GAP_UNITS = 5
const TICK_FROM = 119
const TICK_TO = 128

/** A point on a circle; 0 is the top, angles run clockwise. */
const at = (r: number, a: number): string => `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`

function arc(r: number, from: number, to: number): string {
  const large = to - from > Math.PI ? 1 : 0
  return `M ${at(r, from)} A ${r} ${r} 0 ${large} 1 ${at(r, to)}`
}

interface Segment {
  readonly key: string
  /** The session it stands for; for a state arc, the first session of that state. */
  readonly id: string
  readonly state: SessionState
  readonly title: string
  readonly from: number
  readonly to: number
}

function segments(rows: readonly BayRow[]): Segment[] {
  const sorted = [...rows].sort((a, b) => stateRank(a.state) - stateRank(b.state))
  const full = 2 * Math.PI
  if (sorted.length > MAX_RING_SEGMENTS) {
    let start = 0
    return STATE_ORDER.flatMap((state) => {
      const of = sorted.filter((r) => r.state === state)
      if (!of.length) return []
      const span = (full * of.length) / sorted.length
      const gap = Math.min(GAP_UNITS / RING_R, span * 0.3)
      const seg = { key: state, id: of[0].id, state, title: `${STATE_NAME[state]} ${of.length} 個`, from: start + gap / 2, to: start + span - gap / 2 }
      start += span
      return [seg]
    })
  }
  const span = full / Math.max(1, sorted.length)
  const gap = Math.min(GAP_UNITS / RING_R, span * 0.3)
  return sorted.map((r, i) => ({ key: r.id, id: r.id, state: r.state, title: `${r.name}，${STATE_NAME[r.state]}`, from: i * span + gap / 2, to: (i + 1) * span - gap / 2 }))
}

/** How many sessions wait in 等你決定, run and are done: what the big number in the middle counts. */
export interface CoreCounts {
  readonly waiting: number
  readonly running: number
  readonly done: number
}

function coreFigure(c: CoreCounts): { value: number; label: string; state: SessionState | null } {
  if (c.waiting) return { value: c.waiting, label: '等你決定', state: 'waiting' }
  if (c.running) return { value: c.running, label: '還在跑', state: 'running' }
  if (c.done) return { value: c.done, label: '做完了', state: 'done' }
  return { value: 0, label: '沒有 agent', state: null }
}

function Ring({ rows }: { rows: readonly BayRow[] }): React.JSX.Element {
  const { selected, select } = useSelection()
  const segs = segments(rows)
  // One arc per state when there are many: the selected session's state arc is marked.
  const pickedState = rows.find((r) => r.id === selected)?.state
  const picked = segs.find((s) => s.key === selected) ?? (rows.length > MAX_RING_SEGMENTS ? segs.find((s) => s.key === pickedState) : undefined)
  return (
    <g className={`bf-ring${picked ? ' bf-ring--picked' : ''}`} fill="none" strokeWidth="13">
      {segs.map((s) => (
        <path key={s.key} className={`bf-seg bf-seg--${s.state}${s === picked ? ' bf-seg--sel' : ''}`} d={arc(RING_R, s.from, s.to)} onClick={() => select(s.id)}>
          <title>{s.title}</title>
        </path>
      ))}
      {picked && (
        <path className="bf-seg-tick" d={`M ${at(TICK_FROM, (picked.from + picked.to) / 2)} L ${at(TICK_TO, (picked.from + picked.to) / 2)}`} strokeWidth="3" strokeLinecap="round" />
      )}
    </g>
  )
}

interface Props {
  readonly rows: readonly BayRow[]
  readonly counts: CoreCounts
  readonly size: number
  readonly ref?: Ref<SVGSVGElement>
}

/**
 * The core: an outer tick ring, one ring segment per session (most urgent first), two inner arcs
 * and the disc with the big number. The rings turn only while something runs.
 */
export function Core({ rows, counts, size, ref }: Props): React.JSX.Element {
  const running = counts.running > 0
  const figure = coreFigure(counts)
  return (
    <div className={`bf-core${running ? ' bf-core--live' : ''}`} style={{ width: size, height: size }}>
      <svg ref={ref} viewBox="-200 -200 400 400" width={size} height={size} role="img" aria-label={`共 ${rows.length} 個 session`}>
        <defs>
          <radialGradient id="bf-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" className="bf-glow-in" />
            <stop offset=".55" className="bf-glow-mid" />
            <stop offset="1" className="bf-glow-out" />
          </radialGradient>
        </defs>
        <g className="bf-cross" fill="none">
          <line x1="-200" y1="0" x2="200" y2="0" />
          <line x1="0" y1="-184" x2="0" y2="184" />
          <circle r="178" strokeDasharray="2 8" />
        </g>
        <circle r="170" fill="url(#bf-core-glow)" />
        <g className="bf-spin-a" fill="none">
          <circle className="bf-ticks-fine" r="150" strokeWidth="7" strokeDasharray="1.4 11.69" />
          <circle className="bf-ticks-major" r="150" strokeWidth="13" strokeDasharray="2.2 76.34" />
        </g>
        <circle className="bf-port-ring" r={128} fill="none" strokeWidth="1.2" />
        <Ring rows={rows} />
        <g className="bf-spin-b" fill="none">
          <circle className="bf-arc-b" r="92" strokeWidth="2" strokeDasharray="150 36 60 36 190 106" />
        </g>
        <g className="bf-spin-c" fill="none">
          <circle className="bf-arc-c" r="84" strokeWidth="5" strokeDasharray="46 130" />
        </g>
        <circle className={`bf-disc bf-disc--${figure.state ?? 'none'}`} r="74" strokeWidth="1.2" />
      </svg>
      <div className={`bf-core-n bf-core-n--${figure.state ?? 'none'}`} style={{ '--s': size / 400 } as React.CSSProperties}>
        <span className="bf-v">{figure.value}</span>
        <span className="bf-k">{figure.label}</span>
        <span className="bf-s">共 {rows.length} 個</span>
      </div>
    </div>
  )
}
