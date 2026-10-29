"""
Mezcla de fuentes: las actividades de ficheros FIT se suman a las de la cuenta de Suunto sin repetir las que
ya están (la misma sesión exportada como FIT y sincronizada desde la nube). Sin dependencias, para poder probarlo.
"""
from __future__ import annotations

import bisect
from datetime import datetime

MAX_START_GAP_S = 120        # el inicio puede variar unos segundos entre el reloj y la nube
MAX_DURATION_DIFF = 0.10     # y la duración, por pausas o recortes, hasta un 10 %


def _start(summary: dict) -> datetime:
    return datetime.fromisoformat(summary["startTime"])


def is_same_activity(a: dict, b: dict) -> bool:
    """¿Son la misma sesión? Inicio a menos de 2 min y duración parecida (±10 %)."""
    if abs((_start(a) - _start(b)).total_seconds()) > MAX_START_GAP_S:
        return False
    da, db = a.get("duration") or 0, b.get("duration") or 0
    return abs(da - db) <= MAX_DURATION_DIFF * max(da, db, 1)


def drop_duplicates(primary: list[dict], extra: list[dict]) -> tuple[list[dict], int]:
    """
    De `extra` (resúmenes de FIT) quita los que ya están en `primary` (resúmenes de la nube, que traen más datos:
    TSS, VO2max…). Devuelve (los que se añaden, cuántos estaban repetidos).
    """
    ordered = sorted(primary, key=_start)
    starts = [_start(s) for s in ordered]
    kept, repeated = [], 0
    for s in extra:
        t = _start(s)
        i = bisect.bisect_left(starts, t)
        near = ordered[max(0, i - 3): i + 3]   # solo las de alrededor de esa hora
        if any(is_same_activity(s, p) for p in near):
            repeated += 1
        else:
            kept.append(s)
    return kept, repeated
