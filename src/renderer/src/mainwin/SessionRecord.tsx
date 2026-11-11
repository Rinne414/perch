import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionLabel } from '@shared/agents'
import { stampLabel } from '@shared/briefing'
import type { AgentSession, AgentTurn } from '@shared/types'
import { Markdown } from '../components/Markdown'
import { whereLine } from './briefingDeck'
import { SaveButtons } from './BriefingSave'

interface Props {
  readonly session: AgentSession
  readonly at: number
  readonly dayStartHour: number
  readonly onBack: () => void
}

/** The mouse's back button; browsers number it 3. */
const MOUSE_BACK = 3

/** Esc and the mouse back button go up one level, like the visible 回簡報. */
function useBackKeys(onBack: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onBack()
    }
    const onMouse = (e: MouseEvent): void => {
      if (e.button !== MOUSE_BACK) return
      e.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [onBack])
}

function Turn({ turn, at, dayStartHour }: { turn: AgentTurn; at: number; dayStartHour: number }): React.JSX.Element {
  return (
    <li className="bf-pn bf-turn">
      {turn.prompt !== null && (
        <div className="bf-said">
          <span className="who">
            你說<span className="bf-mono">{stampLabel(turn.startedAt, at, dayStartHour)}</span>
          </span>
          <p className="text">{turn.prompt}</p>
        </div>
      )}
      {turn.reply !== null && turn.endedAt !== null ? (
        <div className="bf-said reply">
          <span className="who">
            它回{turn.prompt === null && '（接著上一輪或背景通知，不是你打的）'}
            <span className="bf-mono">{stampLabel(turn.endedAt, at, dayStartHour)}</span>
          </span>
          <div className="text">
            <Markdown text={turn.reply} />
          </div>
        </div>
      ) : (
        <span className="bf-meta">這一輪沒有留下回覆（還在做，或被中斷了）。</span>
      )}
    </li>
  )
}

interface HeadProps {
  readonly session: AgentSession
  readonly turns: readonly AgentTurn[] | null
  readonly onBack: () => void
}

/** The visible way back, what the session is, and saving it. The back button takes focus on entry. */
function RecordHead({ session, turns, onBack }: HeadProps): React.JSX.Element {
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => back.current?.focus(), [])
  return (
    <header className="bf-pn bf-record-head">
      <button ref={back} className="bf-b" title="回到簡報（Esc）" onClick={onBack}>
        ‹ 回簡報
      </button>
      <div className="what">
        <h1>{sessionLabel(session)}</h1>
        <span className="bf-meta">
          {whereLine(session)}
          {turns && `，${turns.length} 輪`}
        </span>
      </div>
      <div className="bf-row">
        <span className="bf-lb">存下來</span>
        <SaveButtons sessionId={session.id} />
      </div>
    </header>
  )
}

/** Every prompt the person typed and every reply, in order: the whole session without opening the agent. */
export function SessionRecord({ session, at, dayStartHour, onBack }: Props): React.JSX.Element {
  const [turns, setTurns] = useState<readonly AgentTurn[] | null>(null)
  const [failed, setFailed] = useState(false)
  useBackKeys(onBack)

  const load = useCallback(() => {
    setFailed(false)
    window.api
      .getSessionTurns(session.id)
      .then(setTurns)
      .catch(() => setFailed(true))
  }, [session.id])
  useEffect(load, [load])

  return (
    <>
      <RecordHead session={session} turns={turns} onBack={onBack} />
      {failed && (
        <div className="bf-pn bf-problem" role="alert">
          <span>紀錄沒有讀到。</span>
          <button className="bf-b" onClick={load}>
            再試一次
          </button>
        </div>
      )}
      {turns && (
        <ol className="bf-turns" aria-label="完整紀錄">
          {turns.map((t) => (
            <Turn key={t.id} turn={t} at={at} dayStartHour={dayStartHour} />
          ))}
        </ol>
      )}
    </>
  )
}
