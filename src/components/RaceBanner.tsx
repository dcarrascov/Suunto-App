import { Link } from 'react-router-dom'
import type { PlannedEvent } from '../types/suunto'

/** Competición del calendario de TrainingPeaks en un día del Plan. */
export default function RaceBanner({ event }: { event: PlannedEvent }) {
  return (
    <div className="border border-accent/60 bg-accent/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold bg-accent text-black px-1.5 py-0.5">COMPETICIÓN</span>
        {event.priority && <span className="text-[10px] font-semibold border border-accent text-accent px-1.5 py-0.5">PRIORIDAD {event.priority}</span>}
        <Link to="/races" className="ml-auto text-xs text-slate-500 hover:text-white">Competiciones →</Link>
      </div>
      <div className="text-lg font-semibold text-slate-100 mt-2">{event.name}</div>
      {event.distanceKm != null && <div className="text-sm text-slate-400">{event.distanceKm.toLocaleString('es-ES')} km</div>}
      {(event.description || event.comment) && (
        <p className="text-sm text-slate-300 mt-2 whitespace-pre-line">{[event.description, event.comment].filter(Boolean).join('\n')}</p>
      )}
    </div>
  )
}
