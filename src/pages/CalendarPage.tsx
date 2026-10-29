import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CustomWorkoutDialog from '../components/CustomWorkoutDialog'
import { useCustomWorkoutStore } from '../stores/customWorkoutStore'
import { useActivityStore } from '../stores/activityStore'
import type { ActivitySummary, PlannedWorkout } from '../types/suunto'
import { localWeekStart } from '../utils/calculations'
import { parseLocalDate, toLocalISODate } from '../utils/date'
import { formatDuration, sportColor } from '../utils/formatters'
import { customByDate, customSummary, EMPTY_FORM, toForm, type CustomWorkoutForm } from '../utils/customWorkouts'
import { matchPlan } from '../utils/plan'
import { eventLabel, eventsByDate, raceDatesFromPlan } from '../utils/races'

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Lunes de cada semana que toca el mes (de la semana del día 1 a la del último día). */
function monthWeeks(year: number, month: number): string[] {
  const first = localWeekStart(new Date(year, month, 1))
  const last = new Date(year, month + 1, 0)
  const weeks: string[] = []
  for (let d = parseLocalDate(first); d <= last; d.setDate(d.getDate() + 7)) weeks.push(toLocalISODate(d))
  return weeks
}

function addDays(iso: string, n: number): string {
  const d = parseLocalDate(iso)
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
}

