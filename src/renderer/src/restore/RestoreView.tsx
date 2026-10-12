import { useCallback, useEffect, useRef, useState } from 'react'
import { agentName, sessionLabel } from '@shared/agents'
import type { RestoreResult } from '@shared/ipc'
import { endLabel } from '@shared/now'
import { projectName } from '@shared/projects'
import {
  clockLabel,
  RESTORE_RANGES_HOURS,
  restartLine,
  type RestartKind,
  type RestoreCandidate,
  type RestoreList,
} from '@shared/restore'
import { errorReason } from '../components/Power'
import './restore.css'

/** Long enough to read "開了 3 個分頁" before the window goes. */
const CLOSE_AFTER_MS = 1_600
const [SHORT_RANGE, LONG_RANGE] = RESTORE_RANGES_HOURS

const pad = (n: number): string => String(n).padStart(2, '0')

/** "14:05" today, "10/11 14:05" before. */
function timeLabel(at: number, now: number): string {
  const d = new Date(at)
  return d.toDateString() === new Date(now).toDateString() ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : clockLabel(at)
}

const CUT_OFF_GROUP: Record<RestartKind, string> = {
  crash: '當機時還開著',
  program: '重開時還開著',
  you: '關機時還開著',
  command: '關機時還開著',
  signout: '登出時還開著',
  unknown: '重開時還開著',
}

/** What 接回 did, in one line: how many tabs opened, and which folders were gone. */
function restoredText({ opened, missing }: RestoreResult): string {
  const gone = missing.map((cwd) => projectName(cwd) ?? cwd).join('、')
  if (opened === 0) return missing.length > 0 ? `資料夾都不見了：${gone}` : '這些已經開著了'
  return missing.length > 0 ? `開了 ${opened} 個分頁；找不到資料夾：${gone}` : `開了 ${opened} 個分頁，都接回原本的對話了`
}

const lastActive = (c: RestoreCandidate): number => Math.max(c.session.updatedAt, c.session.reopenedAt ?? 0)

interface RowProps {
  readonly candidate: RestoreCandidate
  readonly checked: boolean
  readonly busy: boolean
  readonly cutoffAt: number
  readonly now: number
  /** Say how it went away (closed, cut off); the cut-off group's heading already says it. */
  readonly sayHow: boolean
  readonly onToggle: (id: string) => void
}

function Row({ candidate, checked, busy, cutoffAt, now, sayHow, onToggle }: RowProps): React.JSX.Element {
  const { session: s, gone } = candidate
  const where = projectName(s.cwd) ?? s.cwd
  const label = sayHow ? endLabel(s, cutoffAt) : null
  const how = label === '已關' && s.endedAt !== null ? ` · ${timeLabel(s.endedAt, now)} 關的` : label ? ` · ${label}` : ''
  return (
    <li>
      <label className={`rw-row${gone ? ' gone' : ''}`} title={s.cwd ?? undefined}>
        <input
          className="cbx"
          type="checkbox"
          checked={checked && !gone}
          disabled={gone || busy}
          aria-label={gone ? `${sessionLabel(s)}：資料夾不見了，不能接回` : `接回 ${sessionLabel(s)}`}
          onChange={() => onToggle(s.id)}
        />
        <span className="main">
          <span className="nm">{sessionLabel(s)}</span>
          <span className="meta">
            {gone && <span className="bad">資料夾不見了 · </span>}
            {where} · {agentName(s.agent)}
            {how}
          </span>
          {s.detail && <span className="last">「{s.detail}」</span>}
        </span>
        <span className="tm">{timeLabel(lastActive(candidate), now)}</span>
      </label>
    </li>
  )
}

interface GroupProps extends Omit<RowProps, 'candidate' | 'checked' | 'sayHow'> {
  readonly id: string
  readonly title: string
  readonly note: string
  readonly items: readonly RestoreCandidate[]
  readonly chosen: ReadonlySet<string>
}

function Group({ id, title, note, items, chosen, ...row }: GroupProps): React.JSX.Element | null {
  const sayHow = id !== 'rw-cut'
  if (items.length === 0) return null
  return (
    <section className="rw-group" aria-labelledby={id}>
      <h2 id={id}>
        {title}
        <small>{note}</small>
      </h2>
      <ul>
        {items.map((c) => (
          <Row key={c.session.id} candidate={c} checked={chosen.has(c.session.id)} sayHow={sayHow} {...row} />
        ))}
      </ul>
    </section>
  )
}

/** The first check marks: after a crash or an installer's restart, every cut-off session that can be reopened. */
const firstChoice = (list: RestoreList): Set<string> =>
  new Set(list.preChecked ? list.interrupted.filter((c) => !c.gone).map((c) => c.session.id) : [])

/**
 * 接回 Agent session: the sessions the last restart cut off, then the ones closed lately, each
 * to tick and reopen as a Windows Terminal tab in its own folder, resuming its conversation.
 */
