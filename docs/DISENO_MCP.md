# MCP de Suunto Stats: diseño

> **Estado (24-11-2026):** la **fase 1 (lectura) está hecha**: `server/auth.ts`, `server/mcpApi.ts`,
> `server/mcpData.ts`, `server/settingsSync.ts`, `mcp/` y la ruta de Traefik. La fase 2 (guardar propuestas) y la 3 están
> sin hacer. Cómo usarlo: [GUIA_MCP.md](../GUIA_MCP.md).
>
> Cambios frente a lo previsto: el MCP tiene 11 herramientas de lectura (`propuestas_guardadas` pasa a la fase 2) y la
> app limita a 60 peticiones por minuto, además de las 30 por minuto de Traefik.
>
> Tras medirlo con datos reales (1479 actividades): todas responden en menos de 10 ms, así que el coste está en el
> tamaño de las respuestas, que gasta contexto de Claude. Por eso:
> - `plan_entrenador` da solo lo planificado (no los entrenos subidos desde el reloj) y recorta las descripciones a
>   300 caracteres, salvo con `descripcion_completa`;
> - `estilo_entrenador` resume el estilo (`coachStats`) en ~1.400 tokens, frente a ~16.500 si se leen 8 semanas de plan;
> - las respuestas no llevan campos vacíos;
> - `deporte` va en español (y admite inglés), `comparar_semana` acepta cualquier día y `ver_actividad`, el id como texto.
>
> Refuerzos para la VPS: en la ruta `suunto-mcp`, Traefik borra las cabeceras `Remote-*` (ahí no pasa Authelia); la
> app rechaza cualquier ruta con barras codificadas (`%2F`, `%5C`), para que Traefik y la app no puedan entender rutas
> distintas; y sin token responde 404, como si la ruta no existiera (con un token equivocado, 401).

---

## 1. Resumen

Un **MCP** (Model Context Protocol) es un «enchufe» estándar que permite a Claude consultar datos y hacer acciones en
otros programas mediante **herramientas** que nosotros definimos.

La idea es que puedas **hablar con Claude** (en Claude Desktop o Claude Code, con tu suscripción y **sin clave de
API**) sobre tus entrenamientos, y que Claude:

- **lea tus datos** de la app que tienes en la VPS: actividades, forma, récords, plan del entrenador y competiciones;
- **guarde propuestas de semana**, que luego ves en la app desde cualquier dispositivo.

Cómo se hace (opción A):

```
 Claude Desktop ──stdio──► MCP en tu PC ──HTTPS + token──► Traefik ──► app en la VPS (/api/mcp/v1/…)
 (tu ordenador)            (mcp/, Node)                   (sin Authelia,     (lee public/data,
                                                           con límite)        calcula, responde)
```

La IA con clave de API (Gemini, OpenAI o Claude por `AI_PROVIDER`) **sigue como está**: los botones de la app no
cambian. El MCP es una forma más de usar la IA, no un sustituto.

---

## 2. Qué podrás hacer (ejemplos)

| Le dices a Claude… | Qué herramientas usará | Qué obtienes |
|---|---|---|
| «¿Cómo voy de forma para la media de diciembre?» | `perfil_atleta`, `competiciones`, `estado_de_forma`, `resumen_semanal` | Tu CTL/ATL/TSB, cómo llegarás según el plan y la predicción para esa distancia |
| «Analiza mi entreno de ayer» | `listar_actividades`, `ver_actividad` | Parciales, zonas, mejores tramos y desacoplamiento comentados |
| «¿Cumplí el plan esta semana?» | `comparar_semana` | Qué tocaba, qué hiciste y el % de cumplimiento por día |
| «Prepárame la semana que viene como mi entrenador» | `perfil_atleta`, `plan_entrenador`, `resumen_semanal`, `guardar_propuesta_semana` | Una semana marcada «PROPUESTA IA» que ves en la app |
| «Plan de 10 semanas para un 10k sin entrenador» | `records_y_predicciones`, `resumen_semanal`, `guardar_propuesta_semana` (semana a semana) | Las semanas guardadas en la app |
| «¿Qué récords tengo y qué tiempo haría en un 5k?» | `records_y_predicciones` | Mejores tramos y predicción de Riegel |

