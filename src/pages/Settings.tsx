import { useActivityStore } from '../stores/activityStore'
import type { UserSettings } from '../types/suunto'
import { useMemo } from 'react'
import { LTHR_OFFSET, estimateThresholdPace, lthrFor, paceZoneRanges } from '../utils/calculations'
import { isoDateOffset } from '../utils/date'
import { formatPace } from '../utils/formatters'
import BackupSection from '../components/BackupSection'

export default function Settings() {
  const settings = useActivityStore(s => s.settings)
  const updateSettings = useActivityStore(s => s.updateSettings)
  const activities = useActivityStore(s => s.activities)
  const estimatedPace = useMemo(() => estimateThresholdPace(activities, isoDateOffset(90)), [activities])

  function set<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    updateSettings({ [key]: value })
  }

  return (
    <div className="page">
      <h1 className="text-xl font-semibold text-slate-100">Ajustes</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-6">
        Parámetros fisiológicos para los cálculos de zonas y TSS. Se guardan en este navegador y cambiarlos afecta a todos
        los cálculos (también a los pasados) de forma, carga y zonas.
      </p>

      <div className="g-grid">
        {/* Frecuencia cardiaca */}
        <div className="g-cell col-span-12 lg:col-span-6 2xl:col-span-4 space-y-6">
          <div className="g-label">Frecuencia cardiaca</div>
          <Field
            label="FC Máxima"
            unit="bpm"
            value={settings.maxHR}
            min={140}
            max={220}
            onChange={v => set('maxHR', v)}
            hint="Usada para calcular las zonas de FC (Z1-Z5)."
          />
          <Field
            label="FC en Umbral Láctico (Running)"
            unit="bpm"
            value={settings.lthrRunning}
            min={120}
            max={200}
            onChange={v => set('lthrRunning', v)}
            hint="FC aproximada en tu umbral láctico corriendo. Suele ser el 87-93% de FCmax."
          />
          {(['cycling', 'swimming'] as const).map(sport => {
            const key = sport === 'cycling' ? 'lthrCycling' : 'lthrSwimming'
            const auto = settings[key] == null
            return (
              <div key={sport}>
                <Field
                  label={`FC en Umbral Láctico (${sport === 'cycling' ? 'Ciclismo' : 'Natación'})`}
                  unit="bpm"
                  value={lthrFor(sport, settings)}
                  min={110}
                  max={200}
                  onChange={v => set(key, v)}
                  hint={auto
                    ? `Automático: ${LTHR_OFFSET[sport]} bpm menos que corriendo. Muévelo para fijar tu valor.`
                    : 'Valor fijado a mano. Se usa para estimar el TSS cuando Suunto no lo da.'}
                />
                {!auto && (
                  <button
                    onClick={() => set(key, undefined)}
                    className="mt-1 text-xs text-blue-400 hover:text-blue-300"
                  >
                    Volver a automático
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Ritmo */}
        <div className="g-cell col-span-12 lg:col-span-6 2xl:col-span-4 space-y-3">
          <div className="g-label">Ritmo</div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">
              Ritmo en Umbral (Running)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={Math.floor(settings.thresholdPace / 60)}
                min={3}
                max={8}
                onChange={e => set('thresholdPace', Number(e.target.value) * 60 + (settings.thresholdPace % 60))}
                className="w-20 bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200"
              />
              <span className="text-slate-500">min</span>
              <input
                type="number"
                value={settings.thresholdPace % 60}
                min={0}
                max={59}
                onChange={e => set('thresholdPace', Math.floor(settings.thresholdPace / 60) * 60 + Number(e.target.value))}
                className="w-20 bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200"
              />
              <span className="text-slate-500">seg /km</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Ritmo que podrías mantener ~1 hora. Define tus zonas de ritmo (parciales del detalle y planes de la IA).
            </p>
            {estimatedPace && Math.abs(estimatedPace - settings.thresholdPace) >= 3 && (
              <div className="mt-2 text-xs text-slate-400">
                Según tus mejores tramos de los últimos 90 días: <span className="font-mono text-slate-200">{formatPace(estimatedPace)}</span>{' '}
                <button
                  onClick={() => set('thresholdPace', estimatedPace)}
                  className="ml-1 text-blue-400 hover:text-blue-300"
                >
                  Usar este valor
                </button>
              </div>
            )}
          </div>
          <table className="w-full text-xs">
            <tbody>
              {paceZoneRanges(settings.thresholdPace).map(({ def, fast, slow }) => (
                <tr key={def.zone} className="border-b border-slate-800/60">
                  <td className="py-1.5 pr-3 font-medium" style={{ color: def.color }}>Z{def.zone}</td>
                  <td className="py-1.5 pr-3 text-slate-400">{def.name}</td>
                  <td className="py-1.5 font-mono text-slate-300 text-right">
                    {fast == null ? `< ${formatPace(slow)}` : slow == null ? `> ${formatPace(fast)}` : `${formatPace(fast).replace(' /km', '')} – ${formatPace(slow)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Ciclismo */}
        <div className="g-cell col-span-12 lg:col-span-6 2xl:col-span-4 space-y-6">
          <div className="g-label">Ciclismo</div>
          <Field
            label="FTP (Functional Threshold Power)"
            unit="W"
            value={settings.ftp}
            min={100}
            max={500}
            onChange={v => set('ftp', v)}
            hint="Potencia que puedes mantener ~1h. Para el TSS de bici con potencia."
          />
        </div>

        {/* Avisos para el Entrenador IA */}
        <div className="g-cell col-span-12 lg:col-span-6 2xl:col-span-12 space-y-3">
          <div className="g-label">Entrenador IA</div>
          <p className="text-xs text-slate-500">Avisos sobre tus datos que se le dan a Gemini para que no saque conclusiones equivocadas.</p>
          <Toggle
            checked={!!settings.hrUnreliable}
            onChange={v => set('hrUnreliable', v)}
            label="Mi pulso de muñeca no es fiable"
            hint="Sobre todo en competición (sale demasiado bajo). La IA planifica por tiempo y ritmo y no juzga por el pulso."
          />
          <Toggle
            checked={!!settings.splitSessions}
            onChange={v => set('splitSessions', v)}
            label="Grabo por separado calentamiento, parte principal y vuelta a la calma"
            hint="Varias actividades seguidas del mismo día cuentan como una sola sesión, no como interrupciones."
          />
        </div>

        {/* Copia de seguridad */}
        <div className="g-cell col-span-12">
          <BackupSection />
        </div>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 accent-blue-500 w-4 h-4 shrink-0" />
      <span>
        <span className="block text-sm text-slate-300">{label}</span>
        <span className="block text-xs text-slate-600 mt-0.5">{hint}</span>
      </span>
    </label>
  )
}

function Field({
  label, unit, value, min, max, onChange, hint
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <div>
      <label className="block text-sm text-slate-300 mb-1">{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={e => onChange(Number(e.target.value))}
          className="w-24 bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200"
        />
        <span className="text-slate-500 text-sm">{unit}</span>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 accent-blue-500"
        />
      </div>
      {hint && <p className="text-xs text-slate-600 mt-1">{hint}</p>}
    </div>
  )
}