export function RestoreView(): React.JSX.Element {
  const [range, setRange] = useState<number>(SHORT_RANGE)
  const [list, setList] = useState<RestoreList | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)
  const started = useRef(false)
  const asked = useRef(0)

  const load = useCallback(() => {
    const ask = ++asked.current
    window.api
      .listRestore(range)
      .then((next) => {
        if (ask !== asked.current) return
        setList(next)
        const listed = new Set([...next.interrupted, ...next.others].map((c) => c.session.id))
        setChosen((prev) => {
          if (!started.current) {
            started.current = true
            return firstChoice(next)
          }
          return new Set([...prev].filter((id) => listed.has(id)))
        })
      })
      .catch((err: unknown) => setMessage({ text: errorReason(err), bad: true }))
  }, [range])

  useEffect(() => {
    load()
    // Coming back to the window: sessions may have been opened or closed meanwhile.
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  useEffect(() => {
    // The taskbar names the window after the page; the shared page is called Perch.
    document.title = '接回 Agent session'
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggle = (id: string): void =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const restore = (): void => {
    if (!list) return
    setBusy(true)
    setMessage(null)
    // Cut-off sessions left unchecked were looked at and passed over: this batch is done with them.
    const passed = list.interrupted.map((c) => c.session.id).filter((id) => !chosen.has(id))
    window.api
      .restoreSessions([...chosen], passed, range)
      .then((result) => {
        setMessage({ text: restoredText(result), bad: result.opened === 0 })
        if (result.opened > 0) {
          setTimeout(() => window.close(), CLOSE_AFTER_MS)
          return
        }
        setBusy(false)
        load()
      })
      .catch((err: unknown) => {
        setMessage({ text: errorReason(err), bad: true })
        setBusy(false)
      })
  }

  const skip = (): void => {
    if (!list) return
    setBusy(true)
    window.api
      .skipRestore(list.interrupted.map((c) => c.session.id))
      .then(() => {
        setMessage({ text: '好，這批不接回了。之後想接回，它們會在「之前關掉的」', bad: false })
        load()
      })
      .catch((err: unknown) => setMessage({ text: errorReason(err), bad: true }))
      .finally(() => setBusy(false))
  }

  const shortcut = (): void => {
    window.api
      .makeRestoreShortcut()
      .then(() => setMessage({ text: '桌面多了一個「接回 Agent session」捷徑', bad: false }))
      .catch((err: unknown) => setMessage({ text: errorReason(err), bad: true }))
  }

  const now = Date.now()
  const cut = list?.interrupted ?? []
  const others = list?.others ?? []
  const count = [...cut, ...others].filter((c) => chosen.has(c.session.id) && !c.gone).length
  const restart = list?.restart ?? null
  const crash = list?.preChecked === true && cut.length > 0
  const rangeText = range === SHORT_RANGE ? `最近 ${SHORT_RANGE} 小時` : `最近 ${LONG_RANGE / 24} 天`
  const row = { busy, cutoffAt: list?.cutoffAt ?? 0, now, onToggle: toggle, chosen }

  return (
    <main className={`rw${crash ? ' crash' : ''}`} aria-labelledby="rw-title">
      <header className="rw-bar">
        <span>Perch</span>
        <button className="rw-x" aria-label="關閉" title="關閉（Esc）" onClick={() => window.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1" aria-hidden="true">
            <path d="M0 0l10 10M10 0 0 10" />
          </svg>
        </button>
      </header>
      <div className="rw-head">
        <h1 id="rw-title">接回 Agent session</h1>
        <p className={`rw-why${crash ? ' warn' : ''}`}>
          {restart && cut.length > 0 ? restartLine(restart, cut.length) : `${rangeText}用過、現在沒開著的 session。勾要接回的。`}
        </p>
      </div>
      <div className="rw-list">
        {!list && <p className="rw-empty">讀取中…</p>}
        {list && cut.length + others.length === 0 && <p className="rw-empty">{rangeText}沒有可以接回的 session。</p>}
        <Group id="rw-cut" title={CUT_OFF_GROUP[restart?.kind ?? 'unknown']} note={`${cut.length} 個`} items={cut} {...row} />
        <Group id="rw-closed" title="之前關掉的" note={`${rangeText}用過`} items={others} {...row} />
        {list && <p className="rw-note">現在開著的 session 不會列在這裡。</p>}
        {list && range === SHORT_RANGE && (
          <button className="rw-more" onClick={() => setRange(LONG_RANGE)}>
            再早一點：顯示 {LONG_RANGE / 24} 天內的
          </button>
        )}
      </div>
      <footer className="rw-foot">
        <div className="acts">
          <button className="btn primary" disabled={busy || count === 0} onClick={restore}>
            {count > 0 ? `在 Windows Terminal 接回 ${count} 個` : '勾要接回的'}
          </button>
          {cut.length > 0 ? (
            <button className="btn ghost" disabled={busy} onClick={skip}>
              這次都不要
            </button>
          ) : (
            <button className="btn ghost" onClick={() => window.close()}>
              關閉
            </button>
          )}
        </div>
        <p className="tiny">
          <span className={message?.bad ? 'bad' : message ? 'ok' : undefined} role="status">
            {message?.text ?? '每個 session 開一個分頁，在原本的資料夾接回對話'}
          </span>
          <span className="push" />
          <button className="link2" onClick={shortcut}>
            放一個捷徑到桌面
          </button>
        </p>
      </footer>
    </main>
  )
}
