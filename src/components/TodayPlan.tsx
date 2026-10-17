import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'
import { toLocalISODate } from '../utils/date'
import { formatDuration } from '../utils/formatters'
import { planItems } from '../utils/plan'

/** Tarjeta del Dashboard con el entreno que toca hoy (y mañana), según TrainingPeaks. */
export default function TodayPlan() {
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

  const describe = (i: (typeof today)[number]) => {
    const p = i.workout.planned
    return [p.duration && formatDuration(p.duration), p.distance && `${p.distance} km`].filter(Boolean).join(' · ')
  }

  return (
    <section className="bg-slate-800/50 border border-blue-500/30 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-slate-500 uppercase tracking-wider">📋 Hoy toca</div>
        <Link to="/plan" className="text-xs text-blue-400 hover:text-blue-300">Ver la semana →</Link>
      </div>
      {today.length === 0 ? (
        <div className="text-sm text-slate-400">Nada planificado para hoy.</div>
      ) : (
        <div className="space-y-1.5">
          {today.map(i => (
            <div key={i.workout.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-slate-100">{i.workout.title}</span>
              <span className="text-xs text-slate-400">{describe(i)}</span>
              {i.status === 'done' && <span className="text-xs text-green-400">✓ hecho</span>}
            </div>
          ))}
        </div>
      )}
      {tomorrow.length > 0 && (
        <div className="text-xs text-slate-500 mt-2">
          Mañana: {tomorrow.map(i => i.workout.title).join(', ')}
        </div>
      )}
    </section>
  )
}
