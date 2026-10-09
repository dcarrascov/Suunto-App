import { useMemo, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { calculateFitnessHistory } from '../utils/calculations'
import { formatShortDate } from '../utils/formatters'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend
} from 'recharts'

const RANGES = [
  { label: '3 meses', days: 90 },
  { label: '6 meses', days: 180 },
  { label: '1 año', days: 365 },
  { label: 'Todo', days: Infinity },
]

export default function FitnessChartPage() {
  const activities = useActivityStore(s => s.activities)
  const settings = useActivityStore(s => s.settings)
  const [range, setRange] = useState(180)

  const fitnessHistory = useMemo(
    () => calculateFitnessHistory(activities, settings),
    [activities, settings]
  )

  const data = useMemo(() => {
    if (range === Infinity) return fitnessHistory
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - range)
    const cutStr = cutoff.toISOString().slice(0, 10)
    return fitnessHistory.filter(p => p.date >= cutStr)
  }, [fitnessHistory, range])

  const current = fitnessHistory[fitnessHistory.length - 1]

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Fitness & Forma</h1>
          <p className="text-sm text-slate-500 mt-0.5">Modelo de carga CTL/ATL/TSB</p>
        </div>
        <div className="flex bg-slate-800 rounded-lg p-0.5 gap-0.5">
          {RANGES.map(r => (
            <button
              key={r.days}
              onClick={() => setRange(r.days)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                range === r.days ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {current && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-slate-800/60 border border-blue-500/20 rounded-xl p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Fitness (CTL)</div>
            <div className="text-3xl font-bold text-blue-400 mt-1">{Math.round(current.ctl)}</div>
            <div className="text-xs text-slate-500 mt-1">Carga crónica 42 días</div>
          </div>
          <div className="bg-slate-800/60 border border-orange-500/20 rounded-xl p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Fatiga (ATL)</div>
            <div className="text-3xl font-bold text-orange-400 mt-1">{Math.round(current.atl)}</div>
            <div className="text-xs text-slate-500 mt-1">Carga aguda 7 días</div>
          </div>
          <div className="bg-slate-800/60 border border-green-500/20 rounded-xl p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Forma (TSB)</div>
            <div
              className="text-3xl font-bold mt-1"
              style={{ color: current.tsb > 5 ? '#22c55e' : current.tsb < -20 ? '#ef4444' : current.tsb < -10 ? '#f97316' : '#eab308' }}
            >
              {current.tsb > 0 ? '+' : ''}{Math.round(current.tsb)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {current.tsb > 5 ? '😴 Descansado' : current.tsb > -5 ? '✅ Óptimo' : current.tsb > -20 ? '😓 Fatigado' : '🔴 Muy fatigado'}
            </div>
          </div>
        </div>
      )}

      {data.length > 0 ? (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={d => formatShortDate(d)}
                interval={Math.floor(data.length / 8)}
              />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value: unknown, name: unknown) => [Math.round(Number(value) * 10) / 10, String(name)]}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="ctl" name="Fitness (CTL)" stroke="#3b82f6" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="atl" name="Fatiga (ATL)" stroke="#f97316" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="tsb" name="Forma (TSB)" stroke="#22c55e" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-center py-16 text-slate-500 text-sm">
          No hay suficientes datos para calcular el modelo de carga.
        </div>
      )}

      <div className="mt-6 bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 text-xs text-slate-500 space-y-1">
        <p><span className="text-blue-400">Fitness (CTL)</span> — Media exponencial de 42 días del TSS diario.</p>
        <p><span className="text-orange-400">Fatiga (ATL)</span> — Media exponencial de 7 días. Fatiga acumulada reciente.</p>
        <p><span className="text-green-400">Forma (TSB)</span> = CTL − ATL. Positivo = descansado. Zona óptima de competición: −10 a +5.</p>
      </div>
    </div>
  )
}
