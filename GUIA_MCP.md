# Habla con Claude de tus entrenamientos (MCP)

**Español** · [English](GUIDE_MCP.md)

El **MCP** de Suunto Stats conecta **Claude Desktop** o **Claude Code** con tu app, para que puedas preguntarle por tus
entrenamientos en una conversación normal, con tu suscripción de Claude y **sin clave de API**. Claude consulta solo
los datos que necesita: actividades, forma, récords, plan del entrenador y competiciones.

```
Claude Desktop ──► MCP (en tu ordenador) ──► tu app (en tu ordenador o en tu servidor)
```

Casi todo es **de lectura**. Lo único que escribe es guardar o borrar en la app las semanas que te proponga Claude, y
solo cuando se lo pidas: aparecen en Entrenador IA y Plan como «Propuesta IA», desde donde las pasas al calendario si
te gustan.

## Qué puedes preguntarle

- «¿Cómo voy de forma para la próxima carrera?»
- «Analiza mi entreno de ayer.»
- «¿Cumplí el plan esta semana?»
- «¿Qué tiempo haría en un 10k ahora mismo?»
- «Propónme la semana que viene como lo haría mi entrenador.»

También trae cuatro **avisos ya preparados** (`revisar_semana`, `planificar_semana`, `analizar_actividad` y
`preparar_competicion`), que en Claude Desktop aparecen como atajos.

## Lo que necesitas

- La app funcionando, en tu ordenador (`npm run dev`) o en tu servidor ([GUIA_DESPLIEGUE.md](GUIA_DESPLIEGUE.md)).
- **Node.js 20** o posterior, el mismo que usa la app.
- **Claude Desktop** o **Claude Code**.

## 1. Crea el token

Es la contraseña que usa el MCP para pedir los datos a la app: una cadena aleatoria de 32 caracteres o más. En
PowerShell:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

O en Mac/Linux: `openssl rand -hex 32`. Guárdalo bien y no lo compartas.

## 2. Actívalo en la app

- **En tu servidor (Dokploy):** añade `MCP_TOKEN=<el token>` en la pestaña **Environment** y vuelve a desplegar.
  `docker-compose.yml` ya trae la ruta de Traefik para el MCP.
- **En tu ordenador:** añade `MCP_TOKEN=<el token>` a tu `.env` y vuelve a arrancar `npm run dev`.

Sin `MCP_TOKEN`, el MCP está apagado y la app no responde nada en su ruta.

Abre la app una vez en el navegador después de este paso: así guarda en el servidor una copia de tus ajustes (FC
máxima, umbrales…) y Claude calcula con los mismos números que ves en pantalla.

## 3. Compila el MCP

Desde la carpeta del proyecto, una sola vez (y otra vez cuando actualices el proyecto):

```bash
npm --prefix mcp install
npm --prefix mcp run build
```

## 4. Conéctalo a Claude

**Claude Desktop:** abre su fichero de configuración, creándolo si no existe:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`

Y añade esto, con la ruta a tu proyecto, la dirección de tu app y tu token:

```json
{
  "mcpServers": {
    "suunto-stats": {
      "command": "node",
      "args": ["C:\\ruta\\al\\proyecto\\mcp\\dist\\index.js"],
      "env": {
        "SUUNTO_APP_URL": "https://suunto.tudominio.com",
        "SUUNTO_MCP_TOKEN": "pega-aqui-el-token"
      }
    }
  }
}
```

- Con la app en tu ordenador, `SUUNTO_APP_URL` es `http://localhost:5173`.
- En un servidor tiene que ser `https://`.

Cierra Claude Desktop del todo y vuelve a abrirlo: «suunto-stats» aparecerá entre sus conexiones.

**Claude Code** (alternativa):

```bash
claude mcp add suunto-stats --scope user --env SUUNTO_APP_URL=https://suunto.tudominio.com --env SUUNTO_MCP_TOKEN=pega-aqui-el-token -- node /ruta/al/proyecto/mcp/dist/index.js
```

## 5. Pruébalo

Pregúntale a Claude «¿cómo voy de forma?». La primera vez te pedirá permiso para usar cada herramienta. Todas son de
**solo lectura** salvo `guardar_propuesta_semana` y `borrar_propuesta`, así que puedes permitir siempre las de lectura
y que te pregunte por esas dos.

## Herramientas

