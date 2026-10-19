import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { geminiPlugin } from './server/gemini.ts'

export default defineConfig({
  // geminiPlugin: ruta /api/gemini (la clave GEMINI_API_KEY se queda en el servidor, ver server/gemini.ts)
  plugins: [tailwindcss(), react(), geminiPlugin()],
})
