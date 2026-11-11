import type { AppInfo } from '@shared/ipc'
import { useToast } from '../components/Toast'

interface RowProps {
  readonly info: AppInfo | null
  readonly onInfo: (next: AppInfo) => void
}

/** 設定 → 資料 → 報告筆記: where 存成筆記 writes, and, with an Obsidian folder, a note for every finished session. */
export function ReportNotesRow({ info, onInfo }: RowProps): React.JSX.Element {
  const show = useToast()
  const vault = info?.obsidianDir ?? null
  const on = info?.autoReports ?? true
  const toggle = (): void => {
    window.api
      .setAutoReports(!on)
      .then((next) => {
        onInfo(next)
        show(next.autoReports ? 'session 做完會自動寫一份報告' : '不再自動寫報告；按「存成筆記」還是可以存')
      })
      .catch(() => show('沒有改成功，再試一次看看'))
  }
  return (
    <div className="r general">
      <span className="name">報告筆記</span>
      <span className="sub obsidian-sub">
        <span className="path" title={info?.notesDir}>
          {info?.notesDir}
        </span>
        {vault
          ? '每個 session 做完，會自動在這裡寫一份報告（最後的回覆、你說過的話、完整經過），內容有變才改寫。'
          : '按簡報裡的「存成筆記」存在這裡。選了 Obsidian 資料夾以後，改存到它的 Perch/報告，session 做完也會自動寫一份。'}
      </span>
      {vault && (
        <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label="session 做完自動寫報告" onClick={toggle}>
          <i />
        </button>
      )}
    </div>
  )
}

/** 設定 → 資料 → PDF: where 存成 PDF writes, chosen here or back to the default. */
export function PdfFolderRow({ info, onInfo }: RowProps): React.JSX.Element {
  const show = useToast()
  const choose = (): void => {
    window.api
      .pickPdfFolder()
      .then((next) => {
        if (!next) return
        onInfo(next)
        show('之後的 PDF 會存到這個資料夾')
      })
      .catch(() => show('那個資料夾不能用，換一個試試'))
  }
  const reset = (): void => {
    window.api
      .resetPdfFolder()
      .then((next) => {
        onInfo(next)
        show('PDF 改回存在預設的資料夾')
      })
      .catch(() => show('沒有改成功，再試一次看看'))
  }
  return (
    <div className="r general">
      <span className="name">PDF</span>
      <span className="sub obsidian-sub">
        <span className="path" title={info?.pdfDir}>
          {info?.pdfDir}
        </span>
        按「存成 PDF」把一個 session 的完整紀錄印成 A4，存在這裡{info?.pdfDirIsDefault ? '（預設）' : ''}。
      </span>
      <div className="set-acts">
        {info && !info.pdfDirIsDefault && (
          <button className="btn ghost" onClick={reset}>
            恢復預設
          </button>
        )}
        <button className="btn" onClick={choose}>
          選資料夾…
        </button>
      </div>
    </div>
  )
}
