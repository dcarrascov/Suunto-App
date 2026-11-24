// Copia los ajustes al servidor (PUT /api/ajustes, server/settingsSync.ts) para que el MCP calcule con los mismos
// números que la app. Se manda al abrir la app y cada vez que cambian. Si no hay servidor, no pasa nada.

import type { UserSettings } from '../types/suunto'

let timer: ReturnType<typeof setTimeout> | undefined

export function uploadSettings(settings: UserSettings, delayMs = 1500): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return
  clearTimeout(timer)
  timer = setTimeout(() => {
    fetch('/api/ajustes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).catch(() => { /* sin servidor (p. ej. ficheros estáticos): la app sigue igual */ })
  }, delayMs)
}
