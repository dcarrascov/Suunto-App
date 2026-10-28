#!/usr/bin/env python3
"""
Comprueba que public/data/ cumple el contrato que espera el frontend
(src/types/suunto.ts). Úsalo después de sincronizar:

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
    check_efforts(a, where)
    dc = a.get("decoupling")
    if dc is not None and not (num(dc) and -100 < dc < 100):
        errors.append(f"{where}: decoupling debe ser null o un % entre -100 y 100")
    hz = a.get("hrZoneSeconds")
    if hz is not None and not (isinstance(hz, list) and len(hz) == 5 and all(num(v) and v >= 0 for v in hz)):
        errors.append(f"{where}: hrZoneSeconds debe ser null o 5 números >= 0 (Z1..Z5)")


EFFORT_SOURCES = {"samples", "laps"}


def check_efforts(a, where):
    """bestEfforts es opcional (datos de versiones anteriores); si está: {"<metros>": segundos} o null."""
    if "bestEfforts" not in a:
        return
    be, src = a["bestEfforts"], a.get("bestEffortsSource")
    if be is None:
        if src is not None:
            errors.append(f"{where}: bestEffortsSource debe ser null si bestEfforts es null")
        return
    if not isinstance(be, dict):
        errors.append(f"{where}: 'bestEfforts' debe ser un objeto o null")
        return
    for k, v in be.items():
        if not k.isdigit() or not num(v) or v <= 0:
            errors.append(f"{where}: bestEfforts['{k}'] debe ser metros (texto) -> segundos (> 0)")
    if src not in EFFORT_SOURCES:
        errors.append(f"{where}: bestEffortsSource debe ser uno de {sorted(EFFORT_SOURCES)} (es {src!r})")


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
    pace = d.get("routePace")  # opcional: ritmo (s/km) de cada punto de gpxCoords
    if pace is not None:
        if not isinstance(pace, list) or len(pace) != len(d.get("gpxCoords") or []):
            errors.append(f"{where}: 'routePace' debe ser una lista del mismo largo que gpxCoords")
        elif any(v is not None and not (num(v) and v > 0) for v in pace):
            errors.append(f"{where}: routePace debe tener números > 0 o null")
    coords = d.get("gpxCoords")
    if not isinstance(coords, list):
        errors.append(f"{where}: 'gpxCoords' debe ser una lista")
    else:
        bad = [c for c in coords if not (isinstance(c, list) and len(c) == 2 and num(c[0]) and num(c[1])
                                          and -90 <= c[0] <= 90 and -180 <= c[1] <= 180)]
        if bad:
            errors.append(f"{where}: {len(bad)} coordenadas inválidas en gpxCoords (esperado [lat, lon])")


PLAN_SPORTS = {"running", "cycling", "swimming", "strength", "rest", "other"}


def check_plan():
    """plan.json (TrainingPeaks) es opcional; si existe debe seguir el tipo TrainingPlan de suunto.ts."""
    path = DATA / "plan.json"
    if not path.exists():
        return
    try:
        plan = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as e:
        errors.append(f"plan.json no es JSON válido: {e}")
        return
    ws = plan.get("workouts") if isinstance(plan, dict) else None
    if not isinstance(ws, list):
        errors.append("plan.json: 'workouts' debe ser una lista")
        return
    ids = [w.get("id") for w in ws if isinstance(w, dict)]
    if len(ids) != len(set(ids)):
        errors.append("plan.json: hay ids de entreno repetidos")
    for i, w in enumerate(ws):
        where = f"plan.json[{i}]"
        if not isinstance(w, dict):
            errors.append(f"{where}: debe ser un objeto")
            continue
        if not isinstance(w.get("id"), int):
            errors.append(f"{where}: 'id' debe ser entero")
        if not (isinstance(w.get("date"), str) and re.match(r"^\d{4}-\d{2}-\d{2}$", w["date"])):
            errors.append(f"{where}: 'date' debe ser YYYY-MM-DD")
        if w.get("sport") not in PLAN_SPORTS:
            errors.append(f"{where}: 'sport' debe ser uno de {sorted(PLAN_SPORTS)}")
        if not isinstance(w.get("title"), str) or not isinstance(w.get("completed"), bool):
            errors.append(f"{where}: necesita title (texto) y completed (booleano)")
        p = w.get("planned")
        if not isinstance(p, dict) or any(p.get(k) is not None and not num(p.get(k)) for k in ("duration", "distance", "tss", "if")):
            errors.append(f"{where}: 'planned' debe tener duration/distance/tss/if numéricos o null")
        a = w.get("actual")
        if a is not None and (not isinstance(a, dict) or any(a.get(k) is not None and not num(a.get(k)) for k in ("duration", "distance", "tss"))):
            errors.append(f"{where}: 'actual' debe ser null o tener duration/distance/tss numéricos o null")
    events = plan.get("events", [])
    if not isinstance(events, list):
        errors.append("plan.json: 'events' debe ser una lista")
        return
    for i, e in enumerate(events):
        where = f"plan.json events[{i}]"
        if not isinstance(e, dict) or not isinstance(e.get("id"), int):
            errors.append(f"{where}: debe ser un objeto con 'id' entero")
            continue
        if not (isinstance(e.get("date"), str) and re.match(r"^\d{4}-\d{2}-\d{2}$", e["date"])):
            errors.append(f"{where}: 'date' debe ser YYYY-MM-DD")
        if not isinstance(e.get("name"), str) or not e["name"]:
            errors.append(f"{where}: 'name' debe ser texto no vacío")
        if e.get("priority") not in (None, "A", "B", "C"):
            errors.append(f"{where}: 'priority' debe ser A, B, C o null")
        if e.get("distanceKm") is not None and not (num(e["distanceKm"]) and e["distanceKm"] > 0):
            errors.append(f"{where}: 'distanceKm' debe ser > 0 o null")


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

    check_plan()

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
