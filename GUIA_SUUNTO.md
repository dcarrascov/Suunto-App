# Actualización: tiempo de recuperación y estadísticas detalladas

Añade a tu proyecto:

- **Dashboard:** un tercer indicador **Recuperación** junto a Fatiga, con el tiempo de recuperación que te queda.
- **Detalle de actividad:** una sección **Estadísticas** como la de la app de Suunto, con Ritmo, Altura, Velocidad, Frecuencia cardiaca, Fisiología y Técnica. Solo se muestra lo que tu reloj envía.
- **Datos:** `vo2max` con decimales (62,2 en vez de 62), `stats.json` con la recuperación, y un `--dump` mucho más corto (de miles de líneas a unas 70).

Parte de **tu estado actual** (el proyecto entregado + tus dos arreglos del mapa), así que no pierdes nada.

## Qué hacer, paso a paso

### 1. Reemplazar 7 ficheros y crear 1

En IntelliJ: abre el fichero → `Ctrl + A` (seleccionar todo) → pega el contenido de abajo → `Ctrl + S`.

| # | Fichero | Qué hacer |
| --- | --- | --- |
| 1 | `fetch/normalizer.py` | Reemplazar todo el contenido |
| 2 | `fetch/sync.py` | Reemplazar todo el contenido |
| 3 | `fetch/fit_source.py` | Reemplazar todo el contenido |
| 4 | `fetch/validate_output.py` | Reemplazar todo el contenido |
| 5 | `src/types/garmin.ts` | Reemplazar todo el contenido |
| 6 | `src/components/ActivityStats.tsx` | **FICHERO NUEVO**: clic derecho en la carpeta `src/components` → New → File |
| 7 | `src/pages/ActivityDetail.tsx` | Reemplazar todo el contenido |
| 8 | `src/pages/Dashboard.tsx` | Reemplazar todo el contenido |

> Si has modificado por tu cuenta alguno de esos ficheros (aparte de los arreglos del mapa), dímelo antes de reemplazarlo.

### 2. Completar tus actividades ya descargadas

En la terminal, desde la carpeta del proyecto:

```powershell
py fetch\sync.py
```

Sin ninguna opción. Debe decir **«Se han completado N actividades ya guardadas con los datos nuevos (sin descargar nada más)»**. Completa tus 1434 actividades con los datos que ya vienen en la lista de Suunto, así que no vuelve a pedir los detalles uno a uno y tarda poco.

### 3. (Opcional) Mejores ritmos y FC mínima en tus actividades recientes

Dos datos, **FC mín.** y **Ritmo máx. de 30 s, 1, 3 y 5 min**, se calculan con las muestras de cada entrenamiento, que solo se descargan con el detalle. Las actividades ya guardadas no los tienen, y esas filas no se muestran. Para tenerlos en las recientes:

```powershell
py fetch\sync.py --force --since 2026-09-01
```

`--force` vuelve a descargar los detalles de ese periodo (tarda en proporción a cuántas haya). Puedes cambiar la fecha.

### 4. Abrir la app

Con `npm run dev` en marcha, refresca el navegador con `Ctrl + F5`.

## Qué esperar (y qué no)

- **Recuperación del Dashboard.** Es una **estimación**: toma el tiempo de recuperación acumulado que Suunto anota tras tu última actividad y le resta el tiempo transcurrido. Compárala con la que te dice el reloj o la app. Si no coincide, dímelo: en mi volcado hay tres valores de recuperación distintos y necesito ver los de otra actividad para saber cuál es el correcto.
- **Ritmo ajustado al calor, ritmo ajustado al viento, ritmo de esfuerzo real e índice de estrés térmico.** No los incluyo: no aparecen en el volcado de la actividad de 1 km que me pasaste y no voy a inventar de dónde salen. Para añadirlos necesito el volcado de tu carrera de 10,13 km (comando abajo).
- **Ritmo máx. de 30 s a 5 min.** Se calculan con las muestras GPS, que van cada unos 6 segundos, así que son aproximados y pueden diferir unos segundos de los de la app.
- **Altura y técnica.** El desnivel, los puntos más alto y bajo, las cadencias, la longitud de paso y de zancada y las velocidades verticales salen de campos que sí vienen en tus datos, o se calculan con fórmulas que cuadran con tus capturas (cadencia de pasos 182 y 210, punto más alto 45 m, ritmo máx. 3:13…). Los valores de tu app usan más decimales, así que puede haber diferencias de ±1.
- **Qué se muestra según el deporte.** La sección Ritmo no sale en bici ni natación; las cadencias de pasos y la longitud de paso solo en actividades a pie.

## Para completar lo que falta: volcado de la carrera de 10,13 km

1. Averigua su clave (cambia la fecha si hace falta):

```powershell
py -c "import json; [print(a['suuntoKey'], a['startTime'], a['distance'], 'km') for a in json.load(open('public/data/activities.json')) if a['startTime'].startswith('2026-10-04')]"
```

2. Haz el volcado con la clave de esa carrera:

```powershell
py fetch\sync.py --dump LA_CLAVE
```

3. Compárteme **solo** el fichero `fetch\debug\LA_CLAVE.redacted.json`. Ahora sale con unas 70 líneas en vez de miles y no lleva coordenadas ni tu usuario.

## Los ficheros

<details>
<summary><b><code>fetch/normalizer.py</code></b> · 510 líneas · clic para desplegar</summary>