Claude decide solo qué herramientas llamar y cuántas veces. Tú solo preguntas.

---

## 3. Componentes

### 3.1 API del MCP en la app (`server/mcpApi.ts`, nuevo)

Un plugin de Vite más, como `gemini.ts`, `sync.ts` o `fit.ts`, con rutas bajo **`/api/mcp/v1/`**. Hace el trabajo
pesado en el servidor:

- lee `public/data/` (actividades, detalles, plan y competiciones), con una caché que se renueva cuando cambian los
  ficheros;
- **reutiliza los cálculos de la app** de `src/utils/`, para que los números sean los mismos que ves en pantalla:
  `calculateFitnessHistory`, `projectFitness`, `aggregateByWeek`, `computePRs`, `predictRaces`,
  `estimateThresholdPace`, `intensitySplit`, `planItems`, `findRaces`, `coachStats`, `compareWeek` y `parseProposal`;
- devuelve **solo lo necesario y ya resumido**, en JSON compacto. **Nunca** rutas GPS.

**Por qué el MCP no lee `/data` directamente:**
1. los detalles llevan tus rutas GPS, y no deben salir del servidor;
2. `activities.json` pesa ~730 KB, demasiado para el contexto de Claude;
3. si el cálculo se hace en la app, los números coinciden siempre con los de la pantalla.

### 3.2 Servidor MCP (`mcp/`, nuevo paquete)

Un programa pequeño de Node/TypeScript que **Claude Desktop arranca en tu PC**. Habla con Claude por *stdio* (entrada y
salida estándar) y traduce cada herramienta a una petición HTTPS a la API de la app.

- No guarda datos ni calcula nada; solo traduce y da formato.
- Usa el SDK oficial `@modelcontextprotocol/sdk` (1.32) y `zod` para validar los parámetros.
- Configuración por variables de entorno: `SUUNTO_APP_URL` y `SUUNTO_MCP_TOKEN`.
- `stdout` queda reservado para el protocolo; sus mensajes de registro van a `stderr`.

### 3.3 Entrada en Traefik (`docker-compose.yml`)

Una ruta nueva, `suunto-mcp`, **solo para `/api/mcp/`**:
- **sin Authelia**, porque un programa no puede escribir el código de 6 dígitos de tu móvil;
- **con el secreto del proxy** (`X-Auth-Proxy-Secret`), como el resto, para que nadie llegue a la app saltándose Traefik;
- **con límite de peticiones**, para frenar abusos si el token se filtrara.

Todo lo demás (la web, `/data` y el resto de `/api`) sigue detrás de Authelia, igual que ahora.

### 3.4 Datos en el servidor (nuevos ficheros en `public/data/`)

| Fichero | Qué guarda | Quién lo escribe |
|---|---|---|
| `ajustes.json` | Copia de tus ajustes: FC máxima, umbrales, ritmo umbral, competiciones marcadas, avisos para la IA | La app, cada vez que cambias un ajuste |
| `propuestas_claude.json` | Las semanas que propone Claude | El MCP (`guardar_propuesta_semana` y `borrar_propuesta`) y la app (borrar) |

Van en `public/data/` porque esa carpeta ya es un volumen en Docker y sobrevive a cada despliegue. Se escriben de forma
segura: primero en un fichero temporal y luego se renombra.

**Por qué hace falta `ajustes.json`:** hoy los ajustes viven solo en el navegador (localStorage). Sin una copia en el
servidor, el MCP calcularía las zonas, el TSS estimado o las competiciones marcadas con los valores por defecto, y
Claude vería números distintos a los de la app.

---

## 4. Cómo funciona, paso a paso

### 4.1 Al abrir Claude Desktop
1. Claude Desktop lee su configuración y arranca `node …/mcp/dist/index.js`.
2. Le pide la lista de herramientas, avisos y consejos (`tools/list`, `prompts/list`) y recibe las **instrucciones**
   del MCP (apartado 6).
3. En el chat aparece «suunto-stats» como conexión disponible.

