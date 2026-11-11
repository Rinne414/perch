import { useRef, useState } from 'react'
import type { Bay, BayRow } from '@shared/bays'
import type { BriefingPayload } from '@shared/briefing'
import type { SessionState } from '@shared/sessionState'
import { useSelection } from './briefingDeck'
import { Core, MAX_RING_SEGMENTS } from './BriefingCore'
import { Glyph } from './BriefingGlyphs'
import { useWires, type WireGeometry } from './useWires'

/** A wire as drawn: where it runs, in the colour of its bay's most urgent state. */
type Wire = WireGeometry & { readonly state: SessionState }

/** A bay shows this many rows until it is opened. */
const SHOWN_ROWS = 4
/** Narrower than this, the core goes on top and the bays into a grid without wires. */
const WIDE_MAP = 760
const CORE_MAX = 400
const CORE_COMPACT = 240

/** Bays at the sides: clamp(200px, (W − 380) / 2, 300px). */
const bayWidth = (w: number): number => Math.min(300, Math.max(200, (w - 380) / 2))

function BayBox({ bay, open, onOpen }: { bay: Bay; open: boolean; onOpen: () => void }): React.JSX.Element {
  const { selected, select } = useSelection()
  const hiddenPick = bay.rows.findIndex((r) => r.id === selected) >= SHOWN_ROWS
  const all = open || hiddenPick || bay.rows.length <= SHOWN_ROWS + 1
  const rows = all ? bay.rows : bay.rows.slice(0, SHOWN_ROWS)
  return (
    <div className={`bf-bay bf-bay--${bay.side} bf-c-${bay.state}`} data-bay-side={bay.side} data-bay-key={bay.key}>
      <div className="bf-bay-h">
        <span className="bf-fd" aria-hidden="true" />
        <b title={bay.key.startsWith('<') ? bay.name : bay.key}>{bay.name}</b>
        <span className="bf-n">{bay.rows.length}</span>
      </div>
      {rows.map((r) => (
        <BayRowButton key={r.id} row={r} selected={r.id === selected} onSelect={() => select(r.id)} />
      ))}
      {!all && (
        <button className="bf-bay-r bf-bay-more" onClick={onOpen}>
          還有 {bay.rows.length - SHOWN_ROWS} 個
        </button>
      )}
    </div>
  )
}

