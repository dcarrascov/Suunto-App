"""
Cliente de SOLO LECTURA para la API interna que usa la web de TrainingPeaks
(tpapi.trainingpeaks.com). No es una API pública: la oficial solo se concede a
empresas. Puede cambiar sin aviso y su uso puede ir contra los términos de
TrainingPeaks. Úsalo solo con tu propia cuenta.

Autenticación: la cookie de sesión `Production_tpAuth` de app.trainingpeaks.com
(variable TP_AUTH_COOKIE en .env; ver GUIA_TRAININGPEAKS.md). Con ella se pide un
token que dura ~1 hora y se renueva solo. Solo se hacen peticiones GET.
"""
from __future__ import annotations
import os
import time
from datetime import date, timedelta

import requests

API_BASE = os.getenv("TP_API_BASE", "https://tpapi.trainingpeaks.com")
TIMEOUT = 45
CHUNK_DAYS = 45  # días por petición de entrenos (rangos pequeños para no forzar al servidor)


class TrainingPeaksError(Exception):
    pass


class TrainingPeaksAuthError(TrainingPeaksError):
    pass


def load_cookie() -> str:
    cookie = os.getenv("TP_AUTH_COOKIE", "").strip()
    if not cookie:
        raise TrainingPeaksAuthError(
            "Falta TP_AUTH_COOKIE en el fichero .env. "
            "Mira GUIA_TRAININGPEAKS.md para copiar la cookie Production_tpAuth del navegador."
        )
    # Por si se pega con el nombre delante ("Production_tpAuth=...")
    return cookie.split("=", 1)[1] if cookie.startswith("Production_tpAuth=") else cookie


class TrainingPeaksClient:
    def __init__(self, cookie: str | None = None):
        self._cookie = cookie or load_cookie()
        self._http = requests.Session()
        self._http.headers.update({"Accept": "application/json"})
        self._token: str | None = None
        self._token_until = 0.0
        self._athlete_id: int | None = None

    # -- autenticación -------------------------------------------------------

    def _ensure_token(self) -> str:
        if self._token and time.time() < self._token_until:
            return self._token
        try:
            r = self._http.get(f"{API_BASE}/users/v3/token", timeout=TIMEOUT,
                               headers={"Cookie": f"Production_tpAuth={self._cookie}"})
        except requests.RequestException as e:
            raise TrainingPeaksError(f"sin conexión con TrainingPeaks ({type(e).__name__})") from e
        if r.status_code in (401, 403):
            raise TrainingPeaksAuthError(
                "La cookie de TrainingPeaks no es válida o ha caducado. "
                "Vuelve a copiar Production_tpAuth (GUIA_TRAININGPEAKS.md)."
            )
        if not r.ok:
            raise TrainingPeaksError(f"HTTP {r.status_code} al pedir el token")
        data = r.json() if r.content else {}
        tok = data.get("token") if isinstance(data, dict) else None
        if not data.get("success") or not isinstance(tok, dict) or not tok.get("access_token"):
            raise TrainingPeaksAuthError("TrainingPeaks no devolvió un token: la cookie puede haber caducado.")
        self._token = tok["access_token"]
        self._token_until = time.time() + float(tok.get("expires_in") or 3600) - 120  # margen de 2 min
        return self._token

    # -- bajo nivel ----------------------------------------------------------

    def _get(self, path: str):
        url = API_BASE.rstrip("/") + "/" + path.lstrip("/")
        last: Exception | None = None
        for attempt in range(3):
            headers = {"Authorization": f"Bearer {self._ensure_token()}"}
            try:
                r = self._http.get(url, timeout=TIMEOUT, headers=headers)
            except requests.RequestException as e:
                last = TrainingPeaksError(f"sin conexión con TrainingPeaks ({type(e).__name__})")
                time.sleep(2 ** attempt)
                continue
            if r.status_code == 401 and attempt == 0:
                self._token = None  # token caducado antes de tiempo: se pide otro
                continue
            if r.status_code in (401, 403):
                raise TrainingPeaksAuthError(f"Acceso denegado por TrainingPeaks (HTTP {r.status_code}) en {path}")
            if r.status_code == 429 or r.status_code >= 500:
                last = TrainingPeaksError(f"HTTP {r.status_code}")
                time.sleep(2 ** attempt * 2)
                continue
            if not r.ok:
                raise TrainingPeaksError(f"HTTP {r.status_code} en {path}")
            try:
                return r.json() if r.content else None
            except ValueError as e:
                raise TrainingPeaksError(f"Respuesta no válida en {path}: {e}") from e
        raise TrainingPeaksError(f"No se pudo leer {path}: {last}")

    # -- endpoints -----------------------------------------------------------

    def user(self) -> dict:
        data = self._get("/users/v3/user")
        if isinstance(data, dict) and isinstance(data.get("user"), dict):
            return data["user"]
        return data if isinstance(data, dict) else {}

    def athlete_id(self) -> int:
        """Id de atleta de la cuenta (TP_ATHLETE_ID en .env lo fuerza si hiciera falta)."""
        if self._athlete_id:
            return self._athlete_id
        forced = os.getenv("TP_ATHLETE_ID", "").strip()
        if forced:
            self._athlete_id = int(forced)
            return self._athlete_id
        u = self.user()
        person = u.get("personId") or u.get("userId")
        athletes = [a for a in u.get("athletes") or [] if isinstance(a, dict)]
        email = (u.get("email") or "").lower()
        # cuenta de atleta: su propio personId; si la cuenta lista atletas, el que coincide con su email
        mine = next((a for a in athletes if (a.get("email") or "").lower() == email and a.get("athleteId")), None)
        athlete = (mine or {}).get("athleteId") or person or (athletes[0].get("athleteId") if athletes else None)
        if not athlete:
            raise TrainingPeaksError("No encuentro tu id de atleta; ponlo en TP_ATHLETE_ID (.env).")
        self._athlete_id = int(athlete)
        return self._athlete_id

    def workouts(self, start: date, end: date) -> list[dict]:
        """Entrenos (planificados y realizados) entre dos fechas, ambas incluidas, en tramos de CHUNK_DAYS."""
        aid = self.athlete_id()
        out: list[dict] = []
        seen: set = set()
        cur = start
        while cur <= end:
            stop = min(end, cur + timedelta(days=CHUNK_DAYS - 1))
            page = self._get(f"/fitness/v6/athletes/{aid}/workouts/{cur.isoformat()}/{stop.isoformat()}")
            for w in page if isinstance(page, list) else []:
                wid = w.get("workoutId") if isinstance(w, dict) else None
                if wid is not None and wid not in seen:
                    seen.add(wid)
                    out.append(w)
            cur = stop + timedelta(days=1)
        return out
