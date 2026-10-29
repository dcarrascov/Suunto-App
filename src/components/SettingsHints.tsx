import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'
import { isoDateOffset } from '../utils/date'
import { settingsHints } from '../utils/settingsCheck'

/** Aviso en el Resumen cuando la FC máxima o el ritmo umbral de Ajustes no cuadran con tus datos. */
export default function SettingsHints() {
  const settings = useActivityStore(s => s.settings)
  const stats = useActivityStore(s => s.stats)
  const activities = useActivityStore(s => s.activities)
  const updateSettings = useActivityStore(s => s.updateSettings)
  const hints = useMemo(
    () => settingsHints(settings, stats, activities, isoDateOffset(90), isoDateOffset(365)),
    [settings, stats, activities],
  )
  if (hints.length === 0) return null

  const dismiss = (key: string, value: number) =>
    updateSettings({ dismissedHints: { ...(settings.dismissedHints ?? {}), [key]: value } })

  return (
    <div className="border border-amber-700/50 bg-amber-500/5 p-4 mb-6 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="g-label text-amber-300">Tus ajustes no cuadran con tus datos</div>
        <Link to="/settings" className="text-xs text-slate-500 hover:text-white">Ajustes →</Link>
      </div>
      {hints.map(h => (
        <div key={h.key} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex-1 min-w-60">
            <div className="text-sm text-slate-100">{h.title}</div>
            <div className="text-xs text-slate-400">{h.detail}</div>
          </div>
          <button onClick={() => updateSettings({ [h.key]: h.suggested })}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-black hover:brightness-110">
            {h.apply}
          </button>
          <button onClick={() => dismiss(h.key, h.suggested)}
            className="px-3 py-1.5 text-xs text-slate-300 border border-slate-600 hover:border-slate-400">
            Dejar como está
          </button>
        </div>
      ))}
    </div>
  )
}
