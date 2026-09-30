import type { UpdateStatus } from '@shared/ipc'

/** Turns updater errors into something a person can act on; the full error goes to the log. */
export function updateErrorText(err: unknown): string {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT|ENOTFOUND|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT/.test(text)) {
    return '連不上 GitHub，檢查一下網路再試一次'
  }
  if (/\b404\b|No published versions|Cannot find latest\.yml|Unable to find latest version/.test(text)) {
    return 'GitHub 上還沒有可以更新的版本'
  }
  if (/sha512 checksum mismatch|ERR_UPDATER_INVALID_SIGNATURE/.test(text)) return '下載的檔案對不上，沒有安裝；再試一次'
  if (/ENOSPC/.test(text)) return '磁碟空間不夠，下載不了新版'
  return '沒有更新成功，原因寫在記錄檔裡'
}

export interface UpdateState {
  current(): UpdateStatus
  /** False while a check or download is under way, or once an update waits to be installed. */
  canCheck(): boolean
  checking(): void
  latest(): void
  found(version: string): void
  /** Newer, but to be downloaded by hand on this system. */
  manual(version: string): void
  progress(percent: number): void
  downloaded(version: string): void
  failed(err: unknown): void
}

/**
 * What the update row shows, driven by the updater's events.
 * Progress is reported in whole percents so the window is not flooded with messages.
 */
export function createUpdateState(onChange: (status: UpdateStatus) => void): UpdateState {
  let status: UpdateStatus = { state: 'idle' }
  const set = (next: UpdateStatus): void => {
    status = next
    onChange(next)
  }
  return {
    current: () => status,
    canCheck: () => !['checking', 'downloading', 'ready'].includes(status.state),
    checking: () => {
      if (status.state !== 'checking') set({ state: 'checking' })
    },
    latest: () => set({ state: 'latest' }),
    found: (version) => set({ state: 'downloading', version, percent: 0 }),
    manual: (version) => set({ state: 'manual', version }),
    progress: (percent) => {
      if (status.state !== 'downloading') return
      const whole = Math.min(100, Math.max(0, Math.floor(percent)))
      if (whole !== status.percent) set({ ...status, percent: whole })
    },
    downloaded: (version) => set({ state: 'ready', version }),
    failed: (err) => set({ state: 'error', message: updateErrorText(err) }),
  }
}
