import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { useActivityStore } from './stores/activityStore'
import { useAiStore } from './stores/aiStore'
import { useCustomWorkoutStore } from './stores/customWorkoutStore'
import { useShoeStore } from './stores/shoeStore'
import { startStateSync } from './utils/stateSync'

// Lo que guardas en este navegador, igual en todos tus dispositivos (si la app tiene servidor)
startStateSync({
  'suunto-settings': useActivityStore,
  'suunto-ai': useAiStore,
  'suunto-entrenos': useCustomWorkoutStore,
  'suunto-zapatillas': useShoeStore,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
