import { useEffect, useState } from 'react'
import {
  clipImageUrl,
  daysLeft,
  matchesFilter,
  topTags,
  type Clip,
  type ClipFilter,
  type ClipKindFilter,
  type ClipsPayload,
} from '@shared/clips'
import { whenLabel } from '@shared/format'
import { CopyIcon, KeepIcon, TrashIcon } from './Icons'
import { useToast } from './Toast'
import './clips.css'

export interface ClipsState {
  readonly payload: ClipsPayload | null
  readonly error: string | null
}

/** Everything in 暫存, refreshed whenever anything changes. */
export function useClips(): ClipsState {
  const [state, setState] = useState<ClipsState>({ payload: null, error: null })
  useEffect(() => {
    const load = (): void => {
      window.api
        .getClips()
        .then((payload) => setState({ payload, error: null }))
        .catch((err: Error) => setState((s) => ({ ...s, error: err.message })))
    }
    load()
    return window.api.onChanged(load)
  }, [])
  return state
}

function LinkView({ url }: { url: string }): React.JSX.Element {
  let host = url
  let rest = ''
  try {
    const parsed = new URL(url)
    host = parsed.host
    rest = `${parsed.pathname}${parsed.search}`.replace(/^\/$/, '')
  } catch {
    // Not a full address after all: show it as it is.
  }
  return (
    <span className="clip-link">
      <span className="fav" aria-hidden="true">
        {host.replace(/^www\./, '').charAt(0).toUpperCase()}
      </span>
      <span className="clip-link-text">
        <b>{host}</b>
        {rest && <span>{rest}</span>}
      </span>
    </span>
  )
}

/** Copy, 保留 and delete: shown while the clip is pointed at. */
export function ClipActs({ clip }: { clip: Clip }): React.JSX.Element {
  const show = useToast()
  const copy = (): void => {
    window.api
      .copyClip(clip.id)
      .then(() => show(clip.kind === 'image' ? '圖片已複製' : '已複製'))
      .catch(() => show(clip.kind === 'image' ? '這張圖沒辦法複製，可以到控制台用「在資料夾顯示」打開' : '沒有複製成功，再試一次看看'))
  }
  const remove = (): void => {
    window.api
      .removeClip(clip.id)
      .then(() =>
        show('已刪除暫存', () =>
          window.api.undoRemoveClip(clip.id).then((ok) => {
            if (!ok) throw new Error('Undo window passed')
          }),
        ),
      )
      .catch(() => show('沒有刪成功，再試一次看看'))
  }
  return (
    <span className="clip-acts">
      <button className="act icon" aria-label="複製" title="複製" onClick={copy}>
        <CopyIcon />
      </button>
      <button
        className={`act icon keep${clip.kept ? ' on' : ''}`}
        aria-pressed={clip.kept}
        aria-label={clip.kept ? '取消保留' : '保留'}
        title={clip.kept ? '取消保留（之後沒用到會清掉）' : '保留（不會自動清掉）'}
        onClick={() => void window.api.keepClip(clip.id, !clip.kept).catch(() => show('沒有成功，再試一次看看'))}
      >
        <KeepIcon filled={clip.kept} />
      </button>
      <button className="act icon danger" aria-label="刪除" title="刪除（1 分鐘內可以復原）" onClick={remove}>
        <TrashIcon size={14} />
      </button>
    </span>
  )
}

interface CardProps {
  readonly clip: Clip
  readonly now: number
  readonly dayStartHour: number
  readonly retentionDays: number | null
  readonly selected?: boolean
  /** The main window opens the clip on the right; the float has no panel. */
  readonly onOpen?: (id: string) => void
  /** Extra content under the card, such as the caption field of a picture just pasted. */
  readonly children?: React.ReactNode
}

/** One clip: the text, the link or the picture, when it came, its tags, and when it will go. */
export function ClipCard({ clip, now, dayStartHour, retentionDays, selected = false, onOpen, children }: CardProps): React.JSX.Element {
  const left = daysLeft(clip, now, retentionDays)
  const content =
    clip.kind === 'image' ? (
      <img className="clip-img" src={clipImageUrl(clip.id)} alt={clip.text || '暫存的圖片'} loading="lazy" draggable={false} />
    ) : clip.kind === 'link' ? (
      <LinkView url={clip.text} />
    ) : (
      <span className="clip-txt">{clip.text}</span>
    )
  const caption = clip.kind === 'image' && clip.text ? <span className="clip-caption">{clip.text}</span> : null
  return (
    <li className={`clip kind-${clip.kind}${clip.kept ? ' kept' : ''}${selected ? ' selected' : ''}`}>
      {onOpen ? (
        <button className="clip-body" aria-pressed={selected} onClick={() => onOpen(clip.id)}>
          {content}
          {caption}
        </button>
      ) : (
        <div className="clip-body">
          {content}
          {caption}
        </div>
      )}
      <div className="clip-meta">
        <span>{whenLabel(clip.createdAt, now, dayStartHour)}</span>
        {clip.kind === 'link' && <span>連結</span>}
        {clip.tags.map((t) => (
          <span key={t} className="tg">
            #{t}
          </span>
        ))}
        {left !== null && <span className="due">{left} 天後清掉</span>}
      </div>
      <ClipActs clip={clip} />
      {children}
    </li>
  )
}

const KINDS: readonly { kind: ClipKindFilter; label: string }[] = [
  { kind: 'all', label: '全部' },
  { kind: 'text', label: '文字' },
  { kind: 'image', label: '圖片' },
  { kind: 'link', label: '連結' },
]

interface FiltersProps {
  readonly clips: readonly Clip[]
  readonly filter: ClipFilter
  readonly onChange: (filter: ClipFilter) => void
  /** How many tags get a chip. */
  readonly tags: number
  readonly counts?: boolean
}

/** 全部 / 文字 / 圖片 / 連結, then the most used #tags; a tag chip toggles. */
export function ClipFilters({ clips, filter, onChange, tags, counts = false }: FiltersProps): React.JSX.Element {
  const count = (kind: ClipKindFilter): number => clips.filter((c) => matchesFilter(c, { kind, tag: null, query: '' })).length
  return (
    <div className="chips clip-filters">
      {KINDS.map(({ kind, label }) => (
        <button
          key={kind}
          className={`chip${filter.kind === kind ? ' on' : ''}`}
          aria-pressed={filter.kind === kind}
          onClick={() => onChange({ ...filter, kind })}
        >
          {label}
          {counts && ` ${count(kind)}`}
        </button>
      ))}
      {topTags(clips, tags).map(({ tag, count: n }) => (
        <button
          key={tag}
          className={`chip tg${filter.tag === tag ? ' on' : ''}`}
          aria-pressed={filter.tag === tag}
          onClick={() => onChange({ ...filter, tag: filter.tag === tag ? null : tag })}
        >
          #{tag}
          {counts && ` ${n}`}
        </button>
      ))}
    </div>
  )
}
