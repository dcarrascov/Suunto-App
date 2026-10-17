import { useMemo, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import type { Sport } from '../types/suunto'
import { HR_ZONE_DEFS, intensitySplit, localWeekStart, zoneSecondsFor } from '../utils/calculations'
import { isoDateOffset, parseLocalDate, toLocalISODate } from '../utils/date'
import { formatDuration } from '../utils/formatters'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const INTENSITY = [
  { key: 'low', name: 'Suave (Z1-Z2)', color: '#22c55e' },
  { key: 'mid', name: 'Medio (Z3)', color: '#eab308' },
  { key: 'high', name: 'Intenso (Z4-Z5)', color: '#ef4444' },
] as const
const INTENSITY_WEEKS = 12

export default function ZoneAnalysis() {
  const activities = useActivityStore(s => s.activities)
  const settings = useActivityStore(s => s.settings)
  const [sport, setSport] = useState<Sport | 'all'>('all')

  const filtered = useMemo(() =>
    activities.filter(a => sport === 'all' || a.sport === sport),
    [activities, sport]
  )

  const zoneSeconds = useMemo(() => {
    const totals: number[] = [0, 0, 0, 0, 0]
    for (const act of filtered) {
      zoneSecondsFor(act, settings.maxHR).seconds.forEach((sec, i) => { totals[i] += sec })
    }
    return totals
  }, [filtered, settings.maxHR])

  const totalSeconds = zoneSeconds.reduce((a, b) => a + b, 0)
  const realShare = filtered.length
    ? Math.round(filtered.filter(a => zoneSecondsFor(a, settings.maxHR).real).length / filtered.length * 100)
    : 0

  // 80/20 de carrera: % del tiempo suave / medio / intenso por semana (también las semanas sin carreras)
  const intensity = useMemo(() => {
    const runs = activities.filter(a => a.sport === 'running')
    const monday = parseLocalDate(localWeekStart(new Date()))
    monday.setDate(monday.getDate() - 7 * (INTENSITY_WEEKS - 1))
    const start = toLocalISODate(monday)
    const byWeek: Record<string, typeof runs> = {}
    for (let i = 0; i < INTENSITY_WEEKS; i++) {
      byWeek[toLocalISODate(monday)] = []
      monday.setDate(monday.getDate() + 7)
    }
    for (const a of runs) {
      if (a.startTime.slice(0, 10) < start) continue
      byWeek[localWeekStart(new Date(a.startTime))]?.push(a)
    }
    const weeks = Object.entries(byWeek).map(([week, acts]) => {
      const sp = intensitySplit(acts, settings.maxHR)
      const tot = sp.low + sp.mid + sp.high
      const pct = (v: number) => (tot ? Math.round(v / tot * 100) : 0)
      return { week: week.slice(5), low: pct(sp.low), mid: pct(sp.mid), high: pct(sp.high), hours: +(tot / 3600).toFixed(1) }
    })
    const last4 = intensitySplit(runs.filter(a => a.startTime.slice(0, 10) >= isoDateOffset(28)), settings.maxHR)
    const tot4 = last4.low + last4.mid + last4.high
    const lowPct4 = tot4 ? Math.round(last4.low / tot4 * 100) : null
    const midPct4 = tot4 ? Math.round(last4.mid / tot4 * 100) : null
    return { weeks, lowPct4, midPct4 }
  }, [activities, settings.maxHR])

  const weeklyZoneData = useMemo(() => {
    const weeks: Record<string, number[]> = {}
    for (const act of filtered) {
      const weekKey = localWeekStart(new Date(act.startTime))
      if (!weeks[weekKey]) weeks[weekKey] = [0, 0, 0, 0, 0]
      zoneSecondsFor(act, settings.maxHR).seconds.forEach((sec, i) => { weeks[weekKey][i] += sec / 3600 })
    }
    return Object.entries(weeks)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-24)
      .map(([date, zones]) => ({
        date: date.slice(5),
        z1: +zones[0].toFixed(2),
        z2: +zones[1].toFixed(2),
        z3: +zones[2].toFixed(2),
        z4: +zones[3].toFixed(2),
        z5: +zones[4].toFixed(2),
      }))
  }, [filtered, settings.maxHR])

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto">
      <div className="flex flex-wrap gap-3 items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Análisis de Zonas</h1>
          <p className="text-sm text-slate-500 mt-0.5">Distribución del tiempo por zonas de FC</p>
        </div>
        <div className="flex bg-slate-800 rounded-lg p-0.5 gap-0.5">
          {(['all', 'running', 'cycling', 'swimming'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSport(s)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                sport === s ? 'bg-accent text-black font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s === 'all' ? 'Todos' : s === 'running' ? 'Carrera' : s === 'cycling' ? 'Bici' : 'Natación'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 mb-8">
        {HR_ZONE_DEFS.map((def, i) => {
          const pct = totalSeconds > 0 ? (zoneSeconds[i] / totalSeconds) * 100 : 0
          return (
            <div key={def.zone} className="flex items-center gap-4">
              <div className="w-6 text-xs font-medium" style={{ color: def.color }}>Z{def.zone}</div>
              <div className="w-24 text-xs text-slate-400">{def.name}</div>
              <div className="flex-1 bg-slate-800 rounded-full h-3">
                <div
                  className="h-3 rounded-full transition-all"
                  style={{ width: `${pct}%`, background: def.color }}
                />
              </div>
              <div className="w-16 text-xs text-slate-300 text-right font-mono">{formatDuration(zoneSeconds[i])}</div>
              <div className="w-10 text-xs text-slate-500 text-right">{pct.toFixed(0)}%</div>
            </div>
          )
        })}
      </div>

      {/* 80/20 */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <div className="text-sm font-medium text-slate-200">Distribución de intensidad (carrera, 80/20)</div>
          {intensity.lowPct4 != null && (
            <div className={`text-xs ${intensity.lowPct4 >= 75 ? 'text-green-400' : intensity.lowPct4 >= 65 ? 'text-yellow-400' : 'text-red-400'}`}>
              Últimas 4 semanas: {intensity.lowPct4}% suave · {intensity.midPct4}% medio
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Lo recomendable es ~80 % del tiempo en suave y poco en zona media (Z3), que cansa sin dar el estímulo de las series.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={intensity.weeks} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#26262b" />
            <XAxis dataKey="week" tick={{ fill: '#77777d', fontSize: 10 }} />
            <YAxis tick={{ fill: '#77777d', fontSize: 10 }} unit="%" domain={[0, 100]} width={40} />
            <Tooltip
              contentStyle={{ background: '#17171a', border: '1px solid #26262b', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#a3a3a8' }}
              formatter={(v: unknown, n: unknown) => [`${v}%`, String(n)]}
            />
            <ReferenceLine y={80} stroke="#e2e8f0" strokeDasharray="4 2" strokeOpacity={0.6} />
            {INTENSITY.map(it => (
              <Bar key={it.key} dataKey={it.key} name={it.name} stackId="i" fill={it.color} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-3 mt-2">
          {INTENSITY.map(it => <span key={it.key} className="text-xs" style={{ color: it.color }}>■ {it.name}</span>)}
          <span className="text-xs text-slate-500">— línea = 80 %</span>
        </div>
      </div>

      {weeklyZoneData.length > 0 && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-4">Distribución semanal (últimas 24 semanas)</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={weeklyZoneData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#26262b" />
              <XAxis dataKey="date" tick={{ fill: '#77777d', fontSize: 10 }} />
              <YAxis tick={{ fill: '#77777d', fontSize: 10 }} unit="h" />
              <Tooltip
                contentStyle={{ background: '#17171a', border: '1px solid #26262b', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#a3a3a8' }}
                formatter={(v: unknown) => [`${Number(v).toFixed(1)}h`]}
              />
              {HR_ZONE_DEFS.map(def => (
                <Bar key={def.zone} dataKey={`z${def.zone}`} name={def.name} stackId="a" fill={def.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-600">
        Tiempo por zona según el reloj (zonas de tu Suunto) en el {realShare}% de las actividades;
        el resto se estima con la FC media y la FCmax configurada ({settings.maxHR} bpm).
      </p>
    </div>
  )
}
