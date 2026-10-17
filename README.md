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
> - Windows: no tiene binarios oficiales. Instala [Go](https://go.dev/dl/) (instalador para Windows), abre una PowerShell **nueva** y ejecuta `go install github.com/tajchert/suuntool@latest`. Queda en `%USERPROFILE%\go\bin\suuntool.exe`; añade esa carpeta al PATH o ejecútalo con la ruta completa. Alternativa: WSL (Ubuntu). Usa PowerShell o Windows Terminal (en Git Bash el login puede fallar con «stdin is not a TTY»).
>
> **En Windows**, donde pone `python3` usa `py`. Si PowerShell dice que la ejecución de scripts está deshabilitada (le pasa a `npm` y al entorno virtual), ejecuta una vez: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

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

# 1b. (Opcional) Plan de tu entrenador en TrainingPeaks — ver GUIA_TRAININGPEAKS.md
python3 fetch/tp_sync.py

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
