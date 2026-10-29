"""
Convierte datos de Suunto (backend de la app Suunto, o ficheros FIT) en el JSON
que espera el frontend React. Los tipos TypeScript equivalentes están en
src/types/suunto.ts.

Unidades de SALIDA (las que espera la app):
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
# IDs de actividad de Suunto -> categoría de la app (tipo Sport de suunto.ts).
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


ROUTE_LIMIT = 1500       # puntos de ruta que se guardan (1 Hz -> uno cada ~2-3 s en 1 h)
PACE_WINDOW_S = 10.0     # el ritmo de cada punto es el de los ±10 s de alrededor
PACE_RANGE = (120, 1200)  # s/km creíbles: más rápido = salto del GPS; más lento = parado


def _haversine_m(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(min(1.0, math.sqrt(h)))


def timed_route(points, limit: int = ROUTE_LIMIT) -> tuple[list, list]:
    """
    [(t_s, lat, lon), ...] -> (gpxCoords, routePace): ruta reducida a `limit` puntos y,
    para cada punto, el ritmo (s/km) en una ventana de ±PACE_WINDOW_S (None si parado o sin datos).
    """
    pts = sorted((t, la, lo) for t, la, lo in points if t is not None and _valid_latlon(la, lo))
    if not pts:
        return [], []
    ts = [p[0] for p in pts]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + _haversine_m(a[1:], b[1:]))

    paces = []
    for t in ts:
        j0 = bisect.bisect_left(ts, t - PACE_WINDOW_S)
        j1 = bisect.bisect_right(ts, t + PACE_WINDOW_S) - 1
        dt, dist = ts[j1] - ts[j0], cum[j1] - cum[j0]
        pace = dt / dist * 1000 if dt >= 4 and dist > 0 else None
        paces.append(round(pace) if pace and PACE_RANGE[0] <= pace <= PACE_RANGE[1] else None)

    idx = downsample(list(range(len(pts))), limit)
    return [[round(pts[i][1], 6), round(pts[i][2], 6)] for i in idx], [paces[i] for i in idx]


def _location_stream(w: dict) -> list:
    """Ruta a 1 Hz del detalle de Suunto (LocationStreamExtension) como [(t_s, lat, lon)]."""
    for e in _ext(w, "LocationStreamExtension"):
        rows = [r for r in e.get("locationPoints") or [] if isinstance(r, dict)]
        stamps = [_num(r.get("timestamp")) for r in rows]
        t0 = min((s for s in stamps if s is not None), default=None)
        if t0 is None:
            continue
        return [((s - t0) / 1000, _num(r.get("latitude")), _num(r.get("longitude")))
                for s, r in zip(stamps, rows) if s is not None]
    return []


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
    ÚNICO sitio que define la forma de ActivitySummary (suunto.ts). Lo usan tanto
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
        # Mejor tiempo (s) por distancia ("1000", "5000"...); lo rellena set_best_efforts()
        "bestEfforts": None,
        "bestEffortsSource": None,  # "samples" (exacto) | "laps" (aprox. con los parciales)
        # Segundos en Z1..Z5 según el reloj (copia de hrZones del detalle); lo rellena detail_to_summary()
        "hrZoneSeconds": None,
        # % de pérdida de eficiencia (velocidad/FC) de la 2.ª mitad frente a la 1.ª; lo rellena detail_to_summary()
        "decoupling": None,
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


# ── Mejores tramos (récords) ────────────────────────────────────────────────
# Distancias (m) para las que se busca el tramo más rápido dentro de cada actividad.
# Las claves de `bestEfforts` son estas distancias como texto ("1000", "5000"...).
EFFORT_DISTANCES = {
    "running": (1000, 5000, 10000, 21097, 42195),
    "cycling": (10000, 20000, 40000, 90000, 180000),
}
# Velocidad máxima creíble (m/s): un tramo más rápido es un salto del GPS y se descarta
EFFORT_MAX_SPEED = {"running": 6.5, "cycling": 25.0}  # 2:34 /km · 90 km/h
# Sube cuando cambie el cálculo con muestras: sync.py vuelve a pedir las actividades afectadas
EFFORTS_VERSION = 2


def _cumulative_without_jumps(pts, max_speed: float):
    """
    Distancia acumulada no decreciente (ignora retrocesos del GPS) en la que no cuenta lo recorrido entre dos
    muestras a más de `max_speed`: saltos del GPS o trozos en coche/moto con el reloj en marcha. El tiempo sí
    sigue corriendo, así que un tramo que los incluya sale más lento, nunca más rápido.
    """
    ts, ds = [pts[0][0]], [0.0]
    prev_t, prev_d, total = pts[0][0], pts[0][1], 0.0
    for t, d in pts[1:]:
        step = d - prev_d
        if step > 0 and (t <= prev_t or step / (t - prev_t) <= max_speed):
            total += step
        if d > prev_d:
            prev_d = d
        prev_t = t
        ts.append(t)
        ds.append(total)
    return ts, ds


def best_efforts_from_samples(dist_pts, sport: str) -> dict | None:
    """
    Menor tiempo (s) en recorrer cada distancia de EFFORT_DISTANCES, sobre muestras
    [(t_s, dist_m)] acumuladas. El inicio del tramo se interpola, así que vale para
    cualquier punto de la actividad (no solo al empezar cada km).
    """
    targets = EFFORT_DISTANCES.get(sport)
    pts = sorted((t, d) for t, d in dist_pts if t is not None and d is not None)
    if not targets or len(pts) < 2:
        return None
    max_speed = EFFORT_MAX_SPEED[sport]
    ts, ds = _cumulative_without_jumps(pts, max_speed)
    out = {}
    for target in targets:
        if ds[-1] - ds[0] < target:
            break
        best = None
        for j in range(len(ds)):
            start_d = ds[j] - target
            if start_d < ds[0]:
                continue
            i = bisect.bisect_right(ds, start_d) - 1  # última muestra con ds[i] <= start_d
            d0, d1 = ds[i], ds[i + 1]
            t_start = ts[i] if d1 == d0 else ts[i] + (ts[i + 1] - ts[i]) * (start_d - d0) / (d1 - d0)
            secs = ts[j] - t_start
            if secs > 0 and target / secs <= max_speed and (best is None or secs < best):
                best = secs
        if best:
            out[str(target)] = round(best)
    return out or None


def best_efforts_from_laps(laps: list, sport: str) -> dict | None:
    """
    Aproximación con los parciales guardados (sin muestras): el grupo de vueltas
    consecutivas más rápido que cubre la distancia, pasándose como mucho un 5 %.
    Con parciales de 1 km es exacto para tramos que empiezan en un km redondo.
    """
    targets = EFFORT_DISTANCES.get(sport)
    laps = [(l.get("distance") or 0.0, l.get("duration") or 0.0) for l in laps or []]
    if not targets or not laps:
        return None
    max_speed = EFFORT_MAX_SPEED[sport]
    out = {}
    for target in targets:
        km = target / 1000
        best = None
        for i in range(len(laps)):
            dist = secs = 0.0
            for d, s in laps[i:]:
                dist += d
                secs += s
                if dist >= km * 0.999:
                    break
            if dist < km * 0.999 or dist > km * 1.05 or secs <= 0:
                continue
            est = secs * km / dist  # se ajusta a la distancia exacta con el ritmo del grupo
            if target / est <= max_speed and (best is None or est < best):
                best = est
        if best:
            out[str(target)] = round(best)
    return out or None


def set_best_efforts(detail: dict, dist_pts=None) -> dict:
    """Rellena bestEfforts/bestEffortsSource del detalle: con muestras si las hay, si no con los parciales."""
    efforts, source = None, None
    if dist_pts:
        efforts = best_efforts_from_samples(dist_pts, detail["sport"])
        source = "samples" if efforts else None
    if not efforts:
        efforts = best_efforts_from_laps(detail.get("laps"), detail["sport"])
        source = "laps" if efforts else None
    detail["bestEfforts"], detail["bestEffortsSource"] = efforts, source
    if source == "samples":
        detail["bestEffortsVersion"] = EFFORTS_VERSION
    else:
        detail.pop("bestEffortsVersion", None)
    return detail


def needs_efforts_refresh(detail: dict) -> bool:
    """
    Detalle guardado cuyos mejores tramos (con muestras) se calcularon con una versión anterior y que puede
    tener trozos demasiado rápidos (velocidad máxima del reloj por encima de la creíble): hay que volver a
    pedir sus muestras. Las demás no cambian con el cálculo nuevo.
    """
    sport = detail.get("sport")
    if sport not in EFFORT_MAX_SPEED or detail.get("bestEffortsSource") != "samples":
        return False
    if detail.get("bestEffortsVersion") == EFFORTS_VERSION:
        return False
    max_kmh = (detail.get("extra") or {}).get("maxSpeed") or 0
    return max_kmh > EFFORT_MAX_SPEED[sport] * 3.6


# Claves que se calculan en el detalle y se copian al resumen (para no cargar 1400 detalles en la web)
SUMMARY_FROM_DETAIL = ("bestEfforts", "bestEffortsSource", "hrZoneSeconds", "decoupling")

DECOUPLING_MIN_S = 2400  # solo actividades de 40 min o más (en las cortas no tiene sentido)


def _pct_drop(d1, t1, hr1, d2, t2, hr2):
    """% que cae la eficiencia (m/s por pulsación) de la 1.ª a la 2.ª mitad. Positivo = el pulso se dispara."""
    if min(d1, t1, hr1, d2, t2, hr2) <= 0:
        return None
    ef1, ef2 = d1 / t1 / hr1, d2 / t2 / hr2
    return round((ef1 - ef2) / ef1 * 100, 1)


def decoupling_from_samples(dist_pts, hr) -> float | None:
    """Desacoplamiento con las muestras [(t_s, dist_m)] y [(t_s, bpm)], partiendo la actividad por la mitad del tiempo."""
    pts = sorted((t, d) for t, d in dist_pts if t is not None and d is not None)
    beats = [(t, v) for t, v in hr if t is not None and v]
    if len(pts) < 10 or len(beats) < 10 or pts[-1][0] - pts[0][0] < DECOUPLING_MIN_S:
        return None
    t0, t_end = pts[0][0], pts[-1][0]
    half = t0 + (t_end - t0) / 2
    d_half = max(d for t, d in pts if t <= half)
    hr1 = [v for t, v in beats if t <= half]
    hr2 = [v for t, v in beats if t > half]
    if not hr1 or not hr2:
        return None
    return _pct_drop(d_half - pts[0][1], half - t0, mean(hr1), pts[-1][1] - d_half, t_end - half, mean(hr2))


def decoupling_from_laps(laps) -> float | None:
    """Aproximación con los parciales (distancia, duración y FC media de cada uno): cada vuelta va a la mitad de su punto medio."""
    rows = [(l.get("distance") or 0.0, l.get("duration") or 0.0, l.get("avgHR")) for l in laps or []]
    rows = [(d * 1000, t, h) for d, t, h in rows if t > 0]
    total = sum(t for _, t, _ in rows)
    if total < DECOUPLING_MIN_S or sum(1 for _, _, h in rows if h) < 4:
        return None
    halves = [[0.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 0.0]]  # distancia, tiempo, FC·tiempo, tiempo con FC
    elapsed = 0.0
    for d, t, h in rows:
        half = halves[0 if elapsed + t / 2 <= total / 2 else 1]
        half[0] += d
        half[1] += t
        if h:
            half[2] += h * t
            half[3] += t
        elapsed += t
    (d1, t1, w1, n1), (d2, t2, w2, n2) = halves
    if not n1 or not n2:
        return None
    return _pct_drop(d1, t1, w1 / n1, d2, t2, w2 / n2)


def detail_to_summary(detail: dict) -> dict:
    """Rellena en el detalle los datos que también van en el resumen y los devuelve."""
    zones = sorted(detail.get("hrZones") or [], key=lambda z: z.get("zone") or 0)
    secs = [round(z.get("seconds") or 0) for z in zones]
    detail["hrZoneSeconds"] = secs if len(secs) == 5 and any(secs) else None
    if "bestEfforts" not in detail:
        set_best_efforts(detail)
    if "decoupling" not in detail:  # con muestras lo calcula normalize_detail; si no, con los parciales
        detail["decoupling"] = decoupling_from_laps(detail.get("laps"))
    return {k: detail.get(k) for k in SUMMARY_FROM_DETAIL}


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
    # Ruta: la del detalle (1 posición por segundo) si está; si no, las posiciones de /data (~1 cada 7 s)
    stream = _location_stream(w)
    if stream:
        detail["gpxCoords"], detail["routePace"] = timed_route(stream)
    if not data:
        return set_best_efforts(detail)

    hr = [(_num(r.get("t")), _num(r.get("hr"))) for r in _rows(data, "heartrates")]
    hr = [(t, v) for t, v in hr if t is not None and v]
    loc = _rows(data, "locations")
    total_m = _num(w.get("totalDistance"), 0.0) or 0.0
    scale = _dist_scale(loc, total_m)
    alts = [(_num(r.get("t")), _num(r.get("h"))) for r in loc]
    alts = sorted((t, h) for t, h in alts if t is not None and h is not None)

    if not stream:
        detail["gpxCoords"], detail["routePace"] = timed_route(
            [(_num(r.get("t")), _num(r.get("la")), _num(r.get("ln"))) for r in loc])

    dist_pts = [(_num(r.get("t")), (_num(r.get("s")) or 0.0) * scale) for r in loc if r.get("s") is not None]
    events = _rows(data, "eventlaps")
    laps = _laps_from_events(events, summary["duration"], total_m, scale, hr, alts) if events else []
    if len(laps) < 2:  # sin vueltas del reloj: parciales automáticos por distancia
        split_m = 5000.0 if summary["sport"] == "cycling" else 1000.0
        laps = auto_splits(dist_pts, hr, alts, split_m) or laps
    detail["laps"] = laps
    detail["extra"] = build_extra(w, summary, sample_extra(dist_pts, hr, alts))
    detail["decoupling"] = decoupling_from_samples(dist_pts, hr) or decoupling_from_laps(laps)
    return set_best_efforts(detail, dist_pts)
