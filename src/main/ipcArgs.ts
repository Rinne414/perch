import { isAgentSessionKey } from '@shared/agentEvent'

/** The most sessions one call may name. */
const MAX_SESSIONS = 500

/** A session id from the renderer, by the same rule the ingest side keeps. */
export function sessionKey(v: unknown): string {
  if (!isAgentSessionKey(v)) throw new Error('Invalid session id')
  return v
}

/** A list of session ids from the renderer. */
export function sessionKeys(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_SESSIONS) throw new Error('Invalid session id list')
  return v.map(sessionKey)
}
