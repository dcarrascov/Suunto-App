import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Flag } from 'lucide-react'
import type { GlobalStats } from '../types/suunto'
import { formState, localWeekStart, predictForDistance, weeklyVo2max } from '../utils/calculations'
import { useActivityStore } from '../stores/activityStore'
import { formatDuration, formatPace } from '../utils/formatters'
import { planItems, planWeeks } from '../utils/plan'
import { isoDateOffset, parseLocalDate, toLocalISODate } from '../utils/date'
import { eventLabel, upcomingEvents } from '../utils/races'
import { clockTime, daysUntil } from '../utils/today'
import { useFitnessProjection } from '../hooks/useFitnessProjection'
import { useWeekComparison } from '../hooks/useWeekComparison'
import { useTrainingStreak } from '../hooks/useTrainingStreak'
import { useRunningVolume } from '../hooks/usePerformanceData'
import TodayPlan from '../components/TodayPlan'
import SettingsHints from '../components/SettingsHints'
import ShoeAlert from '../components/ShoeAlert'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'

// Diseño del Resumen (pulido con unslop): cuadrícula de 4 px, tres tamaños de cifra (48 principal, 28 secundarias,
// 13/12 texto), peso 500 y el lima solo en «Hoy» y en la gráfica de forma. La bandera de meta marca la próxima carrera.
const ACCENT = '#c5f23c'
const GREY = { line: '#222226', track: '#2a2a2f', bar: '#3a3a40', muted: '#5a5a60', text: '#a3a3a8', strong: '#c4c4c7' }
const RACE_DAYS_SHOWN = 60   // la forma prevista solo se dibuja si la carrera cae dentro de este margen

// ─── Loading / Empty states ───────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-slate-500 text-sm" role="status">Cargando…</div>
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
  const size = 96
  const r = 40
  const c = 2 * Math.PI * r
  const frac = Math.min(Math.max((tsb + FORM_RANGE) / (2 * FORM_RANGE), 0), 1)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 96 96" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="48" cy="48" r={r} fill="none" stroke={GREY.track} strokeWidth="6" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="6" strokeDasharray={`${frac * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-mono text-[28px] font-medium" style={{ color }}>
        {tsb > 0 ? '+' : ''}{Math.round(tsb)}
      </div>
    </div>
  )
}

/** Cambio frente a la semana pasada, siempre en gris: más carga o más km no es «mejor» por sí solo. */
function Delta({ value, unit = '', digits = 0 }: { value: number; unit?: string; digits?: number }) {
  if (!value) return <div className="text-xs text-slate-500 mt-1">igual que la semana pasada</div>
  const txt = `${value > 0 ? '+' : '−'}${Math.abs(value).toLocaleString('es-ES', { maximumFractionDigits: digits })}${unit}`
  return <div className="text-xs text-slate-400 mt-1">{txt} <span className="text-slate-500">frente a la semana pasada</span></div>
}

/** Bandera de meta sobre la línea de la carrera (la misma idea que la bandera de la barra de actualización). */
function RaceFlag({ viewBox, name }: { viewBox?: { x?: number; y?: number }; name: string }) {
  const x = viewBox?.x ?? 0
  const y = (viewBox?.y ?? 0) + 2
  return (
    <g>
      <path d={`M${x} ${y} h10 l-3 4 l3 4 h-10 z`} fill={ACCENT} />
      <text x={x - 4} y={y + 8} textAnchor="end" fill={GREY.text} fontSize={11}>{name}</text>
    </g>
  )
}

interface ChartPoint { date: string; ctl?: number; atl?: number; ctlP?: number; atlP?: number }

/**
 * La próxima carrera como un dorsal: placa clara con los cuatro agujeros de los imperdibles, la cuenta atrás en cifras
 * de cronómetro, la predicción de tiempo (Riegel, últimos 90 días) y la forma prevista para ese día.
 */
