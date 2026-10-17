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
    sample_extra, set_best_efforts, timed_route,
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
    """Devuelve (resumen, detalle) en el formato de suunto.ts. Lanza ValueError si no es una actividad."""
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

    hr, alts, dist_pts, route = [], [], [], []
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
            route.append((t, lat * SEMICIRCLES, lon * SEMICIRCLES))

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
    detail["gpxCoords"], detail["routePace"] = timed_route(route)
    set_best_efforts(detail, dist_pts)

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
