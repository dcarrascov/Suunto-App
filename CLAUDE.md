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
    `bestEfforts`, `bestEffortsSource`, `hrZoneSeconds` (Z1..Z5 del reloj). Así la web no carga 1400 detalles.

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

## Pendiente
- Sincronización automática programada (el usuario avisará cuándo).
- Zapatillas: km por par con aviso (el usuario avisará cuándo).
- Evolución de récords (mejor por año / top 5): descartado por ahora.