```python
"""
Convierte datos de Suunto (backend de la app Suunto, o ficheros FIT) en el JSON
que espera el frontend React. Los tipos TypeScript equivalentes están en
src/types/garmin.ts.

Unidades de SALIDA (las mismas que usaba la versión Garmin):
    distance km · duration / movingTime s · avgPace s/km · avgSpeed km/h
    avgHR / maxHR bpm · elevationGain m · startTime ISO local (YYYY-MM-DDTHH:MM:SS)

Unidades de ENTRADA del backend de Suunto (comprobadas por proyectos que lo usan):
    totalDistance m · totalTime s · avgSpeed m/s · energyConsumption kcal
    hrdata.* bpm · timeInZone0..5 centisegundos · startTime epoch en milisegundos
    cadence.avg ciclos/min (en carrera hay que multiplicar x2 para pasos/min)
"""
from __future__ import annotations
import bisect
import math
import os
from datetime import datetime, timezone
from statistics import mean
from zoneinfo import ZoneInfo

# ── Deportes ────────────────────────────────────────────────────────────────
# IDs de actividad de Suunto -> categoría de la app (tipo Sport de garmin.ts).
# Cualquier otro ID cae en "other". Edita estos conjuntos para cambiar el reparto.
RUNNING_IDS = {1, 22, 53, 103, 115}    # Running, Trail, Cinta, Pista, Vertical
CYCLING_IDS = {2, 10, 52, 99, 114}     # Bici, MTB, Bici indoor, Gravel, Ciclocross
SWIMMING_IDS = {21, 85}                # Natación (piscina), Aguas abiertas

ACTIVITY_NAMES = {
    0: "Caminata", 1: "Carrera", 2: "Ciclismo", 10: "MTB", 11: "Senderismo",
    21: "Natación", 22: "Trail running", 23: "Gimnasio", 31: "Esquí de travesía",
    51: "Yoga", 52: "Ciclismo indoor", 53: "Cinta de correr", 54: "CrossFit",
    55: "Elíptica", 57: "Remo indoor", 58: "Estiramientos", 68: "Multideporte",
    70: "Trekking", 74: "Triatlón", 85: "Aguas abiertas", 99: "Gravel",
    103: "Pista", 112: "Meditación", 114: "Ciclocross", 115: "Carrera vertical",
    120: "Pilates",
}

# Límites de zona como % de la FC máxima (mismos que HR_ZONE_DEFS en calculations.ts)
HR_ZONE_PCTS = (0.0, 0.6, 0.7, 0.8, 0.9, 1.0)


def sport_of(activity_id: int | None) -> str:
    if activity_id in RUNNING_IDS:
        return "running"
    if activity_id in CYCLING_IDS:
        return "cycling"
    if activity_id in SWIMMING_IDS:
        return "swimming"
    return "other"


# ── Utilidades ──────────────────────────────────────────────────────────────

def _num(v, default=None):
    """float seguro: rechaza None, bool, texto no numérico, NaN e infinitos."""
    if v is None or isinstance(v, bool):
        return default
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


def _bpm(*values):
    """Primer valor válido como bpm entero. Si parece Hz (< 10) lo pasa a bpm."""
    for v in values:
        f = _num(v)
        if f and f > 0:
            return round(f * 60) if f < 10 else round(f)
    return 0


def _tz():
    name = os.getenv("SUUNTO_TIMEZONE", "").strip()
    if name:
        try:
            return ZoneInfo(name)
        except Exception:
            print(f"  WARNING: SUUNTO_TIMEZONE='{name}' no es válida; uso la zona del sistema")
    return None  # None = zona horaria local del sistema (con su horario de verano)


def local_iso(epoch_s: float, offset_min: float | None = None) -> str:
    """
    Epoch (s) -> hora local ISO sin zona, p. ej. 2026-09-30T07:45:00.
    Si el entrenamiento trae su diferencia horaria con UTC (`offset_min`) se usa esa,
    que es la hora real donde estabas; si no, la zona horaria del ordenador.
    """
    if offset_min is not None:
        return datetime.fromtimestamp(epoch_s + offset_min * 60, timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
    return datetime.fromtimestamp(epoch_s, _tz()).replace(tzinfo=None).isoformat(timespec="seconds")


def downsample(seq: list, limit: int) -> list:
    """Reduce a como mucho `limit` elementos repartidos por igual (conserva el último)."""
    if len(seq) <= limit:
        return list(seq)
    step = (len(seq) - 1) / (limit - 1)
    return [seq[round(i * step)] for i in range(limit)]


def _valid_latlon(lat, lon) -> bool:
    if lat is None or lon is None:
        return False
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    return not (abs(lat) < 1e-4 and abs(lon) < 1e-4)  # (0,0) = GPS sin fix


def route_points(latlons, limit: int = 500) -> list:
    """[(lat, lon), ...] -> [[lat, lon], ...] válidos y reducidos a `limit` puntos."""
    pts = [[round(la, 6), round(lo, 6)] for la, lo in latlons if _valid_latlon(la, lo)]
    return downsample(pts, limit)


def _window_mean(samples, t0, t1):
    vals = [v for t, v in samples if t0 < t <= t1 and v]
    return round(mean(vals)) if vals else None


def _elev_gain(alts, t0, t1) -> int:
    """Suma de subidas entre muestras consecutivas de altitud dentro de (t0, t1]."""
    inside = [h for t, h in alts if t0 <= t <= t1]
    return round(sum(max(0.0, b - a) for a, b in zip(inside, inside[1:])))


def _lap(index, dist_m, dur_s, hr, alts, t0, t1, power=None, gain=None):
    speed = dist_m / dur_s if dur_s > 0 and dist_m > 0 else 0
    return {
        "index": index,
        "distance": round(dist_m / 1000, 3),
        "duration": round(dur_s),
        "avgHR": _window_mean(hr, t0, t1) if hr is not None else None,
        "avgPace": round(1000 / speed) if speed > 0 else None,
        "avgSpeed": round(speed * 3.6, 1) if speed else None,
        "avgPower": power,
        "elevationGain": gain if gain is not None else _elev_gain(alts, t0, t1),
    }


def auto_splits(dist_pts, hr, alts, split_m: float) -> list:
    """
    Parciales de `split_m` metros a partir de muestras acumuladas [(t_s, dist_m)],
    interpolando el instante exacto en que se cruza cada marca. Sirve cuando el
    reloj no registró vueltas (autolap desactivado).
    """
    pts = sorted((t, d) for t, d in dist_pts if t is not None and d is not None)
    if pts and pts[0][0] > 0:
        pts.insert(0, (0.0, 0.0))
    if len(pts) < 2:
        return []
    laps, target, prev_t = [], split_m, 0.0
    for (t0, d0), (t1, d1) in zip(pts, pts[1:]):
        while d1 > d0 and d0 < target <= d1:
            t_cross = t0 + (t1 - t0) * (target - d0) / (d1 - d0)
            laps.append(_lap(len(laps) + 1, split_m, t_cross - prev_t, hr, alts, prev_t, t_cross))
            prev_t, target = t_cross, target + split_m
    rest = pts[-1][1] - (target - split_m)
    if rest >= 100 and pts[-1][0] > prev_t:
        laps.append(_lap(len(laps) + 1, rest, pts[-1][0] - prev_t, hr, alts, prev_t, pts[-1][0]))
    return laps


def hr_zones_from_samples(hr_samples, max_hr: int) -> list:
    """Segundos por zona (Z1-Z5) a partir de muestras [(t_s, bpm)] y la FC máxima."""
    secs = [0.0] * 5
    pts = sorted((t, v) for t, v in hr_samples if v and v > 0)
    for (t0, v), (t1, _) in zip(pts, pts[1:]):
        dt = min(t1 - t0, 15.0)  # un hueco largo (pausa) no cuenta como esfuerzo
        zone = max((z for z in range(5) if v >= max_hr * HR_ZONE_PCTS[z]), default=0)
        secs[zone] += dt
    if not any(secs):
        return []
    return [
        {"zone": z + 1, "name": f"Zona {z + 1}", "seconds": round(secs[z]),
         "lowBPM": round(max_hr * HR_ZONE_PCTS[z]),
         "highBPM": round(max_hr * HR_ZONE_PCTS[z + 1])}
        for z in range(5)
    ]


# ── Backend de Suunto: resumen ──────────────────────────────────────────────

def _ext(w: dict, kind: str):
    """Itera los bloques `extensions` de un tipo (SummaryExtension, FitnessExtension...)."""
    for e in w.get("extensions") or []:
        if isinstance(e, dict) and e.get("type") == kind:
            yield e


def _first_ext_value(w: dict, kind: str, key: str):
    for e in _ext(w, kind):
        v = _num(e.get(key))
        if v:
            return v
    return None


def _spm(cad, sport: str):
    """cadence.avg de Suunto son ciclos/min: en carrera x2 = pasos/min; en bici = rpm."""
    cad = _num(cad)
    if not cad or cad <= 0:
        return None
    if sport == "running":
        return round(cad * 2) if cad * 2 <= 250 else round(cad)  # si ya venía en spm
    if sport == "cycling":
        return round(cad)
    return None


def make_summary(*, start_s, sport, name, distance_m, duration_s, ascent_m, avg_hr, max_hr,
                 calories, tss=None, speed=None, power=None, np_w=None, cadence=None,
                 vo2max=None, aerobic_te=None, anaerobic_te=None, utc_offset_min=None,
                 **extra) -> dict:
    """
    ÚNICO sitio que define la forma de ActivitySummary (garmin.ts). Lo usan tanto
    la fuente "nube de Suunto" como la fuente "ficheros FIT".
    """
    start_iso = local_iso(start_s, utc_offset_min)
    if not speed and distance_m and duration_s:
        speed = distance_m / duration_s  # m/s
    summary = {
        "id": int(start_s),  # id numérico estable derivado de la hora de inicio
        "title": f"{name} · {start_iso[8:10]}/{start_iso[5:7]}",
        "sport": sport,
        "startTime": start_iso,
        "distance": round(distance_m / 1000, 2),
        "duration": round(duration_s),
        "movingTime": round(duration_s),
        "elevationGain": round(ascent_m or 0),
        "avgHR": round(avg_hr or 0),
        "maxHR": round(max_hr or 0),
        "calories": round(calories or 0),
        "tss": round(tss, 1) if tss else None,
        "avgPace": round(1000 / speed) if speed and speed > 0 else None,
        "avgSpeed": round(speed * 3.6, 1) if speed else None,
        "avgPower": round(power) if power else None,
        "normalizedPower": round(np_w) if np_w else None,
        "avgCadence": cadence,
        "vo2max": vo2max,
        "aerobicTE": round(aerobic_te, 1) if aerobic_te else None,
        "anaerobicTE": round(anaerobic_te, 1) if anaerobic_te else None,
    }
    if sport == "swimming":
        summary["swolf"] = None
        summary["avgStrokesPerLength"] = None
    summary.update(extra)
    return summary


def normalize_summary(w: dict) -> dict:
    """ActivitySummary a partir de un entrenamiento del backend de Suunto."""
    start_ms = _num(w.get("startTime"))
    if start_ms is None:
        raise ValueError("entrenamiento sin startTime")
    raw_id = _num(w.get("activityId"))
    activity_id = int(raw_id) if raw_id is not None else None
    sport = sport_of(activity_id)

    hr = w.get("hrdata") if isinstance(w.get("hrdata"), dict) else {}
    tss_blk = w.get("tss") if isinstance(w.get("tss"), dict) else {}
    cad = w.get("cadence")
    cad_avg = cad.get("avg") if isinstance(cad, dict) else cad

    return make_summary(
        start_s=start_ms / 1000,
        sport=sport,
        name=ACTIVITY_NAMES.get(activity_id) or (f"Actividad {activity_id}" if activity_id is not None else "Actividad"),
        distance_m=_num(w.get("totalDistance"), 0.0),
        duration_s=_num(w.get("totalTime"), 0.0),
        ascent_m=_num(w.get("totalAscent"), 0.0),
        avg_hr=_bpm(hr.get("workoutAvgHR"), hr.get("avg")),
        max_hr=_bpm(hr.get("workoutMaxHR"), hr.get("max")),
        calories=_num(w.get("energyConsumption"), 0.0),  # kcal por entrenamiento
        tss=_num(tss_blk.get("trainingStressScore")),
        speed=_num(w.get("avgSpeed")),  # m/s
        power=_num(w.get("avgPower")) or _first_ext_value(w, "SummaryExtension", "avgPower"),
        np_w=_num(tss_blk.get("normalizedPower")),
        cadence=_spm(cad_avg, sport),
        # estimatedVo2Max trae decimales (62,2); vo2Max es ese mismo valor redondeado (62)
        vo2max=(_first_ext_value(w, "FitnessExtension", "estimatedVo2Max")
                or _first_ext_value(w, "FitnessExtension", "vo2Max")),
        aerobic_te=_first_ext_value(w, "SummaryExtension", "pte"),  # Peak Training Effect 1..5
        anaerobic_te=None,  # no viene en los datos de Suunto que se conocen
        utc_offset_min=_num(w.get("timeOffsetInMinutes")),  # si el servidor lo envía
        suuntoKey=w.get("key"),  # dato extra (no lo usa la interfaz)
    )


# ── Backend de Suunto: detalle ──────────────────────────────────────────────

def _zone_lowers(w: dict) -> dict:
    """Límite inferior (bpm) de las zonas 1..5 según IntensityExtension."""
    lowers = {}
    for e in _ext(w, "IntensityExtension"):
        zones = ((e.get("zones") or {}).get("heartRate")) or {}
        for n in range(1, 6):
            z = zones.get(f"zone{n}")
            low = _num(z.get("lowerLimit")) if isinstance(z, dict) else None
            if low:
                lowers[n] = round(low)
        if lowers:
            break
    return lowers


def hr_zones_suunto(w: dict) -> list:
    """Zonas de FC tal como las calcula el reloj (timeInZone0..5, en centisegundos)."""
    secs = [(_num(w.get(f"timeInZone{i}"), 0.0) or 0.0) / 100 for i in range(6)]
    if not any(secs):
        return []
    secs[1] += secs[0]  # la "zona 0" (por debajo de Z1) se suma a Z1
    lowers = _zone_lowers(w)
    top = _bpm((w.get("hrdata") or {}).get("userMaxHR")) or None
    zones = []
    for z in range(1, 6):
        zones.append({
            "zone": z,
            "name": f"Zona {z}",
            "seconds": round(secs[z]),
            "lowBPM": lowers.get(z),
            "highBPM": lowers.get(z + 1) if z < 5 else top,
        })
    return zones


def _rows(data: dict, key: str) -> list:
    v = data.get(key) if isinstance(data, dict) else None
    return [r for r in v if isinstance(r, dict)] if isinstance(v, list) else []


def _dist_scale(loc_rows: list, total_m: float) -> float:
    """
    Comprueba en qué unidad viene la distancia acumulada `s` comparando su último
    valor con la distancia total del entrenamiento (se espera metros -> 1.0).
    """
    s_last = max((_num(r.get("s"), 0.0) for r in loc_rows), default=0.0)
    if not s_last or not total_m:
        return 1.0
    best = min((1.0, 0.1, 0.01, 0.001, 10.0, 100.0, 1000.0), key=lambda c: abs(s_last * c - total_m))
    return best if abs(s_last * best - total_m) / total_m < 0.25 else 1.0


def _laps_from_events(events: list, total_t: float, total_m: float, scale: float, hr, alts) -> list:
    raw = [(_num(r.get("t")), _num(r.get("s"))) for r in events]
    pts = sorted(
        ((t, s * scale if s is not None else None) for t, s in raw if t is not None),
        key=lambda p: p[0],
    )
    if total_t and (not pts or total_t - pts[-1][0] > 5):  # última vuelta (parcial)
        pts.append((total_t, total_m or None))
    laps, prev_t, prev_s = [], 0.0, 0.0
    for t, s in pts:
        dur = t - prev_t
        if dur <= 0:
            continue
        dist = (s - prev_s) if s is not None and s >= prev_s else 0.0
        laps.append(_lap(len(laps) + 1, dist, dur, hr, alts, prev_t, t))
        prev_t = t
        if s is not None:
            prev_s = s
    return laps


# ── Datos extra para la pantalla de detalle ─────────────────────────────────

PEAK_WINDOWS = {"peakPace30s": 30, "peakPace1m": 60, "peakPace3m": 180, "peakPace5m": 300}


def _pace(speed_ms):
    """m/s -> segundos por km."""
    return round(1000 / speed_ms) if speed_ms and speed_ms > 0 else None


def _secs(v, total_time):
    """Segundos; si el valor es absurdamente grande para la duración, se asume milisegundos."""
    v = _num(v)
    if v is None:
        return None
    return v / 1000 if total_time and v > total_time * 1.5 else v


def best_window_speed(dist_pts, window_s: float):
    """Mayor velocidad media (m/s) en cualquier tramo de `window_s` s, sobre muestras [(t_s, dist_m)] acumuladas."""
    pts = sorted((t, d) for t, d in dist_pts if t is not None and d is not None)
    if len(pts) < 2 or pts[-1][0] - pts[0][0] < window_s:
        return None
    ts = [p[0] for p in pts]

    def dist_at(t):
        i = bisect.bisect_right(ts, t)
        if i <= 0:
            return pts[0][1]
        if i >= len(pts):
            return pts[-1][1]
        (t0, d0), (t1, d1) = pts[i - 1], pts[i]
        return d0 if t1 == t0 else d0 + (d1 - d0) * (t - t0) / (t1 - t0)

    starts = [t for t in ts if t + window_s <= ts[-1]] + [t - window_s for t in ts if t - window_s >= ts[0]]
    best = max(((dist_at(s + window_s) - dist_at(s)) / window_s for s in starts), default=None)
    return best if best and best > 0 else None


def sample_extra(dist_pts, hr, alts) -> dict:
    """Extras que se calculan a partir de las muestras (sirven para la nube y para FIT)."""
    out = {k: _pace(best_window_speed(dist_pts, w)) for k, w in PEAK_WINDOWS.items()}
    out["minHR"] = round(min(v for _, v in hr)) if hr else None
    if alts:
        out["minAltitude"] = round(min(h for _, h in alts), 1)
        out["maxAltitude"] = round(max(h for _, h in alts), 1)
    return out


EXTRA_KEYS = (
    "maxSpeed", "maxPace", "ngp", "peakPace30s", "peakPace1m", "peakPace3m", "peakPace5m",
    "ascent", "descent", "ascentTime", "descentTime", "minAltitude", "maxAltitude",
    "ascentSpeed", "descentSpeed", "minHR", "tssMethod", "epoc", "recoveryTime",
    "steps", "stepCadence", "maxStepCadence", "cadence", "maxCadence", "stepLength", "strideLength",
)


def build_extra(w: dict, summary: dict, samples: dict | None = None) -> dict:
    """
    Datos adicionales de un entrenamiento de Suunto para la pantalla de detalle. Todas las claves
    existen siempre; las que Suunto no envía valen None (la interfaz no las muestra).
    `samples` es el resultado de sample_extra() cuando se han descargado las muestras.
    """
    sport = summary["sport"]
    total_time = _num(w.get("totalTime"), 0.0) or 0.0
    summ = next(_ext(w, "SummaryExtension"), {})
    tss_blk = w.get("tss") if isinstance(w.get("tss"), dict) else {}
    cad = w.get("cadence") if isinstance(w.get("cadence"), dict) else {}

    max_speed = _num(w.get("maxSpeed"))  # m/s
    avg_speed = _num(w.get("avgSpeed"))
    if not avg_speed and total_time:
        avg_speed = (_num(w.get("totalDistance"), 0.0) or 0.0) / total_time
    ascent, descent = _num(w.get("totalAscent")), _num(w.get("totalDescent"))
    asc_t, desc_t = _secs(summ.get("ascentTime"), total_time), _secs(summ.get("descentTime"), total_time)
    steps = _num(w.get("stepCount"))
    foot = sport == "running" or (sport == "other" and bool(steps))  # actividades a pie
    cad_avg, cad_max = _num(cad.get("avg")), _num(cad.get("max"))  # ciclos/min
    min_alt, max_alt = _num(w.get("minAltitude")), _num(w.get("maxAltitude"))  # decímetros
    step_len = avg_speed / (cad_avg * 2 / 60) * 100 if foot and cad_avg and avg_speed else None  # cm

    extra = {
        "maxSpeed": round(max_speed * 3.6, 1) if max_speed else None,
        "maxPace": _pace(max_speed),
        "ngp": _pace(_num(tss_blk.get("averageGradeAdjustedPace"))),  # ritmo ajustado a la pendiente
        "ascent": round(ascent) if ascent is not None else None,
        "descent": round(descent) if descent is not None else None,
        "ascentTime": round(asc_t) if asc_t else None,
        "descentTime": round(desc_t) if desc_t else None,
        "minAltitude": round(min_alt / 10, 1) if min_alt is not None else None,
        "maxAltitude": round(max_alt / 10, 1) if max_alt is not None else None,
        "ascentSpeed": round(ascent / (asc_t / 60), 1) if ascent and asc_t else None,  # m/min
        "descentSpeed": round(descent / (desc_t / 60), 1) if descent and desc_t else None,
        "tssMethod": tss_blk.get("calculationMethod") if tss_blk.get("trainingStressScore") else None,
        "epoc": _num(summ.get("peakEpoc")),
        "recoveryTime": _num(w.get("recoveryTime")) or _num(summ.get("recoveryTime")),  # segundos
        "steps": round(steps) if steps else None,
        "stepCadence": round(cad_avg * 2) if foot and cad_avg else None,  # pasos/min
        "maxStepCadence": round(cad_max * 2) if foot and cad_max else None,
        "cadence": round(cad_avg) if (foot or sport == "cycling") and cad_avg else None,  # rpm
        "maxCadence": round(cad_max) if (foot or sport == "cycling") and cad_max else None,
        "stepLength": round(step_len) if step_len else None,
        "strideLength": round(step_len * 2) if step_len else None,
        "peakPace30s": None, "peakPace1m": None, "peakPace3m": None, "peakPace5m": None, "minHR": None,
    }
    for k, v in (samples or {}).items():  # lo calculado de las muestras solo rellena huecos
        if extra.get(k) is None:
            extra[k] = v
    return {k: extra.get(k) for k in EXTRA_KEYS}


def normalize_detail(summary: dict, w: dict, data: dict | None) -> dict:
    """
    ActivityDetail: resumen + zonas de FC + parciales + ruta GPS.
    `w` es el entrenamiento de Suunto y `data` la respuesta de workouts/{key}/data
    (heartrates, locations, eventlaps). Con data=None solo hay zonas de FC.
    """
    detail = dict(summary)
    detail["hrZones"] = hr_zones_suunto(w)
    detail["laps"], detail["gpxCoords"] = [], []
    detail["extra"] = build_extra(w, summary, None)
    if not data:
        return detail

    hr = [(_num(r.get("t")), _num(r.get("hr"))) for r in _rows(data, "heartrates")]
    hr = [(t, v) for t, v in hr if t is not None and v]
    loc = _rows(data, "locations")
    total_m = _num(w.get("totalDistance"), 0.0) or 0.0
    scale = _dist_scale(loc, total_m)
    alts = [(_num(r.get("t")), _num(r.get("h"))) for r in loc]
    alts = sorted((t, h) for t, h in alts if t is not None and h is not None)

    detail["gpxCoords"] = route_points([(_num(r.get("la")), _num(r.get("ln"))) for r in loc])

    dist_pts = [(_num(r.get("t")), (_num(r.get("s")) or 0.0) * scale) for r in loc if r.get("s") is not None]
    events = _rows(data, "eventlaps")
    laps = _laps_from_events(events, summary["duration"], total_m, scale, hr, alts) if events else []
    if len(laps) < 2:  # sin vueltas del reloj: parciales automáticos por distancia
        split_m = 5000.0 if summary["sport"] == "cycling" else 1000.0
        laps = auto_splits(dist_pts, hr, alts, split_m) or laps
    detail["laps"] = laps
    detail["extra"] = build_extra(w, summary, sample_extra(dist_pts, hr, alts))
    return detail
```

