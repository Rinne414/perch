/**
 * Runs `task` one at a time. A call while it runs is remembered, and however many came, exactly
 * one more run follows when it finishes. `stop` drops a remembered run (the view went away).
 */
export function coalesce(task: () => Promise<unknown>): { readonly run: () => void; readonly stop: () => void } {
  let busy = false
  let again = false
  let stopped = false
  const run = (): void => {
    if (stopped) return
    if (busy) {
      again = true
      return
    }
    busy = true
    void task()
      .catch(() => undefined)
      .finally(() => {
        busy = false
        if (!again) return
        again = false
        run()
      })
  }
  return {
    run,
    stop: () => {
      stopped = true
    },
  }
}
