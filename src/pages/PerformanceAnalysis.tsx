import { formatDuration } from '../utils/formatters'
import {
  useAerobicEfficiency,
  useRunningVolume,
  useCadenceData,
  useVo2maxTrend,
  useConsistencyHeatmap,
} from '../hooks/usePerformanceData'
import { useWeeklyLoad } from '../hooks/useWeeklyLoad'
import { useActivityStore } from '../stores/activityStore'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, ScatterChart, Scatter, ComposedChart,
  ReferenceLine, ReferenceArea, Cell,
} from 'recharts'

const RAMP_COLOR: Record<string, string> = { ok: '#3b82f6', warn: '#eab308', high: '#ef4444' }

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
      <div className="mb-4">
        <div className="text-sm font-medium text-slate-200">{title}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

// ─── Insight chip ─────────────────────────────────────────────────────────────
function Insight({ label, color }: { label: string; color: string }) {
  return (
    <div className="text-xs px-2.5 py-1 rounded-full border"
      style={{ borderColor: color + '40', background: color + '12', color }}>
      {label}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PerformanceAnalysis() {
  const activities = useActivityStore(s => s.activities)

  const { data: efData, trendPct: efTrend } = useAerobicEfficiency()
  const runVolume = useRunningVolume(12)
  const cadenceData = useCadenceData()
  const { points: vo2Points, current: currentVo2 } = useVo2maxTrend()
  const weeklyLoad = useWeeklyLoad(16)
  const heatmap = useConsistencyHeatmap(28)

  const avgWeeklyTSS = weeklyLoad.length
    ? Math.round(weeklyLoad.slice(-8).reduce((s, w) => s + w.tss, 0) / Math.min(weeklyLoad.length, 8))
    : 0

  const vo2Label = currentVo2
    ? currentVo2 >= 60 ? 'Elite' : currentVo2 >= 55 ? 'Excelente' : currentVo2 >= 48 ? 'Buena' : currentVo2 >= 42 ? 'Moderada' : 'Mejorable'
    : null

  const thisWeek = runVolume.at(-1)
  const hasBikeEF = efData.some(d => d.bike != null)
  const hasCross = heatmap.cross.some(h => h > 0)

  const insights = deriveInsights({ runVolume, efTrend, weeklyLoad, heatmap, cadenceData })

  if (activities.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Sin datos. Ejecuta el script de sync primero.
      </div>
    )
  }

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <h1 className="text-xl font-bold text-slate-100 mb-1">Análisis de Rendimiento</h1>
      <p className="text-sm text-slate-500 mb-5">Forma física, puntos de mejora y estado actual</p>

      {insights.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {insights.map((ins, i) => <Insight key={i} label={ins.text} color={ins.color} />)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">

        {/* 1 · Aerobic Efficiency */}
        <Section
          title="Eficiencia Aeróbica"
          sub={efTrend != null
            ? `Running: ${efTrend > 0 ? '+' : ''}${efTrend}% en 12 meses`
            : 'Velocidad / FC — sube = mejor base aeróbica'}
        >
          {efData.some(d => d.run || d.bike) ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={efData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} width={36} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: unknown, n: unknown) => [Number(v).toFixed(2), String(n)]}
                />
                <Line type="monotone" dataKey="run"  name="Running EF" stroke="#ef4444" dot={{ r: 3 }} strokeWidth={2} connectNulls />
                {hasBikeEF && (
                  <Line type="monotone" dataKey="bike" name="Cycling EF" stroke="#f97316" dot={{ r: 3 }} strokeWidth={2} connectNulls />
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="Sin datos suficientes" />
          )}
          <p className="text-xs text-slate-600 mt-2">
            Running: km/h ÷ bpm × 100.{hasBikeEF && ' Cycling: W ÷ bpm.'} Sube = mejoras.
          </p>
        </Section>

        {/* 2 · Running Volume */}
        <Section
          title="Volumen de Carrera (12 semanas)"
          sub={thisWeek
            ? `Esta semana: ${thisWeek.km} km en ${thisWeek.runs} salidas`
              + (thisWeek.baseKm != null ? ` · media 4 semanas previas: ${thisWeek.baseKm} km` : '')
            : 'Km por semana y tirada larga'}
        >
          {runVolume.some(w => w.km > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={runVolume} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="week" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} width={36} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: unknown, n: unknown) => [`${v} km`, String(n)]}
                />
                <Bar dataKey="km" name="Km semana" radius={[3, 3, 0, 0]}>
                  {runVolume.map((w, i) => (
                    <Cell key={i} fill={RAMP_COLOR[w.riskLevel]} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="longRun" name="Tirada larga" stroke="#a855f7" dot={{ r: 2 }} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="Sin carreras en las últimas 12 semanas" />
          )}
          <p className="text-xs text-slate-600 mt-2">
            Barra amarilla/roja = +15 % / +30 % de km sobre la media de las 4 semanas anteriores.
          </p>
        </Section>

        {/* 3 · Cadence vs Speed */}
        <Section
          title="Cadencia vs Velocidad (Running)"
          sub="Zona verde = cadencia óptima (170–180 spm)"
        >
          {cadenceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="cadencia" name="Cadencia" unit=" spm" tick={{ fill: '#64748b', fontSize: 10 }} type="number" domain={['auto', 'auto']} />
                <YAxis dataKey="velocidad" name="Velocidad" unit=" km/h" tick={{ fill: '#64748b', fontSize: 10 }} width={42} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: unknown, n: unknown) => [String(v), String(n)]}
                />
                <ReferenceArea x1={170} x2={180} fill="#22c55e" fillOpacity={0.08} />
                <ReferenceLine x={170} stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.5} />
                <ReferenceLine x={180} stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.5} />
                <Scatter data={cadenceData} fill="#ef4444">
                  {cadenceData.map((entry, i) => (
                    <Cell key={i} fill={entry.optimal ? '#22c55e' : '#ef4444'} fillOpacity={0.7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="Sin datos de cadencia" />
          )}
        </Section>

        {/* 4 · VO2max Trend */}
        <Section
          title="Tendencia VO2max"
          sub={currentVo2 ? `Actual: ${currentVo2.toFixed(1)} ml/kg/min — ${vo2Label}` : 'Suunto solo lo calcula en carreras y caminatas'}
        >
          {vo2Points.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={vo2Points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} interval={Math.floor(vo2Points.length / 6)} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} width={36} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: unknown) => [Number(v).toFixed(1), 'VO2max']}
                />
                <ReferenceArea y1={55} y2={70} fill="#22c55e" fillOpacity={0.05} />
                <ReferenceArea y1={48} y2={55} fill="#3b82f6" fillOpacity={0.05} />
                <Line type="monotone" dataKey="vo2max" stroke="#a855f7" dot={{ r: 3 }} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty label={vo2Points.length === 0 ? 'Sin datos VO2max' : 'Pocas mediciones aún'} />
          )}
          <div className="flex gap-3 mt-2 flex-wrap">
            {[['≥60', 'Elite', '#22c55e'], ['55–59', 'Excelente', '#3b82f6'], ['48–54', 'Buena', '#eab308'], ['<48', 'Mejorable', '#ef4444']].map(
              ([r, l, c]) => <span key={r} className="text-xs" style={{ color: c }}>{r} {l}</span>
            )}
          </div>
        </Section>

        {/* 5 · Weekly TSS Load */}
        <Section
          title="Carga Semanal TSS"
          sub={`Media últimas 8 semanas: ${avgWeeklyTSS} TSS · Rojo = ramp >15% (riesgo lesión)`}
        >
          {weeklyLoad.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weeklyLoad} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="week" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} width={36} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: unknown) => [String(v), 'TSS']}
                />
                <ReferenceLine y={avgWeeklyTSS} stroke="#475569" strokeDasharray="4 2"
                  label={{ value: 'media', fill: '#64748b', fontSize: 9 }} />
                <Bar dataKey="tss" radius={[3, 3, 0, 0]}>
                  {weeklyLoad.map((w, i) => (
                    <Cell key={i} fill={RAMP_COLOR[w.riskLevel]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="Sin datos suficientes" />
          )}
        </Section>

        {/* 6 · Consistency Heatmap */}
        <Section
          title="Consistencia (últimos 28 días)"
          sub={`${heatmap.activeDaysCount} días con actividad · Intensidad = horas`}
        >
          <div className="space-y-2 py-1">
            {([
              { key: 'running', emoji: '🏃', rgb: '239,68,68', data: heatmap.running, title: 'Carrera' },
              ...(hasCross ? [{ key: 'cross', emoji: '➕', rgb: '59,130,246', data: heatmap.cross, title: 'Otros deportes' }] : []),
            ]).map(row => {
              const maxH = Math.max(...row.data, 0.01)
              return (
                <div key={row.key} className="flex items-center gap-2">
                  <div className="w-5 text-sm" title={row.title}>{row.emoji}</div>
                  <div className="flex gap-0.5 flex-1">
                    {row.data.map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{
                          height: 20,
                          background: h > 0
                            ? `rgba(${row.rgb},${0.15 + (h / maxH) * 0.85})`
                            : 'rgba(51,65,85,0.3)',
                        }}
                        title={`${heatmap.dates[i]}: ${h > 0 ? formatDuration(h * 3600) : '–'}`}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            <div className="flex gap-0.5 pl-7">
              {heatmap.dates.map((d, i) => (
                i % 7 === 0
                  ? <div key={i} className="flex-1 text-center" style={{ fontSize: 8, color: '#475569' }}>{d.slice(3)}</div>
                  : <div key={i} className="flex-1" />
              ))}
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Empty({ label }: { label: string }) {
  return <div className="h-48 flex items-center justify-center text-slate-600 text-sm">{label}</div>
}

function deriveInsights({
  runVolume,
  efTrend,
  weeklyLoad,
  heatmap,
  cadenceData,
}: {
  runVolume: ReturnType<typeof useRunningVolume>
  efTrend: number | null
  weeklyLoad: ReturnType<typeof useWeeklyLoad>
  heatmap: ReturnType<typeof useConsistencyHeatmap>
  cadenceData: ReturnType<typeof useCadenceData>
}): { text: string; color: string }[] {
  const result: { text: string; color: string }[] = []

  // Última semana completa (la actual aún no ha terminado)
  const lastWeek = runVolume.at(-2)
  if (lastWeek?.rampPct != null && lastWeek.rampPct > 30) {
    result.push({ text: `⚠️ Km semanales +${lastWeek.rampPct}% sobre tu media — riesgo de lesión`, color: '#ef4444' })
  }
  if (lastWeek && lastWeek.km >= 20 && lastWeek.longRun / lastWeek.km > 0.4) {
    result.push({ text: '🛣️ La tirada larga supera el 40% de los km de la semana', color: '#eab308' })
  }

  if (efTrend != null && efTrend > 2)  result.push({ text: '📈 Eficiencia aeróbica mejorando', color: '#22c55e' })
  if (efTrend != null && efTrend < -2) result.push({ text: '📉 Eficiencia aeróbica bajando — más Z1/Z2', color: '#f97316' })

  const highRiskWeeks = weeklyLoad.filter(w => w.riskLevel === 'high').length
  if (highRiskWeeks >= 2) result.push({ text: '⚠️ Rampas de carga elevadas — riesgo de lesión', color: '#f97316' })

  if (heatmap.activeDaysCount >= 20) result.push({ text: '✅ Consistencia excelente (28 días)', color: '#22c55e' })
  else if (heatmap.activeDaysCount < 12) result.push({ text: '⚡ Aumenta la frecuencia de entrenamiento', color: '#eab308' })

  const lowCadence = cadenceData.filter(c => !c.optimal).length
  if (cadenceData.length > 0 && lowCadence > cadenceData.length * 0.4) {
    result.push({ text: '👟 Cadencia baja — trabaja frecuencia de zancada', color: '#eab308' })
  }

  return result
}
