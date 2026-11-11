import { useState } from 'react'
import type { SavedFile } from '@shared/ipc'
import { saveFailureReason } from '@shared/saveErrors'
import { useNotice, useToast } from '../components/Toast'

/** "2026-11-10 報告.md（在 reports）": the file's name and the folder it is in, short enough for a toast. */
function placeOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return `${parts.at(-1)}（在 ${parts.at(-2) ?? '資料夾'} 裡）`
}

/** Saves through `save`, then says where the file went and offers 開資料夾. */
function useSave(): (save: () => Promise<SavedFile>, done: string, failed: string) => Promise<void> {
  const notice = useNotice()
  const show = useToast()
  return (save, done, failed) =>
    save()
      .then((file) => {
        const said = file.written ? `${done}：${placeOf(file.path)}` : `${done}，內容沒變：${placeOf(file.path)}`
        notice(said, '開資料夾', async () => window.api.showSavedFile(file.path))
      })
      .catch((err: Error) => show(`${failed}：${saveFailureReason(err.message)}`))
}

/** 存成筆記 and 存成 PDF for one session. PDF takes a moment, so its button says so while it works. */
export function SaveButtons({ sessionId }: { sessionId: string }): React.JSX.Element {
  const save = useSave()
  const [printing, setPrinting] = useState(false)
  const pdf = (): void => {
    setPrinting(true)
    void save(() => window.api.saveSessionPdf(sessionId), '存成 PDF 了', '沒有存成 PDF').finally(() => setPrinting(false))
  }
  return (
    <>
      <button className="bf-b bf-b--sm" title="存成 Markdown 筆記：報告、你說過的話、完整經過" onClick={() => void save(() => window.api.saveSessionNote(sessionId), '存成筆記了', '沒有存成筆記')}>
        筆記
      </button>
      <button className="bf-b bf-b--sm" title="印成 A4 的 PDF，內容和筆記一樣" disabled={printing} onClick={pdf}>
        {printing ? '正在存…' : 'PDF'}
      </button>
    </>
  )
}

/** 存成今天的筆記: the whole briefing as the day's note. */
export function SaveDayButton(): React.JSX.Element {
  const save = useSave()
  return (
    <button className="bf-b" title="把這份簡報存成今天的 Markdown 筆記" onClick={() => void save(() => window.api.saveBriefingNote(), '存成今天的筆記了', '沒有存成筆記')}>
      存成今天的筆記
    </button>
  )
}
