import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useActivityStore } from './stores/activityStore'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Activities from './pages/Activities'
import ActivityDetailPage from './pages/ActivityDetail'
import FitnessChartPage from './pages/FitnessChartPage'
import ZoneAnalysis from './pages/ZoneAnalysis'
import Records from './pages/Records'
import Settings from './pages/Settings'
import PerformanceAnalysis from './pages/PerformanceAnalysis'

export default function App() {
  const loadActivities = useActivityStore(s => s.loadActivities)
  const loadStats = useActivityStore(s => s.loadStats)

  useEffect(() => {
    loadActivities()
    loadStats()
  }, [loadActivities, loadStats])

  return (
    <BrowserRouter>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/activities" element={<Activities />} />
            <Route path="/activity/:id" element={<ActivityDetailPage />} />
            <Route path="/fitness" element={<FitnessChartPage />} />
            <Route path="/zones" element={<ZoneAnalysis />} />
            <Route path="/records" element={<Records />} />
            <Route path="/performance" element={<PerformanceAnalysis />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
