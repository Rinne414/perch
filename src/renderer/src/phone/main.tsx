import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PhoneApp } from './PhoneApp'
import './phone.css'

// The worker only shows pushed notifications; without it (plain http) the page still works.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PhoneApp />
  </StrictMode>,
)
