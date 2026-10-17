import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'
import { useFitnessProjection } from '../hooks/useFitnessProjection'
import { formState, predictRaces, RACE_FORM_BAND } from '../utils/calculations'
import { isoDateOffset } from '../utils/date'
import { formatPace, formatRaceTime } from '../utils/formatters'
import { findRaces } from '../utils/races'

function dayLabel(iso: string, withYear = true): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
  })
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`

const formColor = (tsb: number) => formState(tsb).color
const inBand = (tsb: number) => tsb >= RACE_FORM_BAND.min && tsb <= RACE_FORM_BAND.max

export default function Races() {
  const activities = useActivityStore(s => s.activities)
  const plan = useActivityStore(s => s.plan)
  const settings = useActivityStore(s => s.settings)
  const { history, projection } = useFitnessProjection()

  const races = useMemo(
    () => findRaces(activities, plan?.workouts ?? [], [...history, ...projection], settings),
    [activities, plan, history, projection, settings],
  )
  const upcoming = races.filter(r => r.upcoming).sort((a, b) => a.date.localeCompare(b.date))
  const past = races.filter(r => r.activity)
  const next = upcoming[0]
  const nextTsb = next ? projection.find(p => p.date === next.date)?.tsb ?? null : null
  // Predicción actual para una distancia como la de tus últimas carreras (normalmente 10 km)
  const usualLabel = past.find(r => r.standardLabel)?.standardLabel ?? '10 km'
  const nowPrediction = useMemo(
    () => predictRaces(activities, isoDateOffset(90)).find(p => p.label === usualLabel) ?? null,
    [activities, usualLabel],
  )

  return (
    <div className="flex-1 p-4 md:px-10 md:py-8 overflow-y-auto">
      <h1 className="text-xl font-semibold text-slate-100">Competiciones</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-6">
        Detectadas con tu plan (el día siguiente a la «Activación precompetición») o marcadas a mano en el detalle de la actividad
      </p>

      {next && (
        <div className="g-grid mb-6">
          <div className="g-cell col-span-12 md:col-span-4">
            <div className="g-label">Próxima competición</div>
            <div className="text-2xl font-semibold text-slate-100 mt-2 first-letter:uppercase">{dayLabel(next.date, false)}</div>
            <div className="text-xs text-slate-500 mt-1">según tu plan de TrainingPeaks</div>
          </div>
          <div className="g-cell col-span-6 md:col-span-4">
            <div className="g-label">Forma prevista</div>
            {nextTsb != null ? (
              <>
                <div className="text-[34px] font-semibold mt-1" style={{ color: formColor(nextTsb) }}>{signed(nextTsb)}</div>
                <div className="text-xs text-slate-500">
                  {formState(nextTsb).label} · {inBand(nextTsb) ? 'dentro' : nextTsb > RACE_FORM_BAND.max ? 'por encima' : 'por debajo'} de la banda para competir (−10 a +5)
                </div>
              </>
            ) : <div className="text-sm text-slate-500 mt-3">Sin datos de previsión</div>}
          </div>
          <div className="g-cell col-span-6 md:col-span-4">
            <div className="g-label">Predicción · {usualLabel}</div>
            {nowPrediction ? (
              <>
                <div className="text-[34px] font-semibold text-slate-100 mt-1">{formatRaceTime(nowPrediction.seconds)}</div>
                <div className="text-xs text-slate-500">{formatPace(nowPrediction.pace)} · con tus tramos de los últimos 90 días</div>
              </>
            ) : <div className="text-sm text-slate-500 mt-3">Sin tramos recientes</div>}
          </div>
        </div>
      )}

      {past.length === 0 ? (
        <div className="text-slate-500 text-sm py-10">
          Aún no hay competiciones. Se detectan solas con el plan de TrainingPeaks; también puedes marcar una actividad
          como competición desde su detalle.
        </div>
      ) : (
        <div className="g-cell border border-line overflow-x-auto">
          <div className="g-label mb-3">Resultados</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 pr-4 font-normal">Fecha</th>
                <th className="pb-2 pr-4 font-normal">Distancia</th>
                <th className="pb-2 pr-4 font-normal">Tiempo</th>
                <th className="pb-2 pr-4 font-normal">Ritmo</th>
                <th className="pb-2 pr-4 font-normal">FC media</th>
                <th className="pb-2 pr-4 font-normal" title="Forma (TSB) del día anterior">Forma al llegar</th>
                <th className="pb-2 font-normal" title="Diferencia con la competición anterior, ajustada a la misma distancia">Frente a la anterior</th>
              </tr>
            </thead>
            <tbody>
              {past.map(r => {
                const a = r.activity!
                const diff = r.vsPrevious
                return (
                  <tr key={a.id} className="border-t border-line hover:bg-[#1b1b1f]">
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      <Link to={`/activity/${a.id}`} className="text-slate-100 hover:text-accent first-letter:uppercase">{dayLabel(r.date)}</Link>
                      {r.source === 'manual' && <span className="ml-2 text-[10px] text-slate-500 border border-slate-700 px-1">manual</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-300 whitespace-nowrap">
                      {a.distance.toFixed(2).replace('.', ',')} km{r.standardLabel && <span className="text-slate-500"> · {r.standardLabel}</span>}
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-slate-100">{formatRaceTime(a.duration)}</td>
                    <td className="py-2.5 pr-4 text-slate-300">{formatPace(a.avgPace)}</td>
                    <td className="py-2.5 pr-4 text-slate-400">{a.avgHR || '–'}</td>
                    <td className="py-2.5 pr-4" style={{ color: r.formBefore != null ? formColor(r.formBefore) : undefined }}>
                      {r.formBefore != null ? signed(r.formBefore) : '–'}
                    </td>
                    <td className="py-2.5 whitespace-nowrap">
                      {diff == null ? <span className="text-slate-600">–</span> : (
                        <span className={diff <= 0 ? 'text-accent' : 'text-slate-400'}>
                          {diff <= 0 ? '−' : '+'}{formatRaceTime(Math.abs(diff))}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-xs text-slate-600 mt-3">
            Lima = más rápido que en la competición anterior. La forma al llegar es el TSB del día anterior a la carrera.
          </p>
        </div>
      )}
    </div>
  )
}