### 4.2 Una pregunta («¿cómo voy de forma?»)
1. Claude decide llamar a `estado_de_forma({ dias: 90 })`.
2. Claude Desktop te pide permiso la primera vez. Puedes permitirlo siempre para las herramientas de solo lectura.
3. El MCP hace `GET https://suunto.tudominio.com/api/mcp/v1/forma?dias=90` con la cabecera
   `Authorization: Bearer <token>`.
4. **Traefik** (ruta `suunto-mcp`) comprueba el límite de peticiones, añade el secreto del proxy y pasa la petición a la app.
5. **`server/auth.ts`** comprueba el secreto del proxy y el token, y solo acepta rutas `/api/mcp/`.
6. **`server/mcpApi.ts`** lee los datos y `ajustes.json`, calcula con `src/utils` y responde en JSON.
7. El MCP entrega a Claude el JSON y una línea de resumen, y Claude te contesta con tus datos.

### 4.3 Guardar una semana («prepárame la semana que viene»)
1. Claude consulta `perfil_atleta`, `plan_entrenador` y `resumen_semanal`.
2. Llama a `guardar_propuesta_semana` con las sesiones. Claude Desktop te pide permiso, porque escribe.
3. La app **valida la semana con las mismas reglas que las propuestas de Gemini** (`parseProposal`): fechas dentro de
   la semana, tipos válidos y números con sentido. Si algo falla, devuelve el error en español y Claude lo corrige.
4. Se guarda en `propuestas_claude.json` y Claude te dice que ya está, con el enlace a la semana en la app.
5. En la app la ves en **Plan** y **Entrenador IA** como «PROPUESTA IA · Claude», y puedes **pasarla al calendario** o
   **borrarla**, como las de Gemini.

---

## 5. Herramientas

Nombres y textos en español, como el resto del proyecto. Las de lectura llevan la anotación `readOnlyHint`; las que
escriben, no, y `borrar_propuesta` lleva `destructiveHint` para que Claude Desktop pida confirmación.

### 5.1 Lectura

| Herramienta | Parámetros | Devuelve |
|---|---|---|
| `perfil_atleta` | — | Ajustes (FC máx, umbral, ritmo umbral y zonas de ritmo), avisos (`hrUnreliable`, `splitSessions`), % de carrera, totales, primera y última actividad, VO2max reciente, fecha de la última descarga y si hay plan de TrainingPeaks |
| `listar_actividades` | `desde`, `hasta` (YYYY-MM-DD; por defecto los últimos 30 días), `deporte` (`running`, `cycling`, `swimming`, `otro`, `todos`), `texto` (busca en el título), `solo_competiciones`, `limite` (1–200, por defecto 50) | Lista compacta: id, fecha, título, deporte, km, duración, ritmo, FC media y máxima, desnivel, TSS, VO2max y origen (Suunto o FIT) |
| `ver_actividad` | `id` | El resumen, más parciales (con zona de ritmo por parcial), zonas de FC, mejores tramos (con récord si lo es), ritmos máximos de 30 s a 5 min, desacoplamiento, cadencia y si es competición. **Sin ruta GPS** |
| `resumen_semanal` | `semanas` (1–52, por defecto 12), `hasta` | Por semana: km de carrera, tiempo, sesiones, tirada larga, TSS, reparto 80/20 y rampa frente a la media de 4 semanas |
| `estado_de_forma` | `dias` (por defecto 90), `proyectar` (por defecto sí) | CTL, ATL, TSB y estado de hoy («fresco», «en forma»…), la serie semanal y la forma prevista con el plan del entrenador hasta la próxima competición |
| `records_y_predicciones` | — | Mejores 3 marcas por distancia (1k, 5k, 10k, media, maratón), ritmos máximos, predicción de Riegel (últimos 90 días) y ritmo umbral estimado |
| `distribucion_intensidad` | `dias` (por defecto 28) | Tiempo en zonas de FC (las reales del reloj) y el reparto 80/20 |
| `plan_entrenador` | `desde`, `hasta` (por defecto, esta semana y las 2 siguientes) | Sesiones de TrainingPeaks: fecha, tipo, título, duración, distancia, TSS y descripción del entrenador, con su estado (hecha, no hecha, hoy o próxima) y el % de cumplimiento |
| `competiciones` | `pasadas`, `futuras` (por defecto las dos) | Las de TrainingPeaks y las detectadas: nombre, fecha, prioridad y distancia. Para las pasadas, el resultado; para las futuras, los días que faltan y la predicción |
| `comparar_semana` | `semana` (lunes) | Lo planificado (entrenador o propuesta de Claude) frente a lo hecho, por día, con el % de cumplimiento y el TSS planificado frente al real |
| `propuestas_guardadas` | `semana` (opcional) | Las semanas de Claude guardadas en el servidor, para que pueda seguir un plan que empezó en otra conversación |

