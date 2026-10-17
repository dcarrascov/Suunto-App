import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'
import { formatPace, formatRaceTime } from '../utils/formatters'
import { computePRs, predictRaces } from '../utils/calculations'
import type { PR, RacePrediction } from '../utils/calculations'
import { isoDateOffset } from '../utils/date'

const PREDICTION_DAYS = 90

function Predictions({ predictions }: { predictions: RacePrediction[] }) {
  if (predictions.length === 0) return null
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
      <h2 className="text-sm font-medium text-slate-200">Predicción de carreras</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-4">
        Con tus mejores tramos de los últimos {PREDICTION_DAYS} días (fórmula de Riegel)
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {predictions.map(p => (
          <div key={p.label} className="bg-slate-900/50 border border-slate-700/40 rounded-lg p-3">
            <div className="text-xs text-slate-500">{p.label}</div>
            <div className="text-lg font-mono font-semibold text-slate-100 mt-0.5">
              {p.approx && <span className="text-slate-500 text-sm" title="El tramo de origen es aproximado">≈ </span>}
              {formatRaceTime(p.seconds)}
            </div>
            <div className="text-xs font-mono text-slate-400">{formatPace(p.pace)}</div>
            <div className="text-[11px] text-slate-600 mt-1.5">
              {p.fromLabel === p.label ? 'Tu mejor tramo' : `Según tu ${p.fromLabel}`} de{' '}
              <Link to={`/activity/${p.fromActivityId}`} className="text-blue-400/80 hover:text-blue-300">
                {formatRaceTime(p.fromSeconds)}
              </Link>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-600 mt-3">
        Las predicciones largas (media y maratón) suponen que has entrenado ese volumen; si no, suelen ser optimistas.
      </p>
    </div>
  )
}

function PRTable({ title, prs, speed = false }: { title: string; prs: PR[]; speed?: boolean }) {
  if (prs.length === 0) return null
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
      <h2 className="text-sm font-medium text-slate-200 mb-4">{title}</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
            <th className="pb-2 pr-4">Distancia</th>
            <th className="pb-2 pr-4">Tiempo</th>
            <th className="pb-2 pr-4">{speed ? 'Velocidad' : 'Ritmo'}</th>
            <th className="pb-2">Fecha</th>
          </tr>
        </thead>
        <tbody>
          {prs.map(pr => (
            <tr key={pr.label} className="border-b border-slate-800/60 hover:bg-slate-800/40">
              <td className="py-2.5 pr-4 font-medium text-slate-200">{pr.label}</td>
              <td className="py-2.5 pr-4 font-mono text-slate-200">
                {pr.approx && <span className="text-slate-500" title="Aproximado con los parciales">≈ </span>}
                {formatRaceTime(pr.duration)}
              </td>
              <td className="py-2.5 pr-4 font-mono text-slate-400">
                {speed ? `${(pr.distance / (pr.duration / 3600)).toFixed(1)} km/h` : formatPace(pr.pace)}
              </td>
              <td className="py-2.5">
                <Link to={`/activity/${pr.activityId}`} className="text-blue-400 hover:text-blue-300">
                  {pr.date}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Records() {
  const activities = useActivityStore(s => s.activities)
  const personalRecords = useMemo(() => computePRs(activities), [activities])
  const predictions = useMemo(() => predictRaces(activities, isoDateOffset(PREDICTION_DAYS)), [activities])
  const hasAny = Object.values(personalRecords).some(prs => prs.length > 0)
  const hasApprox = Object.values(personalRecords).some(prs => prs.some(pr => pr.approx))

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto">
      <h1 className="text-xl font-bold text-slate-100 mb-1">Récords Personales</h1>
      <p className="text-sm text-slate-500 mb-6">Mejor tramo de cada distancia dentro de tus actividades</p>

      {!hasAny ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          No hay suficientes datos para calcular récords. Sincroniza con fetch/sync.py para generarlos.
        </div>
      ) : (
        <div className="space-y-4">
          <Predictions predictions={predictions} />
          <PRTable title="Carrera" prs={personalRecords.running ?? []} />
          <PRTable title="Ciclismo" prs={personalRecords.cycling ?? []} speed />
          {hasApprox && (
            <p className="text-xs text-slate-500">
              ≈ Aproximado con los parciales guardados. Para calcularlo exacto con las muestras
              del reloj, sincroniza con <code className="text-slate-400">--force</code>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