</details>
<details>
<summary><b><code>fetch/sync.py</code></b> · 332 líneas · clic para desplegar</summary>

```python
#!/usr/bin/env python3
"""
Suunto -> JSON local.

Uso (desde la carpeta raíz del proyecto):
    python3 fetch/sync.py                       # todo el historial (nube de Suunto)
    python3 fetch/sync.py --limit 20            # solo las 20 más recientes (para probar)
    python3 fetch/sync.py --since 2024-01-01    # solo desde una fecha
    python3 fetch/sync.py --no-gpx              # más rápido: sin ruta GPS ni parciales
    python3 fetch/sync.py --force               # vuelve a descargar los detalles ya guardados
    python3 fetch/sync.py --source fit          # lee los .fit de la carpeta fetch/fit/
    python3 fetch/sync.py --dump latest         # guarda las respuestas crudas para depurar

Fuente "nube": la sesión la crea `suuntool login` (ver la guía); aquí no hay contraseñas.
Salida: public/data/activities.json + activity_{id}.json + stats.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

for _stream in (sys.stdout, sys.stderr):  # evita errores con consolas de codificación limitada (Windows)
    try:
        _stream.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

OUT_DIR = ROOT / "public" / "data"
PAUSE = float(os.getenv("SUUNTO_PAUSE", "0.6"))  # segundos entre actividades (límite de ritmo)
DEBUG_DIR = Path(__file__).resolve().parent / "debug"
DETAIL_ONLY = ("laps", "hrZones", "gpxCoords", "extra", "partial")  # claves que no van en el resumen


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def since_ms(since: str | None) -> int:
    if not since:
        return 0
    try:
        return int(datetime.strptime(since, "%Y-%m-%d").timestamp() * 1000)
    except ValueError:
        sys.exit("ERROR: --since debe tener el formato YYYY-MM-DD (por ejemplo 2024-01-01)")


# ── Fuente: nube de Suunto ──────────────────────────────────────────────────

def make_client():
    from suunto_client import SuuntoAuthError, SuuntoClient
    try:
        return SuuntoClient()
    except SuuntoAuthError as e:
        sys.exit(f"ERROR: {e}")


def collect_cloud(args):
    from normalizer import _num, normalize_detail, normalize_summary
    from suunto_client import SuuntoAuthError, SuuntoError

    client = make_client()
    print("Leyendo la lista de entrenamientos de Suunto...")
    try:
        raw_list = client.list_workouts(since_ms(args.since))
    except SuuntoAuthError as e:
        sys.exit(f"ERROR: {e}")
    except SuuntoError as e:
        sys.exit(f"ERROR: {e}")
    print(f"Total entrenamientos: {len(raw_list)}")

    entries, user_max_hr = [], None
    for raw in sorted(raw_list, key=lambda w: w.get("startTime") or 0, reverse=True):
        try:
            summary = normalize_summary(raw)
        except Exception as e:
            print(f"  WARNING: no pude procesar el entrenamiento {raw.get('key')}: {e}")
            continue
        if user_max_hr is None:
            hr = raw.get("hrdata") if isinstance(raw.get("hrdata"), dict) else {}
            user_max_hr = hr.get("userMaxHR")

        def load(raw=raw, summary=summary):
            w, data = raw, None
            if not args.no_gpx:
                if raw.get("extensions") is None:  # la lista no trae VO2max/TE: pedir el detalle
                    try:
                        w = {**raw, **client.workout(raw["key"])}
                    except SuuntoAuthError:
                        raise
                    except SuuntoError as e:
                        print(f"  WARNING: detalle {raw['key']}: {e}")
                try:
                    data = client.workout_data(raw["key"])
                except SuuntoAuthError:
                    raise
                except SuuntoError as e:
                    print(f"  WARNING: muestras {raw['key']}: {e}")
            new_summary = normalize_summary(w)
            new_summary["id"] = summary["id"]  # conserva el id (puede haberse desplazado)
            detail = normalize_detail(new_summary, w, data)
            if args.no_gpx:
                detail["partial"] = True  # se completará en la próxima sync sin --no-gpx
            return new_summary, detail

        entries.append({"summary": summary, "load": load, "network": True, "raw": raw})
    meta = {"userMaxHR": round(float(user_max_hr)) if user_max_hr else None}

    # Tiempo de recuperación acumulado tras el último entrenamiento y cuándo terminó (la web calcula lo que queda)
    latest = max(raw_list, key=lambda w: w.get("startTime") or 0, default=None)
    if latest:
        secs = _num(latest.get("cumulativeRecoveryTime")) or _num(latest.get("recoveryTime"))
        ended = _num(latest.get("stopTime")) or (
            (_num(latest.get("startTime"), 0.0) or 0.0) + (_num(latest.get("totalTime"), 0.0) or 0.0) * 1000)
        if secs and ended:
            meta["recovery"] = {"seconds": round(secs), "endedAt": int(ended)}
    return entries, meta


# ── Fuente: ficheros FIT ────────────────────────────────────────────────────

def collect_fit(args):
    from fit_source import parse_fit

    fit_dir = Path(args.fit_dir) if args.fit_dir else Path(__file__).resolve().parent / "fit"
    files = sorted(p for p in fit_dir.rglob("*") if p.suffix.lower() == ".fit")
    if not files:
        sys.exit(f"ERROR: no hay ficheros .fit en {fit_dir} (copia ahí los que exportes de la app)")
    max_hr = int(os.getenv("MAX_HR", "185"))
    print(f"Leyendo {len(files)} ficheros FIT de {fit_dir} (FC máxima para zonas: {max_hr})...")

    entries, seen = [], set()
    for path in files:
        try:
            summary, detail = parse_fit(path, max_hr)
        except Exception as e:
            print(f"  AVISO: {path.name} omitido: {e}")
            continue
        if summary["id"] in seen:
            print(f"  AVISO: {path.name} es un duplicado (misma hora de inicio); lo omito")
            continue
        seen.add(summary["id"])
        entries.append({"summary": summary, "load": lambda s=summary, d=detail: (s, d), "network": False})
    return entries, {}


# ── Depuración ──────────────────────────────────────────────────────────────

SENSITIVE = {"la", "ln", "lat", "lon", "latitude", "longitude", "x", "y", "polyline", "username", "email"}


def redact(obj):
    """Copia sin datos personales: coordenadas, ruta codificada y nombre de usuario."""
    if isinstance(obj, dict):
        return {k: "REDACTED" if k in SENSITIVE else redact(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


def compress_streams(obj):
    """En el detalle de Suunto las series (FC, altitud, GPS…) son enormes: deja solo el total y 3 muestras."""
    if isinstance(obj, dict):
        return {k: ({"_total": len(v), "_first3": v[:3]} if k in ("points", "locationPoints") and isinstance(v, list)
                    else compress_streams(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [compress_streams(v) for v in obj]
    return obj


def redacted_sample(data: dict) -> dict:
    """Del detalle de muestras (/data) conserva solo la estructura: total y 3 primeras filas por serie."""
    return {
        k: ({"_total": len(v), "_first3": redact(v[:3])} if isinstance(v, list) else redact(v))
        for k, v in data.items()
    }


def dump(which: str):
    from suunto_client import SuuntoError
    client = make_client()
    try:
        if which == "latest":
            items = client.list_workouts()
            if not items:
                sys.exit("No hay entrenamientos en tu cuenta.")
            item = max(items, key=lambda w: w.get("startTime") or 0)
        else:
            item = {"key": which}
        key = item["key"]
        files = {"list": item, "detail": client.workout(key), "data": client.workout_data(key)}
    except SuuntoError as e:
        sys.exit(f"ERROR: {e}")
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    for name, payload in files.items():
        path = DEBUG_DIR / f"{key}.{name}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        if isinstance(payload, dict):
            shape = {k: (len(v) if isinstance(v, (list, dict)) else type(v).__name__) for k, v in payload.items()}
            print(f"{path.relative_to(ROOT)}\n    {shape}")
    safe = DEBUG_DIR / f"{key}.redacted.json"
    safe.write_text(json.dumps({
        "list": redact(files["list"]), "detail": compress_streams(redact(files["detail"])),
        "data": redacted_sample(files["data"]),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nPara pedir ayuda comparte SOLO {safe.relative_to(ROOT)} (sin coordenadas ni usuario).")
    print("Los demás ficheros de esa carpeta contienen tu ruta GPS: no los compartas.")


# ── Estadísticas globales ───────────────────────────────────────────────────

def compute_stats(summaries: list, meta: dict) -> dict:
    by_sport: dict = {}
    for s in summaries:
        by_sport.setdefault(s.get("sport", "other"), []).append(s)
    vo2max_history = sorted(
        ({"date": s["startTime"][:10], "value": s["vo2max"]} for s in summaries if s.get("vo2max")),
        key=lambda x: x["date"],
    )
    stats = {
        "totalActivities": len(summaries),
        "byType": {sport: len(acts) for sport, acts in by_sport.items()},
        "vo2maxHistory": vo2max_history,
        "syncedAt": datetime.now().isoformat(),
    }
    if meta.get("userMaxHR"):
        stats["userMaxHR"] = meta["userMaxHR"]
    if meta.get("recovery"):
        stats["recovery"] = meta["recovery"]
    return stats


# ── Principal ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Sincroniza tus entrenamientos de Suunto a JSON local")
    parser.add_argument("--source", choices=["cloud", "fit"], default="cloud",
                        help="cloud = nube de Suunto (por defecto) · fit = ficheros .fit exportados")
    parser.add_argument("--fit-dir", default=None, help="carpeta con los .fit (por defecto fetch/fit)")
    parser.add_argument("--limit", type=int, default=None, help="máximo de actividades (para probar)")
    parser.add_argument("--since", type=str, default=None, help="solo desde esta fecha (YYYY-MM-DD)")
    parser.add_argument("--no-gpx", action="store_true", help="sin ruta GPS ni parciales (más rápido; solo nube)")
    parser.add_argument("--force", action="store_true", help="vuelve a descargar los detalles ya guardados")
    parser.add_argument("--dump", metavar="KEY|latest", default=None,
                        help="guarda en fetch/debug las respuestas crudas de un entrenamiento y sale")
    args = parser.parse_args()

    since_ms(args.since)  # valida el formato antes de tocar la red
    if args.dump:
        return dump(args.dump)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries, meta = collect_fit(args) if args.source == "fit" else collect_cloud(args)

    # ids únicos y estables (derivados de la hora de inicio)
    used = set()
    for e in sorted(entries, key=lambda e: (e["summary"]["startTime"], e["summary"].get("suuntoKey") or "")):
        while e["summary"]["id"] in used:
            e["summary"]["id"] += 1
        used.add(e["summary"]["id"])

    if args.since:
        entries = [e for e in entries if e["summary"]["startTime"] >= args.since]
    entries.sort(key=lambda e: e["summary"]["startTime"], reverse=True)
    if args.limit:
        entries = entries[: args.limit]

    save_json(OUT_DIR / "activities.json", [e["summary"] for e in entries])
    print(f"Guardados {len(entries)} resúmenes → public/data/activities.json")

    from normalizer import build_extra, normalize_summary
    from suunto_client import SuuntoAuthError  # solo para capturar el error de sesión
    print(f"\nProcesando el detalle de {len(entries)} actividades...")
    updated = 0
    for i, e in enumerate(entries):
        s = e["summary"]
        path = OUT_DIR / f"activity_{s['id']}.json"
        tag = f"[{i + 1}/{len(entries)}] {s['id']}"

        if path.exists() and not args.force:
            cached = json.loads(path.read_text(encoding="utf-8"))
            if not (cached.get("partial") and not args.no_gpx):
                raw = e.get("raw")
                if raw is not None and "extra" not in cached:
                    # detalle guardado con una versión anterior: se completa con los datos nuevos que
                    # ya vienen en la lista (no hace falta pedir nada más a Suunto)
                    fresh = normalize_summary(raw)
                    cached["extra"] = build_extra(raw, cached, None)
                    for k in ("vo2max", "aerobicTE"):
                        cached[k] = fresh[k]
                    save_json(path, cached)
                    updated += 1
                print(f"  {tag} — ya guardada, la salto")
                e["summary"] = {k: v for k, v in cached.items() if k not in DETAIL_ONLY}
                continue

        print(f"  {tag} ({s.get('title', '')})...")
        try:
            new_summary, detail = e["load"]()
            save_json(path, detail)
            e["summary"] = new_summary
        except SuuntoAuthError as err:
            sys.exit(f"ERROR: {err}")
        except Exception as err:
            print(f"  WARNING: no pude procesar {s['id']}: {err}")
        if e["network"] and not args.no_gpx:
            time.sleep(PAUSE)  # el servidor admite pocas peticiones por segundo

    if updated:
        print(f"\nSe han completado {updated} actividades ya guardadas con los datos nuevos (sin descargar nada más).")
    summaries = [e["summary"] for e in entries]
    save_json(OUT_DIR / "activities.json", summaries)
    save_json(OUT_DIR / "stats.json", compute_stats(summaries, meta))
    print("\n¡Listo! Datos guardados en public/data/")
    if meta.get("userMaxHR"):
        print(f"Tu FC máxima según Suunto es {meta['userMaxHR']} bpm → ponla en Ajustes dentro de la app.")
    print("Ejecuta 'npm run dev' para abrir la app.")


if __name__ == "__main__":
    main()
```

