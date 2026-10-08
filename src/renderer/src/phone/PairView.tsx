import { useState } from 'react'
import { MAX_PHONE_NAME } from '@shared/phone'
import { call, messageOf, saveKey } from './api'
import { canPush, enablePush } from './push'

type Step = 'name' | 'notify' | 'home'

interface StepCardProps {
  readonly n: number
  readonly state: 'ok' | 'now' | 'later'
  readonly title: string
  readonly children?: React.ReactNode
}

function StepCard({ n, state, title, children }: StepCardProps): React.JSX.Element {
  return (
    <div className={`p-card${state === 'later' ? ' later' : ''}`}>
      <div className="p-step">
        <span className={`n ${state}`}>{state === 'ok' ? '✓' : n}</span>
        <div className="p-step-body">
          <div className="t2">{title}</div>
          {children}
        </div>
      </div>
    </div>
  )
}

/** First visit from the QR code: name this phone, pair, then offer notifications and the home screen. */
export function PairView({ code, onDone }: { code: string; onDone: () => void }): React.JSX.Element {
  const [step, setStep] = useState<Step>('name')
  const [notified, setNotified] = useState(false)
  const [name, setName] = useState('Android 手機')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const attempt = (work: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    work()
      .catch((err: unknown) => setError(messageOf(err)))
      .finally(() => setBusy(false))
  }

  const pair = (): void =>
    attempt(async () => {
      const { key } = await call<{ key: string }>('POST', '/api/pair', { code, name })
      saveKey(key)
      setStep('notify')
    })

  const notify = (): void =>
    attempt(async () => {
      await enablePush()
      setNotified(true)
      setStep('home')
    })

  const notifyState = step === 'notify' ? 'now' : step === 'home' && notified ? 'ok' : 'later'
  const notifyTitle = step === 'home' && !notified ? '開啟通知（之後可以在「現在」頁最下面打開）' : '開啟通知'

  return (
    <div className="p-body pair">
      <StepCard n={1} state="ok" title="掃了電腦上的 QR code">
        <p className="d2">配對碼只能用一次，10 分鐘內有效。</p>
      </StepCard>
      <StepCard n={2} state={step === 'name' ? 'now' : 'ok'} title={step === 'name' ? '幫這支手機取個名字' : `已配對：${name}`}>
        {step === 'name' && (
          <>
            <p className="d2">電腦的「設定 → 手機」會用這個名字列出它，不要了可以在那裡移除。</p>
            <label className="p-label">
              <span className="p-lbl">名稱</span>
              <input className="p-field" id="phone-name" value={name} maxLength={MAX_PHONE_NAME} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="p-btn primary wide" disabled={busy || !name.trim()} onClick={pair}>
              配對
            </button>
          </>
        )}
      </StepCard>
      <StepCard n={3} state={notifyState} title={notifyTitle}>
        <p className="d2">agent 等你回覆或跑完、GPU 跑完、電腦一分鐘後要關機時，手機會跳通知。</p>
        {step === 'notify' && (
          <div className="p-acts">
            <button className="p-btn primary" disabled={busy || !canPush()} onClick={notify}>
              開啟通知
            </button>
            <button className="p-btn ghost" onClick={() => setStep('home')}>
              先不要
            </button>
          </div>
        )}
      </StepCard>
      <StepCard n={4} state={step === 'home' ? 'now' : 'later'} title="加到主畫面">
        <p className="d2">Chrome 右上角選單 → 加到主畫面，之後就像一個 App。</p>
        {step === 'home' && (
          <button className="p-btn primary wide" onClick={onDone}>
            開始用
          </button>
        )}
      </StepCard>
      {error && (
        <p className="p-error" role="alert">
          {error}
        </p>
      )}
      <p className="p-hint">手機要開著 Tailscale 才連得到電腦。網址只在你自己的 Tailscale 網路裡有效，別人打開也連不到。</p>
    </div>
  )
}

/** Opened without a pairing code and without a key. */
export function UnpairedView(): React.JSX.Element {
  return (
    <div className="p-body pair">
      <div className="p-card">
        <div className="t2">這支手機還沒配對</div>
        <p className="d2">在電腦上打開 Perch 的「設定 → 手機」，按「產生 QR code」，再用手機相機掃它。</p>
      </div>
    </div>
  )
}
