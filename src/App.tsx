import { Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useActivityStore } from './stores/activityStore'
import Sidebar from './components/Sidebar'
import SyncBar from './components/SyncBar'
import Dashboard from './pages/Dashboard'
import { lazyPage } from './utils/lazyPage'

// El Resumen va en la carga inicial (es la primera pantalla); el resto se descarga al abrirlo
const Activities = lazyPage(() => import('./pages/Activities'))
const ActivityDetailPage = lazyPage(() => import('./pages/ActivityDetail'))
const FitnessChartPage = lazyPage(() => import('./pages/FitnessChartPage'))
const ZoneAnalysis = lazyPage(() => import('./pages/ZoneAnalysis'))
const Records = lazyPage(() => import('./pages/Records'))
const Settings = lazyPage(() => import('./pages/Settings'))
const PerformanceAnalysis = lazyPage(() => import('./pages/PerformanceAnalysis'))
const History = lazyPage(() => import('./pages/History'))
const Plan = lazyPage(() => import('./pages/Plan'))
const Races = lazyPage(() => import('./pages/Races'))
const AiCoach = lazyPage(() => import('./pages/AiCoach'))
const CalendarPage = lazyPage(() => import('./pages/CalendarPage'))
const Shoes = lazyPage(() => import('./pages/Shoes'))
const FitImport = lazyPage(() => import('./pages/FitImport'))

function PageLoading() {
  return <div className="page text-sm text-slate-500" role="status">Cargando…</div>
}

export default function App() {
  const loadActivities = useActivityStore(s => s.loadActivities)
  const loadStats = useActivityStore(s => s.loadStats)
  const loadPlan = useActivityStore(s => s.loadPlan)

  useEffect(() => {
    loadActivities()
    loadStats()
    loadPlan()
  }, [loadActivities, loadStats, loadPlan])

  return (
    <BrowserRouter>
      <SyncBar />
      <div className="flex flex-col md:flex-row min-h-screen">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/activities" element={<Activities />} />
            <Route path="/activity/:id" element={<ActivityDetailPage />} />
            <Route path="/fitness" element={<FitnessChartPage />} />
            <Route path="/zones" element={<ZoneAnalysis />} />
            <Route path="/records" element={<Records />} />
            <Route path="/history" element={<History />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/races" element={<Races />} />
            <Route path="/ia" element={<AiCoach />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/performance" element={<PerformanceAnalysis />} />
            <Route path="/shoes" element={<Shoes />} />
            <Route path="/import" element={<FitImport />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  )
}
