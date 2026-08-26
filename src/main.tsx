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

const root = createRoot(document.getElementById('root')!)
const visualRegression = new URLSearchParams(window.location.search).get('visual-regression')

if (visualRegression === 'stellar-topology') {
  void import('./visualRegression/StellarTopologyVisualHarness').then(({ StellarTopologyVisualHarness }) => {
    root.render(<StellarTopologyVisualHarness />)
  })
} else if (visualRegression === 'collision-watch') {
  void import('./visualRegression/CollisionWatchVisualHarness').then(({ CollisionWatchVisualHarness }) => {
    root.render(<CollisionWatchVisualHarness />)
  })
} else if (visualRegression === 'non-stellar-destruction') {
  void import('./visualRegression/NonStellarDestructionVisualHarness').then(({ NonStellarDestructionVisualHarness }) => {
    root.render(<NonStellarDestructionVisualHarness />)
  })
} else {
  root.render(
    <StrictMode>
      <>
        <App />
        <div className="screen-app-version" aria-label={`version ${APP_VERSION}`}>v{APP_VERSION}</div>
      </>
    </StrictMode>,
  )
}
