import { Fragment, useCallback, useEffect, useState } from 'react'
import { agentName } from '@shared/agents'
import type { AgentIntegration, HookState, IntegrationsPayload, SourceUsage, StatuslineInfo } from '@shared/integrations'
import type { AppInfo, GlassLevel } from '@shared/ipc'
import { useToast } from '../components/Toast'
import { AddCommandSection } from './AddCommand'
import { PhoneSection } from './PhoneSection'
import { DataSection, ShortcutRow, UpdateSection } from './Upkeep'
import './settings.css'

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

interface StatuslineView {
  readonly label: string
  readonly cls: string
  readonly sub: React.ReactNode
  readonly action: { readonly label: string; readonly on: boolean } | null
  /** What changes inside Claude Code when the person installs it. */
  readonly note?: string
}

function statuslineView({ state, other }: StatuslineInfo): StatuslineView | null {
  const theirs = other && <code>{other}</code>
  switch (state) {
    case 'installed':
      return {
        label: '已連線',
        cls: 'ok',
        sub: other ? <>額度會出現在 Agent 分頁；Claude Code 裡照常顯示你的 {theirs}</> : '5 小時和 7 天的用量會出現在 Agent 分頁；快用完時浮窗會提醒',
        action: { label: '移除', on: false },
      }
    case 'outdated':
      return { label: '指向舊位置', cls: 'warn', sub: '狀態列還指向別的 Perch，重新安裝就會改過來', action: { label: '重新安裝', on: true } }
    case 'not-installed':
      return {
        label: '未安裝',
        cls: 'off',
        sub: '裝一個狀態列，讓 Perch 記下 5 小時和 7 天的用量（Pro / Max 才有）',
        action: { label: '安裝', on: true },
        note: 'Claude Code 底下會多一行「5h 23% · 7d 41%」，原本那排快捷鍵提示會被它取代。',
      }
    case 'taken':
      return other
        ? {
            label: '未安裝',
            cls: 'off',
            sub: <>你已經有自己的狀態列 {theirs}。裝上後 Perch 先記下額度，再照常執行它，Claude Code 裡看起來完全一樣。</>,
            action: { label: '安裝', on: true },
          }
        : { label: '讀不到設定檔', cls: 'warn', sub: '~/.claude/settings.json 讀不到，Perch 不會去改它', action: null }
    default:
      return null
  }
}

/** Claude Code's status line, which reports the plan's usage limits. */
function StatuslineRow({ info, busy, onToggle }: { info: StatuslineInfo; busy: boolean; onToggle: (on: boolean) => void }): React.JSX.Element | null {
  const view = statuslineView(info)
  if (!view) return null
  const { label, cls, sub, action, note } = view
  return (
    <div className="r">
      <span className="name indent">額度</span>
      <span className={`state ${cls}`}>
        <i />
        {label}
      </span>
      <span className="sub">{sub}</span>
      {action ? (
        <button className={`btn${action.on ? ' primary' : ''}`} disabled={busy} onClick={() => onToggle(action.on)}>
          {action.label}
        </button>
      ) : (
        <span />
      )}
      {note && <p className="note">{note}</p>}
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

const GLASS: readonly { level: GlassLevel; label: string }[] = [
  { level: 'light', label: '淡' },
  { level: 'mid', label: '中' },
  { level: 'dense', label: '濃' },
]

function GeneralSection({ info, setInfo }: { info: AppInfo | null; setInfo: (next: AppInfo) => void }): React.JSX.Element {
  const show = useToast()

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
          <span className="name">玻璃濃淡</span>
          <span className="sub">後面常是白色視窗就選濃；桌布比較暗、想多透一點就選淡</span>
          <div className="seg" role="radiogroup" aria-label="玻璃濃淡">
            {GLASS.map(({ level, label }) => (
              <button
                key={level}
                role="radio"
                aria-checked={info?.glass === level}
                className={info?.glass === level ? 'on' : undefined}
                onClick={() =>
                  window.api
                    .setGlass(level)
                    .then(setInfo)
                    .catch(() => show('沒有改成功，再試一次看看'))
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ShortcutRow info={info} onInfo={setInfo} />
      </div>
    </section>
  )
}

export function SettingsTab(): React.JSX.Element {
  const [data, setData] = useState<IntegrationsPayload | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const show = useToast()

  useEffect(() => {
    window.api
      .getAppInfo()
      .then(setInfo)
      .catch(() => show('讀不到程式設定'))
  }, [show])

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

  const toggleStatusline = (on: boolean): void => {
    setBusy('statusline')
    window.api
      .setStatusline(on)
      .then((next) => {
        setData(next)
        show(on ? '已裝上 Claude Code 的狀態列，它下一次回覆後就會有數字' : '已移除 Claude Code 的狀態列')
      })
      .catch(() => show('沒有改成功，Claude Code 的設定檔可能讀不到'))
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
            <Fragment key={a.agent}>
              <AgentRowSetting entry={a} busy={busy === a.agent || busy === 'all'} onToggle={(on) => toggle(a.agent, on)} />
              {a.agent === 'claude-code' && (
                <StatuslineRow info={data.statusline} busy={busy === 'statusline'} onToggle={toggleStatusline} />
              )}
            </Fragment>
          ))}
        </div>
      </section>

      {data && <AddCommandSection command={data.addCommand} />}

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

      <GeneralSection info={info} setInfo={setInfo} />
      <PhoneSection />
      <DataSection info={info} onInfo={setInfo} />
      <UpdateSection info={info} />
    </>
  )
}
