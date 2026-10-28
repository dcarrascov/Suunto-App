import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'
import type { PlanSport } from '../types/suunto'
import { localWeekStart } from '../utils/calculations'
import { toLocalISODate } from '../utils/date'
import { formatDuration, formatPace } from '../utils/formatters'
import { planItems, planWeeks, shiftWeek, weekDays } from '../utils/plan'
import type { PlanItem, PlanStatus, PlanWeek } from '../utils/plan'
import { useAiStore } from '../stores/aiStore'
import AiProposalView from '../components/AiProposalView'
import RaceBanner from '../components/RaceBanner'
import { eventsByDate } from '../utils/races'

// Color de la barrita lateral de cada entreno según el deporte
const SPORT_COLOR: Record<PlanSport, string> = {
  running: '#c5f23c', cycling: '#fb923c', swimming: '#60a5fa', strength: '#a3a3a8', rest: '#3a3a40', other: '#a3a3a8',
}

const STATUS: Record<PlanStatus, { label: string; cls: string }> = {
  done: { label: '✓ Hecho', cls: 'bg-accent text-black border-accent font-medium' },
  missed: { label: '✗ No hecho', cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
  today: { label: 'Hoy', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/40' },
  upcoming: { label: 'Próximo', cls: 'bg-slate-700/40 text-slate-400 border-slate-600/50' },
  rest: { label: 'Descanso', cls: 'bg-slate-700/40 text-slate-400 border-slate-600/50' },
}

const HISTORY_PAGE = 12

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })
}

function weekLabel(weekStart: string): string {
  const days = weekDays(weekStart)
  const f = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  return `${f(days[0])} – ${f(days[6])}`
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-mono text-slate-300 bg-slate-900/60 border border-slate-700/50 rounded-md px-1.5 py-0.5">{children}</span>
}

function ComplianceText({ pct }: { pct: number | null }) {
  if (pct == null) return null
  const color = pct >= 90 && pct <= 115 ? 'text-green-400' : pct >= 75 && pct <= 130 ? 'text-yellow-400' : 'text-red-400'
  return <span className={`text-xs ${color}`}>{pct}% de lo planificado</span>
}