</details>
<details>
<summary><b><code>fetch/fit_source.py</code></b> · 186 líneas · clic para desplegar</summary>

```python
"""
Fuente alternativa SIN cuenta ni API: lee ficheros .fit (los que exporta la app de
Suunto: abrir entrenamiento > menú ⋮ > exportar FIT) y los convierte al mismo JSON
que la fuente "nube". Sirve con cualquier reloj que exporte FIT.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from pathlib import Path

from garmin_fit_sdk import Decoder, Stream

from normalizer import (
    EXTRA_KEYS, _lap, _num, _pace, _spm, auto_splits, hr_zones_from_samples, make_summary,
    route_points, sample_extra,
)

SEMICIRCLES = 180.0 / 2 ** 31  # los FIT guardan las coordenadas en semicírculos
FIT_EPOCH = datetime(1989, 12, 31, tzinfo=timezone.utc)  # origen de las fechas FIT

_NAMES = {
    ("running", "trail"): "Trail running", ("running", "treadmill"): "Cinta de correr",
    ("running", "track"): "Pista", ("cycling", "mountain"): "MTB",
    ("cycling", "indoor_cycling"): "Ciclismo indoor", ("cycling", "gravel_cycling"): "Gravel",
    ("cycling", "cyclocross"): "Ciclocross", ("swimming", "open_water"): "Aguas abiertas",
}
_BASE = {
    "running": "Carrera", "cycling": "Ciclismo", "swimming": "Natación", "walking": "Caminata",
    "hiking": "Senderismo", "training": "Entrenamiento", "multisport": "Multideporte",
}


def _first(*values):
    """Primer valor numérico no nulo (el 0 cuenta como valor válido)."""
    for v in values:
        f = _num(v)
        if f is not None:
            return f
    return None


def _positive(*values):
    f = _first(*values)
    return f if f and f > 0 else None


def _sport(sessions: list) -> tuple[str, str]:
    """(categoría de la app, nombre en español) a partir de las sesiones del FIT."""
    pairs = {((s.get("sport") or "").lower(), (s.get("sub_sport") or "").lower()) for s in sessions}
    if len({p[0] for p in pairs}) > 1:
        return "other", _BASE["multisport"]
    sport, sub = next(iter(pairs))
    name = _NAMES.get((sport, sub)) or _BASE.get(sport) or sport.replace("_", " ").title() or "Actividad"
    if sport == "running":
        return "running", name
    if sport == "cycling" and not sub.startswith("e_bike"):
        return "cycling", name
    if sport == "swimming":
        return "swimming", name
    return "other", name


def _fit_laps(lap_msgs: list, start, hr, alts) -> list:
    laps = []
    for m in lap_msgs:
        dur = _first(m.get("total_timer_time"), m.get("total_elapsed_time")) or 0.0
        if dur <= 0:
            continue
        dist = _first(m.get("total_distance")) or 0.0
        t0 = (m["start_time"] - start).total_seconds() if m.get("start_time") else None
        t1 = t0 + (_first(m.get("total_elapsed_time")) or dur) if t0 is not None else None
        lap = _lap(
            len(laps) + 1, dist, dur,
            hr if t0 is not None else None, alts, t0 or 0.0, t1 or 0.0,
            power=round(_positive(m.get("avg_power")) or 0) or None,
            gain=round(_first(m.get("total_ascent")) or 0) if m.get("total_ascent") is not None else None,
        )
        own_hr = _positive(m.get("avg_heart_rate"))  # preferimos el valor del propio reloj
        if own_hr:
            lap["avgHR"] = round(own_hr)
        laps.append(lap)
    return laps


def parse_fit(path: Path, max_hr: int = 185) -> tuple[dict, dict]:
    """Devuelve (resumen, detalle) en el formato de garmin.ts. Lanza ValueError si no es una actividad."""
    decoder = Decoder(Stream.from_file(str(path)))
    if not decoder.is_fit():
        raise ValueError("no es un fichero FIT")
    messages, _errors = decoder.read(enable_crc_check=False)
    sessions = messages.get("session_mesgs") or []
    records = messages.get("record_mesgs") or []
    if not sessions or not records or not sessions[0].get("start_time"):
        raise ValueError("no contiene una actividad (sin sesión o sin registros)")

    first = sessions[0]
    start = first["start_time"]  # datetime con zona UTC

    # Hora local exacta: el mensaje `activity` trae timestamp (UTC) y local_timestamp (local)
    offset_min = None
    for act in messages.get("activity_mesgs") or []:
        ts, lts = act.get("timestamp"), act.get("local_timestamp")
        if ts is not None and isinstance(lts, (int, float)):  # entero: segundos desde la época FIT
            lts = FIT_EPOCH + timedelta(seconds=lts)
        if ts is not None and isinstance(lts, datetime):
            if lts.tzinfo is None and ts.tzinfo is not None:
                lts = lts.replace(tzinfo=ts.tzinfo)
            delta = (lts - ts).total_seconds() / 60
            if abs(delta) <= 14 * 60:
                offset_min = delta
        break

    hr, alts, dist_pts, latlons = [], [], [], []
    for r in records:
        ts = r.get("timestamp")
        if ts is None:
            continue
        t = (ts - start).total_seconds()
        h = _positive(r.get("heart_rate"))
        if h:
            hr.append((t, h))
        alt = _first(r.get("enhanced_altitude"), r.get("altitude"))
        if alt is not None:
            alts.append((t, alt))
        d = _first(r.get("distance"))
        if d is not None:
            dist_pts.append((t, d))
        lat, lon = r.get("position_lat"), r.get("position_long")
        if lat is not None and lon is not None:
            latlons.append((lat * SEMICIRCLES, lon * SEMICIRCLES))

    def total(key):
        vals = [v for v in (_num(s.get(key)) for s in sessions) if v is not None]
        return sum(vals) if vals else None

    sport, name = _sport(sessions)
    distance_m = total("total_distance") or (dist_pts[-1][1] if dist_pts else 0.0)
    timer = total("total_timer_time") or total("total_elapsed_time") or 0.0
    avg_hr = _positive(first.get("avg_heart_rate")) if len(sessions) == 1 else None
    if not avg_hr and hr:
        avg_hr = sum(v for _, v in hr) / len(hr)  # algunos relojes no lo rellenan en la sesión
    max_hr_seen = _positive(first.get("max_heart_rate")) if len(sessions) == 1 else None
    max_hr_seen = max_hr_seen or (max(v for _, v in hr) if hr else None)

    summary = make_summary(
        start_s=start.timestamp(),
        sport=sport,
        name=name,
        distance_m=distance_m,
        duration_s=timer,
        ascent_m=total("total_ascent"),
        avg_hr=avg_hr,
        max_hr=max_hr_seen,
        calories=total("total_calories"),
        tss=_positive(first.get("training_stress_score")),
        speed=_positive(first.get("enhanced_avg_speed"), first.get("avg_speed")),
        power=_positive(first.get("avg_power")),
        np_w=_positive(first.get("normalized_power")),
        cadence=_spm(_positive(first.get("avg_cadence")), sport),
        aerobic_te=_positive(first.get("total_training_effect")),
        anaerobic_te=_positive(first.get("total_anaerobic_training_effect")),
        utc_offset_min=offset_min,
        sourceFile=path.name,  # dato extra (no lo usa la interfaz)
    )

    laps = _fit_laps(messages.get("lap_mesgs") or [], start, hr, alts)
    if len(laps) < 2:  # sin vueltas del reloj: parciales automáticos por distancia
        split_m = 5000.0 if sport == "cycling" else 1000.0
        laps = auto_splits(dist_pts, hr, alts, split_m) or laps

    detail = dict(summary)
    detail["hrZones"] = hr_zones_from_samples(hr, max_hr)
    detail["laps"] = laps
    detail["gpxCoords"] = route_points(latlons)

    # Datos extra (los que un FIT permite calcular)
    max_speed = _positive(first.get("enhanced_max_speed"), first.get("max_speed"))
    extra = {k: None for k in EXTRA_KEYS}
    extra.update(sample_extra(dist_pts, hr, alts))
    extra.update({
        "maxSpeed": round(max_speed * 3.6, 1) if max_speed else None,
        "maxPace": _pace(max_speed),
        "ascent": round(total("total_ascent")) if total("total_ascent") is not None else None,
        "descent": round(total("total_descent")) if total("total_descent") is not None else None,
    })
    detail["extra"] = extra
    return summary, detail
```

