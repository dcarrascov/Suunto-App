#!/usr/bin/env python3
"""
Datos de demostración (inventados) para probar la app sin cuenta de Suunto ni TrainingPeaks.

    python3 fetch/make_demo.py      # escribe demo/data/ con fechas hasta hoy
    npm run demo                    # abre la app con esos datos (no toca public/data/)

Sin rutas GPS ni datos de nadie: unas 26 semanas de un corredor ficticio, su plan y dos carreras.
"""
from __future__ import annotations

import json
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from normalizer import EXTRA_KEYS, detail_to_summary, make_summary, set_best_efforts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "demo" / "data"
WEEKS = 26
MAX_HR = 190
ZONES = [(1, 0, 133), (2, 133, 152), (3, 152, 162), (4, 162, 172), (5, 172, MAX_HR)]

# Semana tipo: (día 0 = lunes, tipo, minutos, ritmo s/km)
WEEK = [
    (1, "rodaje", 45, 320),
    (2, "series", 55, 290),
    (3, "rodaje", 40, 330),
    (5, "rodaje", 35, 335),
    (6, "tirada", 80, 325),
]


def epoch(day: date, hour: int, minute: int = 0) -> int:
    """Hora «de reloj» como si fuera UTC: con utc_offset_min=0 make_summary devuelve esa misma hora."""
    return int(datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc).timestamp())


def laps_for(km: float, pace: float, hr: int, rng: random.Random) -> list:
    laps, done, i = [], 0.0, 1
    while done < km - 0.05:
        d = min(1.0, round(km - done, 3))
        p = pace * rng.uniform(0.97, 1.03)
        laps.append({"index": i, "distance": d, "duration": round(p * d), "avgHR": hr + rng.randint(-4, 4),
                     "avgPace": round(p), "avgSpeed": round(3600 / p, 1), "avgPower": None,
                     "elevationGain": rng.randint(0, 8)})
        done += d
        i += 1
    return laps


def zones_for(seconds: int, kind: str) -> list:
    split = {"rodaje": (0.35, 0.5, 0.1, 0.05, 0), "tirada": (0.3, 0.55, 0.1, 0.05, 0),
             "series": (0.3, 0.3, 0.1, 0.2, 0.1), "carrera": (0, 0.1, 0.2, 0.4, 0.3)}[kind]
    return [{"zone": z, "name": f"Zona {z}", "seconds": round(seconds * f), "lowBPM": lo or None, "highBPM": hi}
            for (z, lo, hi), f in zip(ZONES, split)]


def activity(day: date, kind: str, minutes: float, pace: float, rng: random.Random, name: str = "Carrera") -> tuple[dict, dict]:
    secs = round(minutes * 60 * rng.uniform(0.95, 1.05))
    pace = pace * rng.uniform(0.98, 1.02)
    km = round(secs / pace, 2)
    hr = {"rodaje": 145, "tirada": 148, "series": 158, "carrera": 170}[kind] + rng.randint(-3, 3)
    summary = make_summary(
        start_s=epoch(day, rng.choice([7, 8, 19, 20]), rng.choice([0, 15, 30, 45])), sport="running", name=name,
        distance_m=km * 1000, duration_s=secs, ascent_m=rng.randint(10, 90), avg_hr=hr, max_hr=hr + rng.randint(10, 18),
        calories=round(secs / 60 * 12), tss=round(secs / 3600 * {"rodaje": 55, "tirada": 60, "series": 80, "carrera": 95}[kind], 1),
        vo2max=round(rng.uniform(54, 57), 1) if kind != "rodaje" else None, aerobic_te=round(rng.uniform(2.5, 4.2), 1),
        utc_offset_min=0, suuntoKey=None,
    )
    detail = dict(summary)
    detail["laps"] = laps_for(km, pace, hr, rng)
    detail["hrZones"] = zones_for(secs, kind)
    detail["gpxCoords"] = []   # sin rutas: la demo no muestra mapas
    detail["extra"] = {k: None for k in EXTRA_KEYS}
    detail["extra"].update({"minHR": hr - 40, "cadence": 86, "stepCadence": 172, "tssMethod": "HR"})
    set_best_efforts(detail)
    summary.update(detail_to_summary(detail))
    return summary, detail


