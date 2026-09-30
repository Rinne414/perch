import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { CaptureView } from './capture/CaptureView'
import { FloatView } from './float/FloatView'
import { MainWindow } from './mainwin/MainWindow'
import './styles/glass.css'

const VIEWS = {
  float: FloatView,
  capture: CaptureView,
  main: MainWindow,
} as const

const requested = new URLSearchParams(location.search).get('view')
const View = VIEWS[(requested as keyof typeof VIEWS) ?? 'float'] ?? FloatView

/** Every window follows the glass level chosen in 設定; until it loads, the default (中) shows. */
function Root(): React.JSX.Element {
  useEffect(() => {
    const apply = (): void => {
      window.api
        .getAppInfo()
        .then((info) => (document.documentElement.dataset.glass = info.glass))
        .catch(() => undefined) // Keep the default look; nothing else depends on it.
    }
    apply()
    return window.api.onChanged(apply)
  }, [])
  return <View />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
