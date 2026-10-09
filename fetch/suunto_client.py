"""
Cliente de SOLO LECTURA para el backend que usa la app móvil de Suunto
(Sports Tracker). No es una API pública: puede cambiar sin aviso y su uso puede
ir contra los términos de Suunto. Úsalo solo con tu propia cuenta.

No gestiona contraseñas. La clave de sesión (`sessionkey`) la crea la herramienta
`suuntool` al hacer `suuntool login` y se lee de su fichero de sesión, o de la
variable de entorno SUUNTO_SESSION_KEY.
"""
from __future__ import annotations
import gzip
import json
import os
import time
from pathlib import Path

import requests

API_BASE = os.getenv("SUUNTO_API_BASE", "https://api.sports-tracker.com/apiserver/v1/")
# Mismo User-Agent que usan los clientes de código abierto de referencia (app Suunto 6.8.13).
# Si el servidor empezara a rechazarlo, cámbialo con SUUNTO_USER_AGENT.
USER_AGENT = os.getenv("SUUNTO_USER_AGENT", "com.stt.android.suunto/6008013")
TIMEOUT = 45
PAGE_SIZE = 100  # máximo por página que acepta el servidor


class SuuntoError(Exception):
    pass


class SuuntoAuthError(SuuntoError):
    pass


def _session_files() -> list[Path]:
    files = []
    if os.getenv("SUUNTOOL_SESSION_FILE"):
        files.append(Path(os.environ["SUUNTOOL_SESSION_FILE"]))
    if os.getenv("XDG_CONFIG_HOME"):
        files.append(Path(os.environ["XDG_CONFIG_HOME"]) / "suuntool" / "session.json")
    files.append(Path.home() / ".config" / "suuntool" / "session.json")
    return files


def load_session_key() -> str:
    key = os.getenv("SUUNTO_SESSION_KEY", "").strip()
    if key:
        return key
    for path in _session_files():
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise SuuntoAuthError(f"No puedo leer {path}: {e}") from e
        if data.get("sessionkey"):
            return data["sessionkey"]
    raise SuuntoAuthError(
        "No hay sesión de Suunto. Ejecuta primero:  suuntool login --email TU_EMAIL"
    )


class SuuntoClient:
    def __init__(self, session_key: str | None = None):
        self._http = requests.Session()
        self._http.headers.update({
            "User-Agent": USER_AGENT,
            "Accept-Language": "en",
            "STTAuthorization": session_key or load_session_key(),
        })

    # -- bajo nivel ----------------------------------------------------------

    def _get(self, path: str) -> bytes:
        url = API_BASE.rstrip("/") + "/" + path.lstrip("/")
        last: Exception | None = None
        for attempt in range(3):
            try:
                r = self._http.get(url, timeout=TIMEOUT)
            except requests.RequestException as e:
                last = SuuntoError(f"sin conexión con Suunto ({type(e).__name__}); comprueba tu internet")
                time.sleep(2 ** attempt)
                continue
            if r.status_code in (401, 403):
                raise SuuntoAuthError(
                    f"Sesión de Suunto no válida o caducada (HTTP {r.status_code}). "
                    "Repite:  suuntool login --email TU_EMAIL"
                )
            if r.status_code == 429 or r.status_code >= 500:
                last = SuuntoError(f"HTTP {r.status_code}")
                time.sleep(2 ** attempt * 2)
                continue
            if not r.ok:
                raise SuuntoError(f"HTTP {r.status_code} en {path}")
            return r.content
        raise SuuntoError(f"No se pudo leer {path}: {last}")

    def _payload(self, path: str):
        """Devuelve `payload` del sobre {error, metadata, payload} que usa el servidor."""
        body = self._get(path)
        if body[:2] == b"\x1f\x8b":  # a veces llega comprimido sin cabecera
            body = gzip.decompress(body)
        try:
            env = json.loads(body)
        except ValueError as e:
            raise SuuntoError(f"Respuesta no válida en {path}: {e}") from e
        if isinstance(env, dict) and env.get("error"):
            raise SuuntoError(f"Error del servidor en {path}: {env['error']}")
        return env.get("payload") if isinstance(env, dict) and "payload" in env else env

    # -- endpoints -----------------------------------------------------------

    def list_workouts(self, since_ms: int = 0, max_pages: int = 200) -> list[dict]:
        """Todos los entrenamientos desde `since_ms` (0 = todos), sin duplicados."""
        items: list[dict] = []
        seen: set[str] = set()
        offset = 0
        for _ in range(max_pages):
            page = self._payload(f"workouts?since={since_ms}&limit={PAGE_SIZE}&offset={offset}")
            if not isinstance(page, list) or not page:
                break
            fresh = [w for w in page if isinstance(w, dict) and w.get("key") and w["key"] not in seen]
            if not fresh:  # el servidor repite página: evita un bucle infinito
                break
            seen.update(w["key"] for w in fresh)
            items.extend(fresh)
            print(f"  {len(items)} entrenamientos leídos...")
            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
            time.sleep(0.3)
        return items

    def workout(self, key: str) -> dict:
        """Detalle de un entrenamiento (incluye `extensions`)."""
        p = self._payload(f"workouts/{key}")
        return p if isinstance(p, dict) else {}

    def workout_data(self, key: str) -> dict:
        """Muestras del entrenamiento: heartrates, locations (GPS) y eventlaps."""
        p = self._payload(f"workouts/{key}/data")
        return p if isinstance(p, dict) else {}