| Herramienta | Qué da |
|---|---|
| `perfil_atleta` | Tus ajustes (FC, umbrales, zonas), avisos para la IA, totales, VO2max, plan y próxima competición |
| `listar_actividades` | Actividades entre dos fechas, con filtros por deporte, texto o competiciones |
| `ver_actividad` | Una actividad con detalle: parciales, zonas, mejores tramos y ritmos máximos |
| `resumen_semanal` | Por semana: km, tiempo, sesiones, tirada larga, TSS, reparto 80/20 y rampa |
| `estado_de_forma` | CTL, ATL y TSB, su evolución y la previsión con el plan del entrenador |
| `records_y_predicciones` | Mejores marcas, predicción de tiempos y ritmo umbral estimado |
| `distribucion_intensidad` | Tiempo en cada zona de FC y reparto 80/20 |
| `plan_entrenador` | Sesiones que planificó el entrenador, con si se hicieron y el % de cumplimiento |
| `estilo_entrenador` | Cómo planifica tu entrenador, en resumen, con sus 2 últimas semanas de ejemplo |
| `competiciones` | Próximas (con predicción) y pasadas (con resultado) |
| `comparar_semana` | Lo planificado frente a lo hecho en una semana, día a día |
| `propuestas_guardadas` | Las semanas propuestas que ya están en la app (de Claude o del Entrenador IA) |
| `guardar_propuesta_semana` | **Escribe:** guarda en la app una semana propuesta (como tu entrenador o sin entrenador) |
| `borrar_propuesta` | **Escribe:** borra una semana que guardó Claude (no toca las demás ni el calendario) |

Para guardar una, pídeselo con naturalidad: «propónme la semana que viene como mi entrenador y, si te parece bien,
guárdala». La verás en Entrenador IA y Plan en cuanto abras la app o vuelvas a ella.

## Privacidad y seguridad

| Claude **ve** | Claude **nunca ve** |
|---|---|
| Resúmenes de actividades, parciales, zonas, récords y forma | Tus rutas GPS |
| El plan del entrenador y tus competiciones | La cookie de TrainingPeaks, la sesión de Suunto ni las claves de IA |
| Tus ajustes de entrenamiento | Tu email ni tu usuario de Authelia |

- **Lo que ve Claude va a Anthropic** dentro de tu conversación, igual que hoy va a Google si usas Gemini.
- **El token solo abre la ruta del MCP:** ni la web, ni tus ficheros de datos, ni las demás rutas de la app.
- **En tu servidor,** esa ruta no pasa por Authelia, pero sí por Traefik, con límite de peticiones. Traefik borra
  cualquier cabecera de usuario que llegue de fuera, y la ruta sigue exigiendo el secreto del proxy, como el resto.
  A quien llega sin token, la app le responde como si la ruta no existiera.
- **Lo único que puede cambiar son sus propuestas de semana en la app.** Se validan como las de la app (fechas de esa
  semana, números con sentido, entre 12 semanas atrás y 26 adelante), no pisa una que ya exista salvo que se le pida y
  solo borra las que guardó él. Nunca toca Suunto, TrainingPeaks, tus actividades, tus ajustes ni el calendario.
- **El token queda escrito en la configuración de Claude Desktop de tu ordenador:** protege tu cuenta de Windows y no
  compartas ese fichero.
- **Si crees que el token se ha filtrado,** cambia `MCP_TOKEN` en el servidor (y en Claude) y el viejo deja de valer.

## Problemas

| Mensaje | Qué hacer |
|---|---|
| «La app rechaza el token» | `SUUNTO_MCP_TOKEN` (en Claude) y `MCP_TOKEN` (en la app) tienen que ser idénticos. |
| «El MCP está desactivado» | Falta `MCP_TOKEN` en la app, o tiene menos de 32 caracteres. Vuelve a desplegar o arrancar la app. |
| «Ha redirigido al login de Authelia» | Falta la ruta `suunto-mcp` de Traefik: despliega con el `docker-compose.yml` actual. |
| «No hay conexión con…» | La app no está en marcha, o `SUUNTO_APP_URL` está mal escrita. |
| «suunto-stats» no aparece en Claude Desktop | Revisa la ruta a `mcp/dist/index.js` y que compilaste el MCP. Los registros están en `%APPDATA%\Claude\logs\`. |
| Los números no coinciden con la app | `perfil_atleta` dice `ajustes_de_la_app: false`: abre la app una vez para que guarde tus ajustes. |

Para probar las herramientas sin Claude, usa el inspector oficial con las mismas dos variables:
`npm --prefix mcp run inspector`.
