import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { authPlugin } from './server/auth.ts'
import { dataPlugin } from './server/data.ts'
import { geminiPlugin } from './server/gemini.ts'
import { syncPlugin } from './server/sync.ts'
import { fitPlugin } from './server/fit.ts'

export default defineConfig(({ mode }) => {
  // qué direcciones se aceptan lo decide server/auth.ts, que además explica qué falta cuando rechaza una
  const allowedHosts = true
  return {
    // authPlugin: primero de todos, decide quién entra (AUTH_MODE, ver server/auth.ts)
    // dataPlugin: en npm run preview, los datos se leen de public/data/ y no de la copia de dist/ (ver server/data.ts)
    // geminiPlugin: ruta /api/gemini (la clave GEMINI_API_KEY se queda en el servidor, ver server/gemini.ts)
    // syncPlugin: ruta /api/sync, lanza actualizar.ps1 desde el botón de recargar (ver server/sync.ts)
    // fitPlugin: ruta /api/fit, sube ficheros .fit a fetch/fit/ desde la página «Importar FIT» (ver server/fit.ts)
    plugins: [authPlugin(), dataPlugin(), tailwindcss(), react(), geminiPlugin(), syncPlugin(), fitPlugin()],
    // npm run demo: datos inventados de demo/data/ (fetch/make_demo.py) en lugar de los tuyos de public/data/
    publicDir: mode === 'demo' ? 'demo' : 'public',
    // los datos los recarga la app al terminar la actualización: que Vite no recargue la página a mitad
    // cors: false = ninguna otra web (tampoco otro puerto de localhost) puede leer las respuestas
    server: { allowedHosts, cors: false, watch: { ignored: ['**/public/data/**', '**/demo/data/**', '**/fetch/**'] } },
    preview: { allowedHosts, cors: false },
  }
})
