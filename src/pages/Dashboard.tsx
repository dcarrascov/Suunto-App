import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { GlobalStats } from '../types/suunto'
import { formState, localWeekStart, weeklyVo2max } from '../utils/calculations'
import { useActivityStore } from '../stores/activityStore'
import { formatDuration, formatPace } from '../utils/formatters'
import { planItems, planWeeks } from '../utils/plan'
import { useFitnessHistory } from '../hooks/useFitnessHistory'
import { useWeekComparison } from '../hooks/useWeekComparison'
import { useTrainingStreak } from '../hooks/useTrainingStreak'
import { useRunningVolume } from '../hooks/usePerformanceData'
import TodayPlan from '../components/TodayPlan'
import SettingsHints from '../components/SettingsHints'
import ShoeAlert from '../components/ShoeAlert'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

// ─── Loading / Empty states ───────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-slate-500 animate-pulse text-sm">Cargando...</div>
    </div>
  )
}

function EmptyScreen() {
  return (
    <div className="flex-1 p-8 max-w-2xl">
      <div className="g-cell border border-line">
        <div className="g-label">Sin datos de Suunto</div>
        <div className="font-mono text-sm text-slate-300 space-y-1 mt-3">
          <div>suuntool login --email TU_EMAIL</div>
          <div>pip install -r fetch/requirements.txt</div>
          <div>py fetch\sync.py --limit 20</div>
        </div>
      </div>
    </div>
  )
}

// "5 – 11 oct" o "29 sep – 5 oct" a partir del lunes de la semana
function formatWeekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  const short = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  return start.getMonth() === end.getMonth() ? `${start.getDate()} – ${short(end)}` : `${short(start)} – ${short(end)}`
}

// Segundos de recuperación que quedan: el acumulado tras la última actividad menos el tiempo transcurrido
function recoveryLeft(stats: GlobalStats | null): number | null {
  const r = stats?.recovery
  if (!r) return null
  return Math.max(0, r.seconds - (Date.now() - r.endedAt) / 1000)
}

const FORM_RANGE = 30  // el anillo va de −30 a +30

function FormRing({ tsb, color }: { tsb: number; color: string }) {
  const size = 100
  const r = 42
  const c = 2 * Math.PI * r
  const frac = Math.min(Math.max((tsb + FORM_RANGE) / (2 * FORM_RANGE), 0), 1)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#26262b" strokeWidth="7" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="7" strokeDasharray={`${frac * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[32px] font-semibold tracking-tight" style={{ color }}>
        {tsb > 0 ? '+' : ''}{Math.round(tsb)}
      </div>
    </div>
  )
}

