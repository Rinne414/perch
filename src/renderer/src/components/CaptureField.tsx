import { useMemo, useState } from 'react'
import { parseCapture } from '@shared/capture'
import { clock, monthDay } from '@shared/format'
import type { CaptureTarget } from '@shared/ipc'
import type { Item } from '@shared/types'
import './capture-field.css'

interface Props {
  readonly id: string
  readonly target: CaptureTarget
  readonly dayStartHour: number
  readonly placeholder: string
  readonly autoFocus?: boolean
  readonly onSaved?: (item: Item) => void
  readonly onEscape?: () => void
}

const hintFor = (target: CaptureTarget): string => (target === 'today' ? 'Enter 加到今天' : 'Enter 放進收件匣')

/** One line in, one item out. Shows what date it read while you type. */
export function CaptureField(props: Props): React.JSX.Element {
  const { id, target, dayStartHour, placeholder, autoFocus, onSaved, onEscape } = props
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => (text.trim() ? parseCapture(text, Date.now(), dayStartHour) : null), [text, dayStartHour])
  const dateLabel =
    parsed?.dueAt != null ? `${monthDay(parsed.dueAt)}${parsed.dueHasTime ? ` ${clock(parsed.dueAt)}` : ''}` : null

  const save = (): void => {
    if (!text.trim()) return
    window.api
      .capture(text, target)
      .then((item) => {
        setText('')
        setError(null)
        onSaved?.(item)
      })
      .catch(() => setError('沒存成功，再按一次 Enter 試試'))
  }

  return (
    <div className="capture-field">
      <input
        id={id}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-label="快速記錄"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
          if (e.key === 'Escape') {
            setText('')
            onEscape?.()
          }
        }}
      />
      {text.trim() && (
        <p className="capture-hint" aria-live="polite">
          {error ?? (dateLabel ? <><span className="capture-date">{dateLabel}</span> 到期 · Enter 儲存</> : hintFor(target))}
        </p>
      )}
    </div>
  )
}
