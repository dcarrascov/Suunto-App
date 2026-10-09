import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'
import { formatPace, formatDuration } from '../utils/formatters'
import { computePRs } from '../utils/calculations'
import type { PR } from '../utils/calculations'

function PRTable({ title, prs, icon }: { title: string; prs: PR[]; icon: string }) {
  if (prs.length === 0) return null
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
      <h2 className="text-sm font-medium text-slate-200 mb-4">{icon} {title}</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
            <th className="pb-2 pr-4">Distancia</th>
            <th className="pb-2 pr-4">Tiempo</th>
            <th className="pb-2 pr-4">Ritmo</th>
            <th className="pb-2">Fecha</th>
          </tr>
        </thead>
        <tbody>
          {prs.map(pr => (
            <tr key={pr.label} className="border-b border-slate-800/60 hover:bg-slate-800/40">
              <td className="py-2.5 pr-4 font-medium text-slate-200">{pr.label}</td>
              <td className="py-2.5 pr-4 font-mono text-slate-200">{formatDuration(pr.duration)}</td>
              <td className="py-2.5 pr-4 font-mono text-slate-400">{formatPace(pr.pace)}</td>
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
  const hasAny = Object.values(personalRecords).some(prs => prs.length > 0)

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <h1 className="text-xl font-bold text-slate-100 mb-1">Récords Personales</h1>
      <p className="text-sm text-slate-500 mb-6">Mejores tiempos por distancia</p>

      {!hasAny ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          No hay suficientes datos para calcular récords.
        </div>
      ) : (
        <div className="space-y-4">
          <PRTable title="Running" icon="🏃" prs={personalRecords.running ?? []} />
          <PRTable title="Ciclismo" icon="🚴" prs={personalRecords.cycling ?? []} />
        </div>
      )}
    </div>
  )
}