### 5.2 Escritura

| Herramienta | Parámetros | Qué hace |
|---|---|---|
| `guardar_propuesta_semana` | `semana` (lunes), `modo` (`como_entrenador` o `sin_entrenador`), `explicacion`, `sesiones[]` con `fecha`, `tipo`, `titulo`, `descripcion`, `duracion_min`, `distancia_km` (opcional) y `tss` (opcional), y `reemplazar` (por defecto no) | Valida y guarda la semana. Si ya hay una para esa semana y modo y `reemplazar` es falso, devuelve un aviso en lugar de sobrescribirla |
| `borrar_propuesta` | `semana`, `modo` | Borra esa propuesta de Claude. No toca las de Gemini ni el calendario |

**Tipos de sesión válidos** (los de `coach.ts`): `rodaje`, `progresivo`, `rectas`, `series`, `cuestas`, `cambios`,
`activacion`, `competicion`, `fuerza`, `natacion`, `descanso` y `otro`.

**Límites de `guardar_propuesta_semana`:** 21 sesiones como máximo; textos de hasta 2000 caracteres; semanas entre 12
semanas atrás (para probar contra semanas ya hechas, como con Gemini) y 26 semanas adelante.

### 5.3 Ejemplo de respuesta (`listar_actividades`, con datos inventados)

```json
{
  "desde": "2026-11-17", "hasta": "2026-11-23", "total": 2,
  "actividades": [
    { "id": 1795090470, "fecha": "2026-11-19T18:02", "titulo": "Carrera", "deporte": "running",
      "km": 3.91, "duracion": "19:45", "ritmo": "5:03/km", "fc_media": 159, "fc_max": 170,
      "desnivel_m": 0, "tss": 24, "vo2max": null, "origen": "suunto" }
  ]
}
```

---

## 6. Instrucciones y avisos predefinidos

### 6.1 Instrucciones del servidor

El SDK permite mandar unas **instrucciones** al conectar. Le dirán a Claude:
- que empiece llamando a `perfil_atleta`, para conocer tus ajustes y avisos;
- que las fechas son en **hora local** y las semanas empiezan en lunes;
- que el entrenador planifica **por tiempo** (duración siempre, distancia pocas veces), y que las propuestas «como el
  entrenador» deben hacer lo mismo;
- que si `hrUnreliable` está activado, no juzgue ni planifique por pulso; y si lo está `splitSessions`, que varias
  actividades del mismo día son una sola sesión;
- que no se invente datos: si una herramienta no devuelve algo, que lo diga;
- que las propuestas son solo propuestas: nunca van a TrainingPeaks y el usuario decide si las pasa al calendario.

### 6.2 Avisos predefinidos (prompts)

Aparecen en Claude Desktop como atajos:

| Aviso | Parámetros | Qué pide |
|---|---|---|
| `revisar_semana` | `semana` (opcional) | Revisar lo planificado frente a lo hecho: cumplimiento, carga, sensaciones y qué ajustar |
| `planificar_semana` | `semana`, `modo`, `objetivo` (opcional) | Proponer y guardar una semana, con las mismas reglas que el Entrenador IA de la app |
| `analizar_actividad` | `id` | Comentar una actividad: ritmos, zonas, parciales y desacoplamiento |
| `preparar_competicion` | `competicion` (opcional) | Ver si llegas en forma y cómo plantear las semanas que faltan |

