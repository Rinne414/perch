import { useCallback, useEffect, useRef, useState } from 'react'
import { clearsAt, clipImageUrl, type Clip, type ClipKind } from '@shared/clips'
import { monthDay, whenLabel } from '@shared/format'
import { useClips } from '../components/Clips'
import { CopyIcon, KeepIcon, WindowIcon } from '../components/Icons'
import { useToast } from '../components/Toast'
import './stash.css'

const KIND_LABEL: Readonly<Record<ClipKind, string>> = { text: '文字', image: '圖片', link: '連結' }

const sizeLabel = (clip: Clip): string | null => {
  const parts: string[] = []
  if (clip.width && clip.height) parts.push(`${clip.width}×${clip.height}`)
  if (clip.bytes) parts.push(clip.bytes < 1024 * 1024 ? `${Math.max(1, Math.round(clip.bytes / 1024))} KB` : `${(clip.bytes / 1024 / 1024).toFixed(1)} MB`)
  return parts.length ? parts.join(' · ') : null
}

/** Saves this long after the last keystroke, like the diary. */
const SAVE_AFTER_MS = 600

/**
 * The text, link or caption; #tags in it sort the clip. Saved shortly after typing stops,
 * and whatever is still unsaved when the panel closes.
 */
function ClipText({ clip }: { clip: Clip }): React.JSX.Element {
  const [text, setText] = useState(clip.text)
  const show = useToast()
  const latest = useRef(clip)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  latest.current = clip

  const flush = useCallback((): void => {
    clearTimeout(timer.current)
    const value = pending.current
    pending.current = null
    const current = latest.current
    if (value === null || value.trim() === current.text || (!value.trim() && current.kind !== 'image')) return
    window.api.editClip(current.id, value).catch(() => show('沒有存成功，再試一次看看'))
  }, [show])

  useEffect(() => {
    if (pending.current === null) setText(clip.text)
  }, [clip.text])
  useEffect(() => flush, [flush])

  return (
    <textarea
      className="field clip-edit"
      value={text}
      rows={clip.kind === 'text' ? 6 : 2}
      placeholder={clip.kind === 'image' ? '加說明或 #標籤' : ''}
      aria-label={clip.kind === 'image' ? '說明' : '內容'}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value)
        pending.current = e.target.value
        clearTimeout(timer.current)
        timer.current = setTimeout(flush, SAVE_AFTER_MS)
      }}
      onBlur={flush}
    />
  )
}

function keepNote(clip: Clip, retentionDays: number | null): string {
  if (clip.kept) return '保留中：不會自動清掉'
  const end = clearsAt(clip, retentionDays)
  if (end === null) return '設定為不自動清掉'
  return `還沒保留：${monthDay(end)} 前沒用到就會清掉。複製、在資料夾打開、改說明都算用到。`
}

interface Props {
  readonly id: string
  readonly at: number
  readonly dayStartHour: number
  readonly onClose: () => void
}

/** One clip on the right: the whole of it, its caption and tags, and what can be done with it. */
export function ClipPanel({ id, at, dayStartHour, onClose }: Props): React.JSX.Element | null {
  const { payload } = useClips()
  const show = useToast()
  if (!payload) return <aside className="item-panel clip-panel" aria-busy="true" />
  const clip = payload.clips.find((c) => c.id === id)
  if (!clip) return null

  const fail = (): void => show('沒有成功，再試一次看看')
  const copy = (): void => {
    window.api
      .copyClip(clip.id)
      .then(() => show(clip.kind === 'image' ? '圖片已複製' : '已複製'))
      .catch(() => show(clip.kind === 'image' ? '這張圖沒辦法複製，用「在資料夾顯示」打開它' : '沒有複製成功，再試一次看看'))
  }
  const remove = (): void => {
    onClose()
    window.api
      .removeClip(clip.id)
      .then(() =>
        show('已刪除暫存', () =>
          window.api.undoRemoveClip(clip.id).then((ok) => {
            if (!ok) throw new Error('Undo window passed')
          }),
        ),
      )
      .catch(fail)
  }
  const size = sizeLabel(clip)

  return (
    <aside className="item-panel clip-panel" aria-label={`暫存的${KIND_LABEL[clip.kind]}`}>
      <div className="detail-top">
        <p className="lbl panel-kind">{KIND_LABEL[clip.kind]}</p>
        <button
          className={`btn keep-btn${clip.kept ? ' on' : ''}`}
          aria-pressed={clip.kept}
          onClick={() => void window.api.keepClip(clip.id, !clip.kept).catch(fail)}
        >
          <KeepIcon filled={clip.kept} />
          {clip.kept ? '已保留' : '保留'}
        </button>
        <button className="wc small" aria-label="關閉" title="關閉（Esc）" onClick={onClose}>
          <WindowIcon kind="close" />
        </button>
      </div>

      {clip.kind === 'image' && <img className="clip-preview" src={clipImageUrl(clip.id)} alt={clip.text || '暫存的圖片'} />}
      <p className="sub clip-when">
        {whenLabel(clip.createdAt, at, dayStartHour)} 貼上{size && ` · ${size}`}
      </p>

      <div className="grp">
        <p className="lbl">{clip.kind === 'image' ? '說明' : '內容'}</p>
        <ClipText key={clip.id} clip={clip} />
        <p className="faint clip-tags">
          {clip.tags.length > 0 ? clip.tags.map((t) => `#${t}`).join('  ') : '在文字裡打 #標籤，就能用標籤篩選'}
        </p>
      </div>

      <div className="grp clip-buttons">
        <button className="btn" onClick={copy}>
          <CopyIcon />
          {clip.kind === 'image' ? '複製圖片' : '複製'}
        </button>
        {clip.kind === 'image' && (
          <button className="btn" onClick={() => void window.api.showClipInFolder(clip.id).catch(fail)}>
            在資料夾顯示
          </button>
        )}
        <button
          className="btn"
          disabled={!clip.text.trim()}
          title={clip.text.trim() ? '第一行變成隨手記裡的一件事' : '先加一行說明'}
          onClick={() =>
            void window.api
              .clipToTask(clip.id)
              .then((item) => show(`已記到隨手記「${item.title}」`))
              .catch(fail)
          }
        >
          變成待辦
        </button>
      </div>

      <div className="detail-foot">
        <span>{keepNote(clip, payload.retentionDays)}</span>
        <button className="btn danger" onClick={remove}>
          刪除
        </button>
      </div>
    </aside>
  )
}
