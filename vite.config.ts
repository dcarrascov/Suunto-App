import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { geminiPlugin } from './server/gemini.ts'
import { syncPlugin } from './server/sync.ts'

export default defineConfig(({ mode }) => ({
  // geminiPlugin: ruta /api/gemini (la clave GEMINI_API_KEY se queda en el servidor, ver server/gemini.ts)
  // syncPlugin: ruta /api/sync, lanza actualizar.ps1 desde el botón de recargar (ver server/sync.ts)
  plugins: [tailwindcss(), react(), geminiPlugin(), syncPlugin()],
  // npm run demo: datos inventados de demo/data/ (fetch/make_demo.py) en lugar de los tuyos de public/data/
  publicDir: mode === 'demo' ? 'demo' : 'public',
  // los datos los recarga la app al terminar la actualización: que Vite no recargue la página a mitad
  server: { watch: { ignored: ['**/public/data/**', '**/demo/data/**', '**/fetch/**'] } },
}))
