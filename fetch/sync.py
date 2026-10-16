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

    from normalizer import SUMMARY_FROM_DETAIL, build_extra, detail_to_summary, normalize_summary
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
                raw, changed = e.get("raw"), False
                if raw is not None and "extra" not in cached:
                    # detalle guardado con una versión anterior: se completa con los datos nuevos que
                    # ya vienen en la lista (no hace falta pedir nada más a Suunto)
                    fresh = normalize_summary(raw)
                    cached["extra"] = build_extra(raw, cached, None)
                    for k in ("vo2max", "aerobicTE"):
                        cached[k] = fresh[k]
                    changed = True
                if any(k not in cached for k in SUMMARY_FROM_DETAIL):
                    # detalle de una versión anterior: mejores tramos (con los parciales guardados;
                    # --force los recalcula exactos con las muestras) y segundos por zona
                    detail_to_summary(cached)
                    changed = True
                if changed:
                    save_json(path, cached)
                    updated += 1
                print(f"  {tag} — ya guardada, la salto")
                e["summary"] = {k: v for k, v in cached.items() if k not in DETAIL_ONLY}
                continue

        print(f"  {tag} ({s.get('title', '')})...")
        try:
            new_summary, detail = e["load"]()
            new_summary.update(detail_to_summary(detail))
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
