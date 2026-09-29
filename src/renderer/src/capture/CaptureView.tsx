import { useEffect, useState } from 'react'
import { clock, monthDay } from '@shared/format'
import type { Item } from '@shared/types'
import { CaptureField } from '../components/CaptureField'
import './capture.css'

/** Short enough to read, long enough to trust that it saved. */
const CONFIRM_MS = 900

const savedText = (item: Item): string => {
  if (item.dueAt === null) return item.kind === 'idea' ? '已放進收件匣' : '已加到今天'
  return `已記下，${monthDay(item.dueAt)}${item.dueHasTime ? ` ${clock(item.dueAt)}` : ''} 到期`
}

export function CaptureView(): React.JSX.Element {
  const [dayStartHour, setDayStartHour] = useState(4)
  const [saved, setSaved] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState(0)

  useEffect(() => {
    void window.api.getNow().then((p) => setDayStartHour(p.dayStartHour))
    // The window is reused; put the cursor back in the field every time it reappears.
    const onFocus = (): void => setFocusKey((k) => k + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  return (
    <main className="capture">
      <p className="capture-title">{saved ?? '記下來，之後再整理'}</p>
      <CaptureField
        key={focusKey}
        id="quick-capture"
        target="inbox"
        dayStartHour={dayStartHour}
        placeholder="想到什麼就打… 有日期會自動抓"
        autoFocus
        onSaved={(item) => {
          setSaved(savedText(item))
          setTimeout(() => {
            setSaved(null)
            window.api.hideWindow()
          }, CONFIRM_MS)
        }}
        onEscape={() => window.api.hideWindow()}
      />
    </main>
  )
}
