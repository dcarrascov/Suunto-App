// Páginas que se descargan al abrirlas (React.lazy), para que la app cargue antes, sobre todo en el móvil.
// Si se despliega una versión nueva con la app abierta, los ficheros de la anterior ya no existen: entonces se recarga
// la página una vez (con la versión nueva) en lugar de enseñar un error.

import { lazy, type ComponentType } from 'react'

const RELOADED_KEY = 'suunto-recargada-por-version'

export function lazyPage<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const page = await load()
      sessionStorage.removeItem(RELOADED_KEY)
      return page
    } catch (e) {
      // una sola vez por sesión: si vuelve a fallar, es otra cosa y se enseña el error
      if (!sessionStorage.getItem(RELOADED_KEY)) {
        sessionStorage.setItem(RELOADED_KEY, '1')
        window.location.reload()
        return await new Promise<never>(() => {})   // la página se está recargando
      }
      throw e
    }
  })
}
