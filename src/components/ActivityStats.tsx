import type { ActivityDetail } from '../types/garmin'
import { formatDuration, formatPace } from '../utils/formatters'

interface Row {
  label: string
  value: string | null
  hint?: string
}

interface Section {
  title: string
  rows: Row[]
}

const pace = (s: number | null | undefined) => (s ? formatPace(s) : null)

const num = (v: number | null | undefined, unit = '', digits = 0): string | null =>
  v == null ? null : `${digits ? v.toFixed(digits) : Math.round(v)}${unit ? ` ${unit}` : ''}`

const hours = (s: number | null | undefined): string | null => {
  if (!s) return null
  if (s < 3600) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(s >= 36000 ? 0 : 1)} h`
}

const TSS_METHOD: Record<string, string> = { HR: 'hr', PACE: 'ritmo', POWER: 'potencia', MET: 'MET' }

export default function ActivityStats({ detail }: { detail: ActivityDetail }) {
  const x = detail.extra
  if (!x) return null

  const onFoot = detail.sport === 'running' || detail.sport === 'other'

  const sections: Section[] = [
    {
      title: 'Ritmo',
      rows: onFoot
        ? [
            { label: 'Ritmo med.', value: pace(detail.avgPace) },
            { label: 'NGP', value: pace(x.ngp), hint: 'Ritmo ajustado a la pendiente' },
            { label: 'Ritmo máx.', value: pace(x.maxPace) },
            { label: 'Ritmo máx.: 30 s', value: pace(x.peakPace30s), hint: 'Calculado con las muestras GPS (aproximado)' },
            { label: 'Ritmo máx.: 1 min', value: pace(x.peakPace1m), hint: 'Calculado con las muestras GPS (aproximado)' },
            { label: 'Ritmo máx.: 3 min', value: pace(x.peakPace3m), hint: 'Calculado con las muestras GPS (aproximado)' },
            { label: 'Ritmo máx.: 5 min', value: pace(x.peakPace5m), hint: 'Calculado con las muestras GPS (aproximado)' },
          ]
        : [],
    },
    {
      title: 'Altura',
      rows: [
        { label: 'Ascenso', value: num(x.ascent ?? detail.elevationGain, 'm') },
        { label: 'Descenso', value: num(x.descent, 'm') },
        { label: 'Duración de ascenso', value: x.ascentTime ? formatDuration(x.ascentTime) : null },
        { label: 'Duración de descenso', value: x.descentTime ? formatDuration(x.descentTime) : null },
        { label: 'Punto más alto', value: num(x.maxAltitude, 'm') },
        { label: 'Punto más bajo', value: num(x.minAltitude, 'm') },
        { label: 'Velocidad de ascenso', value: num(x.ascentSpeed, 'm/min', 1) },
        { label: 'Velocidad de descenso', value: num(x.descentSpeed, 'm/min', 1) },
      ],
    },
    {
      title: 'Velocidad',
      rows: [
        { label: 'Velocidad med.', value: num(detail.avgSpeed, 'km/h', 1) },
        { label: 'Velocidad máx.', value: num(x.maxSpeed, 'km/h', 1) },
      ],
    },
    {
      title: 'Frecuencia cardiaca',
      rows: [
        { label: 'FC media', value: detail.avgHR > 0 ? `${detail.avgHR} ppm` : null },
        { label: 'FC máx.', value: detail.maxHR > 0 ? `${detail.maxHR} ppm` : null },
        { label: 'FC mín.', value: num(x.minHR, 'ppm') },
      ],
    },
    {
      title: 'Fisiología',
      rows: [
        { label: 'Calorías', value: detail.calories > 0 ? `${detail.calories} kcal` : null },
        {
          label: x.tssMethod ? `TSS (${TSS_METHOD[x.tssMethod] ?? x.tssMethod.toLowerCase()})` : 'TSS',
          value: detail.tss != null ? String(Math.round(detail.tss)) : null,
        },
        { label: 'VO₂ máx. estimado', value: num(detail.vo2max, '', 1) },
        { label: 'EPOC', value: num(x.epoc) },
        { label: 'PTE', value: num(detail.aerobicTE, '', 1), hint: 'Peak Training Effect' },
        { label: 'Tiempo de recuperación', value: hours(x.recoveryTime) },
      ],
    },
    {
      title: 'Técnica',
      rows: [
        { label: 'Pasos', value: num(x.steps) },
        { label: 'Cadencia de pasos med.', value: num(x.stepCadence, 'ppm') },
        { label: 'Cadencia de pasos máx.', value: num(x.maxStepCadence, 'ppm') },
        { label: 'Cadencia med.', value: num(x.cadence, 'rpm') },
        { label: 'Cadencia máx.', value: num(x.maxCadence, 'rpm') },
        { label: 'Longitud de pasos med.', value: num(x.stepLength, 'cm') },
        { label: 'Longitud de zancada med.', value: num(x.strideLength, 'cm') },
      ],
    },
  ]

  // Solo se muestra lo que el reloj ha enviado
  const visible = sections
    .map(s => ({ ...s, rows: s.rows.filter(r => r.value != null) }))
    .filter(s => s.rows.length > 0)
  if (visible.length === 0) return null

  return (
    <section className="mb-6">
      <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-3">Estadísticas</h2>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {visible.map(section => (
          <div key={section.title}>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">{section.title}</h3>
            <div className="grid grid-cols-2 gap-px bg-slate-700/40 border border-slate-700/50 rounded-xl overflow-hidden">
              {section.rows.map((row, i) => (
                <div
                  key={row.label}
                  title={row.hint}
                  className={`bg-slate-900 px-4 py-3 ${section.rows.length % 2 === 1 && i === section.rows.length - 1 ? 'col-span-2' : ''}`}
                >
                  <div className="text-xs text-slate-500">{row.label}</div>
                  <div className="text-base font-semibold text-slate-100 tabular-nums mt-0.5">{row.value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