</details>
<details>
<summary><b><code>fetch/validate_output.py</code></b> · 159 líneas · clic para desplegar</summary>

```python
#!/usr/bin/env python3
"""
Comprueba que public/data/ cumple el contrato que espera el frontend
(src/types/garmin.ts). Úsalo después de sincronizar:

    python3 fetch/validate_output.py

Sale con código 1 si encuentra errores (los avisos no son errores).
"""
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
SPORTS = {"running", "cycling", "swimming", "other"}
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}")
REQUIRED_NUM = ["id", "distance", "duration", "movingTime", "elevationGain", "avgHR", "maxHR", "calories"]
NULLABLE_NUM = ["tss", "avgPace", "avgSpeed", "avgPower", "normalizedPower",
                "avgCadence", "vo2max", "aerobicTE", "anaerobicTE"]

errors: list[str] = []
warnings: list[str] = []


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_summary(a, where):
    for k in REQUIRED_NUM:
        if not num(a.get(k)):
            errors.append(f"{where}: '{k}' debe ser numérico (es {a.get(k)!r})")
    for k in NULLABLE_NUM:
        if k not in a:
            errors.append(f"{where}: falta '{k}' (puede ser null, pero la clave debe existir)")
        elif a[k] is not None and not num(a[k]):
            errors.append(f"{where}: '{k}' debe ser número o null (es {a[k]!r})")
    if not isinstance(a.get("title"), str) or not a.get("title"):
        errors.append(f"{where}: 'title' debe ser texto no vacío")
    if a.get("sport") not in SPORTS:
        errors.append(f"{where}: 'sport' debe ser uno de {sorted(SPORTS)} (es {a.get('sport')!r})")
    if not isinstance(a.get("startTime"), str) or not ISO.match(a["startTime"]):
        errors.append(f"{where}: 'startTime' debe ser ISO local YYYY-MM-DDTHH:MM:SS (es {a.get('startTime')!r})")
    elif a["startTime"][:10] > (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d"):
        warnings.append(f"{where}: startTime en el futuro ({a['startTime']})")
    if num(a.get("id")) and int(a["id"]) != a["id"]:
        errors.append(f"{where}: 'id' debe ser entero")
    if num(a.get("avgHR")) and a["avgHR"] < 0:
        errors.append(f"{where}: avgHR negativo")


EXTRA_TEXT = {"tssMethod"}


def check_extra(x, where):
    if x is None:
        return  # detalles guardados con una versión anterior: es opcional
    if not isinstance(x, dict):
        errors.append(f"{where}: 'extra' debe ser un objeto")
        return
    for k, v in x.items():
        if k in EXTRA_TEXT:
            if v is not None and not isinstance(v, str):
                errors.append(f"{where}: extra.{k} debe ser texto o null")
        elif v is not None and not num(v):
            errors.append(f"{where}: extra.{k} debe ser número o null (es {v!r})")


def check_detail(d, where):
    check_summary(d, where)
    check_extra(d.get("extra"), where)
    if not isinstance(d.get("laps"), list):
        errors.append(f"{where}: 'laps' debe ser una lista")
    else:
        for i, lap in enumerate(d["laps"]):
            for k in ("index", "distance", "duration", "elevationGain"):
                if not num(lap.get(k)):
                    errors.append(f"{where}: laps[{i}].{k} debe ser numérico")
            for k in ("avgHR", "avgPace", "avgSpeed", "avgPower"):
                if k not in lap or (lap[k] is not None and not num(lap[k])):
                    errors.append(f"{where}: laps[{i}].{k} debe ser número o null")
    if not isinstance(d.get("hrZones"), list):
        errors.append(f"{where}: 'hrZones' debe ser una lista")
    else:
        for i, z in enumerate(d["hrZones"]):
            if not (isinstance(z.get("zone"), int) and 1 <= z["zone"] <= 5):
                errors.append(f"{where}: hrZones[{i}].zone debe ser un entero 1-5")
            if not isinstance(z.get("name"), str) or not num(z.get("seconds")):
                errors.append(f"{where}: hrZones[{i}] necesita name (texto) y seconds (número)")
            for k in ("lowBPM", "highBPM"):
                if k not in z or (z[k] is not None and not num(z[k])):
                    errors.append(f"{where}: hrZones[{i}].{k} debe ser número o null")
    coords = d.get("gpxCoords")
    if not isinstance(coords, list):
        errors.append(f"{where}: 'gpxCoords' debe ser una lista")
    else:
        bad = [c for c in coords if not (isinstance(c, list) and len(c) == 2 and num(c[0]) and num(c[1])
                                          and -90 <= c[0] <= 90 and -180 <= c[1] <= 180)]
        if bad:
            errors.append(f"{where}: {len(bad)} coordenadas inválidas en gpxCoords (esperado [lat, lon])")


def main():
    acts_path = DATA / "activities.json"
    if not acts_path.exists():
        sys.exit(f"No existe {acts_path}. Ejecuta primero: python3 fetch/sync.py")
    acts = json.loads(acts_path.read_text(encoding="utf-8"))
    if not isinstance(acts, list):
        sys.exit("activities.json debe ser una lista")

    ids = [a.get("id") for a in acts]
    if len(ids) != len(set(ids)):
        errors.append("hay ids repetidos en activities.json")
    for a in acts:
        check_summary(a, f"activities.json[id={a.get('id')}]")

    missing = 0
    for a in acts:
        p = DATA / f"activity_{a.get('id')}.json"
        if not p.exists():
            missing += 1
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        if d.get("id") != a.get("id"):
            errors.append(f"{p.name}: el id no coincide con el de activities.json")
        check_detail(d, p.name)
    if missing:
        warnings.append(f"{missing} actividades sin fichero de detalle (la app las muestra sin mapa/parciales)")

    stats_path = DATA / "stats.json"
    if stats_path.exists():
        s = json.loads(stats_path.read_text(encoding="utf-8"))
        if not isinstance(s.get("totalActivities"), int) or not isinstance(s.get("byType"), dict):
            errors.append("stats.json: totalActivities (entero) y byType (objeto) son obligatorios")
        if not isinstance(s.get("syncedAt"), str):
            errors.append("stats.json: syncedAt debe ser texto")
        rec = s.get("recovery")
        if rec is not None and not (isinstance(rec, dict) and num(rec.get("seconds")) and num(rec.get("endedAt"))):
            errors.append("stats.json: recovery necesita seconds y endedAt (números)")
        for i, v in enumerate(s.get("vo2maxHistory") or []):
            if not isinstance(v.get("date"), str) or not num(v.get("value")):
                errors.append(f"stats.json: vo2maxHistory[{i}] necesita date (texto) y value (número)")
    else:
        warnings.append("no existe stats.json (es opcional)")

    print(f"{len(acts)} actividades revisadas · {len(errors)} errores · {len(warnings)} avisos")
    for w in warnings:
        print("  AVISO:", w)
    for e in errors[:40]:
        print("  ERROR:", e)
    if len(errors) > 40:
        print(f"  ... y {len(errors) - 40} errores más")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
```

