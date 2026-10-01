import { sep } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentIntegration, IntegrationsPayload, StatuslineInfo } from '@shared/integrations'
import {
  addCommandLine,
  INSTALLABLE,
  install,
  installState,
  isInstallable,
  targetFor,
  uninstall,
  type HookSetup,
  type InstallableAgent,
} from '../../integrations/install'
import { installStatusline, statuslineInfo, uninstallStatusline } from '../../integrations/statusline'
import { agentSourceUsage } from '../db/sources'

const shortPath = (file: string, home: string): string =>
  file.startsWith(home + sep) ? `~/${file.slice(home.length + 1).split(sep).join('/')}` : file

function integrationOf(agent: InstallableAgent, setup: HookSetup): AgentIntegration {
  const file = shortPath(targetFor(agent, setup.home).file, setup.home)
  try {
    return { agent, state: installState(agent, setup), file, error: null }
  } catch (err) {
    return { agent, state: 'not-installed', file, error: (err as Error).message }
  }
}

/** A settings file that cannot be read is reported as taken with nothing to wrap, so nothing is written to it. */
function currentStatusline(setup: HookSetup): StatuslineInfo {
  try {
    return statuslineInfo(setup)
  } catch {
    return { state: 'taken', other: null }
  }
}

/** Adds or removes Claude Code's status line (a backup of settings.json is kept). */
export function setStatusline(on: boolean, setup: HookSetup): void {
  if (on) installStatusline(setup)
  else uninstallStatusline(setup.home)
}

export function integrationsPayload(db: DatabaseSync, setup: HookSetup): IntegrationsPayload {
  return {
    agents: INSTALLABLE.map((agent) => integrationOf(agent, setup)),
    sources: agentSourceUsage(db),
    statusline: currentStatusline(setup),
    addCommand: addCommandLine(setup, '明天 確認 macOS 版能打開'),
  }
}

/** Adds or removes our hook in one agent's config (a backup of the old file is kept). */
export function setHook(agent: string, on: boolean, setup: HookSetup): void {
  if (!isInstallable(agent)) throw new Error(`Unknown agent: ${agent}`)
  if (on) install(agent, setup)
  else uninstall(agent, setup.home)
}
