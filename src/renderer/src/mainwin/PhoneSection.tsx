import { useCallback, useEffect, useState } from 'react'
import { ago, monthDay } from '@shared/format'
import type { PhoneDevice, PhonePairing, PhoneSettingsPayload, TailscaleState } from '@shared/phone'
import { errorReason } from '../components/Power'
import { useToast } from '../components/Toast'
import './phone-settings.css'

/** Tailscale's state and the paired phones' last-seen times change on their own. */
const REFRESH_MS = 5_000
const MINUTE_MS = 60_000

function seenText(d: PhoneDevice, now: number): string {
  const paired = `${monthDay(d.pairedAt)} 配對`
  if (d.lastSeenAt === null) return paired
  const since = ago(d.lastSeenAt, now)
  return `${paired} · ${since === '剛剛' ? '剛剛' : `${since}前`}連過`
}

function TailscaleRow({ state }: { state: TailscaleState }): React.JSX.Element {
  if (state.kind === 'missing') {
    return (
      <div className="r state-r">
        <span className="name">Tailscale</span>
        <span className="state warn">
          <i />
          沒有安裝
        </span>
        <span className="sub">電腦和手機都要裝 Tailscale、登入同一個帳號，手機才連得到這台電腦。</span>
        <span />
      </div>
    )
  }
  return (
    <div className="r state-r">
      <span className="name">Tailscale</span>
      <span className={`state ${state.kind === 'running' ? 'ok' : 'warn'}`}>
        <i />
        {state.kind === 'running' ? '已登入' : '還沒連上'}
      </span>
      {state.kind === 'running' ? <span className="path">{state.dnsName}</span> : <span className="sub">{state.detail}</span>}
      <span />
    </div>
  )
}

interface ServeProps {
  readonly dnsName: string
  readonly serving: boolean
  readonly busy: boolean
  readonly onSet: (on: boolean) => void
}

function ServeRow({ dnsName, serving, busy, onSet }: ServeProps): React.JSX.Element {
  return (
    <div className="r state-r">
      <span className="name">轉送</span>
      <span className={`state ${serving ? 'ok' : 'off'}`}>
        <i />
        {serving ? '已設定' : '還沒設定'}
      </span>
      <span className="url">https://{dnsName}</span>
      <button className={`btn${serving ? '' : ' primary'}`} disabled={busy} onClick={() => onSet(!serving)}>
        {serving ? '移除轉送' : '設定轉送'}
      </button>
      {!serving && (
        <p className="note">
          Perch 會執行 <code>tailscale serve --bg</code>，把這個網址轉到這台電腦上的 Perch。第一次可能要你到 Tailscale
          後台開啟 HTTPS，Perch 會把 Tailscale 給的連結顯示出來。
        </p>
      )}
    </div>
  )
}

interface PairProps {
  readonly pairing: PhonePairing | null
  readonly busy: boolean
  readonly onNew: () => void
}

