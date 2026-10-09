# Guía: adaptar Garmin Stats para que funcione con tu reloj Suunto

> **Resumen en 30 segundos**
>
> - La app tiene dos mitades: un script de Python que **descarga** tus entrenamientos (es lo único atado a Garmin) y una web en React que **lee ficheros JSON** y casi no cambia.
> - Suunto **no ofrece una API para uso personal**, así que hay dos caminos: **Ruta A** (automática: lee tu cuenta de Suunto; no es oficial) y **Ruta B** (ficheros FIT que exportas tú; sin riesgo). La guía incluye el código completo de las dos.
> - De paso se corrigen **3 fallos que ya tenía la app** y que se notarían con cualquier reloj: un gráfico del Dashboard sin barras, el mapa de la actividad que no dibujaba la ruta y un TSS negativo en entrenos sin pulsómetro.
> - Todo está probado con un servidor simulado y con ficheros FIT reales, pero **no contra los servidores reales de Suunto** (no tengo una cuenta). Qué está verificado y qué no se detalla en el [apartado 9](#9-cómo-se-verificó-esta-guía-y-qué-no).

> **¿Usas un asistente de IA (Claude Code, Cursor, Copilot…)?** Pásale esta guía entera y dile: *«Aplica esta guía a mi proyecto, paso a paso, y al final ejecuta las comprobaciones del apartado 5.6.»* Está escrita para poder aplicarse de forma literal: cada fichero está completo y cada edición indica exactamente qué buscar y por qué cambiarlo.

## Índice

1. [Qué vas a conseguir (y qué no)](#1-qué-vas-a-conseguir-y-qué-no)
2. [Cómo está hecha la app (y por qué el cambio es pequeño)](#2-cómo-está-hecha-la-app-y-por-qué-el-cambio-es-pequeño)
3. [Elige tu ruta](#3-elige-tu-ruta)
4. [Plan de trabajo](#4-plan-de-trabajo)
5. [Paso a paso](#5-paso-a-paso)
   - [5.1 Antes de tocar nada](#51-antes-de-tocar-nada)
   - [5.2 Capa de datos: carpeta `fetch/`](#52-capa-de-datos-carpeta-fetch)
   - [5.3 Web: carpeta `src/` (e `index.html`)](#53-web-carpeta-src-e-indexhtml)
   - [5.4 `.gitignore` y README](#54-gitignore-y-readme)
   - [5.5 Primera sincronización](#55-primera-sincronización)
   - [5.6 Comprobar que funciona](#56-comprobar-que-funciona)
6. [Qué datos tendrás: Garmin frente a Suunto](#6-qué-datos-tendrás-garmin-frente-a-suunto)
7. [Problemas frecuentes](#7-problemas-frecuentes)
8. [Riesgos y privacidad](#8-riesgos-y-privacidad)
9. [Cómo se verificó esta guía (y qué no)](#9-cómo-se-verificó-esta-guía-y-qué-no)
10. [Mejoras opcionales](#10-mejoras-opcionales)
- [Apéndice A. `README.md` adaptado](#apéndice-a-readmemd-adaptado)
- [Apéndice B. Contrato de datos](#apéndice-b-contrato-de-datos)
- [Apéndice C. IDs de actividad de Suunto usados](#apéndice-c-ids-de-actividad-de-suunto-usados)

---

## 1. Qué vas a conseguir (y qué no)

**Vas a tener** la misma aplicación, con tus datos de Suunto: Dashboard, Actividades (con mapa, zonas de FC y parciales), Fitness y Forma (CTL/ATL/TSB), Zonas, Rendimiento y Récords.

**Qué cambia respecto a Garmin** (la tabla completa está en el [apartado 6](#6-qué-datos-tendrás-garmin-frente-a-suunto)):

- En los datos de Suunto que usan los proyectos de referencia no vienen el Training Effect anaeróbico ni el SWOLF/brazadas: esos huecos quedan vacíos.
- El VO2max tendrá pocas mediciones: Suunto solo lo calcula en carreras y caminatas.
- El «Training Effect» que verás es el *Peak Training Effect* de Suunto (escala 1-5): parecido al de Garmin, pero calculado de otra forma.
- El TSS será el que calcula Suunto. Si una actividad no lo trae, la app lo estima con la FC, como ya hacía.
- No he encontrado un campo con el título del entrenamiento en los datos que usan los proyectos de referencia, así que se genera uno: «Carrera · 30/09».

**Trabajo que implica:** crear o reemplazar 8 ficheros (el código está en esta guía), hacer 16 ediciones pequeñas en 8 ficheros existentes y configurar la ruta que elijas.

---

## 2. Cómo está hecha la app (y por qué el cambio es pequeño)

```
   Garmin Connect ──▶ fetch/sync.py ──▶ fetch/normalizer.py
   (garminconnect,                              │
    email + contraseña)                         ▼
                                    public/data/activities.json        ← lista de actividades
                                    public/data/activity_<id>.json     ← detalle de cada una
                                    public/data/stats.json             ← totales y VO2max
                                                │
                                                ▼
                                    src/  (React + Vite): Dashboard, Fitness, Zonas…
```

Solo la parte de la izquierda conoce a Garmin. La web ya funciona con un «contrato» de datos (los tipos de `src/types/garmin.ts`, copiados en el [Apéndice B](#apéndice-b-contrato-de-datos)) que no depende del reloj. Por eso la estrategia es:

1. **Sustituir la parte que descarga** por otra que lea Suunto.
2. **Producir exactamente el mismo JSON** que antes.
3. **Tocar la web solo en rótulos «Garmin» y en 3 fallos** que encontré al probarla.

| Pieza | ¿Atada a Garmin? | Qué hacer |
| --- | --- | --- |
| `fetch/requirements.txt` | Sí (`garminconnect`) | Reemplazar |
| `.env.example` | Sí (`GARMIN_EMAIL`, `GARMIN_PASSWORD`) | Reemplazar |
| `fetch/sync.py` | Sí | Reemplazar |
| `fetch/normalizer.py` | Sí | Reemplazar |
| `src/` (la web) | Solo unos pocos rótulos «Garmin» | Editar (y arreglar 3 fallos) |
| `src/types/garmin.ts` | Solo el nombre del fichero | Nada (renombrarlo es opcional) |

---

## 3. Elige tu ruta

### 3.1 Por qué no se usa la API oficial

Suunto tiene una API oficial (la «API Zone»), pero según su propio [FAQ](https://apizone.suunto.com/faq) se concede a empresas y organizaciones que desarrollan herramientas o servicios, y **no se ofrece para uso personal**. Como particular no puedes pedirla.

### 3.2 Las dos rutas

| | **Ruta A — Nube de Suunto** | **Ruta B — Ficheros FIT** |
| --- | --- | --- |
| Cómo trae los datos | Lee tu cuenta de Suunto (la de la app del móvil) | Lee los `.fit` que exportas desde la app |
| Comodidad | Un comando, todo el historial | Hay que exportar los entrenamientos y copiarlos a una carpeta |
| Qué obtienes | TSS, VO2max, PTE y zonas de FC **de Suunto**, parciales, ruta | Distancia, FC, ruta, parciales, potencia; TSS y zonas se calculan |
| Riesgo | **No es oficial.** Puede dejar de funcionar sin aviso y podría ir contra los términos de Suunto | **Ninguno** (son tus propios ficheros) |
| Necesitas | `suuntool` (solo para iniciar sesión) | Nada más |

### 3.3 ¿Y Strava?

Si ya sincronizas Suunto con Strava podrías leer Strava con su API oficial. No lo he incluido porque obliga a registrar una aplicación de desarrollador y a hacer un flujo OAuth, y porque esa API no está pensada para datos propios de Suunto como el VO2max o el Training Effect. La Ruta B cubre el caso «sin riesgo» sin esos pasos.

### 3.4 Mi recomendación

Prueba primero la **Ruta A** con `--limit 20`. Si el riesgo no te convence o no funciona con tu cuenta, usa la **Ruta B**. Elige una: las dos escriben en `public/data/` y la lista de actividades se rehace con la fuente que ejecutes, no se mezclan.

---

## 4. Plan de trabajo

- [ ] 1. Hacer una copia de seguridad del proyecto.
- [ ] 2. Crear o reemplazar los 6 ficheros de `fetch/`, `.env.example` y `README.md` ([5.2](#52-capa-de-datos-carpeta-fetch)).
- [ ] 3. Hacer las ediciones de la web ([5.3](#53-web-carpeta-src-e-indexhtml)) y del `.gitignore` ([5.4](#54-gitignore-y-readme)).
- [ ] 4. Instalar las dependencias de Python.
- [ ] 5. **Ruta A:** instalar `suuntool` e iniciar sesión · **Ruta B:** exportar tus `.fit` ([5.5](#55-primera-sincronización)).
- [ ] 6. Sincronizar una prueba pequeña (`--limit 20`) y, si va bien, todo el historial.
- [ ] 7. Validar los datos y abrir la app ([5.6](#56-comprobar-que-funciona)).
- [ ] 8. Poner tu FC máxima en **Ajustes**.

---

## 5. Paso a paso

### 5.1 Antes de tocar nada

Haz una copia de la carpeta del proyecto. Si usas git: `git checkout -b suunto`.

### 5.2 Capa de datos: carpeta `fetch/`

Estos ficheros se **crean o se sustituyen enteros** (copia el contenido tal cual). El código está en bloques desplegables; haz clic en cada uno.

| Fichero | Acción | Para qué sirve |
| --- | --- | --- |
| `.env.example` | Reemplazar | Opciones. Ya **no hay email ni contraseña** de ningún servicio |
| `fetch/requirements.txt` | Reemplazar | Dependencias de Python (sin `garminconnect`) |
| `fetch/suunto_client.py` | **Nuevo** | Ruta A: lee tu cuenta de Suunto (solo lectura) |
| `fetch/normalizer.py` | Reemplazar | Convierte datos de Suunto al formato de la app |
| `fetch/fit_source.py` | **Nuevo** | Ruta B: lee ficheros FIT |
| `fetch/sync.py` | Reemplazar | Script principal: descarga, caché y estadísticas |
| `fetch/validate_output.py` | **Nuevo** | Comprueba que los datos tienen el formato correcto |
| `README.md` | Reemplazar | Versión adaptada ([Apéndice A](#apéndice-a-readmemd-adaptado)) |

Notas:

- Aunque la librería se llame `garmin-fit-sdk`, **FIT es un formato abierto** que usan muchas marcas (Suunto lo exporta). Es el decodificador oficial del formato y funcionó con ficheros de Garmin, COROS y Wahoo en mis pruebas.
- No hace falta crear un `.env`: todas las opciones son opcionales. Si quieres usarlas: `cp .env.example .env`.
- Ya no necesitas `garminconnect`. Puedes quitarlo con `python3 -m pip uninstall garminconnect garth`.

<details>
<summary><b><code>.env.example</code></b> · 17 líneas · clic para desplegar</summary>

```ini
# Ya NO hace falta email ni contraseña: la sesión la crea `suuntool login`.
# Todo lo de abajo es opcional (quita el # para activarlo).

# Zona horaria para la hora local de tus actividades (por defecto, la de tu ordenador)
# SUUNTO_TIMEZONE=Europe/Madrid

# Solo si no usas suuntool: pega aquí tu clave de sesión (equivale a una contraseña, no la compartas)
# SUUNTO_SESSION_KEY=

# Solo si el servidor rechazara el User-Agent por defecto
# SUUNTO_USER_AGENT=

# Pausa (segundos) entre actividades al descargar; súbela si ves errores 429
# SUUNTO_PAUSE=0.6

# Importación de ficheros FIT (--source fit): FC máxima para calcular las zonas
# MAX_HR=185
```

</details>

<details>
<summary><b><code>fetch/requirements.txt</code></b> · 4 líneas · clic para desplegar</summary>

```text
requests>=2.31.0
python-dotenv>=1.0.0
garmin-fit-sdk>=21.0.0
tzdata>=2024.1
```

</details>

<details>
<summary><b><code>fetch/suunto_client.py</code></b> · 142 líneas · clic para desplegar</summary>

```python
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
```

</details>

<details>
<summary><b><code>fetch/normalizer.py</code></b> · 394 líneas · clic para desplegar</summary>

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
        vo2max=_first_ext_value(w, "FitnessExtension", "vo2Max"),  # solo carrera/caminata
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


def normalize_detail(summary: dict, w: dict, data: dict | None) -> dict:
    """
    ActivityDetail: resumen + zonas de FC + parciales + ruta GPS.
    `w` es el entrenamiento de Suunto y `data` la respuesta de workouts/{key}/data
    (heartrates, locations, eventlaps). Con data=None solo hay zonas de FC.
    """
    detail = dict(summary)
    detail["hrZones"] = hr_zones_suunto(w)
    detail["laps"], detail["gpxCoords"] = [], []
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

    events = _rows(data, "eventlaps")
    laps = _laps_from_events(events, summary["duration"], total_m, scale, hr, alts) if events else []
    if len(laps) < 2:  # sin vueltas del reloj: parciales automáticos por distancia
        dist_pts = [(_num(r.get("t")), (_num(r.get("s")) or 0.0) * scale) for r in loc if r.get("s") is not None]
        split_m = 5000.0 if summary["sport"] == "cycling" else 1000.0
        laps = auto_splits(dist_pts, hr, alts, split_m) or laps
    detail["laps"] = laps
    return detail
```

</details>

<details>
<summary><b><code>fetch/fit_source.py</code></b> · 173 líneas · clic para desplegar</summary>

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
    _lap, _num, _spm, auto_splits, hr_zones_from_samples, make_summary, route_points,
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
    return summary, detail
```

</details>

<details>
<summary><b><code>fetch/sync.py</code></b> · 296 líneas · clic para desplegar</summary>

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
DETAIL_ONLY = ("laps", "hrZones", "gpxCoords", "partial")  # claves que no van en el resumen


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
    from normalizer import normalize_detail, normalize_summary
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

        entries.append({"summary": summary, "load": load, "network": True})
    meta = {"userMaxHR": round(float(user_max_hr)) if user_max_hr else None}
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
        "list": redact(files["list"]), "detail": redact(files["detail"]), "data": redacted_sample(files["data"]),
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

    from suunto_client import SuuntoAuthError  # solo para capturar el error de sesión
    print(f"\nProcesando el detalle de {len(entries)} actividades...")
    for i, e in enumerate(entries):
        s = e["summary"]
        path = OUT_DIR / f"activity_{s['id']}.json"
        tag = f"[{i + 1}/{len(entries)}] {s['id']}"

        if path.exists() and not args.force:
            cached = json.loads(path.read_text(encoding="utf-8"))
            if not (cached.get("partial") and not args.no_gpx):
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
<summary><b><code>fetch/validate_output.py</code></b> · 138 líneas · clic para desplegar</summary>

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


def check_detail(d, where):
    check_summary(d, where)
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

### 5.3 Web: carpeta `src/` (e `index.html`)

Cada edición dice **qué bloque buscar** y **por qué lo cambias por otro**. Los bloques incluyen un par de líneas de contexto para que los localices sin ambigüedad; solo cambian las líneas distintas.

Los 3 fallos que ya tenía la app (marcados con 🐞) los comprobé sobre el código original: los dos primeros en un navegador real y el tercero ejecutando su función:

1. 🐞 **Gráfico «Carga semanal» del Dashboard vacío.** Cada barra usaba un porcentaje de altura dentro de un contenedor sin altura, así que medía 0.
2. 🐞 **El mapa no dibujaba la ruta.** La app nunca cargaba la hoja de estilos de Leaflet: las capas del mapa quedaban sin posicionar y la ruta aparecía fuera de la vista.
3. 🐞 **TSS negativo.** Una actividad sin frecuencia cardiaca (`avgHR = 0`) daba un TSS estimado negativo (−4 en un entreno de 49 min), que *restaba* carga al Fitness y la Fatiga.

#### `index.html`

**Cambio 1 de 1**: Título de la pestaña del navegador.

Busca este bloque:

```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Garmin Training Analyst</title>
  </head>
  <body>
```

y cámbialo por:

```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Suunto Training Analyst</title>
  </head>
  <body>
```

#### `src/components/Sidebar.tsx`

**Cambio 1 de 2**: Nombre de la app en la barra lateral.

Busca este bloque:

```tsx
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-700/50">
        <div className="text-blue-400 font-bold text-lg tracking-tight">Garmin Stats</div>
        <div className="text-slate-500 text-xs mt-0.5">
          {activities.length > 0 ? `${activities.length} actividades` : 'Sin datos aún'}
```

y cámbialo por:

```tsx
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-700/50">
        <div className="text-blue-400 font-bold text-lg tracking-tight">Suunto Stats</div>
        <div className="text-slate-500 text-xs mt-0.5">
          {activities.length > 0 ? `${activities.length} actividades` : 'Sin datos aún'}
```

**Cambio 2 de 2**: Comando de actualización que se muestra abajo (el original apuntaba a `cd fetch && python sync.py`).

Busca este bloque:

```tsx
          <div className="mt-3 text-xs text-slate-600 leading-relaxed">
            Para actualizar:<br />
            <code className="text-slate-500">cd fetch && python sync.py</code>
          </div>
        </div>
```

y cámbialo por:

```tsx
          <div className="mt-3 text-xs text-slate-600 leading-relaxed">
            Para actualizar:<br />
            <code className="text-slate-500">python3 fetch/sync.py</code>
          </div>
        </div>
```

#### `src/pages/Dashboard.tsx`

**Cambio 1 de 2**: Pantalla «sin datos»: ahora explica los pasos de Suunto.

Busca este bloque:

```tsx
    <div className="flex-1 p-8 max-w-2xl">
      <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl p-6">
        <h2 className="text-amber-300 font-medium text-lg mb-2">Sin datos de Garmin</h2>
        <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-300 space-y-1 mt-3">
          <div>cp .env.example .env</div>
          <div>cd fetch && pip install -r requirements.txt</div>
          <div>python3 sync.py --limit 20</div>
        </div>
      </div>
```

y cámbialo por:

```tsx
    <div className="flex-1 p-8 max-w-2xl">
      <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl p-6">
        <h2 className="text-amber-300 font-medium text-lg mb-2">Sin datos de Suunto</h2>
        <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-300 space-y-1 mt-3">
          <div>suuntool login --email TU_EMAIL</div>
          <div>pip install -r fetch/requirements.txt</div>
          <div>python3 fetch/sync.py --limit 20</div>
        </div>
      </div>
```

**Cambio 2 de 2**: 🐞 **Fallo 1.** La columna de cada barra pasa a tener altura (`h-full`) y las barras se apoyan abajo (`justify-end`); sin eso su `height: X%` medía 0.

Busca este bloque:

```tsx
              const isCurrentWeek = i === weeklyLoad.length - 1
              return (
                <div key={w.week} className="flex-1 flex flex-col items-center" title={`${w.week}: ${w.tss} TSS`}>
                  <div
                    className="w-full rounded-t transition-all"
```

y cámbialo por:

```tsx
              const isCurrentWeek = i === weeklyLoad.length - 1
              return (
                <div key={w.week} className="flex-1 h-full flex flex-col justify-end items-center" title={`${w.week}: ${w.tss} TSS`}>
                  <div
                    className="w-full rounded-t transition-all"
```

#### `src/pages/PerformanceAnalysis.tsx`

**Cambio 1 de 1**: Texto de ayuda del VO2max cuando todavía no hay datos.

Busca este bloque:

```tsx
        <Section
          title="Tendencia VO2max"
          sub={currentVo2 ? `Actual: ${currentVo2.toFixed(1)} ml/kg/min — ${vo2Label}` : 'Estimado por Garmin'}
        >
          {vo2Points.length > 1 ? (
```

y cámbialo por:

```tsx
        <Section
          title="Tendencia VO2max"
          sub={currentVo2 ? `Actual: ${currentVo2.toFixed(1)} ml/kg/min — ${vo2Label}` : 'Suunto solo lo calcula en carreras y caminatas'}
        >
          {vo2Points.length > 1 ? (
```

#### `src/pages/ActivityDetail.tsx`

**Cambio 1 de 3**: Título de la tabla: los parciales ya no son siempre de 1 km (son las vueltas de tu reloj).

Busca este bloque:

```tsx
        <section className="mb-6">
          <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-3">
            Splits ({detail.laps.length} km)
          </h2>
          <div className="overflow-x-auto">
```

y cámbialo por:

```tsx
        <section className="mb-6">
          <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-3">
            Parciales ({detail.laps.length})
          </h2>
          <div className="overflow-x-auto">
```

**Cambio 2 de 3**: Cabecera de la tabla: columna `#` y nueva columna `Dist.`.

Busca este bloque:

```tsx
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-4">Km</th>
                  <th className="pb-2 pr-4">Tiempo</th>
                  {act.sport === 'running' && <th className="pb-2 pr-4">Ritmo</th>}
```

y cámbialo por:

```tsx
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">Dist.</th>
                  <th className="pb-2 pr-4">Tiempo</th>
                  {act.sport === 'running' && <th className="pb-2 pr-4">Ritmo</th>}
```

**Cambio 3 de 3**: Celda con la distancia de cada parcial.

Busca este bloque:

```tsx
                  <tr key={lap.index} className="border-b border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 pr-4 text-slate-400">{lap.index}</td>
                    <td className="py-2 pr-4 font-mono text-slate-200">{formatDuration(lap.duration)}</td>
                    {act.sport === 'running' && (
```

y cámbialo por:

```tsx
                  <tr key={lap.index} className="border-b border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 pr-4 text-slate-400">{lap.index}</td>
                    <td className="py-2 pr-4 text-slate-200">{lap.distance.toFixed(2)} km</td>
                    <td className="py-2 pr-4 font-mono text-slate-200">{formatDuration(lap.duration)}</td>
                    {act.sport === 'running' && (
```

#### `src/utils/calculations.ts`

**Cambio 1 de 3** *(opcional)*: Solo cambia un comentario.

Busca este bloque:

```ts

/**
 * Estimates TSS for activities that don't have it from Garmin.
 * Uses TRIMP-derived method based on HR zones.
 */
```

y cámbialo por:

```ts

/**
 * Estimates TSS for activities that don't have it from Suunto.
 * Uses TRIMP-derived method based on HR zones.
 */
```

**Cambio 2 de 3**: 🐞 **Fallo 3.** Sin FC se asume una carga suave (~30 TSS por hora) y, con FC, la reserva se limita a 0-1 para que nunca salga negativa.

Busca este bloque:

```ts

  const durationHours = activity.movingTime / 3600
  const hrReserve = (activity.avgHR - 60) / (settings.maxHR - 60)

  // TRIMP exponential weighting
```

y cámbialo por:

```ts

  const durationHours = activity.movingTime / 3600
  // Sin frecuencia cardiaca (avgHR = 0) no se puede usar TRIMP: se asume una carga suave de ~30 TSS/hora.
  // Antes salía un TSS NEGATIVO que restaba carga al Fitness/Fatiga.
  if (!activity.avgHR) return Math.round(durationHours * 30)
  const hrReserve = Math.min(Math.max((activity.avgHR - 60) / (settings.maxHR - 60), 0), 1)

  // TRIMP exponential weighting
```

**Cambio 3 de 3** *(opcional)*: Solo cambia un comentario.

Busca este bloque:

```ts

/**
 * Returns seconds spent in each zone for an activity that lacks zone data from Garmin.
 */
export function estimateZonesFromHR(
```

y cámbialo por:

```ts

/**
 * Returns seconds spent in each zone for an activity that lacks zone data from Suunto.
 */
export function estimateZonesFromHR(
```

#### `src/index.css`

**Cambio 1 de 1**: 🐞 **Fallo 2.** Carga los estilos de Leaflet **antes** de los ajustes del proyecto (así se respeta el fondo oscuro del mapa).

Busca este bloque:

```css
@import "tailwindcss";

@theme {
```

y cámbialo por:

```css
@import "tailwindcss";
@import "leaflet/dist/leaflet.css";

@theme {
```

### 5.4 `.gitignore` y README

- **`README.md`:** reemplázalo por el del [Apéndice A](#apéndice-a-readmemd-adaptado).
- **`.gitignore`:** protege las carpetas que pueden contener tu ruta GPS (`fetch/debug/`, `fetch/fit/`, `*.fit`) e ignora el entorno virtual de Python y su bytecode.

#### `.gitignore`

**Cambio 1 de 3** *(opcional)*: Solo cambia un comentario.

Busca este bloque:

```text
*.local

# Credenciales de Garmin (NUNCA subir)
.env
.env.local
```

y cámbialo por:

```text
*.local

# Credenciales (NUNCA subir)
.env
.env.local
```

**Cambio 2 de 3** *(opcional)*: Solo cambia un comentario.

Busca este bloque:

```text
!.env.example

# Datos personales descargados de Garmin Connect
public/data/
public/data/**
```

y cámbialo por:

```text
!.env.example

# Datos personales descargados de Suunto
public/data/
public/data/**
```

**Cambio 3 de 3**: Ignora el entorno virtual de Python y las carpetas que pueden contener tu ruta GPS (sustituye al bloque `.garth/`).

Busca este bloque:

```text
dist/data/**

# Tokens de sesión de Garmin (por si se copian al proyecto)
.garth/

# Editor directories and files
```

y cámbialo por:

```text
dist/data/**

# Python: entorno virtual y bytecode
.venv/
__pycache__/

# Depuración y ficheros FIT exportados (contienen tus coordenadas GPS)
fetch/debug/
fetch/fit/
*.fit

# Editor directories and files
```

### 5.5 Primera sincronización

> En Windows usa `py` o `python` donde ponga `python3`.

Instala las dependencias de Python (desde la carpeta raíz del proyecto):

```bash
python3 -m pip install -r fetch/requirements.txt
```

> **Si `pip` dice «externally-managed-environment»** (pasa en Ubuntu/WSL y otras distribuciones recientes), crea un entorno virtual en la carpeta del proyecto y úsalo en todos los comandos de Python:
>
> ```bash
> sudo apt install python3-venv          # solo en Debian/Ubuntu, si falta
> python3 -m venv .venv
> source .venv/bin/activate              # Windows (PowerShell): .venv\Scripts\Activate.ps1
> python3 -m pip install -r fetch/requirements.txt
> ```
>
> Cada vez que abras una terminal nueva, ejecuta `source .venv/bin/activate` antes de `python3 fetch/sync.py`.

#### Ruta A — Nube de Suunto

**1. Instala `suuntool`.** Es una herramienta de línea de comandos de código abierto (MIT), no oficial, que hace el login contra el servicio de la app de Suunto. Este proyecto **no guarda tu contraseña**: solo lee la clave de sesión que crea `suuntool`.

| Sistema | Cómo |
| --- | --- |
| macOS | `brew install --cask tajchert/tap/suuntool` (o descarga el binario `darwin_arm64` / `darwin_amd64` de la [página de versiones](https://github.com/tajchert/suuntool/releases)) |
| Linux | Descarga el binario de la [página de versiones](https://github.com/tajchert/suuntool/releases) (ver abajo) o `go install github.com/tajchert/suuntool@latest` |
| Windows | **No hay binarios para Windows.** Lo más sencillo es usar WSL (Ubuntu) y ejecutar allí `suuntool` y también `python3 fetch/sync.py`. Alternativa: `go install` con Go instalado (no lo he podido probar) |

Linux (verificado con la v0.10.0; usa `arm64` en lugar de `amd64` en Raspberry Pi y similares):

```bash
curl -L -o suuntool.tar.gz https://github.com/tajchert/suuntool/releases/download/v0.10.0/suuntool_0.10.0_linux_amd64.tar.gz
tar -xzf suuntool.tar.gz suuntool
sudo mv suuntool /usr/local/bin/
suuntool version        # → suuntool 0.10.0
```

**2. Inicia sesión** (solo la primera vez, o cuando caduque):

```bash
suuntool login --email TU_EMAIL
suuntool doctor
```

Te pide tu contraseña de Suunto sin mostrarla en pantalla. Usa la cuenta de la **app Suunto** (las credenciales del antiguo Movescount no sirven, según el FAQ oficial). La clave de sesión queda en `~/.config/suuntool/session.json`. `suuntool doctor` comprueba la conexión y la sesión.

- `suuntool` solo admite email y contraseña. Si entras en la app con Facebook u otro acceso social, crea antes una contraseña de Suunto (en la app: Ajustes → Cuenta → Cambiar contraseña; te llega un enlace por email). **No está comprobado** que eso baste en cuentas creadas con acceso social; si no funciona, usa la Ruta B.
- **WSL:** si `suuntool` está en WSL pero ejecutas Python en Windows, o al revés, no verán el mismo `~/.config`. Ejecuta todo en el mismo sitio, o copia el valor de `sessionkey` de `session.json` a tu `.env` como `SUUNTO_SESSION_KEY=...`.

**3. Sincroniza una prueba pequeña y luego todo:**

```bash
python3 fetch/sync.py --limit 20     # las 20 más recientes
python3 fetch/sync.py                # todo el historial
```

Si Suunto envía tu FC máxima, al terminar te la dice (por ejemplo «Tu FC máxima según Suunto es 186 bpm»): apúntala para **Ajustes**.

La primera vez puede tardar varios minutos si tienes muchas actividades (hay una pausa entre peticiones).

Opciones útiles: `--since 2024-01-01` (desde una fecha), `--no-gpx` (mucho más rápido, sin ruta ni parciales), `--force` (volver a descargar lo guardado). Lo ya descargado no se vuelve a pedir.

#### Ruta B — Ficheros FIT

**1. Exporta tus entrenamientos** (pasos del [soporte oficial de Suunto](https://www.suunto.com/Support/faq-articles/suunto-app/how-do-i-download-a-.fit-file-from-suunto-app-for-ios)): en la app, **Calendario** → elige el entrenamiento → menú de tres puntos (arriba a la derecha) → **exportar como FIT** → envíatelo a tu ordenador. Se hace de uno en uno.

**2. Copia los `.fit` a `fetch/fit/`** (crea la carpeta si no existe).

**3. Sincroniza:**

```bash
python3 fetch/sync.py --source fit
```

Opcional: en `.env`, `MAX_HR=190` (tu FC máxima) para que las zonas de FC se calculen con ella. Los ficheros que no son actividades se saltan con un aviso.

**¿Muchos entrenamientos?** Si vives en la UE, el Reglamento de Datos te da derecho a pedir a Suunto tus datos gratis y en formatos como FIT, GPX o JSON (por la app, Sports Tracker o escribiendo a Suunto; mira su [aviso oficial](https://www.suunto.com/legal-pages/suunto-eu-data-act-notice/)). No he podido comprobar en la práctica qué entregan exactamente ni cuánto tardan; este proyecto lee ficheros `.fit`.

#### Abrir la app

```bash
npm install        # solo la primera vez
npm run dev        # abre http://localhost:5173
```

### 5.6 Comprobar que funciona

```bash
python3 fetch/validate_output.py       # debe terminar con «0 errores»
```

En el navegador deberías ver:

- [ ] La barra lateral dice **Suunto Stats** y el número de actividades.
- [ ] El Dashboard muestra Fitness, Fatiga y Forma, y el gráfico «Carga semanal» **con barras**.
- [ ] Al abrir una carrera o una salida en bici: **mapa con la ruta**, zonas de FC Z1-Z5 y la tabla de **Parciales**.
- [ ] Un entreno sin pulsómetro (por ejemplo, gimnasio) se abre sin errores y su TSS **no es negativo**.
- [ ] En **Ajustes** has puesto tu FC máxima.

Si algo sale vacío o raro, mira el [apartado 7](#7-problemas-frecuentes).

---

## 6. Qué datos tendrás: Garmin frente a Suunto

| Campo de la app | Versión Garmin | Con Suunto |
| --- | --- | --- |
| Distancia, duración, desnivel, FC media y máxima, calorías | Sí | Sí |
| Título | El de Garmin Connect | Generado: `Carrera · 30/09` |
| Hora de inicio | Hora local de Garmin | Hora local calculada: con la diferencia horaria del propio entrenamiento si viene (`timeOffsetInMinutes` en la nube, `local_timestamp` en FIT); si no, con la zona horaria de tu ordenador o `SUUNTO_TIMEZONE` |
| TSS | El de Garmin; si faltaba, estimado | El de Suunto (`tss.trainingStressScore`); si falta, estimado con la FC; sin FC, ~30 TSS por hora |
| VO2max | En casi todas las carreras | Solo carreras y caminatas (`FitnessExtension.vo2Max`): pocas mediciones |
| Training Effect aeróbico | El de Garmin | El *Peak Training Effect* de Suunto (`SummaryExtension.pte`) |
| Training Effect anaeróbico | Sí | No viene en los datos: vacío |
| Potencia media y normalizada | Si hay sensor | Si hay sensor y el dato llega (en la nube no está verificado; en FIT sí) |
| Cadencia | pasos/min o rpm | Carrera: pasos/min (Suunto da ciclos/min, se multiplica ×2); bici: rpm |
| SWOLF y brazadas | Sí | No vienen en los datos que he podido ver: vacío |
| Zonas de FC | Calculadas por Garmin | Tiempo real en cada zona según tu reloj (`timeInZone0..5`; la «zona 0» se suma a Z1). En FIT se calculan con tu FC máxima |
| Parciales | Vueltas del reloj | Vueltas del reloj; si no hay, automáticos: cada 1 km (5 km en bici) |
| Ruta GPS | GPX | Muestras GPS de Suunto, reducidas a 500 puntos |
| Deportes (running, cycling, swimming, other) | Por tipo de Garmin | Por ID de actividad de Suunto ([Apéndice C](#apéndice-c-ids-de-actividad-de-suunto-usados)) |

---

## 7. Problemas frecuentes

| Síntoma | Qué hacer |
| --- | --- |
| `ERROR: No hay sesión de Suunto` | Aún no has iniciado sesión: `suuntool login --email TU_EMAIL` |
| `Sesión de Suunto no válida o caducada` | Repite `suuntool login`. Si persiste, `suuntool doctor` y actualiza `suuntool` (puede que Suunto haya cambiado algo) |
| `ModuleNotFoundError: ... requests / dotenv / garmin_fit_sdk` | Falta instalar: `python3 -m pip install -r fetch/requirements.txt` (y, si usas entorno virtual, activarlo antes) |
| `error: externally-managed-environment` al instalar | Usa un entorno virtual (receta al principio de 5.5) |
| `ERROR: No se pudo leer ...: sin conexión con Suunto` | Revisa tu internet. Si usas WSL, comprueba que tiene red |
| Error HTTP 429 | Demasiadas peticiones: sube la pausa con `SUUNTO_PAUSE=1.5` en `.env` |
| Faltan actividades, o la **ruta / los parciales salen vacíos** | Mira «Cómo pedir ayuda» debajo |
| Las horas salen desplazadas | Pon `SUUNTO_TIMEZONE=Europe/Madrid` (tu zona) en `.env` |
| «Pocas mediciones aún» en VO2max | Es normal: Suunto solo lo calcula en carreras y caminatas |
| Los entrenos sin pulsómetro (gimnasio…) tienen un TSS bajo | Es la estimación de ~30 TSS por hora para entrenos sin FC. Ajusta el `30` en `src/utils/calculations.ts` si quieres |
| `AVISO: ... omitido: no contiene una actividad` (Ruta B) | Ese `.fit` no era un entrenamiento (ajustes, báscula…). Es normal |
| Parciales automáticos con un primer tramo muy lento (Ruta B) | En un FIT con una pausa larga, el tiempo parado cuenta en el parcial donde ocurrió |
| La web dice «Sin datos de Suunto» | Aún no has sincronizado (o `public/data/activities.json` no existe) |
| Cambié de Ruta A a B y han desaparecido actividades | Es lo esperado: la lista se rehace con la fuente que ejecutas. Vuelve a ejecutar la otra ruta para recuperarla |

### Cómo pedir ayuda sin regalar tus datos

Si algo no encaja con tu cuenta (faltan campos, no hay ruta…), ejecuta:

```bash
python3 fetch/sync.py --dump latest
```

Guarda en `fetch/debug/` lo que devuelve Suunto para tu último entrenamiento. **Comparte solo el fichero `*.redacted.json`**: conserva la estructura (nombres de campos y tipos) pero sustituye coordenadas, ruta codificada y nombre de usuario. Los demás ficheros de esa carpeta contienen tu ruta GPS completa.

Con ese fichero se puede ver qué campo ha cambiado Suunto y ajustar `fetch/normalizer.py`.

---

## 8. Riesgos y privacidad

**La Ruta A no es oficial**

- Suunto no publica ese servicio: puede cambiar o desaparecer sin avisar y la Ruta A dejaría de funcionar.
- Su uso podría ir contra los términos de Suunto. Los autores de `suuntool` advierten de que un uso abusivo podría llevar a que se bloquee la cuenta. Este código solo **lee tus propios datos**, hace una pausa entre peticiones (`SUUNTO_PAUSE`, 0,6 s por defecto) y no vuelve a pedir lo ya descargado.
- La versión Garmin ya dependía de una librería no oficial (`garminconnect`), así que el nivel de riesgo es comparable. Si prefieres no asumirlo, usa la Ruta B.

**Credenciales**

- Tu contraseña solo se la das a `suuntool`; este proyecto no la guarda (antes estaba en `.env`).
- `~/.config/suuntool/session.json` equivale a una contraseña: no lo subas a ningún sitio. `suuntool logout` lo invalida.
- `suuntool` es software de terceros que recibe tu contraseña. Declara no tener telemetría y es de código abierto; lee su README o revisa el código antes de usarlo.

**Tus datos**

- `public/data/` contiene tus rutas GPS. Vite sirve `public/` tal cual: **no publiques esa carpeta** (GitHub Pages, Netlify…). Ya está en `.gitignore`.
- `fetch/debug/` y `fetch/fit/` también contienen rutas GPS y quedan ignoradas por git con el cambio de 5.4.

---

## 9. Cómo se verificó esta guía (y qué no)

Probado en octubre de 2026 con: Python 3.12, Node 22, Vite 8, `garmin-fit-sdk` 21.217.0 y `suuntool` 0.10.0.

| Qué | Cómo | Resultado |
| --- | --- | --- |
| Estructura y unidades de los datos de Suunto | Leyendo el código de [`suuntool`](https://github.com/tajchert/suuntool) y de [`ha-suunto`](https://github.com/MichalZaniewicz/ha-suunto) (integración de Home Assistant; su autor documenta haberlo contrastado con una cuenta real), el FAQ oficial de la API de Suunto y su [PDF oficial de IDs de actividad](https://aspartnercontent.blob.core.windows.net/apizone/docs/Activities.pdf) | Campos, unidades y mapa de deportes confirmados por fuentes independientes. La URL base coincide con la que muestra `suuntool doctor` |
| Normalizador | 44 pruebas unitarias, incluidos datos «sucios» (HR en Hz, campos nulos, NaN, coordenadas inválidas, vueltas desordenadas…) | Todas correctas |
| Ruta A completa | Servidor simulado con 131 entrenamientos en 2 páginas: caché, `--limit`, `--since`, `--no-gpx`, `--force`, errores de sesión y de red, ids únicos y estables, volcado redactado | Todo correcto; la 2.ª sincronización no repite ninguna petición de detalle |
| Ruta B | 44 ficheros FIT reales (Garmin, COROS, Wahoo, multideporte, corruptos y ficheros que no son actividades) | 24 actividades válidas, 20 saltadas con aviso, 0 errores de formato |
| Guía aplicada desde cero | Copia limpia del proyecto original + solo lo que dice esta guía | Idéntica a la versión probada; compila, pasa el linter y sincroniza por las dos rutas con un entorno Python vacío |
| Web | `tsc` estricto + `vite build`, linter (0 avisos) y un navegador real (Chromium) recorriendo las 10 pantallas con datos simulados | Sin errores de JavaScript; solo fallaron las teselas del mapa base, que mi red bloquea |

**Lo que NO he podido verificar**

- **Los servidores reales de Suunto.** No tengo cuenta de Suunto y mi entorno no puede conectar con su servicio. Lo que sé de él viene de código y documentación de terceros; por eso existen `--dump` y los avisos del apartado 7.
- Que el servidor real envíe `timeOffsetInMinutes`, `avgPower` o `tss.normalizedPower`. El código los usa si están y, si no, hace otra cosa razonable.
- Ficheros FIT **de Suunto**: no tengo ninguno; probé con otras marcas.
- Windows y macOS (probado en Linux), `suuntool` en Windows y cuentas creadas con acceso social.

---

## 10. Mejoras opcionales

1. **Zonas de FC exactas en la página «Zonas».** Hoy esa página estima las zonas con la FC media (lo dice su pie: «Zonas estimadas…»), aunque cada `activity_<id>.json` ya trae el tiempo real por zona (`hrZones`). Se podría guardar ese reparto en el resumen y usarlo en `src/hooks/useZoneDistribution.ts`.
2. **FC máxima automática.** `stats.json` ya incluye `userMaxHR` (la de tu reloj); la página de Ajustes podría proponerla.
3. **Ritmo por 100 m en natación.** La interfaz muestra «/km» también en natación.
4. **Renombrados cosméticos** (no aportan nada funcional): `src/types/garmin.ts` → `activity.ts` (hazlo con «Renombrar» de VS Code para que actualice los imports), el nombre en `package.json` y las variables `--color-garmin-*` de `src/index.css`. **No cambies** la clave `garmin-settings` de `src/stores/activityStore.ts`: perderías los ajustes guardados en tu navegador.

---

## Apéndice A. `README.md` adaptado

<details>
<summary><b><code>README.md</code></b> · 341 líneas · clic para desplegar</summary>

````markdown
# Suunto Stats

Panel personal para ver tus estadísticas de entrenamiento de Suunto: actividades, mapas, zonas de FC, fitness (CTL/ATL/TSB), récords y más.

Los datos se descargan de tu cuenta de Suunto (o de ficheros FIT que exportes tú) a archivos locales en tu ordenador. La app los lee desde ahí; no hay servidor en la nube ni base de datos.

---

## Dos formas de traer tus datos

| | **Ruta A — Automática** | **Ruta B — Ficheros FIT** |
| --- | --- | --- |
| Cómo funciona | Lee tu cuenta de Suunto (la misma de la app del móvil) | Exportas tus entrenamientos como `.fit` desde la app y los copias a una carpeta |
| Comodidad | Un solo comando, descarga todo el historial | Hay que exportar los entrenamientos de uno en uno |
| Riesgo | **No es oficial**: Suunto no ofrece API para uso personal. Puede dejar de funcionar sin aviso y podría ir contra sus términos de uso | Ninguno: son tus propios ficheros |
| Necesitas | La herramienta `suuntool` (solo para iniciar sesión) | Nada más |

Elige una. Si cambias de una a otra, la lista de actividades se rehace con la fuente nueva (no se mezclan). El resto de la app es idéntico.

---

## Qué necesitas antes de empezar

| Programa | Para qué sirve | Cómo comprobarlo |
| --- | --- | --- |
| **Node.js** (v18 o superior) | Ejecutar la app web | `node --version` |
| **Python** (v3.10 o superior) | Descargar datos de Suunto | `python3 --version` |
| **suuntool** (solo Ruta A) | Iniciar sesión en Suunto una vez | `suuntool version` |

> **¿No tienes Node.js o Python?**
>
> - Node.js: [https://nodejs.org](https://nodejs.org) → descarga la versión LTS.
> - Python: [https://python.org/downloads](https://python.org/downloads) → en Mac/Linux suele venir instalado.

> **Instalar suuntool (Ruta A)** — [github.com/tajchert/suuntool](https://github.com/tajchert/suuntool)
>
> - Mac / Linux con Homebrew: `brew install --cask tajchert/tap/suuntool`
> - Con Go instalado: `go install github.com/tajchert/suuntool@latest`
> - Windows: no tiene binarios oficiales. Lo más sencillo es usar WSL (Ubuntu) y ejecutar allí tanto `suuntool` como `python3 fetch/sync.py`.

---

## Guía paso a paso

### 1. Descargar el proyecto

Abre la carpeta del proyecto en la terminal:

```bash
cd ruta/donde/está/suunto-stats
```

---

### 2. Instalar dependencias de Python

Desde la carpeta raíz del proyecto:

```bash
python3 -m pip install -r fetch/requirements.txt
```

> **Si `pip` dice «externally-managed-environment»** (pasa en Ubuntu/WSL y otras distribuciones recientes), crea un entorno virtual en la carpeta del proyecto y úsalo en todos los comandos de Python:
>
> ```bash
> sudo apt install python3-venv          # solo en Debian/Ubuntu, si falta
> python3 -m venv .venv
> source .venv/bin/activate              # Windows (PowerShell): .venv\Scripts\Activate.ps1
> python3 -m pip install -r fetch/requirements.txt
> ```
>
> Cada vez que abras una terminal nueva, ejecuta `source .venv/bin/activate` antes de `python3 fetch/sync.py`.

---

### 3A. Ruta A — Iniciar sesión en Suunto (solo la primera vez)

```bash
suuntool login --email tu@email.com
```

Te pedirá tu contraseña de Suunto (la de la app del móvil). **No se guarda ninguna contraseña en este proyecto**: `suuntool` guarda solo una clave de sesión en `~/.config/suuntool/session.json`.

Comprueba que todo va bien:

```bash
suuntool doctor
```

> `suuntool` solo admite email + contraseña. Si entras en la app de Suunto con Facebook u otro acceso social, crea primero una contraseña de Suunto (en la app: Ajustes → Cuenta → Cambiar contraseña; te llega un enlace por email). No está comprobado que eso baste en cuentas creadas con acceso social; si no funciona, usa la Ruta B.

Después descarga tus actividades, desde la carpeta raíz del proyecto:

```bash
python3 fetch/sync.py --limit 20
```

**Qué hace este comando:**

- Lee la lista de tus entrenamientos de Suunto
- Descarga el detalle de cada uno (zonas de FC, parciales, ruta GPS)
- Guarda todo en `public/data/` (archivos JSON)

La primera vez puede tardar **varios minutos** si tienes muchas actividades. Verás el progreso en la terminal.

**Opciones útiles:**

```bash
# Todo el historial
python3 fetch/sync.py

# Solo actividades desde una fecha
python3 fetch/sync.py --since 2024-01-01

# Más rápido, sin ruta GPS ni parciales
python3 fetch/sync.py --no-gpx

# Volver a descargar lo ya guardado
python3 fetch/sync.py --force
```

> **Importante:** vuelve a ejecutar `python3 fetch/sync.py` cuando quieras actualizar los datos con entrenamientos nuevos. Las actividades ya descargadas no se vuelven a pedir a Suunto.

---

### 3B. Ruta B — Usar ficheros FIT

1. En la app de Suunto (móvil): Calendario → elige el entrenamiento → menú de tres puntos (arriba a la derecha) → **exportar como FIT**. Envíatelo a tu ordenador.
2. Copia los `.fit` a la carpeta `fetch/fit/` (créala si no existe).
3. Desde la carpeta raíz del proyecto:

```bash
python3 fetch/sync.py --source fit
```

Opcional: en `.env` puedes poner `MAX_HR=190` (tu FC máxima) para que las zonas de FC se calculen con ella.

> **¿Muchos entrenamientos?** Exportarlos de uno en uno es lento. Si vives en la UE, el Reglamento de Datos te da derecho a pedir a Suunto tus datos gratis y en formatos como FIT, GPX o JSON (por la app, Sports Tracker o escribiendo a Suunto; ver su [aviso oficial](https://www.suunto.com/legal-pages/suunto-eu-data-act-notice/)). Este proyecto lee ficheros `.fit`.

---

### 4. Comprobar que los datos son correctos (opcional)

```bash
python3 fetch/validate_output.py
```

Debe terminar con `0 errores`.

---

### 5. Instalar dependencias de la app web

En la carpeta raíz del proyecto:

```bash
npm install
```

Solo hace falta hacerlo **una vez** (o cuando cambien las dependencias del proyecto).

---

### 6. Abrir la app

```bash
npm run dev
```

Verás algo como:

```
  ➜  Local:   http://localhost:5173/
```

Abre ese enlace en el navegador (Chrome, Firefox, Safari…).

Para **cerrar** la app, vuelve a la terminal y pulsa `Ctrl + C`.

---

## Resumen rápido (cuando ya lo hayas hecho una vez)

```bash
# 1. Sincronizar datos nuevos de Suunto
python3 fetch/sync.py

# 2. Arrancar la app
npm run dev
```

Luego abre [http://localhost:5173](http://localhost:5173) en el navegador.

---

## Ajustes dentro de la app

En el menú lateral, entra en **Ajustes** para configurar:

- FC máxima (al terminar la sincronización se te indica la que tienes en tu reloj Suunto)
- FTP (ciclismo)
- FC y ritmo en umbral (running)

Estos valores se guardan en tu navegador y afectan a los cálculos de zonas, TSS y fitness.

---

## Qué datos de Suunto verás

| Dato | Detalle |
| --- | --- |
| Distancia, duración, desnivel, FC, calorías | Siempre |
| TSS | El que calcula Suunto; si falta, la app lo estima con la FC |
| VO2max | Suunto solo lo calcula en carreras y caminatas, así que habrá pocas mediciones |
| Training Effect | Se muestra el aeróbico (PTE de Suunto, escala 1-5). El anaeróbico no viene en los datos de Suunto |
| Zonas de FC | Las de tu reloj (tiempo real en cada zona) |
| Parciales | Las vueltas de tu reloj; si no hay, se calculan automáticos (cada 1 km, o 5 km en bici) |
| SWOLF / brazadas | No vienen en los datos |

---

## Problemas frecuentes

### "ERROR: No hay sesión de Suunto"

Aún no has iniciado sesión. Ejecuta `suuntool login --email tu@email.com` y repite la sincronización.

### "Sesión de Suunto no válida o caducada"

La clave de sesión ya no vale. Repite `suuntool login --email tu@email.com`.

### Pide el login y la contraseña es correcta

Prueba `suuntool doctor`. Si el login falla pero la contraseña es correcta, es posible que Suunto haya cambiado algo en su app y haga falta actualizar `suuntool` (`brew upgrade --cask suuntool` o `go install github.com/tajchert/suuntool@latest`).

### Faltan actividades, o la ruta / los parciales salen vacíos

Ejecuta `python3 fetch/sync.py --dump latest`. Guarda en `fetch/debug/` lo que devuelve Suunto para tu último entrenamiento; con eso se puede ver qué campo ha cambiado. Para pedir ayuda comparte **solo** el fichero `*.redacted.json` (sin coordenadas ni usuario): los demás ficheros de esa carpeta contienen tu ruta GPS.

### Las horas salen desplazadas

Pon tu zona horaria en `.env`: `SUUNTO_TIMEZONE=Europe/Madrid`.

### "No hay ficheros .fit"

Copia tus `.fit` en `fetch/fit/` (Ruta B) o ejecuta la sincronización sin `--source fit` (Ruta A).

### "No se encontró /data/activities.json" en la app

Aún no has sincronizado datos. Ejecuta primero:

```bash
python3 fetch/sync.py
```

### La terminal dice que `node` o `npm` no existen

Instala Node.js desde [nodejs.org](https://nodejs.org) y vuelve a abrir la terminal.

### La sincronización va muy lenta

Es normal: hay una pausa entre peticiones para no saturar el servidor de Suunto. Para una prueba rápida usa `--limit 20` o `--no-gpx`. Si ves errores 429, sube la pausa con `SUUNTO_PAUSE=1.5` en `.env`.

### Puerto 5173 ya en uso

Cierra otras ventanas de terminal donde tengas `npm run dev` corriendo, o Vite te propondrá otro puerto (por ejemplo 5174).

---

## Comandos extra (opcional)

| Comando | Descripción |
| --- | --- |
| `npm run build` | Genera una versión optimizada en la carpeta `dist/` |
| `npm run preview` | Previsualiza la versión de producción (después de `build`) |
| `npm run lint` | Revisa el código con el linter |
| `python3 fetch/validate_output.py` | Comprueba que los datos descargados tienen el formato correcto |

---

## Estructura del proyecto (referencia)

```
suunto-stats/
├── .env                      ← Opciones personales (opcional, no compartir)
├── fetch/
│   ├── sync.py               ← Script que descarga los datos
│   ├── suunto_client.py      ← Ruta A: lectura de tu cuenta de Suunto
│   ├── fit_source.py         ← Ruta B: lectura de ficheros FIT
│   ├── normalizer.py         ← Convierte los datos al formato de la app
│   ├── validate_output.py    ← Comprueba el formato de los datos
│   ├── requirements.txt      ← Dependencias de Python
│   └── fit/                  ← (Ruta B) tus ficheros .fit
├── public/data/              ← Datos descargados (JSON)
└── src/                      ← Código de la app web (React)
```

---

## Privacidad y qué NO subir a GitHub

Estos archivos contienen datos personales o credenciales. El `.gitignore` ya los excluye, pero conviene conocerlos:

| Archivo / carpeta | Qué contiene | Riesgo |
| --- | --- | --- |
| `.env` | Opciones personales (y la clave de sesión si la pusiste ahí) | Acceso a tu cuenta |
| `~/.config/suuntool/session.json` (en tu home) | Clave de sesión de Suunto | Acceso a tu cuenta sin contraseña |
| `public/data/` | Actividades, estadísticas y rutas GPS | Ubicación exacta, salud, hábitos |
| `dist/data/` | Copia de los datos al hacer `npm run build` | Igual que arriba |
| `fetch/debug/` y `fetch/fit/` | Respuestas crudas y ficheros FIT | Rutas GPS completas |

**Datos sensibles dentro de los JSON:**

- Coordenadas GPS de cada entrenamiento (pueden revelar dónde vives o entrenas)
- FC, VO2max, calorías, ritmos y patrones horarios

**Seguro para publicar:**

- `.env.example` (solo tiene placeholders)
- Todo el código en `src/` y `fetch/` (salvo las carpetas `fetch/debug/` y `fetch/fit/`)

**Antes de hacer `git push`**, comprueba que no se cuelen datos:

```bash
git status
```

No deberían aparecer `.env` ni archivos dentro de `public/data/`. Si alguna vez los añadiste por error:

```bash
git rm -r --cached public/data/
git rm --cached .env
```

Luego haz commit de la eliminación. Si ya los subiste a GitHub, **cierra la sesión de Suunto** (`suuntool logout`), cambia tu contraseña de Suunto y considera borrar el historial del repositorio.

---

## Aviso

Este proyecto no está afiliado a Suunto. La Ruta A usa un servicio que Suunto no ha publicado como API: puede cambiar o dejar de funcionar en cualquier momento, y su uso podría no cumplir los términos de Suunto. Úsala solo con tu propia cuenta y con moderación. Si prefieres evitar ese riesgo, usa la Ruta B.
````

</details>

---

## Apéndice B. Contrato de datos

La web lee tres tipos de fichero, todos en `public/data/`:

| Fichero | Contenido |
| --- | --- |
| `activities.json` | Lista de `ActivitySummary` |
| `activity_<id>.json` | Un `ActivityDetail` (resumen + `laps`, `hrZones`, `gpxCoords`) |
| `stats.json` | `GlobalStats` |

Reglas que cumplen los datos generados (y que comprueba `validate_output.py`):

- `id` es un **entero**. Suunto identifica los entrenamientos con una clave de texto, así que se usa la hora de inicio en segundos (con +1 si dos coincidieran).
- `startTime` es hora **local** en ISO, sin zona: `2026-09-30T07:45:00`.
- `avgHR`, `maxHR` y `calories` son números (0 si no hay dato); el resto de campos opcionales valen `null`, **nunca se omite la clave**.

Tipos de `src/types/garmin.ts` (solo la parte de datos):

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

export interface ActivityDetail extends ActivitySummary {
  laps: Lap[]
  hrZones: HRZone[]
  gpxCoords: [number, number][]  // [lat, lon] pairs
  avgStrideLength?: number | null
  trainingEffect?: number | null
}

export interface GlobalStats {
  totalActivities: number
  byType: Record<string, number>
  vo2maxHistory: { date: string; value: number }[]
  syncedAt: string
}
```

---

## Apéndice C. IDs de actividad de Suunto usados

Cada entrenamiento de Suunto trae un `activityId` numérico. Así se reparten en las 4 categorías de la app (fuente: el [PDF oficial de Suunto](https://aspartnercontent.blob.core.windows.net/apizone/docs/Activities.pdf)):

| Categoría | IDs | Deportes |
| --- | --- | --- |
| `running` | 1, 22, 53, 103, 115 | Running, trail, cinta, pista, carrera vertical |
| `cycling` | 2, 10, 52, 99, 114 | Ciclismo, MTB, ciclismo indoor, gravel, ciclocross |
| `swimming` | 21, 85 | Natación en piscina, aguas abiertas |
| `other` | El resto | Por ejemplo: 0 caminata, 11 senderismo, 23 gimnasio, 105 y 106 e-bike |

Para cambiar el reparto (por ejemplo, contar la bici eléctrica como ciclismo o la orientación como carrera) edita `RUNNING_IDS`, `CYCLING_IDS` y `SWIMMING_IDS` al principio de `fetch/normalizer.py`.
