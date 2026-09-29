export type ItemKind = 'task' | 'idea' | 'routine'

/** 0 = urgent, 1 = this week, 2 = later (same meaning as the original float). */
export type Priority = 0 | 1 | 2

export interface Item {
  readonly id: string
  readonly kind: ItemKind
  readonly title: string
  readonly notes: string | null
  /** Set on steps that break a bigger item down; the first open step is the item's "next step". */
  readonly parentId: string | null
  readonly sortOrder: number
  readonly priority: Priority | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly dueAt: number | null
  /** False when only a date was given; the reminder then fires at the configured morning hour. */
  readonly dueHasTime: boolean
  /** Local day key (YYYY-MM-DD) the user picked this item for. */
  readonly plannedFor: string | null
  readonly doneAt: number | null
  /** Set when the user let it go ("不做了"): closed like a done item, but not counted as done. */
  readonly droppedAt: number | null
  /** How many times an unfinished plan rolled over to the next day. */
  readonly postponeCount: number
  /** Routines only: the gap the user wants between two completions. */
  readonly intervalDays: number | null
  /** Routines only: routines never finish, they only record their latest completion. */
  readonly lastDoneAt: number | null
  readonly notifiedAt: number | null
  /** Who wrote the item: "user", "import:legacy", "agent:<name>", "mcp". */
  readonly source: string
}

export interface NewItem {
  readonly kind: ItemKind
  readonly title: string
  readonly notes?: string | null
  readonly parentId?: string | null
  readonly priority?: Priority | null
  readonly dueAt?: number | null
  readonly dueHasTime?: boolean
  readonly plannedFor?: string | null
  readonly intervalDays?: number | null
  readonly lastDoneAt?: number | null
  readonly source?: string
}

export type ItemPatch = Partial<
  Pick<
    Item,
    | 'title'
    | 'notes'
    | 'priority'
    | 'dueAt'
    | 'dueHasTime'
    | 'plannedFor'
    | 'intervalDays'
    | 'sortOrder'
    | 'kind'
    | 'notifiedAt'
  >
>

export type TimelineEventType =
  | 'item.created'
  | 'item.done'
  | 'item.reopened'
  | 'item.dropped'
  | 'focus'
  | 'routine.done'
  | 'agent.status'
  | 'manual'

export interface TimelineEvent {
  readonly id: number
  readonly at: number
  readonly type: TimelineEventType
  readonly title: string
  readonly itemId: string | null
  readonly agentSessionId: string | null
  readonly source: string
  readonly data: Record<string, unknown> | null
}

export type AgentStatus = 'running' | 'needs_input' | 'done' | 'failed' | 'cancelled'

export interface AgentSession {
  /** `${agent}:${sessionId}` */
  readonly id: string
  readonly agent: string
  readonly sessionId: string
  readonly cwd: string | null
  readonly title: string | null
  readonly status: AgentStatus
  readonly detail: string | null
  readonly startedAt: number
  readonly updatedAt: number
  /** When the session last started waiting on the user (needs input, finished, failed). */
  readonly attentionAt: number | null
  readonly acknowledgedAt: number | null
}
