import { useCallback, useEffect, useState } from 'react'
import { agentName } from '@shared/agents'
import type { AgentIntegration, HookState, IntegrationsPayload, SourceUsage } from '@shared/integrations'
import type { AppInfo } from '@shared/ipc'
import { useToast } from './Toast'

const STATE_LABEL: Readonly<Record<HookState, string>> = {
  installed: '已連線',
  outdated: '指向舊位置',
  'not-installed': '未安裝',
  'no-agent': '沒有偵測到',
}

const STATE_CLASS: Readonly<Record<HookState, string>> = {
  installed: 'ok',
  outdated: 'warn',
  'not-installed': 'off',
  'no-agent': 'off',
}

/** Agent-specific things the person has to do by hand after installing. */
const NOTES: Readonly<Record<string, React.ReactNode>> = {
  codex: (
    <>
      Codex 只跑你信任過的 hook：每次安裝或更新後，在 Codex 裡輸入 <code>/hooks</code>，信任 perch。
    </>
  ),
}

function AgentRowSetting({
  entry,
  busy,
  onToggle,
}: {
  entry: AgentIntegration
  busy: boolean
  onToggle: (on: boolean) => void
}): React.JSX.Element {
  const { agent, state, file, error } = entry
  const action =
    state === 'installed' ? { label: '移除', on: false } : state === 'no-agent' ? null : { label: state === 'outdated' ? '重新安裝' : '安裝', on: true }
  return (
    <div className="r">
      <span className="name">{agentName(agent)}</span>
      <span className={`state ${STATE_CLASS[state]}`}>
        <i />
        {STATE_LABEL[state]}
      </span>
      <span className="path" title={file}>
        {file}
      </span>
      {action ? (
        <button className={`btn${action.on ? ' primary' : ''}`} disabled={busy} onClick={() => onToggle(action.on)}>
          {action.label}
        </button>
      ) : (
        <span />
      )}
      {error && <p className="note late-text">讀不到設定檔：{error}</p>}
      {state === 'installed' && NOTES[agent] && <p className="note">{NOTES[agent]}</p>}
    </div>
  )
}

function usageText(u: SourceUsage): string {
  const parts = [
    u.sessions && `${u.sessions} 個 session`,
    u.events && `${u.events} 筆時間軸`,
    u.items && `${u.items} 件事`,
  ].filter(Boolean)
  return parts.join(' · ')
}

function SourceRow({ usage, onClear }: { usage: SourceUsage; onClear: () => void }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const total = usage.sessions + usage.events + usage.items
  return (
    <div className="r src-r">
      <span className="name">{agentName(usage.agent)}</span>
      <span className="sub">{usageText(usage)}</span>
      {confirming ? (
        <span />
      ) : (
        <button className="btn" onClick={() => setConfirming(true)}>
          清除…
        </button>
      )}
      {confirming && (
        <div className="confirm" role="alert">
          <span>
            會刪掉 {agentName(usage.agent)} 的 {total} 筆資料，不能復原。
          </span>
          <button
            className="btn danger"
            onClick={() => {
              setConfirming(false)
              onClear()
            }}
          >
            確定清除
          </button>
          <button className="btn ghost" autoFocus onClick={() => setConfirming(false)}>
            取消
          </button>
        </div>
      )}
    </div>
  )
}

function GeneralSection(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const show = useToast()
  useEffect(() => {
    window.api
      .getAppInfo()
      .then(setInfo)
      .catch(() => show('讀不到程式設定'))
  }, [show])

  const toggleLogin = (): void => {
    if (!info) return
    window.api
      .setOpenAtLogin(!info.openAtLogin)
      .then(setInfo)
      .catch(() => show('沒有改成功，再試一次看看'))
  }

  return (
    <section className="set" aria-labelledby="set-general">
      <div className="set-head">
        <h2 id="set-general">一般</h2>
      </div>
      <div className="card">
        <div className="r general">
          <span className="name">開機時啟動</span>
          <span className="sub">
            {info?.canOpenAtLogin ? '登入 Windows 後自動打開浮窗' : '安裝版才能設定；開發中的版本不會跟著開機'}
          </span>
          <button
            className={`switch${info?.openAtLogin ? ' on' : ''}`}
            role="switch"
            aria-checked={info?.openAtLogin ?? false}
            aria-label="開機時啟動"
            disabled={!info?.canOpenAtLogin}
            onClick={toggleLogin}
          >
            <i />
          </button>
        </div>
        <div className="r general">
          <span className="name">資料位置</span>
          <span className="path" title={info?.dataDir}>
            {info?.dataDir}
          </span>
          <button className="btn" onClick={() => window.api.openDataFolder()}>
            打開資料夾
          </button>
        </div>
      </div>
      {info && <p className="faint set-empty">版本 {info.version} · 資料只存在這台電腦</p>}
    </section>
  )
}

