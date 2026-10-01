import { useMemo, useState } from 'react'
import { parseCapture } from '@shared/capture'
import { dayKey } from '@shared/day'
import { clock, dayLabel } from '@shared/format'

interface Props {
  readonly dayStartHour: number
  readonly initial?: string
  /** Receives the typed text; the main process reads the date out of it again. */
  readonly onSubmit: (text: string) => void
  readonly onCancel: () => void
}

const QUICK = ['今天', '明天', '週五', '週六', '下週一'] as const

/** A one-line date field that says what it understood before you commit. */
export function DueEditor({ dayStartHour, initial = '', onSubmit, onCancel }: Props): React.JSX.Element {
  const [text, setText] = useState(initial)
  const now = Date.now()
  const today = dayKey(now, dayStartHour)

  const parsed = useMemo(() => (text.trim() ? parseCapture(text, Date.now(), dayStartHour) : null), [text, dayStartHour])
  const understood =
    parsed?.dueAt != null
      ? `${dayLabel(dayKey(parsed.dueAt, dayStartHour), today)}${parsed.dueHasTime ? ` ${clock(parsed.dueAt)}` : ''}`
      : null

  const submit = (value: string): void => {
    if (value.trim() && parseCapture(value, Date.now(), dayStartHour).dueAt !== null) onSubmit(value)
  }

  return (
    <div
      className="due-editor"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        // Esc closes only this editor, not the panel around it.
        e.stopPropagation()
        onCancel()
      }}
    >
      <div className="line">
        <input
          className="field"
          autoFocus
          value={text}
          placeholder="週五、10/3、明天下午3點"
          aria-label="截止日"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit(text)}
        />
        <button className="btn primary" disabled={!understood} onClick={() => submit(text)}>
          設定
        </button>
        <button className="btn ghost" onClick={onCancel}>
          取消
        </button>
      </div>
      <p className="hint" aria-live="polite">
        {understood ? (
          <>
            讀到 <b>{understood}</b>
            {!parsed?.dueHasTime && '，當天早上提醒'}
          </>
        ) : text.trim() ? (
          '看不懂這個日期'
        ) : (
          '打日期或時間，或點下面'
        )}
      </p>
      <div className="chips">
        {QUICK.map((q) => (
          <button key={q} className="chip" onClick={() => submit(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
