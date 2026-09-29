import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

interface ToastMessage {
  readonly id: number
  readonly text: string
  /** When set, the toast offers "復原". */
  readonly undo?: () => Promise<unknown>
}

type Show = (text: string, undo?: () => Promise<unknown>) => void

const VISIBLE_MS = 6000
const ToastContext = createContext<Show>(() => undefined)

/** Shows short confirmations ("已刪除…") with an optional undo, one at a time. */
export const useToast = (): Show => useContext(ToastContext)

/** Runs an action and reports a failure in the toast instead of failing silently. */
export function useAction(): (action: () => Promise<unknown>) => void {
  const show = useToast()
  return useCallback(
    (action) => {
      action().catch(() => show('沒有成功，再試一次看看'))
    },
    [show],
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const seq = useRef(0)

  const show = useCallback<Show>((text, undo) => setToast({ id: ++seq.current, text, undo }), [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const undo = (): void => {
    if (!toast?.undo) return
    const run = toast.undo
    setToast(null)
    run().catch(() => show('沒辦法復原了'))
  }

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="mw-toast-slot" aria-live="polite">
        {toast && (
          <div className="mw-toast" key={toast.id}>
            <span>{toast.text}</span>
            {toast.undo && (
              <button className="btn" onClick={undo}>
                復原
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
