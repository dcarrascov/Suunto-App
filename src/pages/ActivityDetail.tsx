import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { ActivityDetail } from '../types/suunto'
import { useActivityStore } from '../stores/activityStore'
import { formatPace, formatDuration, formatDistance, formatDate, sportLabel } from '../utils/formatters'
import { HR_ZONE_DEFS, paceZoneFor } from '../utils/calculations'
import ActivityMap from '../components/ActivityMap'
import MetricCard from '../components/MetricCard'
import ActivityStats from '../components/ActivityStats'
import BestEfforts from '../components/BestEfforts'

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const loadDetail = useActivityStore(s => s.loadDetail)
  const activities = useActivityStore(s => s.activities)
  const thresholdPace = useActivityStore(s => s.settings.thresholdPace)
  const [detail, setDetail] = useState<ActivityDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    loadDetail(Number(id)).then(d => {
      setDetail(d)
      setLoading(false)
    })
  }, [id, loadDetail])

  const summary = activities.find(a => a.id === Number(id))

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Cargando actividad...
      </div>
    )
  }

  const act = detail ?? summary
  if (!act) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Actividad no encontrada.{' '}
        <Link to="/activities" className="text-blue-400 ml-1">Volver</Link>
      </div>
    )
  }

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto">
      {/* Header */}
      <div className="mb-5">
        <Link to="/activities" className="text-xs text-slate-500 hover:text-slate-300 mb-2 inline-block">← Actividades</Link>
        <h1 className="text-xl font-bold text-slate-100">{act.title}</h1>
        <div className="text-sm text-slate-500 mt-0.5">
          {formatDate(act.startTime)} · {sportLabel(act.sport)}
        </div>
      </div>

      {/* Map */}
      {detail?.gpxCoords && detail.gpxCoords.length > 0 && (
        <div className="mb-6">
          <ActivityMap coords={detail.gpxCoords} sport={act.sport} height={320} />
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Distancia" value={formatDistance(act.distance, act.sport)} />
        <MetricCard label="Duración" value={formatDuration(act.duration)} />
        {act.sport === 'running' && act.avgPace
          ? <MetricCard label="Ritmo medio" value={formatPace(act.avgPace)} />
          : act.sport === 'cycling' && act.avgSpeed
          ? <MetricCard label="Velocidad" value={`${act.avgSpeed}`} unit="km/h" />
          : <MetricCard label="Calorías" value={act.calories} unit="kcal" />
        }
        <MetricCard label="FC Media" value={act.avgHR > 0 ? act.avgHR : '–'} unit={act.avgHR > 0 ? 'bpm' : ''} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MetricCard label="FC Máxima" value={act.maxHR > 0 ? act.maxHR : '–'} unit={act.maxHR > 0 ? 'bpm' : ''} />
        <MetricCard label="Elevación +" value={act.elevationGain} unit="m" />
        {act.tss != null && <MetricCard label="TSS" value={Math.round(act.tss)} />}
        {act.sport === 'cycling' && act.avgPower
          ? <MetricCard label="Potencia media" value={act.avgPower} unit="W" />
          : act.sport === 'cycling' && act.normalizedPower
          ? <MetricCard label="Potencia NP" value={act.normalizedPower} unit="W" />
          : act.sport === 'running' && act.avgCadence
          ? <MetricCard label="Cadencia" value={act.avgCadence} unit="spm" />
          : null
        }
      </div>

      {/* Mejores tramos (1 km, 5 km...) con marca de récord */}
      <BestEfforts act={act} />

      {/* HR Zones */}
      {detail?.hrZones && detail.hrZones.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-3">Zonas de frecuencia cardíaca</h2>
          <div className="space-y-2">
            {detail.hrZones.map((zone) => {
              const total = detail.hrZones.reduce((s, z) => s + z.seconds, 0)
              const pct = total > 0 ? (zone.seconds / total) * 100 : 0
              const def = HR_ZONE_DEFS[zone.zone - 1]
              return (
                <div key={zone.zone} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-slate-400">{zone.name}</div>
                  <div className="flex-1 bg-slate-800 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${pct}%`, background: def?.color ?? '#6b7280' }}
                    />
                  </div>
                  <div className="w-16 text-xs text-slate-400 text-right">{formatDuration(zone.seconds)}</div>
                  <div className="w-10 text-xs text-slate-500 text-right">{pct.toFixed(0)}%</div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Laps */}
      {detail?.laps && detail.laps.length > 1 && (
        <section className="mb-6">
          <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-3">
            Parciales ({detail.laps.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">Dist.</th>
                  <th className="pb-2 pr-4">Tiempo</th>
                  {act.sport === 'running' && <th className="pb-2 pr-4">Ritmo</th>}
                  {act.sport === 'cycling' && <th className="pb-2 pr-4">Velocidad</th>}
                  {act.avgPower != null && <th className="pb-2 pr-4">Potencia</th>}
                  <th className="pb-2 pr-4">FC</th>
                  <th className="pb-2">Elev.</th>
                </tr>
              </thead>
              <tbody>
                {detail.laps.map(lap => (
                  <tr key={lap.index} className="border-b border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 pr-4 text-slate-400">{lap.index}</td>
                    <td className="py-2 pr-4 text-slate-200">{lap.distance.toFixed(2)} km</td>
                    <td className="py-2 pr-4 font-mono text-slate-200">{formatDuration(lap.duration)}</td>
                    {act.sport === 'running' && (() => {
                      const z = paceZoneFor(lap.avgPace, thresholdPace)
                      return (
                        <td className="py-2 pr-4 font-mono text-slate-200 whitespace-nowrap">
                          {formatPace(lap.avgPace)}
                          {z && (
                            <span className="ml-2 text-[10px] font-sans px-1.5 py-0.5 rounded-full"
                              style={{ color: z.color, background: z.color + '1a' }} title={z.name}>
                              Z{z.zone}
                            </span>
                          )}
                        </td>
                      )
                    })()}
                    {act.sport === 'cycling' && (
                      <td className="py-2 pr-4 text-slate-200">{lap.avgSpeed ? `${lap.avgSpeed} km/h` : '–'}</td>
                    )}
                    {act.avgPower != null && (
                      <td className="py-2 pr-4 text-slate-200">{lap.avgPower ? `${lap.avgPower}W` : '–'}</td>
                    )}
                    <td className="py-2 pr-4 text-slate-400">{lap.avgHR ?? '–'}</td>
                    <td className="py-2 text-slate-400">{lap.elevationGain}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Estadísticas detalladas (ritmo, altura, fisiología, técnica…) */}
      {detail && <ActivityStats detail={detail} />}
    </div>
  )
}