def planned(wid: int, day: date, title: str, minutes: int, tss: int, desc: str, done: bool) -> dict:
    return {"id": wid, "date": day.isoformat(), "sport": "running", "typeName": "Carrera", "title": title,
            "description": desc, "coachComments": None, "athleteComments": None,
            "planned": {"duration": minutes * 60, "distance": None, "tss": tss, "if": None},
            "actual": {"duration": minutes * 60, "distance": None, "tss": tss} if done else None,
            "completed": done, "hasPlan": True}


def main():
    rng = random.Random(42)
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    first = monday - timedelta(weeks=WEEKS)
    race_a = monday + timedelta(weeks=5, days=6)      # domingo, dentro de 5 semanas: objetivo
    race_b = monday - timedelta(weeks=6, days=1)      # domingo hace 6 semanas: 5K de prueba

    summaries, details, workouts = [], [], []
    wid = 1000
    for w in range(WEEKS + 6):
        start = first + timedelta(weeks=w)
        load = 0.8 if w % 4 == 3 else 1.0 + min(w, 20) * 0.01   # descarga cada 4 semanas
        for dow, kind, minutes, pace in WEEK:
            day = start + timedelta(days=dow)
            if day == race_b + timedelta(days=0) or day > today + timedelta(weeks=3):
                continue
            title = {"rodaje": f"RODAJE {round(minutes * load)}'", "series": "SERIES 6x1000 r2'",
                     "tirada": f"TIRADA LARGA {round(minutes * load)}'"}[kind]
            past = day < today
            # el plan (TrainingPeaks ficticio) de las últimas 8 semanas y las 3 próximas
            if day >= monday - timedelta(weeks=8):
                wid += 1
                desc = {"rodaje": "OBJETIVO: base aeróbica. Z2, ritmo cómodo.",
                        "series": "OBJETIVO: umbral. 15' calentamiento, 6x1000 a ritmo de 10K con 2' de trote, 10' vuelta a la calma.",
                        "tirada": "OBJETIVO: resistencia. Continuo en Z2; últimos 10' algo más vivos."}[kind]
                workouts.append(planned(wid, day, title, round(minutes * load), round(minutes * load * 0.9), desc, past))
            if past and rng.random() > 0.08:   # alguna sesión se queda sin hacer
                s, d = activity(day, "tirada" if kind == "tirada" else kind, minutes * load, pace, rng)
                summaries.append(s)
                details.append(d)
        if start + timedelta(days=3) < today and w % 3 == 1:   # un día de bici de vez en cuando
            day = start + timedelta(days=3)
            secs = rng.randint(3000, 4800)
            s = make_summary(start_s=epoch(day, 18), sport="cycling", name="Ciclismo", distance_m=secs * 7.5,
                             duration_s=secs, ascent_m=rng.randint(100, 400), avg_hr=128, max_hr=150,
                             calories=round(secs / 60 * 9), tss=round(secs / 3600 * 45, 1), utc_offset_min=0, suuntoKey=None)
            summaries.append(s)
    if race_b < today:
        s, d = activity(race_b, "carrera", 20, 238, rng, name="Carrera")
        summaries.append(s)
        details.append(d)

    events = [
        {"id": 1, "date": race_b.isoformat(), "name": "5K Popular del Parque", "type": "RunningRoad", "priority": "B",
         "distanceKm": 5.0, "description": None, "comment": None},
        {"id": 2, "date": race_a.isoformat(), "name": "10K Ciudad Demo", "type": "RunningRoad", "priority": "A",
         "distanceKm": 10.0, "description": "Objetivo de la temporada.", "comment": None},
    ]
    summaries.sort(key=lambda s: s["startTime"], reverse=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("activity_*.json"):
        old.unlink()

    def save(name, data):
        (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    save("activities.json", summaries)
    for d in details:
        save(f"activity_{d['id']}.json", d)
    save("stats.json", {
        "totalActivities": len(summaries),
        "byType": {sp: sum(1 for s in summaries if s["sport"] == sp) for sp in {s["sport"] for s in summaries}},
        "vo2maxHistory": sorted(({"date": s["startTime"][:10], "value": s["vo2max"]} for s in summaries if s.get("vo2max")),
                                key=lambda x: x["date"]),
        "syncedAt": datetime.now().isoformat(timespec="seconds"),
        "userMaxHR": MAX_HR,
    })
    save("plan.json", {"syncedAt": datetime.now().isoformat(timespec="seconds"), "workouts": workouts, "events": events})
    print(f"Demo: {len(summaries)} actividades, {len(workouts)} entrenos planificados y {len(events)} carreras → {OUT}")


if __name__ == "__main__":
    main()
