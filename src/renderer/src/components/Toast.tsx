import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import './toast.css'

/** The one button a toast may carry: 復原, or something like 開資料夾. */
interface ToastAction {
  readonly label: string
  readonly run: () => Promise<unknown>
  /** Said when the action fails. */
  readonly failed: string
}

interface ToastMessage {
  readonly id: number
  readonly text: string
  readonly action?: ToastAction
}

type Show = (text: string, undo?: () => Promise<unknown>) => void
type Post = (text: string, action?: ToastAction) => void

const VISIBLE_MS = 6000
const ToastContext = createContext<Post>(() => undefined)

/** Shows short confirmations ("已刪除…") with an optional undo, one at a time. */
export function useToast(): Show {
  const post = useContext(ToastContext)
  return useCallback<Show>((text, undo) => post(text, undo && { label: '復原', run: undo, failed: '沒辦法復原了' }), [post])
}

/** A confirmation with its own button, such as 開資料夾 after saving a file. */
export function useNotice(): (text: string, label: string, run: () => Promise<unknown>) => void {
  const post = useContext(ToastContext)
  return useCallback((text, label, run) => post(text, { label, run, failed: '沒有成功，再試一次看看' }), [post])
}

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

  const post = useCallback<Post>((text, action) => setToast({ id: ++seq.current, text, action }), [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const act = (): void => {
    if (!toast?.action) return
    const { run, failed } = toast.action
    setToast(null)
    run().catch(() => post(failed))
  }

  return (
    <ToastContext.Provider value={post}>
      {children}
      <div className="toast-slot" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span>{toast.text}</span>
            {toast.action && (
              <button className="btn" onClick={act}>
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
