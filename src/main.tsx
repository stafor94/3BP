import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { APP_VERSION } from './version'
import './styles.css'
import './camera-controls.css'
import './time-speed-controls.css'
import './tablet-panel-controls.css'
import './version.css'
import './top-overlay-controls.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <>
      <App />
      <div className="screen-app-version" aria-label={`version ${APP_VERSION}`}>v{APP_VERSION}</div>
    </>
  </StrictMode>,
)
