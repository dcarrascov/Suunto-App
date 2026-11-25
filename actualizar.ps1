<#
  Actualiza todos los datos de la app de una vez:
    1. Suunto        (py fetch\sync.py)
    2. TrainingPeaks (py fetch\tp_sync.py), solo si TP_AUTH_COOKIE está en .env
    3. Validación    (py fetch\validate_output.py)

  Uso, desde la carpeta del proyecto:
    .\actualizar.ps1              # lo normal (incremental)
    .\actualizar.ps1 -Completo    # vuelve a descargar todo de Suunto (--force) y todo el plan (--full)
    .\actualizar.ps1 -SinPlan     # solo Suunto
    .\actualizar.ps1 -SoloFit     # sin cuenta de Suunto: solo los .fit de fetch\fit (Ruta B)

  Si Windows no deja ejecutarlo («la ejecución de scripts está deshabilitada»):
    powershell -ExecutionPolicy Bypass -File .\actualizar.ps1
#>
param(
  [switch]$Completo,
  [switch]$SinPlan,
  [switch]$SoloFit
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

function Paso($texto) { Write-Host ''; Write-Host "== $texto ==" -ForegroundColor Green }

$inicio = Get-Date

# Una sola actualización a la vez (p. ej. una lanzada a mano y el botón de recargar).
# Si el candado es de una actualización que se cortó, se quita.
New-Item -ItemType Directory -Force -Path 'public\data' | Out-Null
$candado = 'public\data\.actualizando.pid'
if (Test-Path $candado) {
  $otro = (Get-Content $candado -ErrorAction SilentlyContinue | Select-Object -First 1) -as [int]
  if ($otro -and (Get-Process -Id $otro -ErrorAction SilentlyContinue)) {
    Write-Host 'Ya hay otra actualización en marcha; no lanzo otra.' -ForegroundColor Yellow
    exit 3
  }
}
Set-Content -Path $candado -Value $PID
try {

  $argsSync = @('fetch\sync.py')
  if ($SoloFit) { Paso 'Suunto (ficheros FIT)'; $argsSync += @('--source', 'fit') } else { Paso 'Suunto' }
  if ($Completo) { $argsSync += '--force' }
  & py @argsSync
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'La sincronización de Suunto ha fallado; no sigo.' -ForegroundColor Red
    exit $LASTEXITCODE
  }

  # Comprueba que existe la línea con la cookie, sin leer ni mostrar su valor
  $hayCookie = (Test-Path '.env') -and (Select-String -Path '.env' -Pattern '^\s*TP_AUTH_COOKIE=\S' -Quiet)
  $planFallido = $false
  if ($SinPlan) {
    Paso 'TrainingPeaks (omitido con -SinPlan)'
  } elseif (-not $hayCookie) {
    Paso 'TrainingPeaks (omitido: no hay TP_AUTH_COOKIE en .env; ver GUIA_TRAININGPEAKS.md)'
  } else {
    Paso 'TrainingPeaks'
    $argsTp = @('fetch\tp_sync.py')
    if ($Completo) { $argsTp += '--full' }
    & py @argsTp
    if ($LASTEXITCODE -ne 0) {
      # Lo normal es que haya caducado la cookie: los datos de Suunto ya están guardados, así que se sigue
      $planFallido = $true
      Write-Host 'TrainingPeaks ha fallado (¿cookie caducada?). Sigo con lo demás.' -ForegroundColor Yellow
    }
  }

  Paso 'Validación'
  & py fetch\validate_output.py
  $validacion = $LASTEXITCODE

  $segundos = [int]((Get-Date) - $inicio).TotalSeconds
  Write-Host ''
  if ($validacion -ne 0) {
    Write-Host "Terminado en $segundos s, pero la validación encontró errores (míralos arriba)." -ForegroundColor Red
    exit $validacion
  }
  if ($planFallido) {
    Write-Host "Terminado en $segundos s. Suunto actualizado; el plan de TrainingPeaks no." -ForegroundColor Yellow
    exit 0
  }
  Write-Host "Todo actualizado en $segundos s. Recarga la app en el navegador." -ForegroundColor Green
} finally {
  Remove-Item $candado -ErrorAction SilentlyContinue   # el candado se quita siempre, también si algo falla
}
