# Suunto Stats — contexto para Claude

Panel personal de estadísticas de entrenamiento Suunto. Sin servidor ni base de datos:
un script Python descarga los datos a JSON locales y una app React los lee.
Idioma del proyecto (UI, comentarios, commits): **español**. El usuario trabaja en Windows (PowerShell, IntelliJ).

## Arquitectura
- `fetch/` (Python) → escribe `public/data/`:
  - `sync.py`: punto de entrada. `--source cloud` (por defecto) o `--source fit`. Incremental: no vuelve a pedir lo ya guardado salvo `--force` o `partial`.
  - `suunto_client.py`: cliente de solo lectura del backend no oficial `api.sports-tracker.com` (sesión de `suuntool login`).
  - `fit_source.py`: lee `.fit` de `fetch/fit/` (librería `garmin_fit_sdk`: es su nombre real, NO renombrar).
  - `normalizer.py`: convierte al formato de la app. `make_summary()` es el ÚNICO sitio que define la forma de `ActivitySummary`.
  - `validate_output.py`: valida los JSON (debe dar 0 errores).
  - `tp_sync.py` + `trainingpeaks_client.py`: plan del entrenador desde la API interna de TrainingPeaks
    (cookie `TP_AUTH_COOKIE` en .env, solo GET) → `plan.json`. `normalize_tp()` define `PlannedWorkout`.
    Incremental: re-pide de −21 a +42 días y conserva lo anterior. Guía: GUIA_TRAININGPEAKS.md.
  - Salida: `activities.json` (resúmenes), `activity_{id}.json` (detalle: zonas, parciales, ruta, extra), `stats.json`,
    `plan.json` (TrainingPeaks, opcional).
- `src/` (React 19 + Vite + Tailwind 4 + Zustand + Recharts + Leaflet, TypeScript):
  - `types/suunto.ts`: tipos (espejo del normalizador; si cambias uno, cambia el otro y `validate_output.py`).
  - `stores/activityStore.ts`: carga los JSON; ajustes persistidos en localStorage con clave `suunto-settings` (migra desde `garmin-settings`).
  - `utils/calculations.ts`: TSS estimado (TRIMP), CTL/ATL/TSB (EMA 42/7), zonas, agregados semanales, récords.
  - `utils/date.ts`, `hooks/`, `pages/` (Dashboard, Actividades, Detalle, Fitness, Zonas, Rendimiento, Récords, Historial, Ajustes).
  - Resumen con datos copiados del detalle (`SUMMARY_FROM_DETAIL` / `detail_to_summary()` en normalizer.py):
    `bestEfforts`, `bestEffortsSource`, `hrZoneSeconds` (Z1..Z5 del reloj), `decoupling` (%). Así la web no carga 1400 detalles.

## Convenciones
- **Fechas siempre en hora local.** `startTime` es ISO local sin zona. Nunca usar `toISOString()` para sacar un día:
  usar `toLocalISODate`, `parseLocalDate`, `isoDateOffset`, `daysAgo` (date.ts) y `localWeekStart` (calculations.ts).
- Datos personales (`public/data/`, `fetch/debug/`, `fetch/fit/`, `.env`) están en `.gitignore`: no subirlos.
  La cookie de TrainingPeaks es una credencial: nunca leerla, mostrarla ni pedirla en el chat.
- Fusiones a `main` con `git merge --no-ff` (el usuario las revisa en SourceTree).
- **Diseño «Grafito»** (elegido por el usuario): oscuro y plano, grises neutros, un solo acento lima `#c5f23c`
  (`text-accent`/`bg-accent`, texto negro encima), esquinas casi rectas. Sin degradados, brillos ni emojis.
  En `index.css` se redefinen las escalas `slate` (grises) y `blue` (= lima), así que `text-blue-400` ya es lima.
  Dashboard con rejilla `.g-grid` / `.g-cell` / `.g-label`. Colores con significado (zonas, avisos) se mantienen.
- Actualizar todo: `.\actualizar.ps1` (sync + tp_sync si hay cookie + validación; `-Completo`, `-SinPlan`).
- Comprobar antes de commit: `npx tsc -b`, `npm test` (vitest) y `py fetch\validate_output.py`.
- Git: rama principal `main`; trabajo en ramas (p. ej. `fix`) y fusión a `main` cuando el usuario lo pide.

## Datos actuales
~1440 actividades (jul 2023 → oct 2026), ~97 % carrera; el resto natación, bici y otros.

## Hecho
- VO2max del Dashboard = media semanal; tooltip en la carga semanal.
- Fechas en hora local en toda la app (racha, Fitness, Zonas, filtros, "Hoy/Ayer").
- Renombrado Garmin → Suunto (tipos, paquete, CSS, clave de ajustes).
- Récords reales: `bestEfforts` (mejor tramo por distancia, en el resumen) lo calcula `set_best_efforts()`
  con las muestras (exacto) o, si no hay, con los parciales guardados (`bestEffortsSource: "laps"`, aprox.).
  `sync.py` completa así los detalles antiguos sin red; `--force` los recalcula exactos.
