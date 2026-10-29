// Avisos cuando los Ajustes no cuadran con tus datos (FC máxima y ritmo umbral). Nunca se cambia nada solo:
// el aviso propone un valor y el usuario decide (su FC de muñeca no siempre es fiable).

import type { ActivitySummary, GlobalStats, UserSettings } from '../types/suunto'
import { estimateThresholdPace } from './calculations'
import { formatPace } from './formatters'

export type HintKey = 'maxHR' | 'thresholdPace'

export interface SettingsHint {
  key: HintKey
  current: number
  suggested: number
  title: string
  detail: string
  apply: string          // texto del botón
}

const MAX_HR_GAP = 5          // ppm de diferencia para avisar
const PACE_GAP = 8            // s/km de diferencia para avisar

/** FC más alta de tus carreras del último año, quitando picos sueltos (percentil 98 de las FC máximas). */
export function observedMaxHR(activities: ActivitySummary[], since: string): number | null {
  const values = activities
    .filter(a => a.sport === 'running' && a.startTime.slice(0, 10) >= since && a.maxHR > 0)
    .map(a => a.maxHR)
    .sort((a, b) => a - b)
  if (values.length < 10) return null
  return values[Math.floor((values.length - 1) * 0.98)]
}

/**
 * Avisos pendientes. Uno descartado no vuelve a salir mientras la propuesta siga siendo la misma
 * (`dismissed[key] === suggested`).
 */
export function settingsHints(
  settings: UserSettings, stats: GlobalStats | null, activities: ActivitySummary[],
  since90: string, since365: string,
): SettingsHint[] {
  const hints: SettingsHint[] = []
  const dismissed = settings.dismissedHints ?? {}

  const suunto = stats?.userMaxHR ?? null
  const seen = observedMaxHR(activities, since365)
  const hrSuggest = suunto ?? (seen && seen > settings.maxHR ? seen : null)
  if (hrSuggest && Math.abs(hrSuggest - settings.maxHR) >= MAX_HR_GAP) {
    const parts = [
      suunto ? `Suunto calcula ${suunto} ppm` : null,
      seen ? `la más alta de tus carreras del último año es ${seen} ppm` : null,
    ].filter(Boolean)
    hints.push({
      key: 'maxHR', current: settings.maxHR, suggested: hrSuggest,
      title: `FC máxima: tienes ${settings.maxHR} ppm`,
      detail: `${parts.join(' y ')}. Afecta a las zonas de FC y al TSS estimado.`,
      apply: `Usar ${hrSuggest} ppm`,
    })
  }

  const pace = estimateThresholdPace(activities, since90)
  if (pace && Math.abs(pace - settings.thresholdPace) >= PACE_GAP) {
    hints.push({
      key: 'thresholdPace', current: settings.thresholdPace, suggested: pace,
      title: `Ritmo umbral: tienes ${formatPace(settings.thresholdPace)}`,
      detail: `Con tus mejores tramos de los últimos 90 días sale ${formatPace(pace)}. Afecta a las zonas de ritmo y a los planes de la IA.`,
      apply: `Usar ${formatPace(pace)}`,
    })
  }
  return hints.filter(h => dismissed[h.key] !== h.suggested)
}
