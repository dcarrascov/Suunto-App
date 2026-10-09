import { useActivityStore } from '../stores/activityStore'
import type { UserSettings } from '../types/garmin'

export default function Settings() {
  const settings = useActivityStore(s => s.settings)
  const updateSettings = useActivityStore(s => s.updateSettings)

  function set<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    updateSettings({ [key]: value })
  }

  return (
    <div className="flex-1 p-6 overflow-y-auto max-w-xl">
      <h1 className="text-xl font-bold text-slate-100 mb-1">Ajustes</h1>
      <p className="text-sm text-slate-500 mb-8">Parámetros fisiológicos para los cálculos de zonas y TSS.</p>

      <div className="space-y-6">
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
          label="FTP (Functional Threshold Power)"
          unit="W"
          value={settings.ftp}
          min={100}
          max={500}
          onChange={v => set('ftp', v)}
          hint="Potencia que puedes mantener ~1h. Para ciclismo."
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
              className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
            />
            <span className="text-slate-500">min</span>
            <input
              type="number"
              value={settings.thresholdPace % 60}
              min={0}
              max={59}
              onChange={e => set('thresholdPace', Math.floor(settings.thresholdPace / 60) * 60 + Number(e.target.value))}
              className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
            />
            <span className="text-slate-500">seg /km</span>
          </div>
          <p className="text-xs text-slate-600 mt-1">Tu ritmo en umbral láctico corriendo. Usado para calcular TSS de running.</p>
        </div>
      </div>

      <div className="mt-8 p-4 bg-slate-800/40 border border-slate-700/50 rounded-xl text-xs text-slate-500 space-y-1">
        <p>Los ajustes se guardan localmente en tu navegador (localStorage).</p>
        <p>Cambiarlos afecta retroactivamente a todos los cálculos de CTL/ATL/TSB y zonas.</p>
      </div>
    </div>
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
          className="w-28 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
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
