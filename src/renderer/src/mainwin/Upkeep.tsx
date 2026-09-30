import { useEffect, useState } from 'react'
import { dayKey } from '@shared/day'
import { clock, dayLabel } from '@shared/format'
import type { AppInfo, UpdateStatus } from '@shared/ipc'
import { acceleratorOf, isModifierCode, shortcutLabel } from '@shared/shortcut'
import { useToast } from './Toast'

type ShortcutMode = { readonly kind: 'idle' } | { readonly kind: 'recording'; readonly rejected: boolean } | { readonly kind: 'taken'; readonly tried: string }

/** 快速記錄: press 更改, then the new keys; the old shortcut stays until the new one is registered. */
export function ShortcutRow({ info, onInfo }: { info: AppInfo | null; onInfo: (next: AppInfo) => void }): React.JSX.Element {
  const [mode, setMode] = useState<ShortcutMode>({ kind: 'idle' })
  const show = useToast()
  const current = info ? shortcutLabel(info.captureShortcut) : ''

  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    e.preventDefault()
    if (e.key === 'Escape') return setMode({ kind: 'idle' })
    if (isModifierCode(e.code)) return
    const accelerator = acceleratorOf(e)
    if (!accelerator) return setMode({ kind: 'recording', rejected: true })
    window.api
      .setCaptureShortcut(accelerator)
      .then((next) => {
        if (!next) return setMode({ kind: 'taken', tried: accelerator })
        onInfo(next)
        setMode({ kind: 'idle' })
        show(`快速記錄改成 ${shortcutLabel(accelerator)}`)
      })
      .catch(() => {
        setMode({ kind: 'idle' })
        show('沒有改成功，再試一次看看')
      })
  }

  const recording = mode.kind === 'recording'
  const sub =
    mode.kind === 'taken' ? (
      <>
        <span className="late-text">{shortcutLabel(mode.tried)} 已經被別的程式用了，換一個試試。</span>原本的還能用。
      </>
    ) : recording && mode.rejected ? (
      <span className="warn-text">要同時按 Ctrl、Alt、Shift 其中兩個，再加一個字母、數字、F 鍵或空白鍵</span>
    ) : recording ? (
      '按下新的組合鍵，Esc 取消'
    ) : (
      '在任何地方按下就能記一件事'
    )

  return (
    <div className="r general">
      <span className="name">快速記錄</span>
      <span className="sub">{sub}</span>
      <div className="set-acts">
        {recording ? (
          <>
            <button className="kbd rec" autoFocus onKeyDown={onKey} onBlur={() => setMode({ kind: 'idle' })}>
              按下新的組合鍵…
            </button>
            <button className="btn ghost">取消</button>
          </>
        ) : (
          <>
            <span className="kbd">{current}</span>
            <button className="btn" disabled={!info} onClick={() => setMode({ kind: 'recording', rejected: false })}>
              更改
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** "今天 09:15", "昨天 21:00", "9/28 週一 09:15" */
function backupLabel(at: number): string {
  const now = Date.now()
  return `${dayLabel(dayKey(at, 0), dayKey(now, 0))} ${clock(at)}`
}

export function DataSection({ info, onInfo }: { info: AppInfo | null; onInfo: (next: AppInfo) => void }): React.JSX.Element {
  const [exporting, setExporting] = useState(false)
  const show = useToast()

  const exportAll = (): void => {
    setExporting(true)
    window.api
      .exportData()
      .then((result) => {
        if (result) show(`已匯出到 ${result.folder}`)
      })
      .catch(() => show('沒有匯出成功，資料夾可能不能寫入，換一個試試'))
      .finally(() => setExporting(false))
  }

  return (
    <section className="set" aria-labelledby="set-data">
      <div className="set-head">
        <h2 id="set-data">資料</h2>
        <p className="sub">全部存在這台電腦，不會上傳。</p>
      </div>
      <div className="card">
        <div className="r general">
          <span className="name">資料位置</span>
          <span className="path" title={info?.dataDir}>
            {info?.dataDir}
          </span>
          <button className="btn" onClick={() => window.api.openFolder('data')}>
            打開資料夾
          </button>
        </div>
        <div className="r general">
          <span className="name">自動備份</span>
          <span className="sub">
            每天一份、更新前一份，留最近 7 份 ·{' '}
            {info?.lastBackupAt ? (
              <>
                上次 <b>{backupLabel(info.lastBackupAt)}</b>
              </>
            ) : (
              '還沒有備份'
            )}
          </span>
          <button className="btn" onClick={() => window.api.openFolder('backups')}>
            打開備份資料夾
          </button>
        </div>
        <div className="r general">
          <span className="name">匯出</span>
          <span className="sub">全部的事和紀錄，存成 JSON（完整）和 Markdown（好讀）兩個檔</span>
          <button className="btn" disabled={exporting} onClick={exportAll}>
            {exporting ? '匯出中…' : '匯出…'}
          </button>
        </div>
        <ObsidianRow info={info} onInfo={onInfo} />
      </div>
    </section>
  )
}

/** 設定 → 資料 → Obsidian: a note per day in the vault's Perch/ folder. */
function ObsidianRow({ info, onInfo }: { info: AppInfo | null; onInfo: (next: AppInfo) => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const show = useToast()
  const dir = info?.obsidianDir ?? null

  const pick = (): void => {
    setBusy(true)
    window.api
      .pickObsidianFolder()
      .then((result) => {
        if (!result) return
        onInfo(result.info)
        show(result.written ? `已寫進 ${result.written} 天的筆記` : '已設定好，之後每天都會寫一份')
      })
      .catch(() => show('那個資料夾不能寫入，換一個試試'))
      .finally(() => setBusy(false))
  }

  const turnOff = (): void => {
    window.api
      .clearObsidianFolder()
      .then((next) => {
        onInfo(next)
        show('不再寫進 Obsidian；已經寫好的檔案都還在')
      })
      .catch(() => show('沒有改成功，再試一次看看'))
  }

  return (
    <div className="r general">
      <span className="name">Obsidian</span>
      {dir ? (
        <span className="sub obsidian-sub">
          <span className="path" title={dir}>
            {dir}
          </span>
          每天寫一份 <b>Perch/{dayKey(Date.now(), 0)}.md</b>：筆記、做完的事、那天的經過。只會寫 Perch 資料夾，在 Obsidian
          改的不會同步回來；vault 有同步到雲端的話，這些內容也會跟著同步。
        </span>
      ) : (
        <span className="sub">把每天的筆記和經過寫進 Obsidian 的資料夾，一天一份（在本機寫檔，不用連網）</span>
      )}
      <div className="set-acts">
        {dir && (
          <button className="btn ghost" onClick={turnOff}>
            關閉
          </button>
        )}
        <button className="btn" disabled={busy} onClick={pick}>
          {dir ? '換資料夾…' : '選 Obsidian 資料夾…'}
        </button>
      </div>
    </div>
  )
}

interface UpdateView {
  readonly text: React.ReactNode
  readonly button: string
  readonly disabled?: boolean
  readonly primary?: boolean
}

function updateView(status: UpdateStatus): UpdateView {
  switch (status.state) {
    case 'unavailable':
      return { text: '開發中的版本不檢查更新，安裝版才會', button: '檢查更新', disabled: true }
    case 'checking':
      return { text: '正在問 GitHub 有沒有新版…', button: '檢查中…', disabled: true }
    case 'latest':
      return { text: <span className="ok-text">已經是最新版</span>, button: '檢查更新' }
    case 'downloading':
      return {
        text: (
          <>
            <span className="info-text">
              找到 {status.version}，下載中 {status.percent}%
            </span>
            <span className="meter-line" role="progressbar" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${status.percent}%` }} />
            </span>
          </>
        ),
        button: '下載中…',
        disabled: true,
      }
    case 'ready':
      return {
        text: (
          <>
            <span className="ok-text">{status.version} 下載好了。</span>重開就會換成新版；下次結束 Perch 時也會自動裝好。
          </>
        ),
        button: '重開更新',
        primary: true,
      }
    case 'manual':
      return {
        text: (
          <>
            <span className="info-text">有新版 {status.version}。</span>這個系統要自己下載安裝，裝好後資料都還在。
          </>
        ),
        button: '打開下載頁',
        primary: true,
      }
    case 'error':
      return { text: <span className="late-text">{status.message}</span>, button: '再試一次' }
    default:
      return { text: '要看有沒有新版，按右邊的按鈕', button: '檢查更新' }
  }
}

export function UpdateSection({ info }: { info: AppInfo | null }): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    window.api
      .getUpdateStatus()
      .then(setStatus)
      .catch(() => undefined)
    return window.api.onUpdateStatus(setStatus)
  }, [])

  const act = (): void => {
    if (status.state === 'ready' || status.state === 'manual') return window.api.installUpdate()
    window.api
      .checkForUpdate()
      .then(setStatus)
      .catch(() => setStatus({ state: 'error', message: '沒有更新成功，原因寫在記錄檔裡' }))
  }

  const view = updateView(status)
  return (
    <section className="set" aria-labelledby="set-update">
      <div className="set-head">
        <h2 id="set-update">更新與回報</h2>
      </div>
      <div className="card">
        <div className="r general">
          <span className="name">版本 {info?.version}</span>
          <span className="sub">{view.text}</span>
          <button className={`btn${view.primary ? ' primary' : ''}`} disabled={view.disabled} onClick={act}>
            {view.button}
          </button>
        </div>
        <div className="r general">
          <span className="name">回報問題</span>
          <span className="sub">打開 GitHub，版本資訊會先填好；需要的話可以附上記錄檔</span>
          <div className="set-acts">
            <button className="btn ghost" onClick={() => window.api.openFolder('logs')}>
              打開記錄資料夾
            </button>
            <button className="btn" onClick={() => window.api.reportProblem()}>
              回報問題
            </button>
          </div>
        </div>
      </div>
      <p className="faint set-empty">只有按「檢查更新」時會連到 GitHub；其他時候 Perch 不上網。</p>
    </section>
  )
}
