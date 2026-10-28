#!/usr/bin/env python3
"""
TrainingPeaks -> JSON local: los entrenos que te envía tu entrenador (planificados)
y lo que hiciste en cada uno.

Uso (desde la carpeta raíz del proyecto):
    py fetch/tp_sync.py                     # incremental: de 3 semanas atrás a 6 adelante
    py fetch/tp_sync.py --full              # todo el historial desde --since
    py fetch/tp_sync.py --since 2024-01-01  # (con --full) desde esa fecha
    py fetch/tp_sync.py --dump              # guarda la respuesta cruda en fetch/debug/ para revisarla

Necesita TP_AUTH_COOKIE en .env (ver GUIA_TRAININGPEAKS.md).
Salida: public/data/plan.json (entrenos y eventos: las competiciones del calendario, hasta un año vista)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

for _stream in (sys.stdout, sys.stderr):  # evita errores con consolas de codificación limitada (Windows)
    try:
        _stream.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

OUT = ROOT / "public" / "data" / "plan.json"
DEBUG_DIR = Path(__file__).resolve().parent / "debug"
PAST_DAYS = 21     # en cada sync se vuelve a pedir esta ventana (el entrenador puede cambiar entrenos)
FUTURE_DAYS = 42
EVENTS_FUTURE_DAYS = 365  # las competiciones se apuntan con mucha antelación: hasta un año vista

# workoutTypeValueId de TrainingPeaks -> (deporte de la app, nombre)
TP_TYPES = {
    1: ("swimming", "Natación"), 2: ("cycling", "Bici"), 3: ("running", "Carrera"),
    4: ("other", "Brick"), 5: ("other", "Cross training"), 6: ("running", "Competición"),
    7: ("rest", "Descanso"), 8: ("cycling", "MTB"), 9: ("strength", "Fuerza"),
    10: ("other", "Personalizado"), 11: ("other", "Esquí de fondo"), 12: ("other", "Remo"),
    13: ("other", "Caminata"), 29: ("strength", "Fuerza"), 100: ("other", "Otro"),
}


def _num(v):
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _secs(hours):
    """TrainingPeaks da la duración en horas decimales (1.5 = 1 h 30 min)."""
    h = _num(hours)
    if not h or h <= 0:
        return None
    return round(h * 3600) if h < 48 else round(h)  # por si algún día llegara ya en segundos


def _km(meters):
    m = _num(meters)
    return round(m / 1000, 2) if m and m > 0 else None


def _text(v):
    return v.strip() if isinstance(v, str) and v.strip() else None


def normalize_tp(w: dict) -> dict | None:
    """Entreno de TrainingPeaks -> PlannedWorkout (src/types/suunto.ts). None si no tiene fecha."""
    day = w.get("workoutDay")
    if not isinstance(day, str) or len(day) < 10:
        return None
    type_id = _num(w.get("workoutTypeValueId"))
    sport, type_name = TP_TYPES.get(int(type_id) if type_id is not None else -1, ("other", "Entreno"))

    planned = {
        "duration": _secs(w.get("totalTimePlanned")),
        "distance": _km(w.get("distancePlanned")),
        "tss": _num(w.get("tssPlanned")),
        "if": _num(w.get("ifPlanned")),
    }
    actual = {
        "duration": _secs(w.get("totalTime")),
        "distance": _km(w.get("distance")),
        "tss": _num(w.get("tssActual")),
    }
    done = bool(w.get("completed")) or actual["duration"] is not None
    return {
        "id": int(w["workoutId"]),
        "date": day[:10],
        "sport": sport,
        "typeName": type_name,
        "title": _text(w.get("title")) or type_name,
        "description": _text(w.get("description")),
        "coachComments": _text(w.get("coachComments")),
        "athleteComments": _text(w.get("athleteComments")),
        "planned": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in planned.items()},
        "actual": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in actual.items()} if done else None,
        "completed": done,
        "hasPlan": any(v is not None for v in planned.values()) or bool(_text(w.get("description"))),
    }


# ── Eventos (competiciones) ────────────────────────────────────────────────

# Distancia a partir del nombre, cuando TrainingPeaks no la trae (casi siempre viene vacía o a 0)
_NAMED_DISTANCES = ((re.compile(r"media\s*marat|medio\s*marat|half", re.I), 21.097),
                    (re.compile(r"marat[oó]n|marathon", re.I), 42.195))
_KM_IN_NAME = re.compile(r"(\d+(?:[.,]\d+)?)\s*k(?:m|ms)?\b", re.I)


def event_distance_km(e: dict) -> float | None:
    meters = _num(e.get("distance"))
    units = (e.get("distanceUnits") or "").lower()
    if meters and meters > 0:
        if units.startswith("kilo"):
            return round(meters, 3)
        if units.startswith("mile"):
            return round(meters * 1.609344, 3)
        return round(meters / 1000, 3)
    name = e.get("name") or ""
    for pattern, km in _NAMED_DISTANCES:
        if pattern.search(name):
            return km
    m = _KM_IN_NAME.search(name)
    return float(m.group(1).replace(",", ".")) if m else None


def normalize_event(e: dict) -> dict | None:
    """Evento de TrainingPeaks -> PlannedEvent (src/types/suunto.ts). None si no tiene fecha o está oculto."""
    day = e.get("eventDate")
    if not isinstance(day, str) or len(day) < 10 or e.get("isHidden"):
        return None
    priority = e.get("atpPriority")
    return {
        "id": int(e["id"]),
        "date": day[:10],
        "name": _text(e.get("name")) or "Competición",
        "type": _text(e.get("eventType")),
        "priority": priority if priority in ("A", "B", "C") else None,
        "distanceKm": event_distance_km(e),
        "description": _text(e.get("description")),
        "comment": _text(e.get("comment")),
    }


def load_existing() -> tuple[list[dict], list[dict]]:
    """(entrenos, eventos) ya guardados en plan.json."""
    if not OUT.exists():
        return [], []
    try:
        data = json.loads(OUT.read_text(encoding="utf-8"))
        return ([w for w in data.get("workouts") or [] if isinstance(w, dict)],
                [e for e in data.get("events") or [] if isinstance(e, dict)])
    except (ValueError, AttributeError):
        print("  AVISO: plan.json no es válido; se vuelve a descargar todo")
        return [], []


def merge(existing: list[dict], fresh: list[dict], start: date, end: date) -> list[dict]:
    """Lo descargado sustituye a lo guardado en esa ventana (así desaparece lo que se borró en TrainingPeaks)
    y a cualquier copia con el mismo id (algo movido desde una fecha fuera de la ventana)."""
    s0, s1 = start.isoformat(), end.isoformat()
    fresh_ids = {x["id"] for x in fresh}
    kept = [x for x in existing if not (s0 <= x["date"] <= s1) and x["id"] not in fresh_ids]
    return sorted(kept + fresh, key=lambda x: (x["date"], x["id"]))


def default_since() -> date:
    """Desde la primera actividad de Suunto (si existe), para tener el historial completo."""
    acts = ROOT / "public" / "data" / "activities.json"
    try:
        first = min(a["startTime"][:10] for a in json.loads(acts.read_text(encoding="utf-8")))
        return date.fromisoformat(first)
    except (OSError, ValueError, KeyError, TypeError):
        return date.today() - timedelta(days=365)


def main():
    parser = argparse.ArgumentParser(description="Descarga tus entrenos de TrainingPeaks a JSON local")
    parser.add_argument("--full", action="store_true", help="todo el historial desde --since")
    parser.add_argument("--since", type=str, default=None, help="con --full: desde esta fecha (YYYY-MM-DD)")
    parser.add_argument("--dump", action="store_true", help="guarda la respuesta cruda (±14 días) en fetch/debug/")
    args = parser.parse_args()

    from trainingpeaks_client import TrainingPeaksAuthError, TrainingPeaksClient, TrainingPeaksError

    try:
        since = date.fromisoformat(args.since) if args.since else None
    except ValueError:
        sys.exit("ERROR: --since debe tener el formato YYYY-MM-DD (por ejemplo 2024-01-01)")

    today = date.today()
    try:
        client = TrainingPeaksClient()
        if args.dump:
            raw = client.workouts(today - timedelta(days=14), today + timedelta(days=14))
            raw_events = client.events(today - timedelta(days=365), today + timedelta(days=365))
            DEBUG_DIR.mkdir(parents=True, exist_ok=True)
            for name, payload in (("tp_workouts.json", raw), ("tp_events.json", raw_events)):
                path = DEBUG_DIR / name
                path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"{len(payload)} registros guardados en {path.relative_to(ROOT)} (contiene tus datos: no lo compartas)")
            return

        existing, existing_events = load_existing()
        if args.full or not existing:
            start = since or default_since()
        else:
            start = today - timedelta(days=PAST_DAYS)
        end = today + timedelta(days=FUTURE_DAYS)
        events_end = today + timedelta(days=EVENTS_FUTURE_DAYS)
        print(f"Leyendo entrenos de TrainingPeaks del {start} al {end} y competiciones hasta el {events_end}...")
        raw = client.workouts(start, end)
        # La primera vez que se guardan competiciones se piden todas (aunque la sync de entrenos sea incremental)
        events_start = start if existing_events else min(start, since or default_since())
        raw_events = client.events(events_start, events_end)
    except TrainingPeaksAuthError as e:
        sys.exit(f"ERROR: {e}")
    except TrainingPeaksError as e:
        sys.exit(f"ERROR: {e}")

    fresh = []
    for w in raw:
        try:
            n = normalize_tp(w)
        except (KeyError, TypeError, ValueError) as e:
            print(f"  AVISO: no pude procesar el entreno {w.get('workoutId')}: {e}")
            continue
        if n:
            fresh.append(n)

    fresh_events = []
    for e in raw_events:
        try:
            n = normalize_event(e)
        except (KeyError, TypeError, ValueError) as err:
            print(f"  AVISO: no pude procesar el evento {e.get('id')}: {err}")
            continue
        if n:
            fresh_events.append(n)

    workouts = merge(existing, fresh, start, end)
    events = merge(existing_events, fresh_events, events_start, events_end)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"syncedAt": datetime.now().isoformat(timespec="seconds"), "workouts": workouts, "events": events},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    planned = sum(1 for w in workouts if w["hasPlan"])
    upcoming = [e for e in events if e["date"] >= today.isoformat()]
    print(f"Guardados {len(workouts)} entrenos ({planned} con plan del entrenador) y {len(events)} competiciones "
          f"({len(upcoming)} próximas) → public/data/plan.json")


if __name__ == "__main__":
    main()