</details>
<details>
<summary><b><code>src/types/garmin.ts</code></b> · 117 líneas · clic para desplegar</summary>

```ts
export type Sport = 'running' | 'cycling' | 'swimming' | 'other'

export interface HRZone {
  zone: number
  name: string
  seconds: number
  lowBPM: number | null
  highBPM: number | null
}

export interface Lap {
  index: number
  distance: number     // km
  duration: number     // seconds
  avgHR: number | null
  avgPace: number | null  // sec/km
  avgSpeed: number | null // km/h
  avgPower: number | null // watts
  elevationGain: number
}

export interface ActivitySummary {
  id: number
  title: string
  sport: Sport
  startTime: string    // ISO local datetime
  distance: number     // km
  duration: number     // seconds
  movingTime: number   // seconds
  elevationGain: number
  avgHR: number
  maxHR: number
  calories: number
  tss: number | null
  avgPace: number | null    // sec/km (running/swim)
  avgSpeed: number | null   // km/h (cycling)
  avgPower: number | null   // watts (cycling)
  normalizedPower: number | null
  avgCadence: number | null
  vo2max: number | null
  aerobicTE: number | null
  anaerobicTE: number | null
  // Swimming only
  swolf?: number | null
  avgStrokesPerLength?: number | null
}

// Datos extra de la pantalla de detalle. Todos opcionales: si el reloj no los envía valen null.
export interface ActivityExtra {
  maxSpeed: number | null        // km/h
  maxPace: number | null         // s/km
  ngp: number | null             // s/km (ritmo ajustado a la pendiente)
  peakPace30s: number | null     // s/km (mejor ritmo en 30 s, 1, 3 y 5 min)
  peakPace1m: number | null
  peakPace3m: number | null
  peakPace5m: number | null
  ascent: number | null          // m
  descent: number | null         // m
  ascentTime: number | null      // s
  descentTime: number | null     // s
  minAltitude: number | null     // m
  maxAltitude: number | null     // m
  ascentSpeed: number | null     // m/min
  descentSpeed: number | null    // m/min
  minHR: number | null           // bpm
  tssMethod: string | null       // 'HR' | 'PACE' | 'MET'...
  epoc: number | null
  recoveryTime: number | null    // s
  steps: number | null
  stepCadence: number | null     // pasos/min
  maxStepCadence: number | null
  cadence: number | null         // rpm
  maxCadence: number | null
  stepLength: number | null      // cm
  strideLength: number | null    // cm
}

export interface ActivityDetail extends ActivitySummary {
  extra?: ActivityExtra | null
  laps: Lap[]
  hrZones: HRZone[]
  gpxCoords: [number, number][]  // [lat, lon] pairs
  avgStrideLength?: number | null
  trainingEffect?: number | null
}

export interface FitnessPoint {
  date: string   // YYYY-MM-DD
  ctl: number    // Chronic Training Load (Fitness)
  atl: number    // Acute Training Load (Fatigue)
  tsb: number    // Training Stress Balance (Form)
  tss: number    // TSS accumulated that day
}

export interface GlobalStats {
  totalActivities: number
  byType: Record<string, number>
  vo2maxHistory: { date: string; value: number }[]
  syncedAt: string
  // Tiempo de recuperación acumulado tras el último entrenamiento (s) y cuándo terminó (ms epoch)
  recovery?: { seconds: number; endedAt: number } | null
}

export interface UserSettings {
  maxHR: number
  ftp: number          // Functional Threshold Power (watts)
  lthrRunning: number  // Lactate threshold HR for running
  thresholdPace: number // seconds per km at threshold
  ftpDate?: string
}

export const DEFAULT_SETTINGS: UserSettings = {
  maxHR: 185,
  ftp: 250,
  lthrRunning: 165,
  thresholdPace: 270, // ~4:30/km
}
```

</details>
<details>
<summary><b><code>src/components/ActivityStats.tsx</code></b> · 135 líneas · clic para desplegar</summary>

```tsx
import type { ActivityDetail } from '../types/garmin'
import { formatDuration, formatPace } from '../utils/formatters'

interface Row {
  label: string
  value: string | null
  hint?: string
}

interface Section {
  title: string
  rows: Row[]
}

const pace = (s: number | null | undefined) => (s ? formatPace(s) : null)

const num = (v: number | null | undefined, unit = '', digits = 0): string | null =>
  v == null ? null : `${digits ? v.toFixed(digits) : Math.round(v)}${unit ? ` ${unit}` : ''}`

const hours = (s: number | null | undefined): string | null => {
  if (!s) return null
  if (s < 3600) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(s >= 36000 ? 0 : 1)} h`
}

const TSS_METHOD: Record<string, string> = { HR: 'hr', PACE: 'ritmo', POWER: 'potencia', MET: 'MET' }

