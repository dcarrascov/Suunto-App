# TrainingPeaks: ver el plan de tu entrenador

La página **Plan** de la app muestra los entrenos que te envía tu entrenador en TrainingPeaks:
lo que te toca esta semana, el historial de semanas anteriores y cuánto cumpliste de cada sesión
(emparejada con tu actividad de Suunto del mismo día). El Dashboard enseña además **Hoy toca**.

> **Aviso.** TrainingPeaks no da su API oficial para uso personal, así que se usa la misma API
> interna que usa su web, con tu sesión. Solo se **leen** datos (nunca se cambia nada), pero puede
> dejar de funcionar si TrainingPeaks cambia algo, y su uso puede ir contra sus condiciones.
> Úsalo solo con tu propia cuenta. Funciona con cuenta básica (gratuita).

## 1. Copiar la cookie de sesión (la primera vez y cuando caduque)

La cookie `Production_tpAuth` **equivale a tu contraseña**: no la compartas ni la pegues en ningún
otro sitio que no sea tu fichero `.env` (que no se sube a git).

1. Abre **https://app.trainingpeaks.com** en Chrome o Edge e inicia sesión.
2. Pulsa **F12** para abrir las herramientas de desarrollo.
3. Ve a la pestaña **Application** (en Edge, **Aplicación**). Si no la ves, búscala en `»`.
4. En el menú de la izquierda: **Storage → Cookies → https://app.trainingpeaks.com**.
5. Busca la fila **`Production_tpAuth`** y copia el contenido de la columna **Value** (doble clic → `Ctrl + C`).
6. Abre el fichero `.env` de la carpeta del proyecto (si no existe, copia `.env.example` como `.env`)
   y añade una línea:

   ```
   TP_AUTH_COOKIE=pega_aquí_el_valor
   ```

## 2. Descargar los entrenos

La primera vez, todo el historial (desde tu primera actividad de Suunto):

```powershell
py fetch\tp_sync.py --full
```

Después, cada vez que quieras actualizar (vuelve a pedir de 3 semanas atrás a 6 adelante, que es
lo que tu entrenador puede haber cambiado):

```powershell
py fetch\tp_sync.py
```

Los datos se guardan en `public/data/plan.json` (está en `.gitignore`). Recarga la app y abre **Plan**.

## Si algo falla

| Mensaje | Qué hacer |
| --- | --- |
| `Falta TP_AUTH_COOKIE` | Sigue el paso 1. |
| `La cookie ... ha caducado` | La sesión dura unas semanas: repite el paso 1 con una cookie nueva. |
| `No encuentro tu id de atleta` | Añade `TP_ATHLETE_ID=tu_numero` al `.env`. Para verlo: en app.trainingpeaks.com abre el Calendario, pulsa F12 → pestaña **Network**, recarga (F5) y filtra por `athletes`; el número tras `/athletes/` en `tpapi.trainingpeaks.com/fitness/v6/athletes/1234567/...` es tu id. |
| Las duraciones o distancias salen raras | Ejecuta `py fetch\tp_sync.py --dump` y revisa `fetch/debug/tp_workouts.json` (contiene tus datos: no lo compartas). |

## Qué se ve en la app

- **Esta semana:** cada día con su entreno: título, duración, distancia, ritmo y TSS planificados,
  la descripción y los comentarios del entrenador, y si ya lo hiciste (con enlace a la actividad).
- **Estados:** ✓ Hecho (con % de lo planificado), ✗ No hecho (día pasado sin actividad), Hoy, Próximo, Descanso.
- **Historial:** semanas anteriores con sesiones hechas, % de cumplimiento, tiempo y distancia
  frente a lo planificado. Pulsa una semana para ver sus entrenos.
