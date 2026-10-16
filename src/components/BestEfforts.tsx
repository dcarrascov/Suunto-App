import { useMemo } from 'react'
import type { ActivitySummary } from '../types/suunto'
import { useActivityStore } from '../stores/activityStore'
import { formatPace, formatRaceTime } from '../utils/formatters'
import { EFFORT_LABELS } from '../utils/calculations'

/** Mejores tramos de una actividad, marcando récord personal y mejor del año. */
export default function BestEfforts({ act }: { act: ActivitySummary }) {
  const activities = useActivityStore(s => s.activities)
  const efforts = act.bestEfforts

  const rows = useMemo(() => {
    if (!efforts) return []
    const year = act.startTime.slice(0, 4)
    return Object.entries(efforts)
      .map(([key, secs]) => {
        const km = Number(key) / 1000
        let allTime = Infinity
        let yearBest = Infinity
        for (const a of activities) {
          const s = a.sport === act.sport ? a.bestEfforts?.[key] : undefined
          if (!s) continue
          allTime = Math.min(allTime, s)
          if (a.startTime.startsWith(year)) yearBest = Math.min(yearBest, s)
        }
        // el resumen puede no estar cargado aún: el propio tramo cuenta
        allTime = Math.min(allTime, secs)
        yearBest = Math.min(yearBest, secs)
        return {
          key, km, secs,
          label: EFFORT_LABELS[key] ?? `${km} km`,
          pace: secs / km,
          badge: secs <= allTime ? 'pr' : secs <= yearBest ? 'year' : null,
          rankGap: secs - allTime,
        }
      })
      .sort((a, b) => a.km - b.km)
  }, [efforts, activities, act.sport, act.startTime])

  if (rows.length === 0) return null
  const approx = act.bestEffortsSource === 'laps'

  return (
    <section className="mb-6">
      <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-3">
        Mejores tramos{approx && <span className="normal-case tracking-normal text-slate-600"> · aprox. con los parciales</span>}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {rows.map(r => (
          <div key={r.key} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{r.label}</span>
              {r.badge === 'pr' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300">🏅 Récord</span>}
              {r.badge === 'year' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300">Mejor del año</span>}
            </div>
            <div className="text-lg font-mono font-semibold text-slate-100 mt-1">
              {approx && <span className="text-slate-500 text-sm">≈ </span>}{formatRaceTime(r.secs)}
            </div>
            <div className="text-xs font-mono text-slate-400">
              {act.sport === 'cycling' ? `${(r.km / (r.secs / 3600)).toFixed(1)} km/h` : formatPace(r.pace)}
            </div>
            {!r.badge && r.rankGap > 0 && (
              <div className="text-[11px] text-slate-600 mt-1">+{formatRaceTime(r.rankGap)} sobre tu récord</div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
