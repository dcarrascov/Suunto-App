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
  - Salida: `activities.json` (resúmenes), `activity_{id}.json` (detalle: zonas, parciales, ruta, extra), `stats.json`.
- `src/` (React 19 + Vite + Tailwind 4 + Zustand + Recharts + Leaflet, TypeScript):
  - `types/suunto.ts`: tipos (espejo del normalizador; si cambias uno, cambia el otro y `validate_output.py`).
  - `stores/activityStore.ts`: carga los JSON; ajustes persistidos en localStorage con clave `suunto-settings` (migra desde `garmin-settings`).
  - `utils/calculations.ts`: TSS estimado (TRIMP), CTL/ATL/TSB (EMA 42/7), zonas, agregados semanales, récords.
  - `utils/date.ts`, `hooks/`, `pages/` (Dashboard, Actividades, Detalle, Fitness, Zonas, Rendimiento, Récords, Ajustes).

## Convenciones
- **Fechas siempre en hora local.** `startTime` es ISO local sin zona. Nunca usar `toISOString()` para sacar un día:
  usar `toLocalISODate`, `parseLocalDate`, `isoDateOffset`, `daysAgo` (date.ts) y `localWeekStart` (calculations.ts).
- Datos personales (`public/data/`, `fetch/debug/`, `fetch/fit/`, `.env`) están en `.gitignore`: no subirlos.
- Comprobar antes de commit: `npx tsc -b` y `py fetch\validate_output.py`.
- Git: rama principal `main`; trabajo en ramas (p. ej. `fix`) y fusión a `main` cuando el usuario lo pide.

## Datos actuales
~1440 actividades (jul 2023 → oct 2026), ~97 % carrera; el resto natación, bici y otros.

## Hecho
- VO2max del Dashboard = media semanal; tooltip en la carga semanal.
- Fechas en hora local en toda la app (racha, Fitness, Zonas, filtros, "Hoy/Ayer").
- Renombrado Garmin → Suunto (tipos, paquete, CSS, clave de ajustes).

## Pendiente
1. **Récords reales** (siguiente tarea): `computePRs` usa el ritmo medio de toda la actividad,
   no el mejor tramo de 1/5/10 km… Calcularlo con parciales o muestras (requiere datos en el detalle o en el resumen).
2. `estimateTSS` usa `lthrRunning` para todos los deportes (afecta a ~20 actividades sin TSS).
3. La página Rendimiento asume reparto de triatlón 35/50/15; no encaja con un corredor puro.