function RaceBib({ name, priority, title, daysLeft, date, km, predicted, raceTsb }: {
  name: string; priority: string | null; title: string; daysLeft: number; date: string; km: number | null
  predicted: number | null; raceTsb: number | null
}) {
  const hole = 'absolute w-2 h-2 rounded-full bg-cell'
  return (
    <Link to="/races" title={title}
      className="relative flex-1 flex flex-col justify-between bg-slate-100 text-slate-950 px-5 py-4 min-h-36 hover:bg-slate-200 transition-colors">
      <span className={`${hole} top-2 left-2`} /><span className={`${hole} top-2 right-2`} />
      <span className={`${hole} bottom-2 left-2`} /><span className={`${hole} bottom-2 right-2`} />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1 min-w-0 font-medium">
          <Flag size={14} strokeWidth={1.5} aria-hidden className="shrink-0" /><span className="truncate">{name}</span>
        </span>
        {priority && <span className="shrink-0 font-medium">Prioridad {priority}</span>}
      </div>
      <div className="font-mono text-[48px] font-medium leading-none my-2">
        {daysLeft === 0 ? 'Hoy' : <>{daysLeft}<span className="font-sans text-base font-normal"> {daysLeft === 1 ? 'día' : 'días'}</span></>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-slate-700">
        <span className="first-letter:uppercase">
          {parseLocalDate(date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}
          {km ? ` · ${km.toLocaleString('es-ES')} km` : ''}
        </span>
        <span className="font-mono">
          {predicted ? `previsto ${clockTime(predicted)}` : ''}
          {predicted && raceTsb != null ? ' · ' : ''}
          {raceTsb != null ? `forma ${raceTsb > 0 ? '+' : ''}${Math.round(raceTsb)}` : ''}
        </span>
      </div>
    </Link>
  )
}

const statNumber ='text-[28px] font-medium leading-none mt-3 text-slate-100'

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const activities = useActivityStore(s => s.activities)
  const stats = useActivityStore(s => s.stats)
  const plan = useActivityStore(s => s.plan)
  const loading = useActivityStore(s => s.loading)
  const error = useActivityStore(s => s.error)

  const { history, projection } = useFitnessProjection()
  const fitness = history.length > 0 ? history[history.length - 1] : null
  const recovery = recoveryLeft(stats)
  const vo2 = weeklyVo2max(stats?.vo2maxHistory)
  const { current: week, previous: lastWeek } = useWeekComparison()
  const streak = useTrainingStreak()
  const runVolume = useRunningVolume(12)

  const todayIso = toLocalISODate(new Date())
  const nextRace = upcomingEvents(plan?.events ?? [], todayIso)[0]
  const raceIn = nextRace ? daysUntil(nextRace.date, todayIso) : 0
  const showRace = !!nextRace && raceIn <= RACE_DAYS_SHOWN
  const raceKm = nextRace?.distanceKm ?? null
  const racePrediction = useMemo(() => (nextRace ? predictForDistance(activities, isoDateOffset(90), raceKm) : null),
    [activities, nextRace, raceKm])
  const raceTsb = nextRace ? (projection.find(p => p.date === nextRace.date)?.tsb ?? null) : null

  // Tiempo planificado esta semana por el entrenador (si hay plan de TrainingPeaks).
  // Se usa el tiempo y no los km: indica la duración en todas las sesiones y la distancia solo en algunas.
  const plannedSeconds = useMemo(() => {
    if (!plan) return null
    const items = planItems(plan.workouts.filter(w => w.hasPlan), activities)
    const thisWeek = planWeeks(items).find(w => w.weekStart === localWeekStart(new Date()))
    return thisWeek && thisWeek.plannedSeconds > 0 ? thisWeek.plannedSeconds : null
  }, [plan, activities])

  // Forma de los últimos 60 días y, si hay carrera cerca, la prevista hasta ese día (en discontinua)
  const chartPoints = useMemo((): ChartPoint[] => {
    const past: ChartPoint[] = history.slice(-60).map(p => ({ date: p.date, ctl: Math.round(p.ctl), atl: Math.round(p.atl) }))
    if (!showRace || !nextRace || past.length === 0) return past
    const last = past[past.length - 1]
    last.ctlP = last.ctl
    last.atlP = last.atl
    const future = projection.filter(p => p.date <= nextRace.date)
      .map(p => ({ date: p.date, ctlP: Math.round(p.ctl), atlP: Math.round(p.atl) }))
    return [...past, ...future]
  }, [history, projection, showRace, nextRace])

  if (loading) return <LoadingScreen />
  if (error || activities.length === 0) return <EmptyScreen />

  const tsb = fitness?.tsb ?? 0
  const form = formState(tsb)
  const maxKm = Math.max(...runVolume.map(w => w.km), 10)
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  const hasProjection = chartPoints.some(p => p.ctlP != null && p.ctl == null)

  const vo2Cell = (className: string, big: boolean) => (
    <div className={`g-cell ${className}`}
      title={vo2 ? `Media de ${vo2.samples} medición(es) de la semana del ${formatWeekRange(vo2.weekStart)}` : undefined}>
      <div className="g-label">VO2max</div>
      <div className={big ? 'font-mono text-[48px] font-medium leading-none mt-4 text-slate-100' : statNumber}>
        {vo2 ? vo2.value.toFixed(1).replace('.', ',') : '–'}
      </div>
      <div className="text-xs text-slate-500 mt-2">
        ml/kg/min · {vo2?.isCurrent ? 'media semanal' : vo2 ? `semana del ${formatWeekRange(vo2.weekStart)}` : 'sin mediciones'}
      </div>
    </div>
  )

  return (
    <div className="page">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-6">
        <h1 className="text-xl font-medium text-slate-100">Resumen</h1>
        <span className="text-xs text-slate-500 first-letter:uppercase">
          {today}
          {stats?.syncedAt && ` · sincronizado el ${new Date(stats.syncedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`}
        </span>
      </div>

      <SettingsHints />
      <ShoeAlert />

      <div className="g-grid">
        {/* Franja «Hoy»: lo que toca (entrenador, tus entrenos o la IA; si nada, recuperación y racha) */}
        <TodayPlan
          className="col-span-12 xl:col-span-6"
          fallback={
            <div className="g-cell col-span-12 xl:col-span-6 border-l-2 border-l-accent">
              <div className="g-label">Hoy · recuperación</div>
              <div className="font-mono text-[48px] font-medium leading-none mt-4 text-slate-100">
                {recovery == null ? '–' : recovery > 0 ? formatDuration(recovery) : 'Recuperado'}
              </div>
              <div className="text-xs text-slate-500 mt-2">
                {recovery ? 'restante (estimado por Suunto)' : 'nada planificado'}{streak > 1 ? ` · racha de ${streak} días` : ''}
              </div>
            </div>
          }
        />

        {/* Forma */}
        <div className="g-cell col-span-12 sm:col-span-6 xl:col-span-3">
          <div className="g-label">Forma</div>
          <div className="flex items-center gap-4 mt-3">
            <FormRing tsb={tsb} color={form.color} />
            <div>
              <div className="text-base font-medium" style={{ color: form.color }}>{form.label}</div>
              <div className="text-xs text-slate-500 mt-1 leading-5">
                Fitness {Math.round(fitness?.ctl ?? 0)}<br />Fatiga {Math.round(fitness?.atl ?? 0)}
              </div>
            </div>
          </div>
        </div>

        {/* Próxima competición como un dorsal: la única placa clara de la pantalla (o, sin carrera, el VO2max) */}
        {nextRace ? (
          <div className="g-cell col-span-12 sm:col-span-6 xl:col-span-3 flex">
            <RaceBib
              name={nextRace.name} priority={nextRace.priority} title={eventLabel(nextRace)}
              daysLeft={raceIn} date={nextRace.date} km={nextRace.distanceKm}
              predicted={racePrediction?.seconds ?? null} raceTsb={raceTsb}
            />
          </div>
        ) : vo2Cell('col-span-12 sm:col-span-6 xl:col-span-3', true)}

        {/* Semana */}
        <div className="g-cell col-span-6 lg:col-span-3">
          <div className="g-label">Distancia esta semana</div>
          <div className={statNumber}>
            {week.distance.toFixed(1).replace('.', ',')} <span className="text-base text-slate-500 font-normal">km</span>
          </div>
          <Delta value={week.distance - lastWeek.distance} unit=" km" digits={1} />
          <div className="text-xs text-slate-500 mt-1">{week.count} {week.count === 1 ? 'sesión' : 'sesiones'}</div>
        </div>
        <div className="g-cell col-span-6 lg:col-span-3">
          <div className="g-label">Tiempo</div>
          <div className={statNumber}>{formatDuration(week.duration)}</div>
          <Delta value={Math.round((week.duration - lastWeek.duration) / 60)} unit=" min" />
          {plannedSeconds != null && (
            <>
              <div className="h-1 mt-3" style={{ background: GREY.track }}>
                <div className="h-1" style={{ background: GREY.strong, width: `${Math.min(week.duration / plannedSeconds * 100, 100)}%` }} />
              </div>
              <div className="text-xs text-slate-500 mt-2">
                {Math.round(week.duration / plannedSeconds * 100)} % de las {formatDuration(plannedSeconds)} planificadas
              </div>
            </>
          )}
        </div>
        <div className="g-cell col-span-6 lg:col-span-3">
          <div className="g-label">Carga</div>
          <div className={statNumber}>{Math.round(week.tss)} <span className="text-base text-slate-500 font-normal">TSS</span></div>
          <Delta value={Math.round(week.tss - lastWeek.tss)} unit=" TSS" />
        </div>
        {nextRace ? vo2Cell('col-span-6 lg:col-span-3', false) : (
          <div className="g-cell col-span-6 lg:col-span-3">
            <div className="g-label">Sesiones</div>
            <div className={statNumber}>{week.count}</div>
            <Delta value={week.count - lastWeek.count} />
          </div>
        )}

        {/* Km por semana: gráfica secundaria, en grises (la semana actual, un gris más claro) */}
        <div className="g-cell col-span-12 xl:col-span-7">
          <div className="flex items-center justify-between">
            <div className="g-label">Km por semana · 12 semanas</div>
            <Link to="/performance" className="text-xs text-slate-500 hover:text-slate-100 transition-colors">Rendimiento →</Link>
          </div>
          <div className="flex items-end gap-2 h-36 mt-4">
            {runVolume.map((w, i) => {
              const current = i === runVolume.length - 1
              return (
                <div key={w.weekStart} className="flex-1 h-full flex flex-col justify-end items-center"
                  title={`${formatWeekRange(w.weekStart)} · ${w.km} km en ${w.runs} salidas`}>
                  <div className={`font-mono text-[11px] mb-1 ${current ? 'text-slate-200' : 'text-slate-500'}`}>{Math.round(w.km)}</div>
                  <div className="w-full" style={{ height: `${Math.max(w.km / maxKm * 84, 1)}%`, background: current ? GREY.strong : GREY.bar }} />
                </div>
              )
            })}
          </div>
        </div>

        {/* Últimas actividades */}
        <div className="g-cell col-span-12 xl:col-span-5">
          <div className="flex items-center justify-between">
            <div className="g-label">Últimas actividades</div>
            <Link to="/activities" className="text-xs text-slate-500 hover:text-slate-100 transition-colors">Ver todas →</Link>
          </div>
          <div className="mt-2">
            {activities.slice(0, 6).map(a => (
              <Link
                key={a.id}
                to={`/activity/${a.id}`}
                className="grid grid-cols-[4.5rem_1fr_auto_3.5rem] gap-3 py-2 border-t border-line text-sm hover:bg-slate-800 transition-colors"
              >
                <span className="text-slate-500">
                  {new Date(a.startTime).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-slate-100 truncate">{a.title.split(' · ')[0]}</span>
                <span className="font-mono text-slate-100 text-right">{a.distance > 0 ? `${a.distance.toFixed(2).replace('.', ',')} km` : formatDuration(a.duration)}</span>
                <span className="font-mono text-slate-500 text-right">{a.avgPace ? formatPace(a.avgPace).replace(' /km', '') : a.avgSpeed ? `${a.avgSpeed}` : '–'}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Forma: la gráfica principal. Fitness en lima; si hay carrera cerca, la prevista hasta ella y su bandera */}
        <div className="g-cell col-span-12">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="g-label">Fitness y fatiga{showRace ? ' · hasta la próxima carrera' : ' · 60 días'}</div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span><span className="inline-block w-3 h-0.5 bg-accent align-middle mr-2" />Fitness (CTL)</span>
              <span><span className="inline-block w-3 h-0.5 bg-slate-400 align-middle mr-2" />Fatiga (ATL)</span>
              {hasProjection && <span><span className="inline-block w-3 border-t border-dashed border-slate-400 align-middle mr-2" />Prevista con lo planificado</span>}
              <Link to="/fitness" className="hover:text-slate-100 transition-colors">Ver completo →</Link>
            </div>
          </div>
          <div className="h-56 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartPoints} margin={{ top: 16, right: 16, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={GREY.line} vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis tick={{ fill: GREY.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#17171a', border: `1px solid ${GREY.track}`, borderRadius: 4, fontSize: 12 }}
                  labelStyle={{ color: GREY.text }}
                  labelFormatter={(d: unknown) => parseLocalDate(String(d)).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
                  formatter={(v: unknown, n: unknown) => [String(v), String(n)]}
                />
                <Line type="monotone" dataKey="ctl" name="Fitness" stroke={ACCENT} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="atl" name="Fatiga" stroke={GREY.text} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                {hasProjection && <>
                  <Line type="monotone" dataKey="ctlP" name="Fitness previsto" stroke={ACCENT} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="atlP" name="Fatiga prevista" stroke={GREY.text} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                </>}
                {hasProjection && <ReferenceLine x={todayIso} stroke={GREY.bar} />}
                {showRace && nextRace && (
                  <ReferenceLine x={nextRace.date} stroke={ACCENT} strokeOpacity={0.6}
                    label={(props: { viewBox?: { x?: number; y?: number } }) => <RaceFlag viewBox={props.viewBox} name={nextRace.name} />} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
