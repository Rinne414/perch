import type { AgentSession } from './types'

/** Which part of the briefing a session belongs to. */
export type SessionGroup = 'waiting' | 'running' | 'done' | 'unattended'

/** How a session is drawn and ranked: by its group, except that a failed session is 失敗 wherever it sits. */
export type SessionState = 'waiting' | 'failed' | 'running' | 'done' | 'unattended'

/** Most urgent first. */
export const STATE_ORDER: readonly SessionState[] = ['waiting', 'failed', 'running', 'done', 'unattended']

export const stateRank = (state: SessionState): number => STATE_ORDER.indexOf(state)

export const stateOf = (s: AgentSession, group: SessionGroup): SessionState => (s.status === 'failed' ? 'failed' : group)

export const STATE_NAME: Readonly<Record<SessionState, string>> = {
  waiting: '等你決定',
  failed: '失敗了',
  running: '還在跑',
  done: '做完了',
  unattended: '放著沒接',
}