export default function ActivityStats({ detail }: { detail: ActivityDetail }) {
  const x = detail.extra
  if (!x) return null

  const onFoot = detail.sport === 'running' || detail.sport === 'other'

  const sections: Section[] = [
    {
      title: 'Ritmo',
      rows: onFoot
        ? [
            { label: 'Ritmo med.', value: pace(detail.avgPace) },
            { label: 'NGP', value: pace(x.ngp), hint: 'Ritmo ajustado a la pendiente' },
            { label: 'Ritmo máx.', value: pace(x.maxPace) },
            { label: 'Ritmo máx.: 30 s', value: pace(x.peakPace30s), hint: 'Calculado con las muestras GPS (aproximado)' },
            { label: 'Ritmo máx.: 1 min', value: pace(x.peakPace1m), hint: 'Calculado con las muestras GPS (aproximado)' },
            { label: 'Ritmo máx.: 3 min', value: pace(x.peakPace3m), hint: 'Calculado con las muestras GPS (aproximado)' },
            { label: 'Ritmo máx.: 5 min', value: pace(x.peakPace5m), hint: 'Calculado con las muestras GPS (aproximado)' },
          ]
        : [],
    },
    {
      title: 'Altura',
      rows: [
        { label: 'Ascenso', value: num(x.ascent ?? detail.elevationGain, 'm') },
        { label: 'Descenso', value: num(x.descent, 'm') },
        { label: 'Duración de ascenso', value: x.ascentTime ? formatDuration(x.ascentTime) : null },
        { label: 'Duración de descenso', value: x.descentTime ? formatDuration(x.descentTime) : null },
        { label: 'Punto más alto', value: num(x.maxAltitude, 'm') },
        { label: 'Punto más bajo', value: num(x.minAltitude, 'm') },
        { label: 'Velocidad de ascenso', value: num(x.ascentSpeed, 'm/min', 1) },
        { label: 'Velocidad de descenso', value: num(x.descentSpeed, 'm/min', 1) },
      ],
    },
    {
      title: 'Velocidad',
      rows: [
        { label: 'Velocidad med.', value: num(detail.avgSpeed, 'km/h', 1) },
        { label: 'Velocidad máx.', value: num(x.maxSpeed, 'km/h', 1) },
      ],
    },
    {
      title: 'Frecuencia cardiaca',
      rows: [
        { label: 'FC media', value: detail.avgHR > 0 ? `${detail.avgHR} ppm` : null },
        { label: 'FC máx.', value: detail.maxHR > 0 ? `${detail.maxHR} ppm` : null },
        { label: 'FC mín.', value: num(x.minHR, 'ppm') },
      ],
    },
    {
      title: 'Fisiología',
      rows: [
        { label: 'Calorías', value: detail.calories > 0 ? `${detail.calories} kcal` : null },
        {
          label: x.tssMethod ? `TSS (${TSS_METHOD[x.tssMethod] ?? x.tssMethod.toLowerCase()})` : 'TSS',
          value: detail.tss != null ? String(Math.round(detail.tss)) : null,
        },
        { label: 'VO₂ máx. estimado', value: num(detail.vo2max, '', 1) },
        { label: 'EPOC', value: num(x.epoc) },
        { label: 'PTE', value: num(detail.aerobicTE, '', 1), hint: 'Peak Training Effect' },
        { label: 'Tiempo de recuperación', value: hours(x.recoveryTime) },
      ],
    },
    {
      title: 'Técnica',
      rows: [
        { label: 'Pasos', value: num(x.steps) },
        { label: 'Cadencia de pasos med.', value: num(x.stepCadence, 'ppm') },
        { label: 'Cadencia de pasos máx.', value: num(x.maxStepCadence, 'ppm') },
        { label: 'Cadencia med.', value: num(x.cadence, 'rpm') },
        { label: 'Cadencia máx.', value: num(x.maxCadence, 'rpm') },
        { label: 'Longitud de pasos med.', value: num(x.stepLength, 'cm') },
        { label: 'Longitud de zancada med.', value: num(x.strideLength, 'cm') },
      ],
    },
  ]

  // Solo se muestra lo que el reloj ha enviado
  const visible = sections
    .map(s => ({ ...s, rows: s.rows.filter(r => r.value != null) }))
    .filter(s => s.rows.length > 0)
  if (visible.length === 0) return null

  return (
    <section className="mb-6">
      <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-3">Estadísticas</h2>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {visible.map(section => (
          <div key={section.title}>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">{section.title}</h3>
            <div className="grid grid-cols-2 gap-px bg-slate-700/40 border border-slate-700/50 rounded-xl overflow-hidden">
              {section.rows.map((row, i) => (
                <div
                  key={row.label}
                  title={row.hint}
                  className={`bg-slate-900 px-4 py-3 ${section.rows.length % 2 === 1 && i === section.rows.length - 1 ? 'col-span-2' : ''}`}
                >
                  <div className="text-xs text-slate-500">{row.label}</div>
                  <div className="text-base font-semibold text-slate-100 tabular-nums mt-0.5">{row.value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

</details>
<details>
<summary><b><code>src/pages/ActivityDetail.tsx</code></b> · 168 líneas · clic para desplegar</summary>

```tsx
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { ActivityDetail } from '../types/garmin'
import { useActivityStore } from '../stores/activityStore'
import { formatPace, formatDuration, formatDistance, formatDate, sportLabel } from '../utils/formatters'
import { HR_ZONE_DEFS } from '../utils/calculations'
import ActivityMap from '../components/ActivityMap'
import MetricCard from '../components/MetricCard'
import ActivityStats from '../components/ActivityStats'

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const loadDetail = useActivityStore(s => s.loadDetail)
  const activities = useActivityStore(s => s.activities)
  const [detail, setDetail] = useState<ActivityDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    loadDetail(Number(id)).then(d => {
      setDetail(d)
      setLoading(false)
    })
  }, [id, loadDetail])

  const summary = activities.find(a => a.id === Number(id))

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Cargando actividad...
      </div>
    )
  }

  const act = detail ?? summary
  if (!act) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Actividad no encontrada.{' '}
        <Link to="/activities" className="text-blue-400 ml-1">Volver</Link>
      </div>
    )
  }

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      {/* Header */}
      <div className="mb-5">
        <Link to="/activities" className="text-xs text-slate-500 hover:text-slate-300 mb-2 inline-block">← Actividades</Link>
        <h1 className="text-xl font-bold text-slate-100">{act.title}</h1>
        <div className="text-sm text-slate-500 mt-0.5">
          {formatDate(act.startTime)} · {sportLabel(act.sport)}
        </div>
      </div>

      {/* Map */}
      {detail?.gpxCoords && detail.gpxCoords.length > 0 && (
        <div className="mb-6">
          <ActivityMap coords={detail.gpxCoords} sport={act.sport} height={320} />
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <MetricCard label="Distancia" value={formatDistance(act.distance, act.sport)} />
        <MetricCard label="Duración" value={formatDuration(act.duration)} />
        {act.sport === 'running' && act.avgPace
          ? <MetricCard label="Ritmo medio" value={formatPace(act.avgPace)} />
          : act.sport === 'cycling' && act.avgSpeed
          ? <MetricCard label="Velocidad" value={`${act.avgSpeed}`} unit="km/h" />
          : <MetricCard label="Calorías" value={act.calories} unit="kcal" />
        }
        <MetricCard label="FC Media" value={act.avgHR > 0 ? act.avgHR : '–'} unit={act.avgHR > 0 ? 'bpm' : ''} />
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <MetricCard label="FC Máxima" value={act.maxHR > 0 ? act.maxHR : '–'} unit={act.maxHR > 0 ? 'bpm' : ''} />
        <MetricCard label="Elevación +" value={act.elevationGain} unit="m" />
        {act.tss != null && <MetricCard label="TSS" value={Math.round(act.tss)} />}
        {act.sport === 'cycling' && act.avgPower
          ? <MetricCard label="Potencia media" value={act.avgPower} unit="W" />
          : act.sport === 'cycling' && act.normalizedPower
          ? <MetricCard label="Potencia NP" value={act.normalizedPower} unit="W" />
          : act.sport === 'running' && act.avgCadence
          ? <MetricCard label="Cadencia" value={act.avgCadence} unit="spm" />
          : null
        }
      </div>

      {/* HR Zones */}
      {detail?.hrZones && detail.hrZones.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-3">Zonas de frecuencia cardíaca</h2>
          <div className="space-y-2">
            {detail.hrZones.map((zone) => {
              const total = detail.hrZones.reduce((s, z) => s + z.seconds, 0)
              const pct = total > 0 ? (zone.seconds / total) * 100 : 0
              const def = HR_ZONE_DEFS[zone.zone - 1]
              return (
                <div key={zone.zone} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-slate-400">{zone.name}</div>
                  <div className="flex-1 bg-slate-800 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${pct}%`, background: def?.color ?? '#6b7280' }}
                    />
                  </div>
                  <div className="w-16 text-xs text-slate-400 text-right">{formatDuration(zone.seconds)}</div>
                  <div className="w-10 text-xs text-slate-500 text-right">{pct.toFixed(0)}%</div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Laps */}
      {detail?.laps && detail.laps.length > 1 && (
        <section className="mb-6">
          <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-3">
            Parciales ({detail.laps.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">Dist.</th>
                  <th className="pb-2 pr-4">Tiempo</th>
                  {act.sport === 'running' && <th className="pb-2 pr-4">Ritmo</th>}
                  {act.sport === 'cycling' && <th className="pb-2 pr-4">Velocidad</th>}
                  {act.avgPower != null && <th className="pb-2 pr-4">Potencia</th>}
                  <th className="pb-2 pr-4">FC</th>
                  <th className="pb-2">Elev.</th>
                </tr>
              </thead>
              <tbody>
                {detail.laps.map(lap => (
                  <tr key={lap.index} className="border-b border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 pr-4 text-slate-400">{lap.index}</td>
                    <td className="py-2 pr-4 text-slate-200">{lap.distance.toFixed(2)} km</td>
                    <td className="py-2 pr-4 font-mono text-slate-200">{formatDuration(lap.duration)}</td>
                    {act.sport === 'running' && (
                      <td className="py-2 pr-4 font-mono text-slate-200">{formatPace(lap.avgPace)}</td>
                    )}
                    {act.sport === 'cycling' && (
                      <td className="py-2 pr-4 text-slate-200">{lap.avgSpeed ? `${lap.avgSpeed} km/h` : '–'}</td>
                    )}
                    {act.avgPower != null && (
                      <td className="py-2 pr-4 text-slate-200">{lap.avgPower ? `${lap.avgPower}W` : '–'}</td>
                    )}
                    <td className="py-2 pr-4 text-slate-400">{lap.avgHR ?? '–'}</td>
                    <td className="py-2 text-slate-400">{lap.elevationGain}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Estadísticas detalladas (ritmo, altura, fisiología, técnica…) */}
      {detail && <ActivityStats detail={detail} />}
    </div>
  )
}
```

</details>
<details>
<summary><b><code>src/pages/Dashboard.tsx</code></b> · 395 líneas · clic para desplegar</summary>

```tsx
import { Link } from 'react-router-dom'
import type { GlobalStats } from '../types/garmin'
import { useActivityStore } from '../stores/activityStore'
import { formatDuration, formatPace, sportIcon, sportColor } from '../utils/formatters'
import { daysAgo } from '../utils/date'
import { useFitnessHistory } from '../hooks/useFitnessHistory'
import { useWeekComparison } from '../hooks/useWeekComparison'
import { useSportVolume } from '../hooks/useSportVolume'
import { useTrainingStreak } from '../hooks/useTrainingStreak'
import { useZoneDistribution } from '../hooks/useZoneDistribution'
import { useWeeklyLoad } from '../hooks/useWeeklyLoad'
import RadialProgress from '../components/RadialProgress'
import FormBadge from '../components/FormBadge'
import DeltaBadge from '../components/DeltaBadge'
import {
  AreaChart, Area, XAxis, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts'

// ─── Loading / Empty states ───────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-slate-400 animate-pulse text-sm">Cargando...</div>
    </div>
  )
}

// Segundos de recuperación que quedan: el acumulado tras la última actividad menos el tiempo transcurrido
function recoveryLeft(stats: GlobalStats | null): number | null {
  const r = stats?.recovery
  if (!r) return null
  return Math.max(0, r.seconds - (Date.now() - r.endedAt) / 1000)
}

function formatRecovery(seconds: number): string {
  return seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`
}

function EmptyScreen() {
  return (
    <div className="flex-1 p-8 max-w-2xl">
      <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl p-6">
        <h2 className="text-amber-300 font-medium text-lg mb-2">Sin datos de Suunto</h2>
        <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-300 space-y-1 mt-3">
          <div>suuntool login --email TU_EMAIL</div>
          <div>pip install -r fetch/requirements.txt</div>
          <div>python3 fetch/sync.py --limit 20</div>
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const activities = useActivityStore(s => s.activities)
  const stats = useActivityStore(s => s.stats)
  const loading = useActivityStore(s => s.loading)
  const error = useActivityStore(s => s.error)

  const { current: fitness, sparkPoints } = useFitnessHistory()
  const recovery = recoveryLeft(stats)
  const { current: week, previous: lastWeek } = useWeekComparison()
  const { bySport: sportHours, totalHours, percentages } = useSportVolume(30)
  const streak = useTrainingStreak()
  const { slices: zoneSlices, isAerobicFocused } = useZoneDistribution(30)
  const weeklyLoad = useWeeklyLoad(16)

  if (loading) return <LoadingScreen />
  if (error || activities.length === 0) return <EmptyScreen />

  const tsb = fitness?.tsb ?? 0
  const ctl = fitness?.ctl ?? 0
  const atl = fitness?.atl ?? 0
  const tsbColor = tsb > 10 ? '#22c55e' : tsb > -5 ? '#3b82f6' : tsb > -15 ? '#eab308' : tsb > -25 ? '#f97316' : '#ef4444'
  const maxWeekTSS = Math.max(...weeklyLoad.map(w => w.tss), 1)

  return (
    <div className="flex-1 overflow-y-auto bg-[#080f1e]">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden px-6 pt-7 pb-6"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #0c1a3a 50%, #0f172a 100%)' }}>
        <div className="absolute top-0 left-1/4 w-96 h-48 rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: tsbColor }} />

        {/* Form title row */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">Estado de forma</div>
            <div className="flex items-center gap-3">
              <span className="text-4xl font-black" style={{ color: tsbColor, textShadow: `0 0 30px ${tsbColor}66` }}>
                {tsb > 0 ? '+' : ''}{Math.round(tsb)}
              </span>
              <div>
                <FormBadge tsb={tsb} />
                <div className="text-xs text-slate-500 mt-1.5">Forma = Fitness − Fatiga</div>
              </div>
            </div>
          </div>

          {/* VO2max */}
          {stats?.vo2maxHistory?.length ? (
            <div className="text-right">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">VO2max</div>
              <div className="text-3xl font-black text-purple-400" style={{ textShadow: '0 0 20px #a855f766' }}>
                {stats.vo2maxHistory.at(-1)!.value.toFixed(1)}
              </div>
              <div className="text-xs text-slate-500">ml/kg/min</div>
            </div>
          ) : null}
        </div>

        {/* CTL / ATL radials + streak */}
        <div className="flex items-center gap-8 mb-6">
          <div className="flex items-center gap-3">
            <RadialProgress value={ctl} max={100} color="#3b82f6" size={72} stroke={6}>
              <span className="text-base font-bold text-blue-300">{Math.round(ctl)}</span>
            </RadialProgress>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Fitness</div>
              <div className="text-xs text-slate-400">CTL · 42 días</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <RadialProgress value={atl} max={100} color="#f97316" size={72} stroke={6}>
              <span className="text-base font-bold text-orange-300">{Math.round(atl)}</span>
            </RadialProgress>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Fatiga</div>
              <div className="text-xs text-slate-400">ATL · 7 días</div>
            </div>
          </div>

          {recovery != null && (
            <div className="flex items-center gap-3">
              <RadialProgress value={recovery} max={72 * 3600} color="#14b8a6" size={72} stroke={6}>
                <span className="text-base font-bold text-teal-300">{recovery > 0 ? formatRecovery(recovery) : '✓'}</span>
              </RadialProgress>
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wider">Recuperación</div>
                <div className="text-xs text-slate-400">{recovery > 0 ? 'restante (estimado)' : 'recuperado'}</div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 ml-auto">
            {streak > 1 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border"
                style={{ borderColor: '#f59e0b40', background: '#f59e0b10' }}>
                <span className="text-lg">🔥</span>
                <div>
                  <div className="text-sm font-bold text-amber-400">{streak} días</div>
                  <div className="text-xs text-slate-500">racha activa</div>
                </div>
              </div>
            )}
            <div className="text-right">
              <div className="text-xs text-slate-500">{stats?.totalActivities ?? activities.length} actividades</div>
              {stats?.syncedAt && (
                <div className="text-xs text-slate-600">
                  Sync: {new Date(stats.syncedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Fitness sparkline */}
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkPoints} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="gCTL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gATL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                formatter={(v: unknown, n: unknown) => [String(v), String(n)]}
              />
              <Area type="monotone" dataKey="ctl" name="Fitness" stroke="#3b82f6" strokeWidth={2} fill="url(#gCTL)" dot={false} />
              <Area type="monotone" dataKey="atl" name="Fatiga" stroke="#f97316" strokeWidth={1.5} fill="url(#gATL)" dot={false} strokeDasharray="3 2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-4 mt-1">
          <LegendDot color="#3b82f6" label="Fitness (CTL)" />
          <LegendDot color="#f97316" label="Fatiga (ATL)" />
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 space-y-5">

        {/* Week comparison */}
        <section>
          <SectionHeader left="Esta semana" right="vs semana anterior" />
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Sesiones',    value: week.count,            prev: lastWeek.count,            fmt: (v: number) => String(v),              unit: '' },
              { label: 'Distancia',   value: week.distance,         prev: lastWeek.distance,         fmt: (v: number) => v.toFixed(1),           unit: 'km' },
              { label: 'Tiempo',      value: week.duration / 3600,  prev: lastWeek.duration / 3600,  fmt: (v: number) => v.toFixed(1),           unit: 'h' },
              { label: 'Carga (TSS)', value: week.tss,              prev: lastWeek.tss,              fmt: (v: number) => Math.round(v).toString(), unit: '' },
            ].map(({ label, value, prev, fmt, unit }) => (
              <div key={label} className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-4 hover:border-slate-600/60 transition-colors">
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">{label}</div>
                <div className="text-2xl font-bold text-slate-100 mb-1">
                  {fmt(value)}<span className="text-sm text-slate-500 ml-1">{unit}</span>
                </div>
                <DeltaBadge value={value - prev} unit={unit ? ` ${unit}` : ''} />
              </div>
            ))}
          </div>
        </section>

        {/* Sport rings + Zone radar */}
        <div className="grid grid-cols-2 gap-4">

          <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-5">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-4">Volumen · últimos 30 días</div>
            <div className="flex items-center justify-around">
              {([
                { sport: 'running' as const,  label: 'Running',  color: '#ef4444', max: 20 },
                { sport: 'cycling' as const,  label: 'Ciclismo', color: '#f97316', max: 30 },
                { sport: 'swimming' as const, label: 'Natación', color: '#3b82f6', max: 8  },
              ]).map(({ sport, label, color, max }) => (
                <div key={sport} className="flex flex-col items-center gap-2">
                  <RadialProgress value={sportHours[sport].hours} max={max} color={color} size={80} stroke={7}>
                    <div className="text-center">
                      <div className="text-sm font-bold" style={{ color }}>{sportHours[sport].hours.toFixed(1)}</div>
                      <div className="text-xs text-slate-600">h</div>
                    </div>
                  </RadialProgress>
                  <div className="text-center">
                    <div className="text-xs font-medium text-slate-300">{sportIcon(sport)} {label}</div>
                    <div className="text-xs text-slate-600">de {max}h ref.</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-700/50 text-xs text-slate-500 text-center">
              Total: <span className="text-slate-300 font-medium">{totalHours.toFixed(1)}h</span>
              {totalHours > 0 && (
                <> · R {Math.round(percentages.running)}% · C {Math.round(percentages.cycling)}% · N {Math.round(percentages.swimming)}%</>
              )}
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-5">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Zonas FC · 30 días</div>
            <div className="text-xs mb-2" style={{ color: isAerobicFocused ? '#22c55e' : '#eab308' }}>
              {isAerobicFocused ? '✅ Buena base aeróbica (Z1+Z2 >60%)' : '⚠️ Añade más entrenamiento en Z1–Z2'}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <RadarChart data={zoneSlices} margin={{ top: 0, right: 20, bottom: 0, left: 20 }}>
                <PolarGrid stroke="#334155" />
                <PolarAngleAxis dataKey="zone" tick={{ fill: '#64748b', fontSize: 10 }} />
                <Radar dataKey="pct" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={1.5} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: unknown) => [`${v}%`, 'Tiempo']}
                />
              </RadarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {zoneSlices.map(z => (
                <span key={z.zone} className="text-xs" style={{ color: z.color }}>{z.zone} {z.pct}%</span>
              ))}
            </div>
          </div>
        </div>

        {/* Weekly TSS bar chart */}
        <div className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-5">
          <SectionHeader left="Carga semanal (TSS) · 16 semanas" rightLink={{ to: '/fitness', label: 'Ver completo →' }} />
          <div className="flex items-end gap-1 h-20">
            {weeklyLoad.map((w, i) => {
              const isCurrentWeek = i === weeklyLoad.length - 1
              return (
                <div key={w.week} className="flex-1 h-full flex flex-col justify-end items-center" title={`${w.week}: ${w.tss} TSS`}>
                  <div
                    className="w-full rounded-t transition-all"
                    style={{
                      height: `${Math.max((w.tss / maxWeekTSS) * 100, 2)}%`,
                      background: isCurrentWeek ? 'linear-gradient(to top, #3b82f6, #60a5fa)' : '#334155',
                      boxShadow: isCurrentWeek ? '0 0 8px #3b82f660' : 'none',
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-slate-600">{weeklyLoad[0]?.week}</span>
            <span className="text-xs text-blue-400 font-medium">
              esta semana {week.tss > 0 ? `${Math.round(week.tss)} TSS` : ''}
            </span>
          </div>
        </div>

        {/* Recent activities */}
        <section>
          <SectionHeader left="Últimas actividades" rightLink={{ to: '/activities', label: 'Ver todas →' }} />
          <div className="space-y-2">
            {activities.slice(0, 6).map(a => (
              <Link
                key={a.id}
                to={`/activity/${a.id}`}
                className="flex items-center gap-4 px-4 py-3 rounded-xl border border-slate-700/40 bg-slate-800/30 hover:bg-slate-800/70 hover:border-slate-600/50 transition-all group"
              >
                <div className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: sportColor(a.sport), boxShadow: `0 0 6px ${sportColor(a.sport)}88` }} />

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-200 truncate group-hover:text-white">{a.title}</div>
                  <div className="text-xs text-slate-500">
                    {daysAgo(a.startTime) === 0 ? 'Hoy' : daysAgo(a.startTime) === 1 ? 'Ayer' : `Hace ${daysAgo(a.startTime)}d`}
                    {' · '}{sportIcon(a.sport)}
                  </div>
                </div>

                <div className="flex items-center gap-5 shrink-0 text-right">
                  {a.distance > 0 && (
                    <div>
                      <div className="text-sm font-bold text-slate-200">
                        {a.distance.toFixed(1)}<span className="text-xs text-slate-500 ml-0.5">km</span>
                      </div>
                      {a.avgPace && <div className="text-xs text-slate-500">{formatPace(a.avgPace)}</div>}
                      {a.avgSpeed && !a.avgPace && <div className="text-xs text-slate-500">{a.avgSpeed.toFixed(1)} km/h</div>}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-bold text-slate-200">{formatDuration(a.duration)}</div>
                    {a.avgHR > 0 && <div className="text-xs text-slate-500">{a.avgHR} bpm</div>}
                  </div>
                  {a.tss != null && (
                    <div className="w-10 text-right">
                      <div className="text-sm font-bold" style={{ color: sportColor(a.sport) }}>{Math.round(a.tss)}</div>
                      <div className="text-xs text-slate-600">TSS</div>
                    </div>
                  )}
                  <div className="text-slate-600 group-hover:text-slate-400 text-xs">→</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <div className="h-2" />
      </div>
    </div>
  )
}

// ─── Shared layout helpers ────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className="w-3 h-0.5 rounded inline-block" style={{ background: color }} />
      {label}
    </span>
  )
}

function SectionHeader({
  left,
  right,
  rightLink,
}: {
  left: string
  right?: string
  rightLink?: { to: string; label: string }
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="text-xs text-slate-500 uppercase tracking-widest">{left}</div>
      {right && <div className="text-xs text-slate-600">{right}</div>}
      {rightLink && (
        <Link to={rightLink.to} className="text-xs text-blue-400 hover:text-blue-300">{rightLink.label}</Link>
      )}
    </div>
  )
}
```

</details>