export default function CalendarPage() {
  const activities = useActivityStore(s => s.activities)
  const plan = useActivityStore(s => s.plan)
  const now = new Date()
  const today = toLocalISODate(now)
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const custom = useCustomWorkoutStore(s => s.workouts)
  const { addWorkout, updateWorkout, deleteWorkout } = useCustomWorkoutStore()
  const customOfDay = useMemo(() => customByDate(custom), [custom])
  // Ventana abierta: entreno nuevo (id null) o el que se edita
  const [dialog, setDialog] = useState<{ id: string | null; form: CustomWorkoutForm } | null>(null)

  const { byDay, plannedByDay, raceDays, eventsOfDay } = useMemo(() => {
    const byDay = new Map<string, ActivitySummary[]>()
    for (const a of activities) {
      const d = a.startTime.slice(0, 10)
      byDay.set(d, [...(byDay.get(d) ?? []), a])
    }
    for (const list of byDay.values()) list.sort((x, y) => x.startTime.localeCompare(y.startTime))
    // Planificado sin actividad emparejada (lo hecho ya aparece como actividad)
    const planned = (plan?.workouts ?? []).filter(w => w.hasPlan && w.sport !== 'rest')
    const matched = matchPlan(planned, activities)
    const plannedByDay = new Map<string, PlannedWorkout[]>()
    for (const w of planned) {
      if (matched.has(w.id) || w.completed) continue
      plannedByDay.set(w.date, [...(plannedByDay.get(w.date) ?? []), w])
    }
    return {
      byDay, plannedByDay,
      raceDays: new Set(raceDatesFromPlan(plan?.workouts ?? [], plan?.events ?? [])),
      eventsOfDay: eventsByDate(plan?.events ?? []),   // competiciones del calendario de TrainingPeaks (con nombre)
    }
  }, [activities, plan])

  const weeks = monthWeeks(cursor.year, cursor.month)
  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  const shift = (n: number) => setCursor(c => {
    const d = new Date(c.year, c.month + n, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const monthKm = activities
    .filter(a => a.sport === 'running' && parseLocalDate(a.startTime).getMonth() === cursor.month && parseLocalDate(a.startTime).getFullYear() === cursor.year)
    .reduce((s, a) => s + a.distance, 0)

  return (
    <div className="flex-1 p-4 md:px-10 md:py-8 overflow-y-auto">
      <div className="flex flex-wrap gap-3 items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 first-letter:uppercase">{monthName}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{monthKm.toFixed(1).replace('.', ',')} km de carrera este mes</p>
        </div>
        <div className="flex items-center gap-0.5 bg-slate-800 p-0.5">
          <button onClick={() => shift(-1)} className="px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700" aria-label="Mes anterior">←</button>
          <button
            onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
            className={`px-3 py-1.5 text-sm ${cursor.year === now.getFullYear() && cursor.month === now.getMonth() ? 'bg-accent text-black font-medium' : 'text-slate-300 hover:bg-slate-700'}`}
          >
            Hoy
          </button>
          <button onClick={() => shift(1)} className="px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700" aria-label="Mes siguiente">→</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px] grid grid-cols-[repeat(7,minmax(0,1fr))_4.5rem] gap-px bg-line border border-line">
          {WEEKDAYS.map(d => <div key={d} className="bg-[#0f0f11] px-2 py-1.5 g-label">{d}</div>)}
          <div className="bg-[#0f0f11] px-2 py-1.5 g-label text-right">Km</div>

          {weeks.map(week => {
            const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
            const weekKm = days.flatMap(d => byDay.get(d) ?? []).filter(a => a.sport === 'running').reduce((s, a) => s + a.distance, 0)
            return [
              ...days.map(day => {
                const inMonth = parseLocalDate(day).getMonth() === cursor.month
                const acts = byDay.get(day) ?? []
                const planned = plannedByDay.get(day) ?? []
                const own = customOfDay.get(day) ?? []
                return (
                  <div key={day} className={`group bg-cell min-h-[104px] p-1.5 ${inMonth ? '' : 'opacity-35'} ${day === today ? 'outline outline-1 outline-accent -outline-offset-1' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${day === today ? 'text-accent font-semibold' : 'text-slate-500'}`}>{parseLocalDate(day).getDate()}</span>
                      <div className="flex items-center gap-1">
                        {raceDays.has(day) && !eventsOfDay.has(day) && <span className="text-[9px] font-semibold bg-accent text-black px-1">CARRERA</span>}
                        {eventsOfDay.get(day)?.some(e => e.priority) && (
                          <span className="text-[9px] font-semibold bg-accent text-black px-1">{eventsOfDay.get(day)!.find(e => e.priority)!.priority}</span>
                        )}
                        <button
                          onClick={() => setDialog({ id: null, form: { ...EMPTY_FORM, date: day } })}
                          className="w-4 h-4 leading-none text-sm text-slate-400 hover:text-black hover:bg-accent md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                          aria-label={`Añadir entreno el ${day}`}
                          title="Añadir entreno propio"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 space-y-1">
                      {(eventsOfDay.get(day) ?? []).map(e => (
                        <Link
                          key={`ev-${e.id}`}
                          to="/races"
                          className="block text-[11px] leading-tight font-semibold bg-accent/15 border-l-2 border-accent text-accent px-1 py-0.5 truncate"
                          title={eventLabel(e)}
                        >
                          {e.name}
                        </Link>
                      ))}
                      {acts.map(a => (
                        <Link
                          key={a.id}
                          to={`/activity/${a.id}`}
                          className="flex items-center gap-1.5 text-[11px] leading-tight hover:bg-[#1f1f24] px-1 py-0.5"
                          title={`${a.title} · ${formatDuration(a.duration)}`}
                        >
                          <span className="w-0.5 h-3 shrink-0" style={{ background: sportColor(a.sport) }} />
                          <span className="text-slate-200">{a.distance > 0 ? `${a.distance.toFixed(1).replace('.', ',')} km` : formatDuration(a.duration)}</span>
                          {a.distance > 0 && <span className="text-slate-500">{formatDuration(a.duration)}</span>}
                        </Link>
                      ))}
                      {planned.map(w => (
                        <Link
                          key={w.id}
                          to="/plan"
                          className="block text-[11px] leading-tight border border-dashed border-slate-600 text-slate-400 px-1 py-0.5 truncate hover:text-white"
                          title={`Planificado: ${w.title}`}
                        >
                          {w.title}
                        </Link>
                      ))}
                      {own.map(w => (
                        <button
                          key={w.id}
                          onClick={() => setDialog({ id: w.id, form: toForm(w) })}
                          className="w-full flex items-center gap-1.5 text-left text-[11px] leading-tight border border-slate-500 bg-[#1b1b1f] text-slate-200 px-1 py-0.5 hover:border-accent"
                          title={[`${w.source === 'ia' ? 'Propuesta IA' : 'Propio'}: ${w.title}`, customSummary(w), w.description].filter(Boolean).join('\n')}
                        >
                          <span className="w-0.5 h-3 shrink-0" style={{ background: sportColor(w.sport) }} />
                          {w.source === 'ia' && <span className="text-[9px] font-semibold text-accent shrink-0">IA</span>}
                          <span className="truncate">{w.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              }),
              <div key={`${week}-km`} className="bg-[#121214] p-1.5 text-right">
                <div className="text-sm font-semibold text-slate-200 mt-4">{weekKm > 0 ? Math.round(weekKm) : '–'}</div>
              </div>,
            ]
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-500">
        <span><span className="inline-block w-0.5 h-3 bg-accent align-middle mr-1.5" />Carrera</span>
        <span><span className="inline-block w-0.5 h-3 align-middle mr-1.5" style={{ background: '#fb923c' }} />Bici</span>
        <span><span className="inline-block w-0.5 h-3 align-middle mr-1.5" style={{ background: '#60a5fa' }} />Natación</span>
        <span><span className="inline-block w-3 h-2.5 border border-dashed border-slate-600 align-middle mr-1.5" />Planificado, sin actividad</span>
        <span><span className="inline-block w-3 h-2.5 border border-slate-500 bg-[#1b1b1f] align-middle mr-1.5" />Entreno propio (pulsa + en un día para crearlo; «IA» = pasado desde el Entrenador IA)</span>
      </div>

      {dialog && (
        <CustomWorkoutDialog
          key={dialog.id ?? `new-${dialog.form.date}`}
          initial={dialog.form}
          editing={dialog.id !== null}
          onClose={() => setDialog(null)}
          onSave={w => {
            if (dialog.id) updateWorkout(dialog.id, w)
            else addWorkout(w)
            setDialog(null)
          }}
          onDelete={dialog.id ? () => {
            if (window.confirm(`¿Eliminar el entreno «${dialog.form.title}»?`)) {
              deleteWorkout(dialog.id!)
              setDialog(null)
            }
          } : undefined}
        />
      )}
    </div>
  )
}