Sus textos se basan en las reglas que ya usan los avisos de Gemini en `src/utils/aiPrompt.ts`, para que las propuestas
de Claude se parezcan a las de la app.

---

## 7. API de la app (`/api/mcp/v1/`)

Todas las rutas exigen `Authorization: Bearer <MCP_TOKEN>`. Las respuestas son JSON y van con `Cache-Control: no-store`.

| Método y ruta | Herramienta |
|---|---|
| `GET /api/mcp/v1/perfil` | `perfil_atleta` |
| `GET /api/mcp/v1/actividades?desde&hasta&deporte&texto&competiciones&limite` | `listar_actividades` |
| `GET /api/mcp/v1/actividades/{id}` | `ver_actividad` |
| `GET /api/mcp/v1/semanas?semanas&hasta` | `resumen_semanal` |
| `GET /api/mcp/v1/forma?dias&proyectar` | `estado_de_forma` |
| `GET /api/mcp/v1/records` | `records_y_predicciones` |
| `GET /api/mcp/v1/intensidad?dias` | `distribucion_intensidad` |
| `GET /api/mcp/v1/plan?desde&hasta` | `plan_entrenador` |
| `GET /api/mcp/v1/competiciones?pasadas&futuras` | `competiciones` |
| `GET /api/mcp/v1/semana/{lunes}` | `comparar_semana` |
| `GET /api/mcp/v1/propuestas?semana` | `propuestas_guardadas` |
| `PUT /api/mcp/v1/propuestas/{lunes}?modo=` | `guardar_propuesta_semana` |
| `DELETE /api/mcp/v1/propuestas/{lunes}?modo=` | `borrar_propuesta` |

**Errores**, con un mensaje en español en `{ "error": "…" }`:
- `400`: parámetros no válidos;
- `401`: token incorrecto o ausente;
- `404`: actividad o semana inexistente, o el MCP desactivado porque no hay `MCP_TOKEN`;
- `409`: ya hay propuesta y `reemplazar` es falso;
- `413`: cuerpo demasiado grande;
- `429`: demasiadas peticiones.

**Límites:** cuerpos de hasta 100 KB, respuestas de hasta ~150 KB (con aviso si se recorta) y 30 peticiones por minuto.

**Rutas nuevas para la propia app** (detrás de Authelia, como el resto):
- `PUT /api/ajustes`: la app manda una copia de tus ajustes al cambiarlos, y también al abrirse.
- `GET /api/propuestas` y `DELETE /api/propuestas/{lunes}?modo=`: la app lee y borra las propuestas de Claude.

---

## 8. Seguridad y privacidad

### 8.1 El token
- **`MCP_TOKEN`:** cadena aleatoria de 32 caracteres como mínimo, generada como los demás secretos. Va en las variables
  de Dokploy y en la configuración del MCP de tu PC.
- **Si no hay `MCP_TOKEN`, el MCP está apagado:** `/api/mcp/` responde 404.
- Se compara **en tiempo constante**, como el secreto del proxy.
- **Solo sirve para `/api/mcp/`.** Con el token no se llega a la web, ni a `/data`, ni a las demás rutas de `/api`.
- **Si se filtra:** lo cambias en Dokploy, redespliegas y el viejo deja de valer.

### 8.2 Dos cerrojos, como ahora
1. **Traefik:** la ruta `suunto-mcp` solo acepta `Host(suunto…) && PathPrefix(/api/mcp/)`, con prioridad sobre la
   general. Añade el secreto del proxy y aplica el límite de peticiones.
2. **La app:** `server/auth.ts` exige el secreto del proxy (en modo `authelia`) y el token, y solo para `/api/mcp/`.

**Contra trucos con la ruta**, del tipo `/api/mcp/../data/…`: si la petición se acepta por el token, el manejador del
MCP la atiende o responde 404, pero **nunca la pasa** al resto del servidor (ficheros estáticos, `/data`…).

### 8.3 Qué ve Claude y qué no

