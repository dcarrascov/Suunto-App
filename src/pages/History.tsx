import { useMemo, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { monthlyKm, yearTotals } from '../utils/calculations'
import { formatDuration } from '../utils/formatters'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function Delta({ now, before, unit = '' }: { now: number; before: number; unit?: string }) {
  if (!before) return null
  const diff = now - before
  const pct = Math.round(diff / before * 100)
  return (
    <span className={`text-xs ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
      {diff >= 0 ? '+' : ''}{Math.round(diff)}{unit} ({pct >= 0 ? '+' : ''}{pct}%)
    </span>
  )
}

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-100 font-mono">{value}</div>
      {children}
    </div>
  )
}

export default function History() {
  const allActivities = useActivityStore(s => s.activities)
  const [onlyRunning, setOnlyRunning] = useState(true)
  const activities = useMemo(
    () => (onlyRunning ? allActivities.filter(a => a.sport === 'running') : allActivities),
    [allActivities, onlyRunning],
  )

  const thisYear = new Date().getFullYear()
  const [chartYear, setChartYear] = useState(thisYear)

  const years = useMemo(() => {
    const ys = new Set(activities.map(a => Number(a.startTime.slice(0, 4))))
    return [...ys].sort((a, b) => b - a)
  }, [activities])

  // Totales del año completo y hasta el mismo día del año que hoy (para comparar)
  const totals = useMemo(
    () => new Map(years.map(y => [y, yearTotals(activities, y)])),
    [activities, years],
  )

  const chartData = useMemo(() => {
    const cur = monthlyKm(activities, chartYear)
    const prev = monthlyKm(activities, chartYear - 1)
    return MONTHS.map((m, i) => ({ month: m, [chartYear]: cur[i], [chartYear - 1]: prev[i] }))
  }, [activities, chartYear])

  if (allActivities.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Sin datos. Ejecuta el script de sync primero.
      </div>
    )
  }

  const cur = totals.get(thisYear)
  const prev = totals.get(thisYear - 1)

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto">
      <div className="flex flex-wrap gap-3 items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Historial</h1>
          <p className="text-sm text-slate-500 mt-0.5">Totales por año y mes, comparados con el año anterior</p>
        </div>
        <div className="flex bg-slate-800 rounded-lg p-0.5 gap-0.5">
          {[true, false].map(v => (
            <button
              key={String(v)}
              onClick={() => setOnlyRunning(v)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                onlyRunning === v ? 'bg-accent text-black font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v ? 'Carrera' : 'Todo'}
            </button>
          ))}
        </div>
      </div>

      {/* Este año frente al anterior a la misma fecha */}
      {cur && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 mb-4">
          <div className="text-sm font-medium text-slate-200">{thisYear} hasta hoy</div>
          <div className="text-xs text-slate-500 mb-4">
            {prev ? `Comparado con ${thisYear - 1} a estas alturas del año` : 'Sin datos del año anterior para comparar'}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Distancia" value={`${Math.round(cur.toDate.km)} km`}>
              {prev && <Delta now={cur.toDate.km} before={prev.toDate.km} unit=" km" />}
            </Stat>
            <Stat label="Tiempo" value={formatDuration(cur.toDate.seconds)}>
              {prev && <Delta now={cur.toDate.seconds / 3600} before={prev.toDate.seconds / 3600} unit=" h" />}
            </Stat>
            <Stat label="Salidas" value={String(cur.toDate.runs)}>
              {prev && <Delta now={cur.toDate.runs} before={prev.toDate.runs} />}
            </Stat>
            <Stat label="Desnivel +" value={`${Math.round(cur.toDate.elevation)} m`}>
              {prev && <Delta now={cur.toDate.elevation} before={prev.toDate.elevation} unit=" m" />}
            </Stat>
          </div>
        </div>
      )}

      {/* Km por mes */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="text-sm font-medium text-slate-200">Km por mes</div>
          <select
            value={chartYear}
            onChange={e => setChartYear(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300"
          >
            {years.map(y => <option key={y} value={y}>{y} vs {y - 1}</option>)}
          </select>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#26262b" />
            <XAxis dataKey="month" tick={{ fill: '#77777d', fontSize: 10 }} />
            <YAxis tick={{ fill: '#77777d', fontSize: 10 }} width={40} />
            <Tooltip
              contentStyle={{ background: '#17171a', border: '1px solid #26262b', borderRadius: 8, fontSize: 11 }}
              formatter={(v: unknown, n: unknown) => [`${v} km`, String(n)]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey={String(chartYear - 1)} fill="#3a3a40" radius={[3, 3, 0, 0]} />
            <Bar dataKey={String(chartYear)} fill="#c5f23c" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tabla por años */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 overflow-x-auto">
        <div className="text-sm font-medium text-slate-200 mb-3">Por año</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
              <th className="pb-2 pr-4">Año</th>
              <th className="pb-2 pr-4">Distancia</th>
              <th className="pb-2 pr-4">Tiempo</th>
              <th className="pb-2 pr-4">Salidas</th>
              <th className="pb-2 pr-4">Km/salida</th>
              <th className="pb-2">Desnivel +</th>
            </tr>
          </thead>
          <tbody>
            {years.map(y => {
              const t = totals.get(y)!.full
              return (
                <tr key={y} className="border-b border-slate-800/60">
                  <td className="py-2 pr-4 font-medium text-slate-200">
                    {y}{y === thisYear && <span className="text-xs text-slate-500"> (en curso)</span>}
                  </td>
                  <td className="py-2 pr-4 font-mono text-slate-200">{Math.round(t.km)} km</td>
                  <td className="py-2 pr-4 font-mono text-slate-400">{formatDuration(t.seconds)}</td>
                  <td className="py-2 pr-4 text-slate-400">{t.runs}</td>
                  <td className="py-2 pr-4 text-slate-400">{t.runs ? (t.km / t.runs).toFixed(1) : '–'}</td>
                  <td className="py-2 text-slate-400">{Math.round(t.elevation)} m</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