- TSS estimado con el umbral de cada deporte (`lthrFor`): bici y natación se deducen del de carrera
  (−5/−10 bpm) salvo que se fijen en Ajustes. El `persist` mezcla con `DEFAULT_SETTINGS`.
- Rendimiento orientado a corredor: «Volumen de carrera» (km/semana, tirada larga, rampa frente a
  la media de 4 semanas) en lugar del balance de triatlón; bici/natación quedan como «Otros».

- Predictor de carreras (Riegel, últimos 90 días) en Récords; mejores tramos con marca de récord en el Detalle.
- 80/20 en Zonas (con las zonas reales del reloj); zonas de ritmo (Friel) desde el ritmo umbral, con
  estimación automática en Ajustes y etiqueta por parcial en el Detalle.
- Página Historial (totales por año, comparación a la misma fecha, km por mes).
- VO2max semanal en Rendimiento; filtros y orden en Actividades; diseño adaptado a móvil; tests de utils.
- Mapa: capas sin clave (OSM claro, Esri gris/oscuro/satélite; CARTO pide API key), borde blanco, marcas
  de km y color por ritmo. La ruta sale de `LocationStreamExtension` del detalle (1 Hz, `timed_route()` →
  `gpxCoords` + `routePace`); sync pide siempre `workout(key)`. Las rutas antiguas (~1 punto/7 s) necesitan `--force`.

- Página Plan (TrainingPeaks): semana actual con estado por entreno emparejado con Suunto (`utils/plan.ts`),
  historial semanal con % de cumplimiento y tarjeta «Hoy toca» en el Dashboard. Sin probar aún con datos reales.

- Forma prevista (`projectFitness` + `useFitnessProjection`) con el TSS planificado; Competiciones (`utils/races.ts`):
  día siguiente a «Activación precompetición» → la carrera más rápida ≥ 3 km; marcar/desmarcar en el Detalle
  (`raceIds`/`notRaceIds` en ajustes); se comparan con la anterior (Riegel), no con el predictor.
- Rendimiento: ritmo a la FC habitual (±4 ppm, sin depender de las zonas del reloj, que el usuario tiene bajas)
  y desacoplamiento de tiradas ≥ 1 h. Página Calendario (mes con actividades y plan). `actualizar.ps1`.
- Ojo con los datos de FC del usuario: en competiciones la FC media sale baja (≈145 a 3:30/km); no fiarse de ella.

- Entrenador IA (rama `feature/entrenador-ia`): la app habla con Gemini por la API (nivel gratuito; Gemini Plus no
  incluye API). `server/gemini.ts` = plugin de Vite con la ruta `/api/gemini` (dev y preview): lee `GEMINI_API_KEY` y
  `GEMINI_MODEL` (por defecto `gemini-3.8-flash`) del .env en cada petición, llama a `models.generateContent` con la clave
  en la cabecera `x-goog-api-key` (nunca en la URL ni en el navegador) y solo acepta peticiones de localhost.
  Reintentos (`callWithFallback`): 500/502/503 → hasta 3 intentos por modelo (esperas 2 s y 4 s); si sigue, o con
  429/404/504, pasa al inferior (`FALLBACK_MODELS`: gemini-3.5-flash-lite → gemini-3.1-flash-lite). 400/401/403 no se
  reintentan. La respuesta dice qué modelo contestó (`fellBack`) y perfil/propuestas guardan `model`.
  `src/utils/gemini.ts` (cliente), `utils/coach.ts` (tipo de sesión por título, estadísticas del entrenador),
  `utils/aiPrompt.ts` (pregunta / perfil / semana), `utils/aiProposal.ts` (lee el JSON y compara: 60 % tipos por día,
  25 % tiempo, 15 % TSS), `stores/aiStore.ts` (localStorage `suunto-ai`). La opción de copiar y pegar se quitó.
  Reglas: nunca escribir en TrainingPeaks; las propuestas se marcan «PROPUESTA IA» y se pueden borrar (con
  confirmación) desde Entrenador IA y desde Plan; nunca rutas GPS en los textos; el texto de una semana no incluye
  nada de esa semana ni posterior (semanas pasadas = prueba justa, sin perfil). El entrenador planifica por TIEMPO:
  duración en el 100 % de sesiones, distancia solo en el 26 % (no usar km planificados como volumen).

## Pendiente
- Sincronización automática programada (el usuario avisará cuándo).
- Zapatillas: km por par con aviso (el usuario avisará cuándo).
- Evolución de récords (mejor por año / top 5): descartado por ahora.