| Claude **ve** | Claude **nunca ve** |
|---|---|
| Resúmenes de actividades, parciales, zonas, récords y forma | Rutas GPS (`gpxCoords`, `routePace`) |
| El plan del entrenador con sus descripciones, y las competiciones | La cookie de TrainingPeaks, la sesión de Suunto y las claves de IA |
| Tus ajustes de entrenamiento | Tu email, tu usuario de Authelia y tus ids de cuenta |
| Las propuestas guardadas | Los ficheros FIT originales y los registros de depuración |

Lo que Claude ve va a Anthropic dentro de tu conversación, igual que hoy va a Google con Gemini.

### 8.4 Lo que el MCP no puede hacer
- Escribir en Suunto o en TrainingPeaks.
- Lanzar la descarga de datos, subir ficheros o cambiar ajustes.
- Borrar nada que no sea una propuesta suya.

### 8.5 Texto de terceros
Los títulos de las actividades, las descripciones del entrenador y los nombres de las competiciones son texto que Claude
lee. Si alguno intentara «darle órdenes», lo peor que podría pasar es una propuesta rara, que tú ves y puedes borrar.
Claude Desktop pide permiso antes de cada escritura.

### 8.6 En tu PC
- El token queda en el fichero de configuración de Claude Desktop, sin cifrar. Protege tu cuenta de Windows y no subas
  ese fichero a ningún sitio.
- El MCP solo habla por HTTPS, salvo con `localhost`.

### 8.7 Registro
Cada escritura (guardar o borrar) se apunta en los registros del contenedor: fecha, herramienta y semana, sin contenido.

---

## 9. Configuración

### 9.1 En Dokploy
Una variable nueva, generada como los otros secretos (`openssl rand -hex 32`):

```
MCP_TOKEN=...
```

Y en `docker-compose.yml`, que lo traería ya hecho:

```yaml
    environment:
      - MCP_TOKEN=${MCP_TOKEN:-}
    labels:
      - traefik.http.routers.suunto-mcp.rule=Host(`${SUUNTO_DOMAIN}`) && PathPrefix(`/api/mcp/`)
      - traefik.http.routers.suunto-mcp.priority=100
      - traefik.http.routers.suunto-mcp.entrypoints=websecure
      - traefik.http.routers.suunto-mcp.tls.certresolver=letsencrypt
      - traefik.http.routers.suunto-mcp.service=suunto
      - traefik.http.routers.suunto-mcp.middlewares=suunto-mcp-limite,suunto-proxy-secret
      - traefik.http.middlewares.suunto-mcp-limite.ratelimit.average=30
      - traefik.http.middlewares.suunto-mcp-limite.ratelimit.period=1m
      - traefik.http.middlewares.suunto-mcp-limite.ratelimit.burst=10
```

### 9.2 En tu PC
1. Compilar el MCP una vez, desde la carpeta del proyecto: `npm --prefix mcp install` y `npm --prefix mcp run build`.
2. **Claude Desktop:** editar `%APPDATA%\Claude\claude_desktop_config.json`:

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

   Reinicia Claude Desktop y aparecerá «suunto-stats».
3. **Claude Code** (alternativa): `claude mcp add` con las mismas dos variables (`-e`) y el comando
   `node …\mcp\dist\index.js`.

### 9.3 Sin VPS (en local)
Con la app en tu ordenador (`npm run dev`), `SUUNTO_APP_URL=http://localhost:5173`. En modo `none` la app ya solo
acepta conexiones de tu propio ordenador, y el token sigue siendo obligatorio. Así sirve también a quien use el
repositorio sin servidor.

---

## 10. Plan de implementación

Rama `feature/mcp` desde `main`. Si sale alguna corrección por el camino, en un commit aparte.

### Fase 1: lectura

