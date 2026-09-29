import { StrictMode } from 'react'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <View />
  </StrictMode>,
)
