// npm run preview sirve la copia de dist/, que se queda vieja: los datos descargados se leen siempre de public/data/,
// como en npm run dev. Así el botón de recargar también funciona en un servidor. El acceso lo decide server/auth.ts.

import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Connect, Plugin } from 'vite'

const DATA_FILE = /^\/data\/([A-Za-z0-9_-][A-Za-z0-9_.-]*\.json)$/

export function dataMiddleware(dir: () => string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const name = DATA_FILE.exec(req.url?.split('?')[0] ?? '')?.[1]
    if (!name) return next()
    const file = join(dir(), name)
    res.setHeader('Cache-Control', 'no-store')
    if (!existsSync(file)) {
      res.statusCode = 404
      return res.end()
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    createReadStream(file).on('error', () => res.destroy()).pipe(res)
  }
}

export function dataPlugin(): Plugin {
  let dir = ''
  return {
    name: 'suunto-data',
    configResolved(config) {
      dir = join(config.publicDir, 'data')
    },
    configurePreviewServer(server) {
      server.middlewares.use(dataMiddleware(() => dir))
    },
  }
}
