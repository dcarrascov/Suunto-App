import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Activity, BrainCircuit, CalendarDays, ClipboardList, Footprints, Gauge, HeartPulse, History,
  LayoutDashboard, Medal, Menu, RefreshCw, Settings, TrendingUp, Trophy, Upload, X,
} from 'lucide-react'
import { useActivityStore } from '../stores/activityStore'
import { useSyncStore } from '../stores/syncStore'

// Menú por categorías (la primera, sin título)
const NAV = [
  {
    title: null,
    items: [
      { to: '/', label: 'Resumen', icon: LayoutDashboard },
      { to: '/calendar', label: 'Calendario', icon: CalendarDays },
    ],
  },
  {
    title: 'Entrenamiento',
    items: [
      { to: '/activities', label: 'Actividades', icon: Activity },
      { to: '/races', label: 'Competiciones', icon: Medal },
    ],
  },
  {
    title: 'Coach',
    items: [
      { to: '/plan', label: 'Plan', icon: ClipboardList },
      { to: '/ia', label: 'Entrenador IA', icon: BrainCircuit },
    ],
  },
  {
    title: 'Análisis',
    items: [
      { to: '/fitness', label: 'Forma', icon: TrendingUp },
      { to: '/zones', label: 'Zonas', icon: HeartPulse },
      { to: '/performance', label: 'Rendimiento', icon: Gauge },
      { to: '/records', label: 'Récords', icon: Trophy },
      { to: '/history', label: 'Historial', icon: History },
    ],
  },
  {
    title: 'Equipo y datos',
    items: [
      { to: '/shoes', label: 'Zapatillas', icon: Footprints },
      { to: '/import', label: 'Importar FIT', icon: Upload },
      { to: '/settings', label: 'Ajustes', icon: Settings },
    ],
  },
]

export default function Sidebar() {
  const activities = useActivityStore(s => s.activities)
  const [open, setOpen] = useState(false)  // menú desplegado (solo en pantallas estrechas)
  const syncing = useSyncStore(s => s.status?.running ?? false)
  const startSync = useSyncStore(s => s.start)

  return (
    <aside className="md:w-52 shrink-0 bg-[#0f0f11] border-b md:border-b-0 md:border-r border-line flex flex-col md:min-h-screen">
      {/* Logo (+ botón de menú en móvil) */}
      <div className="px-6 py-4 md:pt-7 md:pb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-bold tracking-wide text-slate-100">SUUNTO<span className="text-accent">/</span>STATS</div>
            <button
              onClick={() => void startSync()}
              disabled={syncing}
              className="p-1 text-slate-500 hover:text-accent disabled:text-accent disabled:cursor-wait"
              aria-label="Actualizar los datos (Suunto y TrainingPeaks)"
              title={syncing ? 'Actualizando…' : 'Actualizar los datos (Suunto y TrainingPeaks)'}
            >
              <RefreshCw size={15} strokeWidth={2} className={syncing ? 'animate-spin' : ''} aria-hidden />
            </button>
          </div>
          <div className="text-slate-500 text-xs mt-0.5">
            {activities.length > 0 ? `${activities.length} actividades` : 'Sin datos aún'}
          </div>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="md:hidden text-slate-300 text-xl px-2 py-1 hover:text-white"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Nav */}
      <nav className={`${open ? 'block' : 'hidden'} md:block flex-1 pb-4`}>
        {NAV.map(group => (
          <div key={group.title ?? 'inicio'} className={group.title ? 'mt-4' : ''}>
            {group.title && <div className="g-label px-6 pb-1">{group.title}</div>}
            {group.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 py-2 text-sm transition-colors border-l-2 ${
                    isActive
                      ? 'border-accent pl-[22px] text-white font-medium'
                      : 'border-transparent pl-[22px] text-slate-500 hover:text-slate-200'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={16} strokeWidth={1.75} className={isActive ? 'text-accent' : ''} aria-hidden />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
