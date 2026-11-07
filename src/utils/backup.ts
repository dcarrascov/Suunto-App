// Copia de seguridad de lo que la app guarda en el navegador (localStorage): ajustes, IA, entrenos propios y
// zapatillas. No lleva claves: la de Gemini y la cookie de TrainingPeaks están en .env, fuera del navegador.

export const BACKUP_KEYS = {
  'suunto-settings': 'Ajustes (FC, umbrales, competiciones marcadas)',
  'suunto-ai': 'Entrenador IA (perfil, semanas propuestas, objetivo sin entrenador)',
  'suunto-entrenos': 'Entrenos propios y de la IA del Calendario',
  'suunto-zapatillas': 'Zapatillas y sus km',
} as const

export type BackupKey = keyof typeof BACKUP_KEYS

export interface Backup {
  app: 'suunto-stats'
  version: 1
  createdAt: string
  data: Partial<Record<BackupKey, unknown>>
}

/** Lo guardado ahora, listo para descargar. */
export function makeBackup(storage: Pick<Storage, 'getItem'>, now: Date = new Date()): Backup {
  const data: Backup['data'] = {}
  for (const key of Object.keys(BACKUP_KEYS) as BackupKey[]) {
    const raw = storage.getItem(key)
    if (raw == null) continue
    try {
      data[key] = JSON.parse(raw)
    } catch {
      // un valor ilegible no se copia
    }
  }
  return { app: 'suunto-stats', version: 1, createdAt: now.toISOString(), data }
}

export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `suunto-stats-copia-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`
}

export type ReadResult = { ok: true; backup: Backup; summary: string[] } | { ok: false; error: string }

/** Comprueba un fichero de copia y resume qué trae. */
export function readBackup(text: string): ReadResult {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return { ok: false, error: 'El fichero no es un JSON válido.' }
  }
  const b = obj as Partial<Backup>
  if (b?.app !== 'suunto-stats' || b.version !== 1 || typeof b.data !== 'object' || b.data == null) {
    return { ok: false, error: 'No es una copia de seguridad de Suunto Stats.' }
  }
  const keys = (Object.keys(b.data) as BackupKey[]).filter(k => Object.hasOwn(BACKUP_KEYS, k))
  if (keys.length === 0) return { ok: false, error: 'La copia está vacía.' }
  const state = (k: BackupKey) => ((b.data![k] as { state?: Record<string, unknown> })?.state ?? {})
  const count = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0)
  const summary = keys.map(k => {
    const s = state(k)
    if (k === 'suunto-entrenos') return `${BACKUP_KEYS[k]}: ${count(s.workouts)}`
    if (k === 'suunto-zapatillas') return `${BACKUP_KEYS[k]}: ${count(s.shoes)} pares`
    if (k === 'suunto-ai') return `${BACKUP_KEYS[k]}: ${count(s.proposals) + count(s.freeProposals)} semanas${s.profile ? ', con perfil' : ''}`
    return BACKUP_KEYS[k]
  })
  return { ok: true, backup: { app: 'suunto-stats', version: 1, createdAt: String(b.createdAt ?? ''), data: b.data }, summary }
}

/** Sustituye lo guardado por lo de la copia (solo las claves que trae). */
export function restoreBackup(backup: Backup, storage: Pick<Storage, 'setItem'>): void {
  for (const key of Object.keys(backup.data) as BackupKey[]) {
    if (!Object.hasOwn(BACKUP_KEYS, key)) continue
    storage.setItem(key, JSON.stringify(backup.data[key]))
  }
}
