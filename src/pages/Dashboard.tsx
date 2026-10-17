import { Link } from 'react-router-dom'
import type { GlobalStats } from '../types/suunto'
import { weeklyVo2max } from '../utils/calculations'
import { useActivityStore } from '../stores/activityStore'
import { formatDuration, formatPace, sportIcon, sportColor } from '../utils/formatters'
import { daysAgo } from '../utils/date'
import { useFitnessHistory } from '../hooks/useFitnessHistory'
import { useWeekComparison } from '../hooks/useWeekComparison'
import { useSportVolume } from '../hooks/useSportVolume'
import { useTrainingStreak } from '../hooks/useTrainingStreak'
import { useZoneDistribution } from '../hooks/useZoneDistribution'
import { useWeeklyLoad } from '../hooks/useWeeklyLoad'
import RadialProgress from '../components/RadialProgress'
import FormBadge from '../components/FormBadge'
import DeltaBadge from '../components/DeltaBadge'
import TodayPlan from '../components/TodayPlan'
import {
  AreaChart, Area, XAxis, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts'

// ─── Loading / Empty states ───────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-slate-400 animate-pulse text-sm">Cargando...</div>
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

function formatWeekTime(seconds: number): string {
  const totalMin = Math.round(seconds / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

// Segundos de recuperación que quedan: el acumulado tras la última actividad menos el tiempo transcurrido
function recoveryLeft(stats: GlobalStats | null): number | null {
  const r = stats?.recovery
  if (!r) return null
  return Math.max(0, r.seconds - (Date.now() - r.endedAt) / 1000)
}

function formatRecovery(seconds: number): string {
  return seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`
}

function EmptyScreen() {
  return (
    <div className="flex-1 p-8 max-w-2xl">
      <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl p-6">
        <h2 className="text-amber-300 font-medium text-lg mb-2">Sin datos de Suunto</h2>
        <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-300 space-y-1 mt-3">
          <div>suuntool login --email TU_EMAIL</div>
          <div>pip install -r fetch/requirements.txt</div>
          <div>python3 fetch/sync.py --limit 20</div>
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const activities = useActivityStore(s => s.activities)
  const stats = useActivityStore(s => s.stats)
  const loading = useActivityStore(s => s.loading)
  const error = useActivityStore(s => s.error)

  const { current: fitness, sparkPoints } = useFitnessHistory()
  const recovery = recoveryLeft(stats)
  const vo2 = weeklyVo2max(stats?.vo2maxHistory)
  const { current: week, previous: lastWeek } = useWeekComparison()
  const { bySport: sportHours, totalHours, percentages } = useSportVolume(30)
  const streak = useTrainingStreak()
  const { slices: zoneSlices, isAerobicFocused } = useZoneDistribution(30)
  const weeklyLoad = useWeeklyLoad(16)

  if (loading) return <LoadingScreen />
  if (error || activities.length === 0) return <EmptyScreen />

  const tsb = fitness?.tsb ?? 0
  const ctl = fitness?.ctl ?? 0
  const atl = fitness?.atl ?? 0
  const tsbColor = tsb > 10 ? '#22c55e' : tsb > -5 ? '#3b82f6' : tsb > -15 ? '#eab308' : tsb > -25 ? '#f97316' : '#ef4444'
  const maxWeekTSS = Math.max(...weeklyLoad.map(w => w.tss), 1)

  return (
    <div className="flex-1 overflow-y-auto bg-[#080f1e]">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden px-4 md:px-6 pt-7 pb-6"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #0c1a3a 50%, #0f172a 100%)' }}>
        <div className="absolute top-0 left-1/4 w-96 h-48 rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: tsbColor }} />

        {/* Form title row */}
        <div className="flex flex-wrap gap-4 items-start justify-between mb-6">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">Estado de forma</div>
            <div className="flex items-center gap-3">
              <span className="text-4xl font-black" style={{ color: tsbColor, textShadow: `0 0 30px ${tsbColor}66` }}>
                {tsb > 0 ? '+' : ''}{Math.round(tsb)}
              </span>
              <div>
                <FormBadge tsb={tsb} />
                <div className="text-xs text-slate-500 mt-1.5">Forma = Fitness − Fatiga</div>
              </div>
            </div>
          </div>

          {/* VO2max */}
          {vo2 ? (
            <div className="text-right" title={`Media de ${vo2.samples} medición(es) de la semana del ${formatWeekRange(vo2.weekStart)}`}>
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">VO2max</div>
              <div className="text-3xl font-black text-purple-400" style={{ textShadow: '0 0 20px #a855f766' }}>
                {vo2.value.toFixed(1)}
              </div>
              <div className="text-xs text-slate-500">ml/kg/min</div>
              <div className="text-xs text-slate-600 mt-0.5">
                {vo2.isCurrent ? 'media de la semana' : `media · ${formatWeekRange(vo2.weekStart)}`}
              </div>
            </div>
          ) : null}
        </div>

        {/* CTL / ATL radials + streak */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 mb-6">
          <div className="flex items-center gap-3">
            <RadialProgress value={ctl} max={100} color="#3b82f6" size={72} stroke={6}>
              <span className="text-base font-bold text-blue-300">{Math.round(ctl)}</span>
            </RadialProgress>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Fitness</div>
              <div className="text-xs text-slate-400">CTL · 42 días</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <RadialProgress value={atl} max={100} color="#f97316" size={72} stroke={6}>
              <span className="text-base font-bold text-orange-300">{Math.round(atl)}</span>
            </RadialProgress>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Fatiga</div>
              <div className="text-xs text-slate-400">ATL · 7 días</div>
            </div>
          </div>

          {recovery != null && (
            <div className="flex items-center gap-3">
              <RadialProgress value={recovery} max={72 * 3600} color="#14b8a6" size={72} stroke={6}>
                <span className="text-base font-bold text-teal-300">{recovery > 0 ? formatRecovery(recovery) : '✓'}</span>
              </RadialProgress>
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wider">Recuperación</div>
                <div className="text-xs text-slate-400">{recovery > 0 ? 'restante (estimado)' : 'recuperado'}</div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 ml-auto">
            {streak > 1 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border"
                style={{ borderColor: '#f59e0b40', background: '#f59e0b10' }}>
                <span className="text-lg">🔥</span>
                <div>
                  <div className="text-sm font-bold text-amber-400">{streak} días</div>
                  <div className="text-xs text-slate-500">racha activa</div>
                </div>
              </div>
            )}
            <div className="text-right">
              <div className="text-xs text-slate-500">{stats?.totalActivities ?? activities.length} actividades</div>
              {stats?.syncedAt && (
                <div className="text-xs text-slate-600">
                  Sync: {new Date(stats.syncedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Fitness sparkline */}
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkPoints} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="gCTL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gATL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                formatter={(v: unknown, n: unknown) => [String(v), String(n)]}
              />
              <Area type="monotone" dataKey="ctl" name="Fitness" stroke="#3b82f6" strokeWidth={2} fill="url(#gCTL)" dot={false} />
              <Area type="monotone" dataKey="atl" name="Fatiga" stroke="#f97316" strokeWidth={1.5} fill="url(#gATL)" dot={false} strokeDasharray="3 2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-4 mt-1">
          <LegendDot color="#3b82f6" label="Fitness (CTL)" />
          <LegendDot color="#f97316" label="Fatiga (ATL)" />
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="px-4 md:px-6 py-5 space-y-5">

        {/* Entreno de hoy según TrainingPeaks (solo si hay plan) */}
        <TodayPlan />

        {/* Week comparison */}
        <section>
          <SectionHeader left="Esta semana" right="vs semana anterior" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Sesiones',    value: week.count,            prev: lastWeek.count,            fmt: (v: number) => String(v),              unit: '' },
              { label: 'Distancia',   value: week.distance,         prev: lastWeek.distance,         fmt: (v: number) => v.toFixed(1),           unit: 'km' },
              { label: 'Tiempo',      value: week.duration / 3600,  prev: lastWeek.duration / 3600,  fmt: (v: number) => v.toFixed(1),           unit: 'h' },
              { label: 'Carga (TSS)', value: week.tss,              prev: lastWeek.tss,              fmt: (v: number) => Math.round(v).toString(), unit: '' },
            ].map(({ label, value, prev, fmt, unit }) => (
              <div key={label} className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-4 hover:border-slate-600/60 transition-colors">
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">{label}</div>
                <div className="text-2xl font-bold text-slate-100 mb-1">
                  {fmt(value)}<span className="text-sm text-slate-500 ml-1">{unit}</span>
                </div>
                <DeltaBadge value={value - prev} unit={unit ? ` ${unit}` : ''} />
              </div>
            ))}
          </div>
        </section>

        {/* Sport rings + Zone radar */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-5">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-4">Volumen · últimos 30 días</div>
            <div className="flex items-center justify-around">
              {([
                { sport: 'running' as const,  label: 'Running',  color: '#ef4444', max: 20 },
                { sport: 'cycling' as const,  label: 'Ciclismo', color: '#f97316', max: 30 },
                { sport: 'swimming' as const, label: 'Natación', color: '#3b82f6', max: 8  },
              ]).map(({ sport, label, color, max }) => (
                <div key={sport} className="flex flex-col items-center gap-2">
                  <RadialProgress value={sportHours[sport].hours} max={max} color={color} size={80} stroke={7}>
                    <div className="text-center">
                      <div className="text-sm font-bold" style={{ color }}>{sportHours[sport].hours.toFixed(1)}</div>
                      <div className="text-xs text-slate-600">h</div>
                    </div>
                  </RadialProgress>
                  <div className="text-center">
                    <div className="text-xs font-medium text-slate-300">{sportIcon(sport)} {label}</div>
                    <div className="text-xs text-slate-600">de {max}h ref.</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-700/50 text-xs text-slate-500 text-center">
              Total: <span className="text-slate-300 font-medium">{totalHours.toFixed(1)}h</span>
              {totalHours > 0 && (
                <> · R {Math.round(percentages.running)}% · C {Math.round(percentages.cycling)}% · N {Math.round(percentages.swimming)}%</>
              )}
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-5">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Zonas FC · 30 días</div>
            <div className="text-xs mb-2" style={{ color: isAerobicFocused ? '#22c55e' : '#eab308' }}>
              {isAerobicFocused ? '✅ Buena base aeróbica (Z1+Z2 >60%)' : '⚠️ Añade más entrenamiento en Z1–Z2'}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <RadarChart data={zoneSlices} margin={{ top: 0, right: 20, bottom: 0, left: 20 }}>
                <PolarGrid stroke="#334155" />
                <PolarAngleAxis dataKey="zone" tick={{ fill: '#64748b', fontSize: 10 }} />
                <Radar dataKey="pct" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={1.5} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: unknown) => [`${v}%`, 'Tiempo']}
                />
              </RadarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {zoneSlices.map(z => (
                <span key={z.zone} className="text-xs" style={{ color: z.color }}>{z.zone} {z.pct}%</span>
              ))}
            </div>
          </div>
        </div>

        {/* Weekly TSS bar chart */}
        <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-5">
          <SectionHeader left="Carga semanal (TSS) · 16 semanas" rightLink={{ to: '/fitness', label: 'Ver completo →' }} />
          <div className="flex items-end gap-1 h-20">
            {weeklyLoad.map((w, i) => {
              const isCurrentWeek = i === weeklyLoad.length - 1
              // las barras de los extremos alinean el tooltip hacia dentro para que no se salga de la tarjeta
              const align = i < 4 ? 'left-0' : i >= weeklyLoad.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2'
              return (
                <div key={w.weekStart} className="group relative flex-1 h-full flex flex-col justify-end items-center">
                  <div
                    role="tooltip"
                    className={`pointer-events-none absolute bottom-full mb-2 hidden group-hover:block z-20 min-w-44 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 shadow-xl ${align}`}
                  >
                    <div className="text-xs font-semibold text-slate-200 whitespace-nowrap">
                      {formatWeekRange(w.weekStart)}{isCurrentWeek ? ' · esta semana' : ''}
                    </div>
                    <div className="mt-1 space-y-0.5 text-xs text-slate-400 tabular-nums whitespace-nowrap">
                      <div className="flex justify-between gap-4"><span>Distancia</span><span className="font-medium text-slate-100">{w.distance.toFixed(1)} km</span></div>
                      <div className="flex justify-between gap-4"><span>Tiempo</span><span className="font-medium text-slate-100">{formatWeekTime(w.duration)}</span></div>
                      <div className="flex justify-between gap-4"><span>Carga</span><span className="font-medium text-slate-100">{w.tss} TSS</span></div>
                    </div>
                  </div>
                  <div
                    className="w-full rounded-t transition-all group-hover:brightness-125"
                    style={{
                      height: `${Math.max((w.tss / maxWeekTSS) * 100, 2)}%`,
                      background: isCurrentWeek ? 'linear-gradient(to top, #3b82f6, #60a5fa)' : '#334155',
                      boxShadow: isCurrentWeek ? '0 0 8px #3b82f660' : 'none',
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-slate-600">{weeklyLoad[0]?.week}</span>
            <span className="text-xs text-blue-400 font-medium">
              esta semana {week.tss > 0 ? `${Math.round(week.tss)} TSS` : ''}
            </span>
          </div>
        </div>

        {/* Recent activities */}
        <section>
          <SectionHeader left="Últimas actividades" rightLink={{ to: '/activities', label: 'Ver todas →' }} />
          <div className="space-y-2">
            {activities.slice(0, 6).map(a => (
              <Link
                key={a.id}
                to={`/activity/${a.id}`}
                className="flex items-center gap-4 px-4 py-3 rounded-xl border border-slate-700/40 bg-slate-800/30 hover:bg-slate-800/70 hover:border-slate-600/50 transition-all group"
              >
                <div className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: sportColor(a.sport), boxShadow: `0 0 6px ${sportColor(a.sport)}88` }} />

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-200 truncate group-hover:text-white">{a.title}</div>
                  <div className="text-xs text-slate-500">
                    {(d => d === 0 ? 'Hoy' : d === 1 ? 'Ayer' : `Hace ${d}d`)(daysAgo(a.startTime))}
                    {' · '}{sportIcon(a.sport)}
                  </div>
                </div>

                <div className="flex items-center gap-5 shrink-0 text-right">
                  {a.distance > 0 && (
                    <div>
                      <div className="text-sm font-bold text-slate-200">
                        {a.distance.toFixed(1)}<span className="text-xs text-slate-500 ml-0.5">km</span>
                      </div>
                      {a.avgPace && <div className="text-xs text-slate-500">{formatPace(a.avgPace)}</div>}
                      {a.avgSpeed && !a.avgPace && <div className="text-xs text-slate-500">{a.avgSpeed.toFixed(1)} km/h</div>}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-bold text-slate-200">{formatDuration(a.duration)}</div>
                    {a.avgHR > 0 && <div className="text-xs text-slate-500">{a.avgHR} bpm</div>}
                  </div>
                  {a.tss != null && (
                    <div className="w-10 text-right">
                      <div className="text-sm font-bold" style={{ color: sportColor(a.sport) }}>{Math.round(a.tss)}</div>
                      <div className="text-xs text-slate-600">TSS</div>
                    </div>
                  )}
                  <div className="text-slate-600 group-hover:text-slate-400 text-xs">→</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <div className="h-2" />
      </div>
    </div>
  )
}

// ─── Shared layout helpers ────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className="w-3 h-0.5 rounded inline-block" style={{ background: color }} />
      {label}
    </span>
  )
}

function SectionHeader({
  left,
  right,
  rightLink,
}: {
  left: string
  right?: string
  rightLink?: { to: string; label: string }
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="text-xs text-slate-500 uppercase tracking-widest">{left}</div>
      {right && <div className="text-xs text-slate-600">{right}</div>}
      {rightLink && (
        <Link to={rightLink.to} className="text-xs text-blue-400 hover:text-blue-300">{rightLink.label}</Link>
      )}
    </div>
  )
}
