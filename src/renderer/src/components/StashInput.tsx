import { useCallback, useEffect, useState } from 'react'
import { tagsOf, type Clip } from '@shared/clips'
import { useToast } from './Toast'

/** Turns a paste or a drop into clips: pictures become files, words become text. Resolves to what was added. */
function useAddClips(): (data: DataTransfer | null) => Promise<Clip[]> {
  const show = useToast()
  return useCallback(
    async (data) => {
      if (!data) return []
      const files = [...data.files]
      const images = files.filter((f) => f.type.startsWith('image/'))
      const added: Clip[] = []
      try {
        for (const file of images) added.push(await window.api.addImageClip(new Uint8Array(await file.arrayBuffer())))
        // A picture copied from a page also carries its address as text; the picture is what was meant.
        const text = images.length === 0 ? data.getData('text/plain') : ''
        if (text.trim()) added.push(await window.api.addTextClip(text))
      } catch {
        show('沒有存成功：圖片要是 PNG、JPG、GIF 或 WebP，最大 20 MB')
        return added
      }
      if (files.length > images.length) show('目前只收文字和圖片，其他檔案沒有存')
      else if (added.length === 0) show('剪貼簿裡沒有文字或圖片')
      return added
    },
    [show],
  )
}

const isTyping = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')

const hasImage = (data: DataTransfer): boolean => [...data.files].some((f) => f.type.startsWith('image/'))

/** Clips from a paste or a drop, then `onAdded` with what was kept. */
function useTake(onAdded?: (clips: Clip[]) => void): (data: DataTransfer | null) => void {
  const add = useAddClips()
  return useCallback(
    (data) => {
      void add(data).then((clips) => clips.length > 0 && onAdded?.(clips))
    },
    [add, onAdded],
  )
}

/** Ctrl+V anywhere on the page keeps what was copied, except in a text field, where it pastes as usual. */
function useWindowPaste(take: (data: DataTransfer | null) => void): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (isTyping(e.target) || e.defaultPrevented) return
      e.preventDefault()
      take(e.clipboardData)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [take])
}

interface HintProps {
  /** Something is being written: show how to save it. */
  readonly writing: boolean
  readonly text: string
  readonly retentionDays: number | null
}

function MemoHint({ writing, text, retentionDays }: HintProps): React.JSX.Element {
  const tags = tagsOf(text)
  const rule =
    retentionDays === null ? '都會一直留著，要自己刪' : `自己寫的會一直留著，貼上的 ${retentionDays} 天沒用到會清掉`
  return (
    <p className="memo-hint" aria-live="polite">
      {writing ? (
        <>
          <span>
            <b>Enter</b> 存 · <b>Shift+Enter</b> 換行 · <b>Esc</b> 清掉
          </span>
          {tags.length > 0 && (
            <span>
              <span className="tg">{tags.map((t) => `#${t}`).join(' ')}</span> 會變成標籤
            </span>
          )}
        </>
      ) : (
        <>
          <span>
            沒點進框也能直接 <b>Ctrl+V</b> 貼上，圖片可以拖進來
          </span>
          <span>{rule}</span>
        </>
      )}
    </p>
  )
}

interface Props {
  readonly retentionDays: number | null
  readonly wide?: boolean
  readonly onAdded?: (clips: Clip[]) => void
}

/**
 * The top of 暫存: a box to write a memo in, kept from the start, and where pasted and dropped
 * things land. Ctrl+V outside a text field saves at once; inside the box it pastes into the words,
 * except a picture, which is saved as it is.
 */
export function StashInput({ retentionDays, wide = false, onAdded }: Props): React.JSX.Element {
  const show = useToast()
  const take = useTake(onAdded)
  useWindowPaste(take)
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [over, setOver] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = (): void => {
    if (!text.trim() || saving) return
    setSaving(true)
    window.api
      .addTextClip(text, true)
      .then(() => setText(''))
      .catch(() => show('沒有存成功，再試一次看看'))
      .finally(() => setSaving(false))
  }

  return (
    <div
      className={`stash-input${wide ? ' wide' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        // Words dropped into the box join what is being written; anything else is kept.
        if (e.dataTransfer.files.length === 0 && e.target instanceof HTMLTextAreaElement) return
        e.preventDefault()
        take(e.dataTransfer)
      }}
    >
      <div className={`memo-box${over ? ' over' : ''}`}>
        <textarea
          value={text}
          rows={wide ? 2 : 1}
          placeholder={wide ? '寫點什麼，Enter 存，Shift+Enter 換行' : '寫點什麼，Enter 存'}
          aria-label="寫一則暫存"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPaste={(e) => {
            if (!hasImage(e.clipboardData)) return
            e.preventDefault()
            take(e.clipboardData)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              save()
            }
            if (e.key === 'Escape') setText('')
          }}
        />
        <button className={`btn${text.trim() ? ' primary' : ''}`} disabled={!text.trim() || saving} onClick={save}>
          存
        </button>
      </div>
      {/* While something is written, how to save it stays in view even after clicking elsewhere. */}
      <MemoHint writing={focused || text.trim() !== ''} text={text} retentionDays={retentionDays} />
    </div>
  )
}
