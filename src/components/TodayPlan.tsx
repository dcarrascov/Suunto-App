import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'
import { useAiStore } from '../stores/aiStore'
import { useCustomWorkoutStore } from '../stores/customWorkoutStore'
import { localWeekStart } from '../utils/calculations'
import { toLocalISODate } from '../utils/date'
import { planItems, weekDays } from '../utils/plan'
import { clockTime, sessionsForDay } from '../utils/today'
import type { DaySession, DaySource } from '../utils/today'

const SOURCE_LABEL: Record<DaySource, string> = {
  coach: 'Plan de tu entrenador',
  custom: 'Tu entreno',
  ia: 'Propuesta IA',
}
const DAY_LETTER = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

type DayState = 'today' | 'done' | 'missed' | 'upcoming' | 'free'
interface WeekDay { date: string; minutes: number; state: DayState; title: string }

// Barra de cada día de la semana (el «momento» de la franja): hoy en lima, lo hecho en gris claro, lo que falta en gris
// oscuro y lo planificado que no se hizo, solo con el borde
const BAR: Record<DayState, React.CSSProperties> = {
  today: { background: '#c5f23c' },
  done: { background: '#c4c4c7' },
  upcoming: { background: '#3a3a40' },
  missed: { border: '1px dashed #5a5a60' },
  free: { background: '#2a2a2f' },
}

function sum(list: DaySession[]): number {
  return list.reduce((s, x) => s + (x.minutes ?? 0), 0)
}

/**
 * Franja «Hoy» del Resumen: lo que toca hoy del entrenador, de tus entrenos o de la propuesta de la IA
 * (ver utils/today.ts), con la duración en cifras de cronómetro y la semana dibujada día a día.
 * Si no hay nada planificado de ningún sitio, enseña `fallback` (recuperación y racha).
 */
export default function TodayPlan({ className = '', fallback }: { className?: string; fallback?: ReactNode }) {
  const plan = useActivityStore(s => s.plan)
  const activities = useActivityStore(s => s.activities)
  const custom = useCustomWorkoutStore(s => s.workouts)
  const week = localWeekStart(new Date())
  const proposal = useAiStore(s => s.proposals[week] ?? s.freeProposals[week])

  const { today, tomorrow, dayName, days } = useMemo(() => {
    const now = new Date()
    const t = toLocalISODate(now)
    const tm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const items = planItems((plan?.workouts ?? []).filter(w => w.hasPlan || w.sport === 'rest'), activities, t)
    const doneDays = new Set(activities.map(a => a.startTime.slice(0, 10)))
    const doneMinutes = new Map<string, number>()
    for (const a of activities) {
      const d = a.startTime.slice(0, 10)
      doneMinutes.set(d, (doneMinutes.get(d) ?? 0) + a.duration / 60)
    }
    const days: WeekDay[] = weekDays(week).map(date => {
      const list = sessionsForDay(date, items, custom, proposal, doneDays)
      const planned = sum(list)
      const real = doneMinutes.get(date) ?? 0
      const state: DayState = date === t ? 'today'
        : real > 0 ? 'done'
          : date < t ? (planned > 0 ? 'missed' : 'free')
            : planned > 0 ? 'upcoming' : 'free'
      return { date, minutes: Math.max(planned, real), state, title: list.map(s => s.title).join(', ') }
    })
    return {
      today: sessionsForDay(t, items, custom, proposal, doneDays),
      // la propuesta es de esta semana: en domingo, «mañana» ya es de la siguiente
      tomorrow: sessionsForDay(toLocalISODate(tm), items, custom, localWeekStart(tm) === week ? proposal : undefined, doneDays),
      dayName: now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' }),
      days,
    }
  }, [plan, activities, custom, proposal, week])

  const weekPlanned = days.some(d => d.minutes > 0)
  if (!plan && today.length === 0 && !weekPlanned && fallback) return <>{fallback}</>
  const source = today[0]?.source ?? (plan ? 'coach' : null)
  const todayMinutes = sum(today)
  const maxMin = Math.max(...days.map(d => d.minutes), 30)

  return (
    <div className={`g-cell border-l-2 border-l-accent ${className}`}>
      <div className="flex items-center justify-between">
        <div className="g-label">Hoy · <span className="first-letter:uppercase inline-block">{dayName}</span></div>
        <Link to={plan ? '/plan' : '/calendar'} className="text-xs text-slate-500 hover:text-slate-100 transition-colors">Ver la semana →</Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 mt-2">
        <div className="min-w-0">
          {today.length === 0 ? (
            <div className="text-xl font-medium text-slate-300">Nada planificado</div>
          ) : (
            today.map(s => (
              <div key={s.key} className="text-xl font-medium text-slate-100">
                {s.title}
                {s.done && <span className="text-sm text-accent font-normal ml-2">✓ hecho</span>}
              </div>
            ))
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {source && (
              <span className={`text-[11px] font-medium px-2 py-0.5 ${source === 'coach' ? 'bg-accent text-black' : 'border border-accent text-accent'}`}>
                {SOURCE_LABEL[source]}
              </span>
            )}
            {today.find(s => s.detail) && <span className="text-xs text-slate-400">{today.map(s => s.detail).filter(Boolean).join(' · ')}</span>}
          </div>
        </div>
        {todayMinutes > 0 && (
          <div className="font-mono text-[48px] font-medium leading-none text-slate-100">{clockTime(todayMinutes * 60)}</div>
        )}
      </div>

      {/* La semana, día a día: altura = minutos (planificados o hechos) */}
      <div className="grid grid-cols-7 gap-2 mt-4" aria-label="Tu semana">
        {days.map((d, i) => (
          <div key={d.date} title={d.title || undefined} className="flex flex-col items-center">
            <div className="h-12 w-full flex items-end">
              <div className="w-full" style={{ height: `${Math.max(d.minutes / maxMin * 100, d.minutes > 0 ? 12 : 4)}%`, ...BAR[d.state] }} />
            </div>
            <div className={`font-mono text-[11px] mt-1 ${d.state === 'today' ? 'text-accent' : 'text-slate-500'}`}>
              {DAY_LETTER[i]}{d.minutes > 0 ? ` ${Math.round(d.minutes)}'` : ''}
            </div>
          </div>
        ))}
      </div>

      {tomorrow.length > 0 && (
        <div className="text-xs text-slate-500 mt-2">Mañana: {tomorrow.map(s => s.title).join(', ')}</div>
      )}
    </div>
  )
}
