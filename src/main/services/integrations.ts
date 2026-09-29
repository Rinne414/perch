import { sep } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentIntegration, IntegrationsPayload } from '@shared/integrations'
import {
  INSTALLABLE,
  install,
  installState,
  isInstallable,
  targetFor,
  uninstall,
  type HookSetup,
  type InstallableAgent,
} from '../../integrations/install'
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

export function integrationsPayload(db: DatabaseSync, setup: HookSetup): IntegrationsPayload {
  return {
    agents: INSTALLABLE.map((agent) => integrationOf(agent, setup)),
    sources: agentSourceUsage(db),
  }
}

/** Adds or removes our hook in one agent's config (a backup of the old file is kept). */
export function setHook(agent: string, on: boolean, setup: HookSetup): void {
  if (!isInstallable(agent)) throw new Error(`Unknown agent: ${agent}`)
  if (on) install(agent, setup)
  else uninstall(agent, setup.home)
}