| Pieza | Ficheros |
|---|---|
| Token y ruta exclusiva en el control de acceso | `server/auth.ts` y sus tests |
| API de lectura, sin GPS y con caché por fecha de los ficheros | `server/mcpApi.ts`, `server/mcpData.ts` y tests |
| Copia de los ajustes en el servidor | `server/settingsSync.ts` (`PUT /api/ajustes`) y `src/stores/activityStore.ts` (envío al cambiar y al abrir) |
| El MCP: 11 herramientas de lectura, instrucciones y 4 avisos | `mcp/package.json`, `mcp/tsconfig.json`, `mcp/src/index.ts`, `mcp/src/api.ts`, `mcp/src/tools/*.ts`, `mcp/src/prompts.ts` y tests |
| Traefik y variables | `docker-compose.yml` y `.env.example` (`MCP_TOKEN`) |
| CI | Compilar y probar `mcp/` |
| Guías | `GUIA_MCP.md` y `GUIDE_MCP.md`, y un apartado en los dos README |

**Al acabar la fase 1:** puedes preguntarle a Claude por todos tus datos; todavía no guarda semanas.

### Fase 2: escritura

| Pieza | Ficheros |
|---|---|
| Guardar, leer y borrar propuestas en el servidor, validando con `parseProposal` | `server/proposals.ts` y tests |
| Herramientas `guardar_propuesta_semana`, `borrar_propuesta` y `propuestas_guardadas` | `mcp/src/tools/*.ts` |
| La app muestra las propuestas de Claude («PROPUESTA IA · Claude») en Plan y Entrenador IA, con «Pasar al calendario» y «Borrar» | `src/stores/aiStore.ts` (o un `claudeStore` aparte), páginas Plan y Entrenador IA |

**Al acabar la fase 2:** Claude planifica, la semana aparece en tu app y la pasas al calendario si te gusta.

### Fase 3: opcional, más adelante
- **MCP remoto (opción B):** desde claude.ai y el móvil, con su propio login OAuth.
- **Sincronizar entre dispositivos** los entrenos propios, las zapatillas y las propuestas de Gemini, que hoy viven en
  el navegador.
- **Herramienta `actualizar_datos`** (lanzar la descarga), siempre con tu confirmación.

---

## 11. Pruebas

- **Tests unitarios (vitest):**
  - el token solo vale en `/api/mcp/`, se compara en tiempo constante y sin `MCP_TOKEN` todo da 404;
  - **ninguna respuesta contiene `gpxCoords` ni `routePace`;**
  - los límites de tamaño y de parámetros;
  - la validación de propuestas;
  - el MCP traduce bien cada herramienta, con un `fetch` simulado.
- **Integración:** arrancar `vite preview` con la **demo** (datos inventados) y llamar a la API con el token, como en
  las pruebas de acceso que ya se hicieron.
- **Manual:**
  1. **MCP Inspector** (`npx @modelcontextprotocol/inspector node mcp/dist/index.js`) para probar cada herramienta a mano.
  2. Claude Desktop con la demo en local.
  3. Claude Desktop con tu VPS.

---

## 12. Límites conocidos

- **Solo Claude Desktop o Claude Code:** no funciona desde la web ni desde el móvil de Claude (eso sería la fase 3).
- **Claude Desktop tiene que estar abierto en tu PC,** con internet.
- **Ajustes:** si cambias ajustes en dos dispositivos distintos, vale el último que se guardó.
- **Los datos son los de la última descarga en la VPS.** El MCP no descarga nada nuevo.
- **Las propuestas de Gemini y las de Claude van por separado,** cada una en su sitio.
- **Usa el límite de uso de tu suscripción de Claude.** Las preguntas que miran muchas semanas gastan más.

---

## 13. Decisiones pendientes

| # | Pregunta | Propuesta |
|---|---|---|
| 1 | ¿Nombres de herramientas en español o en inglés? | Español, como el resto del proyecto |
| 2 | ¿Claude puede borrar sus propuestas? | Sí, solo las suyas y con confirmación de Claude Desktop |
| 3 | ¿Las propuestas de Claude aparecen solas en el Calendario? | No: en Plan y Entrenador IA, y al Calendario con «Pasar al calendario», como ahora |
| 4 | ¿Claude puede lanzar la descarga de datos? | No en las fases 1 y 2 |
| 5 | ¿El MCP va en el repositorio público? | Sí, en `mcp/`: sirve a cualquiera, con su VPS o en local |
| 6 | ¿Copiar los ajustes al servidor? | Sí, para que Claude vea los mismos números que la app |
