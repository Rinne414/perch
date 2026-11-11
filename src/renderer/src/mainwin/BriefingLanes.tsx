import { Fragment } from 'react'
import { durationLabel, durationParts, stampLabel, type BriefingPayload } from '@shared/briefing'
import { clock } from '@shared/format'
import type { Lane, LaneBar, LaneFigure, LanesView } from '@shared/lanes'
import { useSelection } from './briefingDeck'
import { Glyph, Panel } from './BriefingGlyphs'

/** A tick label too close to the right edge would run out of the track. */
const LAST_LABEL_AT = 0.93

const pct = (v: LanesView, at: number): number => (100 * (at - v.from)) / Math.max(1, v.to - v.from)
const place = (v: LanesView, from: number, to: number): React.CSSProperties => ({ left: `${pct(v, from)}%`, width: `${Math.max(0, pct(v, to) - pct(v, from))}%` })

function barTitle(bar: LaneBar, b: BriefingPayload): string {
  const start = stampLabel(bar.start, b.at, b.dayStartHour)
  const span = durationLabel(bar.to - bar.start)
  return bar.open && !bar.silent ? `${start} 到現在，做了 ${span}` : `${start} 到 ${stampLabel(bar.to, b.at, b.dayStartHour)}，做了 ${span}`
}

const END_GLYPH = { done: 'done', wait: 'waiting', fail: 'failed' } as const

function LaneRow({ lane, b }: { lane: Lane; b: BriefingPayload }): React.JSX.Element {
  const { selected, select } = useSelection()
  const v = b.lanes
  return (
    <div className={`bf-lane${selected === lane.id ? ' bf-sel' : ''}`} data-lane={lane.id} onClick={() => select(lane.id)}>
      <button className="bf-lane-nm" aria-pressed={selected === lane.id} title={lane.name}>
        <Glyph state={lane.state} />
        <span className="bf-nm">{lane.name}</span>
        <span className="bf-t">{lane.time}</span>
      </button>
      <div className="bf-tr">
        {lane.bars.map((bar) => (
          <Fragment key={bar.start}>
            <i className={`bf-bar${bar.pre ? ' bf-bar--pre' : ''}${bar.open ? ' bf-bar--open' : ''}`} style={place(v, bar.from, bar.to)} title={barTitle(bar, b)} />
            {bar.silent && (
              <i className="bf-silent" style={place(v, bar.silent.from, bar.silent.to)} title={`${stampLabel(bar.silent.from, b.at, b.dayStartHour)} 之後沒有回報`} />
            )}
          </Fragment>
        ))}
        {lane.holdFrom !== null && <i className="bf-hold" style={place(v, lane.holdFrom, v.to)} />}
        {lane.end && (
          <span className="bf-mk" style={{ left: `${pct(v, lane.end.at)}%` }}>
            <Glyph state={END_GLYPH[lane.end.kind]} size={18} />
          </span>
        )}
      </div>
    </div>
  )
}

function Ruler({ v }: { v: LanesView }): React.JSX.Element {
  return (
    <div className="bf-ruler" aria-hidden="true">
      <span />
      <div className="bf-tr">
        {v.ticks.map((t) => {
          const at = pct(v, t.at) / 100
          return (
            <i key={t.at} className={`bf-tk${t.label ? ' bf-tk--mj' : ''}`} style={{ left: `${at * 100}%` }}>
              {t.label && at <= LAST_LABEL_AT && <span>{t.label}</span>}
            </i>
          )
        })}
      </div>
    </div>
  )
}

/** The away stretch as a hatched band, and the bright 現在 line. */
function Overlay({ b }: { b: BriefingPayload }): React.JSX.Element {
  const v = b.lanes
  const { away } = b
  return (
    <div className="bf-lanes-over" aria-hidden="true">
      {away && (
        <div className="bf-band" style={place(v, Math.max(v.from, away.from), away.to)}>
          <b className="bf-band-a">你離開 {clock(away.from)}</b>
          <b className="bf-band-z">回來 {clock(away.to)}</b>
        </div>
      )}
      <i className="bf-nowl" style={{ left: `${pct(v, v.to)}%` }}>
        <b>現在 {clock(v.to)}</b>
      </i>
    </div>
  )
}

function Figure({ ms, label, tone }: { ms: number; label: string; tone?: 'wait' }): React.JSX.Element {
  const parts = durationParts(ms)
  return (
    <div className={tone ? `bf-stat bf-stat--${tone}` : 'bf-stat'}>
      <b>
        {parts.length
          ? parts.map((p) => (
              <span key={p.unit}>
                {p.value}
                <small>{p.unit}</small>
              </span>
            ))
          : '不到 1 分'}
      </b>
      <span title={label}>{label}</span>
    </div>
  )
}

function Figures({ b }: { b: BriefingPayload }): React.JSX.Element | null {
  const { workMs, quiet, longestWait } = b.lanes
  const named = (f: LaneFigure | null, words: string): React.JSX.Element | null =>
    f && <Figure ms={f.ms} label={`${words}：${f.name}`} tone="wait" />
  if (workMs <= 0 && !quiet && !longestWait) return null
  return (
    <div className="bf-stats">
      {workMs > 0 && <Figure ms={workMs} label={b.away ? '你不在的時候，它們加起來做了' : '這 12 小時它們加起來做了'} />}
      {named(quiet, '沒回報，可能卡住了')}
      {named(longestWait, '等你最久的')}
    </div>
  )
}

/** 你不在的時候: one lane per session, its turns as bars, where it stopped, and where it waits for the person. */
export function LanesPanel({ briefing }: { briefing: BriefingPayload }): React.JSX.Element {
  const v = briefing.lanes
  return (
    <Panel id="bf-h-lane" title={briefing.away ? '你不在的時候' : '這 12 小時'} hint="橫條是它在做事，虛線是它在等你" count={v.lanes.length} variant="grow">
      {v.lanes.length === 0 ? (
        <p className="bf-note">這段時間沒有 agent 做事。</p>
      ) : (
        <div className={`bf-lanes${v.lanes.length > 12 ? ' bf-lanes--scroll' : ''}`} tabIndex={v.lanes.length > 12 ? 0 : undefined}>
          <div className="bf-lanes-in">
            <Ruler v={v} />
            {v.lanes.map((lane) => (
              <LaneRow key={lane.id} lane={lane} b={briefing} />
            ))}
            <Overlay b={briefing} />
          </div>
        </div>
      )}
      {v.idle > 0 && <p className="bf-note">另外 {v.idle} 個這段時間沒動過。</p>}
      <Figures b={briefing} />
    </Panel>
  )
}