function Delta({ value, unit = '', digits = 0 }: { value: number; unit?: string; digits?: number }) {
  if (!value) return <div className="text-xs text-slate-600 mt-1">igual que la semana pasada</div>
  const txt = `${value > 0 ? '+' : '−'}${Math.abs(value).toLocaleString('es-ES', { maximumFractionDigits: digits })}${unit}`
  return <div className={`text-xs mt-1 ${value > 0 ? 'text-accent' : 'text-slate-400'}`}>{txt}</div>
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const activities = useActivityStore(s => s.activities)
  const stats = useActivityStore(s => s.stats)
  const plan = useActivityStore(s => s.plan)
  const loading = useActivityStore(s => s.loading)
  const error = useActivityStore(s => s.error)

  const { current: fitness, sparkPoints } = useFitnessHistory()
  const recovery = recoveryLeft(stats)
  const vo2 = weeklyVo2max(stats?.vo2maxHistory)
  const { current: week, previous: lastWeek } = useWeekComparison()
  const streak = useTrainingStreak()
  const runVolume = useRunningVolume(12)

  // Tiempo planificado esta semana por el entrenador (si hay plan de TrainingPeaks).
  // Se usa el tiempo y no los km: indica la duración en todas las sesiones y la distancia solo en algunas.
  const plannedSeconds = useMemo(() => {
    if (!plan) return null
    const items = planItems(plan.workouts.filter(w => w.hasPlan), activities)
    const thisWeek = planWeeks(items).find(w => w.weekStart === localWeekStart(new Date()))
    return thisWeek && thisWeek.plannedSeconds > 0 ? thisWeek.plannedSeconds : null
  }, [plan, activities])

  if (loading) return <LoadingScreen />
  if (error || activities.length === 0) return <EmptyScreen />

  const tsb = fitness?.tsb ?? 0
  const form = formState(tsb)
  const maxKm = Math.max(...runVolume.map(w => w.km), 10)
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="page">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-6">
        <h1 className="text-xl font-semibold text-slate-100">Resumen</h1>
        <span className="text-xs text-slate-500 first-letter:uppercase">
          {today}
          {stats?.syncedAt && ` · sincronizado el ${new Date(stats.syncedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`}
        </span>
      </div>

      <SettingsHints />
      <ShoeAlert />

      <div className="g-grid">
        {/* Forma */}
        <div className="g-cell col-span-12 sm:col-span-6 xl:col-span-3">
          <div className="g-label">Forma</div>
          <div className="flex items-center gap-4 mt-3">
            <FormRing tsb={tsb} color={form.color} />
            <div>
              <div className="text-base font-semibold" style={{ color: form.color }}>{form.label}</div>
              <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                Fitness {Math.round(fitness?.ctl ?? 0)}<br />Fatiga {Math.round(fitness?.atl ?? 0)}
              </div>
            </div>
          </div>
        </div>

        {/* VO2max */}
        <div className="g-cell col-span-12 sm:col-span-6 xl:col-span-3"
          title={vo2 ? `Media de ${vo2.samples} medición(es) de la semana del ${formatWeekRange(vo2.weekStart)}` : undefined}>
          <div className="g-label">VO2max</div>
          <div className="text-[52px] font-semibold tracking-tight leading-none mt-4 text-slate-100">
            {vo2 ? vo2.value.toFixed(1).replace('.', ',') : '–'}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            ml/kg/min · {vo2?.isCurrent ? 'media semanal' : vo2 ? `semana del ${formatWeekRange(vo2.weekStart)}` : 'sin mediciones'}
          </div>
        </div>

        {/* Hoy toca (o, sin plan, recuperación y racha) */}
        {plan ? (
          <TodayPlan className="col-span-12 xl:col-span-6" />
        ) : (
          <div className="g-cell col-span-12 xl:col-span-6">
            <div className="g-label">Recuperación</div>
            <div className="text-[40px] font-semibold tracking-tight leading-none mt-4 text-slate-100">
              {recovery == null ? '–' : recovery > 0 ? formatDuration(recovery) : 'Recuperado'}
            </div>
            <div className="text-xs text-slate-500 mt-2">
              {recovery ? 'restante (estimado por Suunto)' : ''}{streak > 1 ? ` · racha de ${streak} días` : ''}
            </div>
          </div>
        )}

        {/* Semana */}
        <div className="g-cell col-span-6 lg:col-span-3">
          <div className="g-label">Distancia semana</div>
          <div className="text-[28px] font-semibold tracking-tight mt-2 text-slate-100">
            {week.distance.toFixed(1).replace('.', ',')} <span className="text-[15px] text-slate-500 font-normal">km</span>
          </div>
          <Delta value={week.distance - lastWeek.distance} unit=" km" digits={1} />
        </div>
        <div className="g-cell col-span-6 lg:col-span-3">
          <div className="g-label">Tiempo</div>
          <div className="text-[28px] font-semibold tracking-tight mt-2 text-slate-100">{formatDuration(week.duration)}</div>
          <Delta value={Math.round((week.duration - lastWeek.duration) / 60)} unit=" min" />
          {plannedSeconds != null && (
            <>
              <div className="h-1 bg-[#26262b] mt-3">
                <div className="h-1 bg-accent" style={{ width: `${Math.min(week.duration / plannedSeconds * 100, 100)}%` }} />
              </div>
              <div className="text-xs text-slate-500 mt-1.5">
                {Math.round(week.duration / plannedSeconds * 100)} % de las {formatDuration(plannedSeconds)} planificadas
              </div>
            </>
          )}
        </div>
        <div className="g-cell col-span-6 lg:col-span-3">
          <div className="g-label">Sesiones</div>
          <div className="text-[28px] font-semibold tracking-tight mt-2 text-slate-100">{week.count}</div>
          <Delta value={week.count - lastWeek.count} />
        </div>
        <div className="g-cell col-span-6 lg:col-span-3">
          <div className="g-label">Carga</div>
          <div className="text-[28px] font-semibold tracking-tight mt-2 text-slate-100">{Math.round(week.tss)}</div>
          <Delta value={Math.round(week.tss - lastWeek.tss)} unit=" TSS" />
        </div>

        {/* Km por semana */}
        <div className="g-cell col-span-12 xl:col-span-7">
          <div className="flex items-center justify-between">
            <div className="g-label">Km por semana · 12 semanas</div>
            <Link to="/performance" className="text-xs text-slate-500 hover:text-white">Rendimiento →</Link>
          </div>
          <div className="flex items-end gap-2 h-44 mt-5">
            {runVolume.map((w, i) => {
              const current = i === runVolume.length - 1
              return (
                <div key={w.weekStart} className="flex-1 h-full flex flex-col justify-end items-center"
                  title={`${formatWeekRange(w.weekStart)} · ${w.km} km en ${w.runs} salidas`}>
                  <div className={`text-[11px] mb-1 ${current ? 'text-accent' : 'text-slate-500'}`}>{Math.round(w.km)}</div>
                  <div className="w-full" style={{ height: `${Math.max(w.km / maxKm * 85, 1)}%`, background: current ? '#c5f23c' : '#3a3a40' }} />
                </div>
              )
            })}
          </div>
        </div>

        {/* Últimas actividades */}
        <div className="g-cell col-span-12 xl:col-span-5">
          <div className="flex items-center justify-between">
            <div className="g-label">Últimas actividades</div>
            <Link to="/activities" className="text-xs text-slate-500 hover:text-white">Ver todas →</Link>
          </div>
          <div className="mt-2">
            {activities.slice(0, 6).map(a => (
              <Link
                key={a.id}
                to={`/activity/${a.id}`}
                className="grid grid-cols-[4.5rem_1fr_auto_3.5rem] gap-3 py-2.5 border-t border-line text-sm hover:bg-[#1b1b1f]"
              >
                <span className="text-slate-500">
                  {new Date(a.startTime).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-slate-100 truncate">{a.title.split(' · ')[0]}</span>
                <span className="text-slate-100 text-right">{a.distance > 0 ? `${a.distance.toFixed(2).replace('.', ',')} km` : formatDuration(a.duration)}</span>
                <span className="text-slate-500 text-right">{a.avgPace ? formatPace(a.avgPace).replace(' /km', '') : a.avgSpeed ? `${a.avgSpeed}` : '–'}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Fitness y fatiga */}
        <div className="g-cell col-span-12">
          <div className="flex items-center justify-between">
            <div className="g-label">Fitness y fatiga</div>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span><span className="inline-block w-3 h-0.5 bg-accent align-middle mr-1.5" />Fitness (CTL)</span>
              <span><span className="inline-block w-3 h-0.5 bg-slate-400 align-middle mr-1.5" />Fatiga (ATL)</span>
              <Link to="/fitness" className="hover:text-white">Ver completo →</Link>
            </div>
          </div>
          <div className="h-40 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkPoints} margin={{ top: 4, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#222226" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis tick={{ fill: '#5a5a60', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#17171a', border: '1px solid #2a2a2f', borderRadius: 4, fontSize: 11 }}
                  labelStyle={{ color: '#a3a3a8' }}
                  formatter={(v: unknown, n: unknown) => [String(v), String(n)]}
                />
                <Line type="monotone" dataKey="ctl" name="Fitness" stroke="#c5f23c" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="atl" name="Fatiga" stroke="#a3a3a8" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
