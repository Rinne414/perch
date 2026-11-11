import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { agentName } from '@shared/agents'
import type { BriefingPayload } from '@shared/briefing'
import { projectName } from '@shared/projects'
import type { AgentSession } from '@shared/types'
import { useToast } from '../components/Toast'

/** The report tabs on the right. */
export type ReportTab = 'done' | 'running' | 'left'
/** Where a session sits in the briefing. */
export type DeckGroup = 'waiting' | ReportTab

export interface DeckSelection {
  /** The one session everything marks: its bay row, its lane, its card. */
  readonly selected: string | null
  readonly select: (id: string) => void
  readonly openRecord: (session: AgentSession) => void
}

export const SelectionContext = createContext<DeckSelection>({ selected: null, select: () => undefined, openRecord: () => undefined })

export const useSelection = (): DeckSelection => useContext(SelectionContext)

export function groupOf(b: BriefingPayload, id: string): DeckGroup | null {
  if (b.waiting.some((e) => e.session.id === id)) return 'waiting'
  if (b.done.some((e) => e.session.id === id)) return 'done'
  if (b.running.some((e) => e.session.id === id)) return 'running'
  if (b.left.some((e) => e.session.id === id)) return 'left'
  return null
}

/** Where the selection starts: the first waiting, else the first finished, else the first running. */
export const firstSelection = (b: BriefingPayload): string | null =>
  b.waiting[0]?.session.id ?? b.done[0]?.session.id ?? b.running[0]?.session.id ?? null

/** The tab shown when nothing chose one: the selection's, else the first with something in it. */
export function defaultTab(b: BriefingPayload, selected: string | null): ReportTab {
  const g = selected ? groupOf(b, selected) : null
  if (g && g !== 'waiting') return g
  return b.done.length ? 'done' : b.running.length ? 'running' : b.left.length ? 'left' : 'done'
}

/** "Claude Code，在 perch" */
export function whereLine(s: AgentSession): string {
  const folder = projectName(s.cwd)
  return folder ? `${agentName(s.agent)}，在 ${folder}` : agentName(s.agent)
}

/** Three columns from 2000 px, two from 1280, one below. */
export type DeckLayout = 'three' | 'two' | 'one'

const WIDE = '(min-width: 2000px)'
const MEDIUM = '(min-width: 1280px)'

const layoutNow = (): DeckLayout => (window.matchMedia(WIDE).matches ? 'three' : window.matchMedia(MEDIUM).matches ? 'two' : 'one')

export function useDeckLayout(): DeckLayout {
  const [layout, setLayout] = useState(layoutNow)
  useEffect(() => {
    const queries = [window.matchMedia(WIDE), window.matchMedia(MEDIUM)]
    const update = (): void => setLayout(layoutNow())
    queries.forEach((q) => q.addEventListener('change', update))
    return () => queries.forEach((q) => q.removeEventListener('change', update))
  }, [])
  return layout
}

/** 看完了 for one session or the whole pile, with one 復原 for the press. */
export function useMarkSeen(): (ids: readonly string[], done: string) => void {
  const show = useToast()
  return (ids, done) => {
    window.api
      .acknowledgeAgents(ids)
      .then((token) =>
        show(done, () =>
          window.api.undoAcknowledge(token).then((ok) => {
            if (!ok) throw new Error('Undo window passed')
          }),
        ),
      )
      .catch(() => show('沒有成功，再試一次看看'))
  }
}

/** Honours the person's reduced-motion setting for scrolling. */
export const calmScroll = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')

/** How long a removal is waited for before focus is left alone (a refresh normally takes far less). */
const REMOVAL_WAIT_MS = 10_000

/**
 * Keeps keyboard focus when an action takes away the control that had it: once the row or card
 * `from` sits in (matched by `item`) leaves the page, focus goes to the next one (the one before
 * when it was the last), or to the panel's heading when none is left. Nothing moves when the
 * person has put focus somewhere else meanwhile.
 */
export function useFocusAfterRemoval(): (from: Element | null, item: string) => void {
  return useCallback((from, item) => {
    const own = from?.closest<HTMLElement>(item)
    const panel = from?.closest<HTMLElement>('.bf-pn')
    if (!own || !panel) return
    const all = [...panel.querySelectorAll<HTMLElement>(item)]
    const i = all.indexOf(own)
    const next = all[i + 1] ?? all[i - 1] ?? null
    // A panel of tabs goes back to its open tab; any other to its heading.
    const heading = panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? panel.querySelector<HTMLElement>('h2')
    const settle = (): boolean => {
      if (own.isConnected) return false
      if (document.activeElement && document.activeElement !== document.body) return true
      const target = next?.isConnected ? (next.querySelector<HTMLElement>('button') ?? next) : heading
      target?.focus()
      return true
    }
    if (settle()) return
    const watch = new MutationObserver(() => {
      if (settle()) watch.disconnect()
    })
    watch.observe(panel, { childList: true, subtree: true })
    setTimeout(() => watch.disconnect(), REMOVAL_WAIT_MS)
  }, [])
}