function WorkoutCard({ item }: { item: PlanItem }) {
  const { workout: w, activity, status, compliance } = item
  const [open, setOpen] = useState(status === 'today')
  const st = STATUS[status]
  const hasText = w.description || w.coachComments || w.athleteComments
  const realDuration = activity?.duration ?? w.actual?.duration ?? null
  const realDistance = activity?.distance ?? w.actual?.distance ?? null

  return (
    <div className={`rounded-xl border p-4 ${status === 'today' ? 'border-blue-500/40 bg-blue-500/5' : 'border-slate-700/50 bg-slate-800/60'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-1 h-5" style={{ background: SPORT_COLOR[w.sport] }} aria-hidden />
            <span className="font-medium text-slate-100">{w.title}</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{w.typeName}</div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${st.cls}`}>{st.label}</span>
      </div>

      {(w.planned.duration || w.planned.distance || w.planned.tss) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <span className="text-xs text-slate-500 mr-1">Plan</span>
          {w.planned.duration != null && <Chip>{formatDuration(w.planned.duration)}</Chip>}
          {w.planned.distance != null && <Chip>{w.planned.distance} km</Chip>}
          {w.planned.duration && w.planned.distance && w.sport === 'running' && (
            <Chip>{formatPace(w.planned.duration / w.planned.distance)}</Chip>
          )}
          {w.planned.tss != null && <Chip>{Math.round(w.planned.tss)} TSS</Chip>}
        </div>
      )}

      {status === 'done' && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="text-xs text-slate-500 mr-1">Hecho</span>
          {realDuration != null && <Chip>{formatDuration(realDuration)}</Chip>}
          {realDistance != null && <Chip>{realDistance.toFixed(2)} km</Chip>}
          {activity?.avgPace && w.sport === 'running' && <Chip>{formatPace(activity.avgPace)}</Chip>}
          <ComplianceText pct={compliance} />
          {activity && (
            <Link to={`/activity/${activity.id}`} className="text-xs text-blue-400 hover:text-blue-300 ml-auto">
              Ver actividad →
            </Link>
          )}
        </div>
      )}

      {hasText && (
        <div className="mt-3">
          <button onClick={() => setOpen(o => !o)} className="text-xs text-blue-400 hover:text-blue-300">
            {open ? 'Ocultar detalles' : 'Ver detalles del entrenador'}
          </button>
          {open && (
            <div className="mt-2 space-y-3 text-sm text-slate-300">
              {w.description && <p className="whitespace-pre-line leading-relaxed">{w.description}</p>}
              {w.coachComments && (
                <div className="border-l-2 border-amber-500/50 pl-3">
                  <div className="text-xs text-amber-300/80 mb-0.5">Comentario del entrenador</div>
                  <p className="whitespace-pre-line">{w.coachComments}</p>
                </div>
              )}
              {w.athleteComments && (
                <div className="border-l-2 border-blue-500/50 pl-3">
                  <div className="text-xs text-blue-300/80 mb-0.5">Tu comentario</div>
                  <p className="whitespace-pre-line">{w.athleteComments}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WeekSummary({ week }: { week: PlanWeek | undefined }) {
  if (!week || week.planned === 0) return null
  const pct = Math.round(week.done / week.planned * 100)
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      {[
        { label: 'Sesiones', value: `${week.done} / ${week.planned}`, sub: `${pct}% hechas` },
        { label: 'Tiempo', value: formatDuration(week.doneSeconds), sub: week.plannedSeconds ? `de ${formatDuration(week.plannedSeconds)} planificado` : '' },
        { label: 'Distancia', value: `${week.doneKm.toFixed(1)} km`, sub: week.plannedKm && week.plannedKmComplete ? `de ${week.plannedKm.toFixed(1)} km planificados` : 'tu entrenador planifica por tiempo' },
        { label: 'No hechas', value: String(week.missed), sub: week.missed ? 'sesiones pasadas sin hacer' : 'ninguna' },
      ].map(c => (
        <div key={c.label} className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase tracking-wider">{c.label}</div>
          <div className="text-xl font-bold text-slate-100 mt-1">{c.value}</div>
          <div className="text-xs text-slate-500">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

export default function Plan() {
  const plan = useActivityStore(s => s.plan)
  const activities = useActivityStore(s => s.activities)
  const today = toLocalISODate(new Date())
  const thisWeek = localWeekStart(new Date())
  const [week, setWeek] = useState(thisWeek)
  const aiProposal = useAiStore(s => s.proposals[week])
  const deleteProposal = useAiStore(s => s.deleteProposal)
  const eventsOfDay = useMemo(() => eventsByDate(plan?.events ?? []), [plan])
  const [historyShown, setHistoryShown] = useState(HISTORY_PAGE)
  const pageRef = useRef<HTMLDivElement>(null)

  // Solo lo que envía el entrenador (los entrenos sin plan ya están en las actividades de Suunto)
  const items = useMemo(
    () => planItems((plan?.workouts ?? []).filter(w => w.hasPlan || w.sport === 'rest'), activities, today),
    [plan, activities, today],
  )
  const weeks = useMemo(() => planWeeks(items), [items])
  const current = weeks.find(w => w.weekStart === week)
  const history = weeks.filter(w => w.weekStart < thisWeek)

  if (!plan) {
    return (
      <div className="flex-1 p-4 md:p-6 overflow-y-auto">
        <h1 className="text-xl font-bold text-slate-100 mb-1">Plan de entrenamiento</h1>
        <div className="mt-6 max-w-xl bg-amber-950/30 border border-amber-800/40 rounded-xl p-5 text-sm text-slate-300 space-y-2">
          <p className="font-medium text-amber-300">Aún no hay datos de TrainingPeaks</p>
          <p>
            Copia tu cookie de TrainingPeaks en <code className="text-slate-200">.env</code> (lo explica{' '}
            <code className="text-slate-200">GUIA_TRAININGPEAKS.md</code>) y ejecuta:
          </p>
          <pre className="bg-slate-900/70 rounded-lg px-3 py-2 text-xs text-slate-200">py fetch\tp_sync.py --full</pre>
        </div>
      </div>
    )
  }

  const days = weekDays(week)

  return (
    <div ref={pageRef} className="flex-1 p-4 md:p-6 overflow-y-auto">
      <div className="flex flex-wrap gap-3 items-start justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Plan de entrenamiento</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Lo que te envía tu entrenador en TrainingPeaks · sincronizado el{' '}
            {new Date(plan.syncedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5">
          <button onClick={() => setWeek(w => shiftWeek(w, -1))} className="px-3 py-1.5 rounded-md text-sm text-slate-300 hover:bg-slate-700" aria-label="Semana anterior">←</button>
          <button
            onClick={() => setWeek(thisWeek)}
            className={`px-3 py-1.5 rounded-md text-sm ${week === thisWeek ? 'bg-accent text-black font-medium' : 'text-slate-300 hover:bg-slate-700'}`}
          >
            Esta semana
          </button>
          <button onClick={() => setWeek(w => shiftWeek(w, 1))} className="px-3 py-1.5 rounded-md text-sm text-slate-300 hover:bg-slate-700" aria-label="Semana siguiente">→</button>
        </div>
      </div>

      <div className="text-sm font-medium text-slate-300 mb-3">
        Semana del {weekLabel(week)}
        {week === thisWeek && <span className="text-slate-500"> · esta semana</span>}
      </div>

      <WeekSummary week={current} />

      {/* Propuesta de la IA para esta semana (si la hay): aparte del plan del entrenador */}
      {aiProposal && (
        <details className="mb-6">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-white mb-2">
            Hay una propuesta de la IA para esta semana · <Link to="/ia" className="text-accent">Entrenador IA</Link>
          </summary>
          <AiProposalView
            proposal={aiProposal}
            onDelete={() => { if (window.confirm(`¿Borrar la propuesta de la IA de la semana del ${weekLabel(week)}?`)) deleteProposal(week) }}
          />
        </details>
      )}

      <div className="space-y-4 mb-10">
        {days.map(day => {
          const dayItems = (current?.items ?? []).filter(it => it.workout.date === day)
          const dayEvents = eventsOfDay.get(day) ?? []
          return (
            <div key={day}>
              <div className={`text-xs uppercase tracking-wider mb-2 ${day === today ? 'text-blue-300 font-semibold' : 'text-slate-500'}`}>
                {dayLabel(day)}{day === today && ' · hoy'}
              </div>
              {dayEvents.length > 0 && (
                <div className="space-y-2 mb-2">
                  {dayEvents.map(e => <RaceBanner key={e.id} event={e} />)}
                </div>
              )}
              {dayItems.length === 0 ? (
                dayEvents.length === 0 && <div className="text-xs text-slate-600 pl-1">Sin entreno planificado</div>
              ) : (
                <div className="space-y-2">
                  {dayItems.map(it => <WorkoutCard key={it.workout.id} item={it} />)}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Historial */}
      {history.length > 0 && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 overflow-x-auto">
          <div className="text-sm font-medium text-slate-200 mb-1">Historial</div>
          <p className="text-xs text-slate-500 mb-3">Semanas anteriores: pulsa una para ver sus entrenos</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                <th className="pb-2 pr-4">Semana</th>
                <th className="pb-2 pr-4">Hechas</th>
                <th className="pb-2 pr-4">Cumplimiento</th>
                <th className="pb-2 pr-4">Tiempo</th>
                <th className="pb-2">Distancia</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, historyShown).map(w => {
                const pct = w.planned ? Math.round(w.done / w.planned * 100) : null
                return (
                  <tr
                    key={w.weekStart}
                    onClick={() => { setWeek(w.weekStart); pageRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }}
                    className={`border-b border-slate-800/60 cursor-pointer hover:bg-slate-800/60 ${w.weekStart === week ? 'bg-slate-800/60' : ''}`}
                  >
                    <td className="py-2 pr-4 text-slate-200 whitespace-nowrap">{weekLabel(w.weekStart)}</td>
                    <td className="py-2 pr-4 text-slate-300">{w.done} / {w.planned}</td>
                    <td className="py-2 pr-4">
                      {pct != null && (
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-slate-700 rounded-full">
                            <div
                              className="h-1.5 rounded-full"
                              style={{ width: `${Math.min(pct, 100)}%`, background: pct >= 90 ? '#22c55e' : pct >= 70 ? '#eab308' : '#ef4444' }}
                            />
                          </div>
                          <span className="text-xs text-slate-400">{pct}%</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-400 whitespace-nowrap">
                      {formatDuration(w.doneSeconds)}{w.plannedSeconds ? ` / ${formatDuration(w.plannedSeconds)}` : ''}
                    </td>
                    <td className="py-2 font-mono text-xs text-slate-400 whitespace-nowrap">
                      {w.doneKm.toFixed(1)}{w.plannedKm && w.plannedKmComplete ? ` / ${w.plannedKm.toFixed(1)}` : ''} km
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {history.length > historyShown && (
            <button
              onClick={() => setHistoryShown(n => n + HISTORY_PAGE)}
              className="mt-3 w-full py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 text-sm"
            >
              Ver más ({history.length - historyShown} semanas)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
