import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'
import { toLocalISODate } from '../utils/date'
import { formatDuration, formatPace } from '../utils/formatters'
import { planItems } from '../utils/plan'
import { upcomingEvents } from '../utils/races'
import { parseLocalDate } from '../utils/date'
import type { PlanItem } from '../utils/plan'

function describe(i: PlanItem): string {
  const p = i.workout.planned
  return [
    p.duration && formatDuration(p.duration),
    p.distance && `${p.distance.toLocaleString('es-ES')} km`,
    p.duration && p.distance && i.workout.sport === 'running' && formatPace(p.duration / p.distance),
    p.tss && `${Math.round(p.tss)} TSS`,
  ].filter(Boolean).join(' · ')
}

/**
 * Celda del Dashboard con el entreno que toca hoy (y mañana) según TrainingPeaks.
 * Devuelve null si no hay plan sincronizado: el Dashboard pone otra cosa en su sitio.
 */
export default function TodayPlan({ className = '' }: { className?: string }) {
  const plan = useActivityStore(s => s.plan)
  const activities = useActivityStore(s => s.activities)

  const { today, tomorrow } = useMemo(() => {
    const now = new Date()
    const t = toLocalISODate(now)
    const m = toLocalISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
    const items = planItems((plan?.workouts ?? []).filter(w => w.hasPlan || w.sport === 'rest'), activities, t)
    return { today: items.filter(i => i.workout.date === t), tomorrow: items.filter(i => i.workout.date === m) }
  }, [plan, activities])

  if (!plan) return null
  const nextRace = upcomingEvents(plan.events ?? [])[0]

  return (
    <div className={`g-cell ${className}`}>
      <div className="flex items-center justify-between">
        <div className="g-label">Hoy toca</div>
        <Link to="/plan" className="text-xs text-slate-500 hover:text-white">Ver la semana →</Link>
      </div>
      {today.length === 0 ? (
        <div className="text-lg font-semibold text-slate-300 mt-2">Nada planificado</div>
      ) : (
        today.map(i => (
          <div key={i.workout.id} className="mt-2">
            <div className="text-xl font-semibold text-slate-100">
              {i.workout.title}
              {i.status === 'done' && <span className="text-sm text-accent font-normal ml-2">✓ hecho</span>}
            </div>
            <div className="text-sm text-slate-400 mt-0.5">{describe(i)}</div>
          </div>
        ))
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-semibold bg-accent text-black px-2 py-0.5">PLAN DE TU ENTRENADOR</span>
        {tomorrow.length > 0 && (
          <span className="text-xs text-slate-500">Mañana: {tomorrow.map(i => i.workout.title).join(', ')}</span>
        )}
      </div>
      {nextRace && (
        <div className="text-xs text-slate-400 mt-2">
          Próxima competición: <span className="text-accent font-medium">{nextRace.name}</span>
          {nextRace.priority ? ` (${nextRace.priority})` : ''} ·{' '}
          {parseLocalDate(nextRace.date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
        </div>
      )}
    </div>
  )
}
