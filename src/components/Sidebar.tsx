import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◉' },
  { to: '/activities', label: 'Actividades', icon: '▤' },
  { to: '/fitness', label: 'Fitness & Forma', icon: '📈' },
  { to: '/zones', label: 'Zonas', icon: '🔥' },
  { to: '/performance', label: 'Rendimiento', icon: '⚡' },
  { to: '/records', label: 'Récords', icon: '🏅' },
  { to: '/history', label: 'Historial', icon: '📅' },
  { to: '/settings', label: 'Ajustes', icon: '⚙' },
]

export default function Sidebar() {
  const stats = useActivityStore(s => s.stats)
  const activities = useActivityStore(s => s.activities)
  const [open, setOpen] = useState(false)  // menú desplegado (solo en pantallas estrechas)

  return (
    <aside className="md:w-56 shrink-0 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-700/50 flex flex-col md:min-h-screen">
      {/* Logo (+ botón de menú en móvil) */}
      <div className="px-5 py-4 md:py-5 border-b border-slate-700/50 flex items-center justify-between">
        <div>
          <div className="text-blue-400 font-bold text-lg tracking-tight">Suunto Stats</div>
          <div className="text-slate-500 text-xs mt-0.5">
            {activities.length > 0 ? `${activities.length} actividades` : 'Sin datos aún'}
          </div>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="md:hidden text-slate-300 text-xl px-2 py-1 rounded-lg hover:bg-slate-800"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
        >
          {open ? '✕' : '☰'}
        </button>
      </div>

      {/* Nav */}
      <nav className={`${open ? 'block' : 'hidden'} md:block flex-1 py-4 px-2 space-y-0.5`}>
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`
            }
          >
            <span className="text-base">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Sync info */}
      {stats && (
        <div className="hidden md:block px-5 py-4 border-t border-slate-700/50">
          <div className="text-xs text-slate-500">
            Última sync
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {new Date(stats.syncedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          <div className="mt-3 text-xs text-slate-600 leading-relaxed">
            Para actualizar:<br />
            <code className="text-slate-500">python3 fetch/sync.py</code>
          </div>
        </div>
      )}
    </aside>
  )
}