function BayRowButton({ row, selected, onSelect }: { row: BayRow; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const classes = ['bf-bay-r', selected && 'bf-sel', row.state === 'unattended' && 'bf-dim'].filter(Boolean).join(' ')
  return (
    <button className={classes} aria-pressed={selected} onClick={onSelect}>
      <Glyph state={row.state} />
      <span className="bf-nm" title={row.name}>
        {row.name}
      </span>
      <span className="bf-t">{row.time}</span>
    </button>
  )
}

/** One wire: a glowing line, and for waiting or running a dash that moves toward or away from the core. */
function WirePath({ wire }: { wire: Wire }): React.JSX.Element {
  const flow = wire.state === 'waiting' ? 'bf-flow' : wire.state === 'running' ? 'bf-flow-out' : null
  return (
    <g className={`bf-wire bf-c-${wire.state}`}>
      <path className="bf-wire-line" d={wire.d} filter={wire.state === 'done' || wire.state === 'unattended' ? undefined : 'url(#bf-wire-glow)'} />
      {flow && <path className={`bf-wire-dash ${flow}`} d={wire.d} />}
      <circle className="bf-wire-end" cx={wire.start.x} cy={wire.start.y} r="4" />
      <circle className="bf-wire-port" cx={wire.port.x} cy={wire.port.y} r="4.5" />
    </g>
  )
}

function Wires({ wires, width, height }: { wires: readonly Wire[]; width: number; height: number }): React.JSX.Element {
  return (
    <svg className="bf-wires" width={width} height={height} aria-hidden="true">
      <defs>
        <filter id="bf-wire-glow" filterUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {wires.map((w) => (
        <WirePath key={w.key} wire={w} />
      ))}
    </svg>
  )
}

const LEGEND: readonly { state: SessionState; label: string }[] = [
  { state: 'waiting', label: '等你決定' },
  { state: 'running', label: '還在跑' },
  { state: 'done', label: '做完了' },
  { state: 'unattended', label: '放著沒接' },
  { state: 'failed', label: '失敗了' },
]

function Legend({ many }: { many: boolean }): React.JSX.Element {
  return (
    <div className="bf-legend">
      {LEGEND.map((l) => (
        <span key={l.state}>
          <Glyph state={l.state} size={12} />
          {l.label}
        </span>
      ))}
      <span className="bf-legend-note">{many ? '圓環一段是一種狀態' : '圓環一格是一個 session'}；線的顏色是那個專案裡最急的狀態</span>
    </div>
  )
}

/** The colour and motion come from the data, not from what the DOM said when it was last measured. */
function coloured(wires: readonly WireGeometry[], bays: readonly Bay[]): Wire[] {
  const states = new Map(bays.map((b) => [b.key, b.state]))
  return wires.flatMap((w) => {
    const state = states.get(w.key)
    return state ? [{ ...w, state }] : []
  })
}

/** 全部的 agent: every session of the briefing by project, each project wired to the core. */
export function MapPanel({ briefing }: { briefing: BriefingPayload }): React.JSX.Element {
  const { bays } = briefing
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const mapRef = useRef<HTMLDivElement>(null)
  const coreRef = useRef<SVGSVGElement>(null)
  const rows = bays.flatMap((b) => b.rows)
  const version = `${bays.map((b) => `${b.key}:${b.rows.length}`).join('|')}#${[...opened].join('|')}`
  const measured = useWires(mapRef, coreRef, version)
  const wires = coloured(measured.wires, bays)
  const { width, height } = measured
  const wide = width === 0 || width >= WIDE_MAP
  const bayW = bayWidth(width)
  const coreSize = wide ? Math.max(CORE_COMPACT, Math.min(CORE_MAX, width - 2 * bayW - 24)) : Math.min(CORE_COMPACT, width)
  const open = (key: string): void => setOpened(new Set([...opened, key]))
  const box = (b: Bay): React.JSX.Element => <BayBox key={b.key} bay={b} open={opened.has(b.key)} onOpen={() => open(b.key)} />
  const counts = { waiting: briefing.waiting.length, running: briefing.running.length, done: briefing.done.length }
  return (
    <section className="bf-pn" aria-labelledby="bf-h-map">
      <div className="bf-pn-h">
        <h2 id="bf-h-map" tabIndex={-1}>
          全部的 agent
        </h2>
        <span className="bf-rule" aria-hidden="true" />
        <span className="bf-hint" title="按專案分，點名字看它的報告">按專案分，點名字看它的報告</span>
        <span className="bf-n">{String(rows.length).padStart(2, '0')}</span>
      </div>
      <div className="bf-pn-b">
        {rows.length === 0 && <p className="bf-note">這一週沒有 agent 在等你、在跑或剛做完。</p>}
        <div
          ref={mapRef}
          className={`bf-map${wide ? '' : ' bf-map--compact'}`}
          style={wide ? ({ '--bay-w': `${bayW}px`, '--core': `${coreSize}px` } as React.CSSProperties) : undefined}
        >
          {wide && <Wires wires={wires} width={width} height={height} />}
          {wide && <div className="bf-bays bf-bays--left">{bays.filter((b) => b.side === 'left').map(box)}</div>}
          <div className="bf-core-cell">
            <Core ref={coreRef} rows={rows} counts={counts} size={coreSize} />
          </div>
          {wide && <div className="bf-bays bf-bays--right">{bays.filter((b) => b.side === 'right').map(box)}</div>}
          {!wide && <div className="bf-bays bf-bays--grid">{bays.map(box)}</div>}
        </div>
        <Legend many={rows.length > MAX_RING_SEGMENTS} />
      </div>
    </section>
  )
}
