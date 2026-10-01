import { useState } from 'react'
import { groupClips, matchesFilter, type ClipFilter } from '@shared/clips'
import { ClipCard, ClipFilters, useClips } from '../components/Clips'
import { StashInput } from '../components/StashInput'
import './stash.css'

const ALL: ClipFilter = { kind: 'all', tag: null, query: '' }

interface Props {
  readonly at: number
  readonly dayStartHour: number
  readonly selected: string | null
  readonly onOpen: (id: string) => void
}

/** 暫存 in the main window: everything written or pasted to keep, searchable, opened on the right. */
export function StashTab({ at, dayStartHour, selected, onOpen }: Props): React.JSX.Element {
  const { payload, error } = useClips()
  const [filter, setFilter] = useState<ClipFilter>(ALL)
  if (!payload) return <p className="mw-empty">{error}</p>
  const shown = payload.clips.filter((c) => matchesFilter(c, filter))

  return (
    <div className="stash-tab">
      <header className="ph">
        <h1>暫存</h1>
        <p>你寫下或貼進來的文字、圖片、連結</p>
        <input
          className="field push stash-search"
          type="search"
          value={filter.query}
          placeholder="搜尋文字和標籤"
          aria-label="搜尋暫存"
          onChange={(e) => setFilter({ ...filter, query: e.target.value })}
        />
      </header>
      <StashInput retentionDays={payload.retentionDays} wide />
      {payload.clips.length > 0 && <ClipFilters clips={payload.clips} filter={filter} onChange={setFilter} tags={6} counts />}
      {groupClips(shown, at, dayStartHour).map((group) => (
        <section className="sec" key={group.key} aria-label={group.label}>
          <h2>
            {group.label}
            {group.key === 'kept' && <small>不會自動清掉</small>}
          </h2>
          <ul className="clip-grid">
            {group.clips.map((c) => (
              <ClipCard
                key={c.id}
                clip={c}
                now={at}
                dayStartHour={dayStartHour}
                retentionDays={payload.retentionDays}
                selected={selected === c.id}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </section>
      ))}
      {payload.clips.length === 0 && (
        <div className="mw-empty">
          <p>還沒有暫存的東西。</p>
          <p className="faint">想記的寫在上面的框裡；複製了什麼想先留著，就在這裡按 Ctrl+V，圖片也可以直接拖進來。</p>
        </div>
      )}
      {payload.clips.length > 0 && shown.length === 0 && <p className="faint">沒有符合的。</p>}
    </div>
  )
}
