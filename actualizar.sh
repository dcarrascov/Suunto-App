#!/usr/bin/env bash
# Actualiza todos los datos de la app de una vez (Mac / Linux; en Windows: actualizar.ps1):
#   1. Suunto        (fetch/sync.py)
#   2. TrainingPeaks (fetch/tp_sync.py), solo si TP_AUTH_COOKIE está en .env
#   3. Validación    (fetch/validate_output.py)
#
# Uso, desde la carpeta del proyecto:
#   ./actualizar.sh              # lo normal (incremental)
#   ./actualizar.sh --completo   # vuelve a descargar todo de Suunto (--force) y todo el plan (--full)
#   ./actualizar.sh --sin-plan   # solo Suunto
# Si usas un entorno virtual, actívalo antes (source .venv/bin/activate).
# Las líneas «== … ==» las lee el botón de recargar de la app (server/sync.ts): no cambiarlas.

cd "$(dirname "$0")" || exit 1
export PYTHONIOENCODING=utf-8

COMPLETO=0
SIN_PLAN=0
for arg in "$@"; do
  case "$arg" in
    --completo) COMPLETO=1 ;;
    --sin-plan) SIN_PLAN=1 ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

# Python: el de $PYTHON si se indica; si no, python3 o python
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  if command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi
fi

paso() { echo ""; echo "== $1 =="; }
inicio=$(date +%s)

paso 'Suunto'
if [ "$COMPLETO" = 1 ]; then "$PY" fetch/sync.py --force; else "$PY" fetch/sync.py; fi || {
  code=$?
  echo 'La sincronización de Suunto ha fallado; no sigo.'
  exit "$code"
}

# Comprueba que existe la línea con la cookie, sin leer ni mostrar su valor
plan_fallido=0
if [ "$SIN_PLAN" = 1 ]; then
  paso 'TrainingPeaks (omitido con --sin-plan)'
elif ! { [ -f .env ] && grep -Eq '^[[:space:]]*TP_AUTH_COOKIE=[^[:space:]]' .env; }; then
  paso 'TrainingPeaks (omitido: no hay TP_AUTH_COOKIE en .env; ver GUIA_TRAININGPEAKS.md)'
else
  paso 'TrainingPeaks'
  if [ "$COMPLETO" = 1 ]; then "$PY" fetch/tp_sync.py --full; else "$PY" fetch/tp_sync.py; fi || {
    # Lo normal es que haya caducado la cookie: los datos de Suunto ya están guardados, así que se sigue
    plan_fallido=1
    echo 'TrainingPeaks ha fallado (¿cookie caducada?). Sigo con lo demás.'
  }
fi

paso 'Validación'
"$PY" fetch/validate_output.py
validacion=$?

segundos=$(( $(date +%s) - inicio ))
echo ""
if [ "$validacion" -ne 0 ]; then
  echo "Terminado en $segundos s, pero la validación encontró errores (míralos arriba)."
  exit "$validacion"
fi
if [ "$plan_fallido" = 1 ]; then
  echo "Terminado en $segundos s. Suunto actualizado; el plan de TrainingPeaks no."
  exit 0
fi
echo "Todo actualizado en $segundos s. Recarga la app en el navegador."
