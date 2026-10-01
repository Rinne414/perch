import { useRef, useState } from 'react'
import { groupClips, matchesFilter, type Clip, type ClipFilter } from '@shared/clips'
import { ClipCard, ClipFilters, PasteZone, useClips } from '../components/Clips'
import { useToast } from '../components/Toast'

const ALL: ClipFilter = { kind: 'all', tag: null, query: '' }

/** Right after a picture is pasted: an optional caption, where #tags sort it. */
function CaptionField({ clip, onDone }: { clip: Clip; onDone: () => void }): React.JSX.Element {
  const [text, setText] = useState('')
  const finished = useRef(false)
  const show = useToast()
  const finish = (save: boolean): void => {
    if (finished.current) return
    finished.current = true
    onDone()
    const caption = text.trim()
    if (save && caption) window.api.editClip(clip.id, caption).catch(() => show('說明沒有存成功'))
  }
  return (
    <input
      className="field clip-caption-field"
      autoFocus
      value={text}
      placeholder="加說明或 #標籤（可以不填，Enter 存）"
      aria-label="圖片說明"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(true)
        if (e.key === 'Escape') finish(false)
      }}
    />
  )
}

interface Props {
  readonly at: number
  readonly dayStartHour: number
}

/** The float's 暫存: paste to keep, newest first, 保留 on top. */
export function StashTab({ at, dayStartHour }: Props): React.JSX.Element {
  const { payload, error } = useClips()
  const [filter, setFilter] = useState<ClipFilter>(ALL)
  const [captioning, setCaptioning] = useState<string | null>(null)
  if (!payload) return <p className="empty">{error}</p>

  const shown = payload.clips.filter((c) => matchesFilter(c, filter))
  const onAdded = (clips: Clip[]): void => setCaptioning(clips.find((c) => c.kind === 'image')?.id ?? null)

  return (
    <div className="stash">
      <PasteZone retentionDays={payload.retentionDays} onAdded={onAdded} />
      {payload.clips.length > 0 && <ClipFilters clips={payload.clips} filter={filter} onChange={setFilter} tags={3} />}
      {groupClips(shown, at, dayStartHour).map((group) => (
        <section className="sec" key={group.key} aria-label={group.label}>
          <h2>
            {group.label}
            {group.key === 'kept' && <small>不會自動清掉</small>}
          </h2>
          <ul className="clip-list">
            {group.clips.map((c) => (
              <ClipCard key={c.id} clip={c} now={at} dayStartHour={dayStartHour} retentionDays={payload.retentionDays}>
                {captioning === c.id && <CaptionField clip={c} onDone={() => setCaptioning(null)} />}
              </ClipCard>
            ))}
          </ul>
        </section>
      ))}
      {payload.clips.length === 0 && (
        <div className="empty">
          <p>還沒有暫存的東西。</p>
          <p className="faint">複製了什麼想先留著，就在這裡按 Ctrl+V。</p>
        </div>
      )}
      {payload.clips.length > 0 && shown.length === 0 && <p className="faint stash-none">沒有符合的。</p>}
    </div>
  )
}
