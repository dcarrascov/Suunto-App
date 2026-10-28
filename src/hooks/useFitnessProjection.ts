import { useMemo } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { calculateFitnessHistory, projectFitness } from '../utils/calculations'
import { toLocalISODate } from '../utils/date'
import { raceDatesFromPlan } from '../utils/races'
import type { FitnessPoint } from '../types/suunto'

export interface FitnessProjection {
  history: FitnessPoint[]       // hasta hoy (lo realizado)
  projection: FitnessPoint[]    // desde mañana, con el TSS que ha planificado el entrenador
  nextRaceDate: string | null   // próxima competición detectada en el plan (hoy o después)
}

/** Forma real y prevista. Sin plan de TrainingPeaks, la proyección va vacía. */
export function useFitnessProjection(): FitnessProjection {
  const activities = useActivityStore(s => s.activities)
  const settings = useActivityStore(s => s.settings)
  const plan = useActivityStore(s => s.plan)

  const history = useMemo(() => calculateFitnessHistory(activities, settings), [activities, settings])

  return useMemo(() => {
    const today = toLocalISODate(new Date())
    const future = (plan?.workouts ?? []).filter(w => w.date > today && w.hasPlan)
    const plannedTss: Record<string, number> = {}
    for (const w of future) plannedTss[w.date] = (plannedTss[w.date] ?? 0) + (w.planned.tss ?? 0)
    const until = future.reduce((max, w) => (w.date > max ? w.date : max), today)
    const nextRaceDate = raceDatesFromPlan(plan?.workouts ?? [], plan?.events ?? []).find(d => d >= today) ?? null
    // si la próxima carrera cae después del último entreno planificado, se proyecta hasta ella igualmente
    const end = nextRaceDate && nextRaceDate > until ? nextRaceDate : until
    return { history, projection: projectFitness(history, plannedTss, end), nextRaceDate }
  }, [history, plan])
}