export function SettingsTab(): React.JSX.Element {
  const [data, setData] = useState<IntegrationsPayload | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const show = useToast()

  const load = useCallback(() => {
    window.api
      .getIntegrations()
      .then(setData)
      .catch(() => show('讀不到 agent 的設定'))
  }, [show])

  useEffect(() => {
    load()
    return window.api.onChanged(load)
  }, [load])

  const toggle = (agent: string, on: boolean): void => {
    setBusy(agent)
    window.api
      .setHook(agent, on)
      .then((next) => {
        setData(next)
        show(on ? `已連上 ${agentName(agent)}，原本的設定檔有留備份` : `已從 ${agentName(agent)} 移除`)
      })
      .catch((err: Error) => show(`${agentName(agent)} 沒有改成功：${err.message.replace(/^.*Error: /, '')}`))
      .finally(() => setBusy(null))
  }

  const updateAll = async (agents: readonly string[]): Promise<void> => {
    setBusy('all')
    try {
      let next: IntegrationsPayload | null = null
      for (const agent of agents) next = await window.api.setHook(agent, true)
      if (next) setData(next)
      show(`已更新 ${agents.length} 個 agent 的連線`)
    } catch {
      show('有 agent 沒有更新成功，看一下各自的狀態')
      load()
    } finally {
      setBusy(null)
    }
  }

  const clear = (agent: string): void => {
    window.api
      .clearAgentData(agent)
      .then((n) => show(`已清除 ${agentName(agent)} 的 ${n} 筆資料`))
      .catch(() => show('沒有清除成功，再試一次看看'))
  }

  const outdated = data?.agents.filter((a) => a.state === 'outdated').map((a) => a.agent) ?? []

  return (
    <>
      <header className="ph">
        <h1>設定</h1>
      </header>

      <section className="set" aria-labelledby="set-agents">
        <div className="set-head">
          <h2 id="set-agents">Agent 連線</h2>
          <p className="sub">
            裝了之後，agent 跑完、失敗或在等你回覆時，浮窗會提醒你。改的是各 agent 自己的設定檔，改之前會留一份備份。
          </p>
        </div>
        {outdated.length > 1 && (
          <div className="confirm info">
            <span>有 {outdated.length} 個 agent 還指向舊的位置（例如開發中的版本），提醒不會送到這裡。</span>
            <button className="btn primary" disabled={busy !== null} onClick={() => void updateAll(outdated)}>
              全部更新
            </button>
          </div>
        )}
        <div className="card">
          {data?.agents.map((a) => (
            <AgentRowSetting
              key={a.agent}
              entry={a}
              busy={busy === a.agent || busy === 'all'}
              onToggle={(on) => toggle(a.agent, on)}
            />
          ))}
        </div>
      </section>

      <section className="set" aria-labelledby="set-sources">
        <div className="set-head">
          <h2 id="set-sources">按來源清除資料</h2>
          <p className="sub">agent 寫進來的紀錄，包括它建立的事（連同你在底下加的步驟）。你自己記的事不會被動到。</p>
        </div>
        {data && data.sources.length > 0 ? (
          <div className="card">
            {data.sources.map((u) => (
              <SourceRow key={u.agent} usage={u} onClear={() => clear(u.agent)} />
            ))}
          </div>
        ) : (
          <p className="faint set-empty">還沒有任何 agent 寫進資料。</p>
        )}
      </section>

      <GeneralSection />
    </>
  )
}
