/**
 * installed: our hook is in place and points at this copy of the app.
 * outdated: our hook is there but points somewhere else (an older build or another data folder).
 * not-installed: the agent is on this computer without our hook.
 * no-agent: the agent's config folder does not exist.
 */
export type HookState = 'installed' | 'outdated' | 'not-installed' | 'no-agent'

export interface AgentIntegration {
  readonly agent: string
  readonly state: HookState
  /** The config file we would change, with the home folder shortened to "~". */
  readonly file: string
  /** Set when the config could not be read. */
  readonly error: string | null
}

/** What one agent has written into the app. */
export interface SourceUsage {
  readonly agent: string
  readonly sessions: number
  readonly events: number
  readonly items: number
}

export interface IntegrationsPayload {
  readonly agents: readonly AgentIntegration[]
  readonly sources: readonly SourceUsage[]
}