function PairBlock({ pairing, busy, onNew }: PairProps): React.JSX.Element {
  if (!pairing) {
    return (
      <div className="r general">
        <span className="name">配對手機</span>
        <span className="sub">產生一個 QR code，用手機相機掃，10 分鐘內有效，只能用一次。</span>
        <button className="btn primary" disabled={busy} onClick={onNew}>
          產生 QR code
        </button>
      </div>
    )
  }
  const minutes = Math.max(1, Math.ceil((pairing.expiresAt - Date.now()) / MINUTE_MS))
  return (
    <div className="qr-box">
      {pairing.qr ? <img className="qr" src={pairing.qr} alt="配對用的 QR code" /> : <div className="qr empty">等 Tailscale</div>}
      <div>
        <div className="name">{pairing.qr ? '用手機相機掃這個，配對一支新手機' : 'Tailscale 連上後，這裡才會有 QR code'}</div>
        <p className="sub">
          {minutes} 分鐘內有效，只能用一次。手機要先裝好 Tailscale、登入同一個帳號。配對後手機會拿到自己的一把鑰匙，電腦只存它的雜湊。
        </p>
        <div className="set-acts">
          <button className="btn" disabled={busy} onClick={onNew}>
            換一個
          </button>
          {pairing.url && (
            <button className="btn ghost" onClick={() => window.api.copyText(pairing.url!)}>
              複製網址
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** 設定 → 手機: the switch, Tailscale, pairing, and the phones paired so far. */
export function PhoneSection(): React.JSX.Element {
  const [data, setData] = useState<PhoneSettingsPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const show = useToast()

  const load = useCallback(() => {
    window.api
      .getPhone()
      .then(setData)
      .catch(() => show('讀不到手機連線的狀態'))
  }, [show])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    const off = window.api.onChanged(load)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [load])

  const run = (request: Promise<PhoneSettingsPayload>, done?: string): void => {
    setBusy(true)
    request
      .then((next) => {
        setData(next)
        if (done) show(done)
      })
      .catch((err: unknown) => show(errorReason(err)))
      .finally(() => setBusy(false))
  }

  const now = Date.now()
  const ts = data?.tailscale
  return (
    <section className="set" aria-labelledby="set-phone">
      <div className="set-head">
        <h2 id="set-phone">手機</h2>
        <p className="sub">
          在手機上看狀態、記東西、排或取消關機，並收到通知。透過 Tailscale 連線，家裡和外面都用同一個網址；Perch 本身只在這台電腦的
          127.0.0.1 上聽，不對區網開門。
        </p>
      </div>
      <div className="card">
        <div className="r general">
          <span className="name">手機連線</span>
          <span className="sub">{data?.enabled ? '開著。關掉後手機什麼都看不到，也送不了任何指令。' : '關著（預設）。'}</span>
          <button
            className={`switch${data?.enabled ? ' on' : ''}`}
            role="switch"
            aria-checked={data?.enabled ?? false}
            aria-label="手機連線"
            disabled={!data || busy}
            onClick={() => data && run(window.api.setPhoneEnabled(!data.enabled))}
          >
            <i />
          </button>
          {data?.error && <p className="note late-text">{data.error}</p>}
        </div>
        {data?.enabled && ts && <TailscaleRow state={ts} />}
        {data?.enabled && ts?.kind === 'running' && (
          <ServeRow
            dnsName={ts.dnsName}
            serving={ts.serving}
            busy={busy}
            onSet={(on) => run(window.api.setPhoneServe(on), on ? '已設定轉送' : '已移除轉送')}
          />
        )}
        {data?.enabled && ts?.kind === 'running' && ts.funnel && (
          <div className="confirm">
            <span>Tailscale Funnel 開著：Perch 的網址現在連網際網路上的任何人都打得開。配對碼和鑰匙還是擋得住，但建議到 Tailscale 後台把 Funnel 關掉。</span>
          </div>
        )}
        {data?.enabled && <PairBlock pairing={data.pairing} busy={busy} onNew={() => run(window.api.newPhoneCode())} />}
      </div>
      {data?.enabled && (
        <>
          {data.devices.length > 0 ? (
            <div className="card">
              {data.devices.map((d) => (
                <div className="r state-r" key={d.id}>
                  <span className="name">{d.name}</span>
                  <span className={`state ${d.notifications ? 'ok' : 'off'}`}>
                    <i />
                    {d.notifications ? '通知開著' : '沒開通知'}
                  </span>
                  <span className="sub">{seenText(d, now)}</span>
                  <button className="btn" onClick={() => run(window.api.removePhone(d.id), `已移除 ${d.name}，它再也連不進來`)}>
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="faint set-empty">還沒有配對的手機。</p>
          )}
          <p className="faint set-empty">
            電腦上跳的通知（agent 等你、跑完、失敗，到期、行程，一分鐘後關機）都會同步推到開了通知的手機。推播經過 Google
            的伺服器，內容是加密的。
          </p>
        </>
      )}
    </section>
  )
}
