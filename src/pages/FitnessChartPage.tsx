import { useMemo, useState } from 'react'
import { formatShortDate } from '../utils/formatters'
import { isoDateOffset, toLocalISODate } from '../utils/date'
import { useFitnessProjection } from '../hooks/useFitnessProjection'
import { useActivityStore } from '../stores/activityStore'
import { formState } from '../utils/calculations'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts'

const RANGES = [
  { label: '3 meses', days: 90 },
  { label: '6 meses', days: 180 },
  { label: '1 año', days: 365 },
  { label: 'Todo', days: Infinity },
]

const formLabel = (tsb: number) => formState(tsb).label
const formColor = (tsb: number) => formState(tsb).color

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`

export default function FitnessChartPage() {
  const { history, projection, nextRaceDate } = useFitnessProjection()
  const plan = useActivityStore(s => s.plan)
  const nextRaceName = nextRaceDate ? (plan?.events ?? []).find(e => e.date === nextRaceDate)?.name ?? null : null
  const [range, setRange] = useState(180)
  const today = toLocalISODate(new Date())

  // Lo real (ctl/atl/tsb) y lo previsto (…P), unidos en el punto de hoy para que las líneas se toquen
  const data = useMemo(() => {
    const cut = range === Infinity ? '' : isoDateOffset(range)
    const past = history.filter(p => p.date >= cut).map(p => ({ ...p, ctlP: null as number | null, atlP: null as number | null, tsbP: null as number | null }))
    const last = past.at(-1)
    if (last && projection.length) Object.assign(last, { ctlP: last.ctl, atlP: last.atl, tsbP: last.tsb })
    const future = projection.map(p => ({ date: p.date, tss: p.tss, ctl: null, atl: null, tsb: null, ctlP: p.ctl, atlP: p.atl, tsbP: p.tsb }))
    return [...past, ...future]
  }, [history, projection, range])

  const current = history.at(-1)
  const raceDay = nextRaceDate ? projection.find(p => p.date === nextRaceDate) ?? (nextRaceDate === today ? current : undefined) : undefined
  const end = projection.at(-1)

  return (
    <div className="flex-1 p-4 md:px-10 md:py-8 overflow-y-auto">
      <div className="flex flex-wrap gap-3 items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Forma</h1>
          <p className="text-sm text-slate-500 mt-0.5">Fitness, fatiga y forma (CTL / ATL / TSB), con la previsión de tu plan</p>
        </div>
        <div className="flex bg-slate-800 p-0.5 gap-0.5">
          {RANGES.map(r => (
            <button
              key={r.days}
              onClick={() => setRange(r.days)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                range === r.days ? 'bg-accent text-black font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {current && (
        <div className="g-grid mb-6">
          <div className="g-cell col-span-6 lg:col-span-3">
            <div className="g-label">Fitness (CTL)</div>
            <div className="text-[34px] font-semibold text-accent mt-2">{Math.round(current.ctl)}</div>
            <div className="text-xs text-slate-500">carga crónica · 42 días</div>
          </div>
          <div className="g-cell col-span-6 lg:col-span-3">
            <div className="g-label">Fatiga (ATL)</div>
            <div className="text-[34px] font-semibold text-slate-200 mt-2">{Math.round(current.atl)}</div>
            <div className="text-xs text-slate-500">carga aguda · 7 días</div>
          </div>
          <div className="g-cell col-span-6 lg:col-span-3">
            <div className="g-label">Forma hoy (TSB)</div>
            <div className="text-[34px] font-semibold mt-2" style={{ color: formColor(current.tsb) }}>{signed(current.tsb)}</div>
            <div className="text-xs text-slate-500">{formLabel(current.tsb)}</div>
          </div>
          <div className="g-cell col-span-6 lg:col-span-3">
            {raceDay && nextRaceDate ? (
              <>
                <div className="g-label">Forma prevista · {nextRaceName ?? 'competición'}</div>
                <div className="text-[34px] font-semibold mt-2" style={{ color: formColor(raceDay.tsb) }}>{signed(raceDay.tsb)}</div>
                <div className="text-xs text-slate-500 first-letter:uppercase">{dayLabel(nextRaceDate)} · {formLabel(raceDay.tsb)}</div>
              </>
            ) : end ? (
              <>
                <div className="g-label">Forma prevista · fin del plan</div>
                <div className="text-[34px] font-semibold mt-2" style={{ color: formColor(end.tsb) }}>{signed(end.tsb)}</div>
                <div className="text-xs text-slate-500 first-letter:uppercase">{dayLabel(end.date)} · {formLabel(end.tsb)}</div>
              </>
            ) : (
              <>
                <div className="g-label">Forma prevista</div>
                <div className="text-sm text-slate-500 mt-3">Sincroniza TrainingPeaks (tp_sync.py) para ver la previsión con tu plan.</div>
              </>
            )}
          </div>
        </div>
      )}

      {data.length > 0 ? (
        <div className="g-cell border border-line">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500 mb-3">
            <span><span className="inline-block w-4 h-0.5 bg-accent align-middle mr-1.5" />Fitness</span>
            <span><span className="inline-block w-4 h-0.5 bg-slate-400 align-middle mr-1.5" />Fatiga</span>
            <span><span className="inline-block w-4 h-0.5 align-middle mr-1.5" style={{ background: '#fb923c' }} />Forma</span>
            {projection.length > 0 && <span className="text-slate-400">- - - previsión con el plan de tu entrenador</span>}
          </div>
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: -10 }}>
              <CartesianGrid stroke="#222226" vertical={false} />
              {/* zona de forma ideal para competir */}
              <ReferenceArea y1={-10} y2={5} fill="#c5f23c" fillOpacity={0.04} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#77777d', fontSize: 11 }}
                tickFormatter={d => formatShortDate(d)}
                interval={Math.max(Math.floor(data.length / 8), 0)}
              />
              <YAxis tick={{ fill: '#77777d', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#17171a', border: '1px solid #2a2a2f', borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: '#a3a3a8' }}
                labelFormatter={(d: unknown) => `${formatShortDate(String(d))}${String(d) > today ? ' · previsto' : ''}`}
                formatter={(value: unknown, name: unknown) => [Math.round(Number(value) * 10) / 10, String(name)]}
              />
              <ReferenceLine y={0} stroke="#3a3a40" />
              {/* «hoy» sin texto si la previsión es corta: se pisaría con la etiqueta de la competición */}
              {projection.length > 0 && (
                <ReferenceLine x={today} stroke="#5a5a60"
                  label={projection.length > 7 ? { value: 'hoy', fill: '#77777d', fontSize: 10, position: 'insideTopLeft' } : undefined} />
              )}
              {nextRaceDate && nextRaceDate > today && (
                <ReferenceLine x={nextRaceDate} stroke="#c5f23c" strokeDasharray="2 3"
                  label={{ value: nextRaceName ?? 'competición', fill: '#c5f23c', fontSize: 10, position: 'insideTopLeft' }} />
              )}
              <Line type="monotone" dataKey="ctl" name="Fitness (CTL)" stroke="#c5f23c" dot={false} strokeWidth={2} connectNulls={false} />
              <Line type="monotone" dataKey="atl" name="Fatiga (ATL)" stroke="#a3a3a8" dot={false} strokeWidth={1.5} connectNulls={false} />
              <Line type="monotone" dataKey="tsb" name="Forma (TSB)" stroke="#fb923c" dot={false} strokeWidth={1.5} connectNulls={false} />
              <Line type="monotone" dataKey="ctlP" name="Fitness previsto" stroke="#c5f23c" dot={false} strokeWidth={2} strokeDasharray="5 4" />
              <Line type="monotone" dataKey="atlP" name="Fatiga prevista" stroke="#a3a3a8" dot={false} strokeWidth={1.5} strokeDasharray="5 4" />
              <Line type="monotone" dataKey="tsbP" name="Forma prevista" stroke="#fb923c" dot={false} strokeWidth={1.5} strokeDasharray="5 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-center py-16 text-slate-500 text-sm">
          No hay suficientes datos para calcular el modelo de carga.
        </div>
      )}

      <div className="mt-6 text-xs text-slate-500 space-y-1">
        <p><span className="text-accent">Fitness (CTL)</span>: media exponencial de 42 días del TSS diario.</p>
        <p><span className="text-slate-300">Fatiga (ATL)</span>: media exponencial de 7 días; fatiga acumulada reciente.</p>
        <p><span style={{ color: '#fb923c' }}>Forma (TSB)</span> = CTL − ATL. Positivo = descansado. Banda marcada (−10 a +5): forma típica para competir.</p>
        <p>La previsión usa el TSS planificado de cada entreno de TrainingPeaks; los días sin plan cuentan como descanso.</p>
      </div>
    </div>
  )
}
