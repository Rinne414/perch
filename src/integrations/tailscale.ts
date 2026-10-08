import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TailscaleState } from '@shared/phone'

const TIMEOUT_MS = 10_000

/** The Windows installer's CLI by full path; elsewhere the one on PATH. Null when not installed. */
export function findTailscale(): string | null {
  if (process.platform !== 'win32') return 'tailscale'
  const exe = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe')
  return existsSync(exe) ? exe : null
}

interface Run {
  readonly ok: boolean
  readonly out: string
}

function run(exe: string, args: readonly string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(exe, [...args], { timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${String(stdout)}${String(stderr)}`.trim() })
    })
  })
}

const BACKEND_LABEL: Readonly<Record<string, string>> = {
  NeedsLogin: '還沒登入：點系統匣的 Tailscale 圖示登入',
  NeedsMachineAuth: '等 Tailscale 後台核准這台電腦',
  Stopped: 'Tailscale 關著：從系統匣打開它',
  Starting: 'Tailscale 正在連線…',
}

interface ServeConfig {
  readonly Web?: Record<string, { readonly Handlers?: Record<string, { readonly Proxy?: unknown }> }>
  readonly AllowFunnel?: Record<string, boolean>
}

/** The `<name>:443` sites of a serve config that forward to Perch's port. */
function perchSites(config: unknown, port: number): string[] {
  const web = (config as ServeConfig | null)?.Web
  if (!web) return []
  const target = new RegExp(`^(https?://)?(127\\.0\\.0\\.1|localhost):${port}/?$`)
  return Object.entries(web)
    .filter(([, site]) => Object.values(site?.Handlers ?? {}).some((h) => typeof h?.Proxy === 'string' && target.test(h.Proxy)))
    .map(([name]) => name)
}

/**
 * Whether the serve config (`tailscale serve status --json`) forwards HTTPS to Perch's port:
 * `{ "Web": { "<name>:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:47817" } } } } }`.
 */
export const servesPort = (config: unknown, port: number): boolean => perchSites(config, port).length > 0

/** Whether Funnel puts Perch's site on the public internet (`"AllowFunnel": { "<name>:443": true }`). */
export function funnelsPort(config: unknown, port: number): boolean {
  const funnel = (config as ServeConfig | null)?.AllowFunnel ?? {}
  return perchSites(config, port).some((site) => funnel[site] === true)
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** What 設定 → 手機 says about Tailscale on this computer. */
export async function tailscaleState(port: number): Promise<TailscaleState> {
  const exe = findTailscale()
  if (!exe) return { kind: 'missing' }
  const status = await run(exe, ['status', '--json'])
  const json = parse(status.out) as { BackendState?: string; Self?: { DNSName?: string } } | null
  if (!json?.BackendState) return { kind: 'stopped', detail: 'Tailscale 沒有在執行：從開始選單打開它' }
  if (json.BackendState !== 'Running') {
    return { kind: 'stopped', detail: BACKEND_LABEL[json.BackendState] ?? `Tailscale 狀態：${json.BackendState}` }
  }
  const dnsName = (json.Self?.DNSName ?? '').replace(/\.$/, '')
  if (!dnsName) return { kind: 'stopped', detail: '這台電腦還沒有名字：請在 Tailscale 後台打開 MagicDNS' }
  const config = parse((await run(exe, ['serve', 'status', '--json'])).out)
  return { kind: 'running', dnsName, serving: servesPort(config, port), funnel: funnelsPort(config, port) }
}

/**
 * Forwards https://<this computer>.<tailnet>.ts.net to Perch on 127.0.0.1:<port>, or stops it.
 * Returns null on success, else what Tailscale said (for example the link to turn on HTTPS).
 */
export async function setTailscaleServe(port: number, on: boolean): Promise<string | null> {
  const exe = findTailscale()
  if (!exe) return '找不到 Tailscale'
  const args = on ? ['serve', '--bg', '--yes', String(port)] : ['serve', '--https=443', 'off']
  const result = await run(exe, args)
  return result.ok ? null : result.out || 'Tailscale 沒有接受這個設定'
}
