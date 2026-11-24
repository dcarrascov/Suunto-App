# Talk to Claude about your training (MCP)

[Español](GUIA_MCP.md) · **English**

The Suunto Stats **MCP** connects **Claude Desktop** or **Claude Code** to your app, so you can ask about your training
in a normal conversation, with your Claude subscription and **no API key**. Claude only fetches the data it needs:
activities, fitness, records, your coach's plan and races.

```
Claude Desktop ──► MCP (on your computer) ──► your app (on your computer or on your server)
```

Almost everything is **read-only**. The only writes are saving or deleting in the app the weeks Claude proposes, and only
when you ask: they show up in Entrenador IA and Plan as «PROPUESTA IA», where you can move them to the calendar if you
like them. The full design (in Spanish)
is in [docs/DISENO_MCP.md](docs/DISENO_MCP.md). The tools and their data use Spanish names, like the app.

## What you can ask

- «How is my fitness for the next race?»
- «Analyse yesterday's run.»
- «Did I follow the plan this week?»
- «What 10K time could I run right now?»
- «Suggest next week the way my coach would.»

It also comes with four **ready-made prompts** (`revisar_semana`, `planificar_semana`, `analizar_actividad` and
`preparar_competicion`), shown as shortcuts in Claude Desktop.

## What you need

- The app running, on your computer (`npm run dev`) or on your server ([GUIDE_DEPLOY.md](GUIDE_DEPLOY.md)).
- **Node.js 20** or later, the same the app uses.
- **Claude Desktop** or **Claude Code**.

## 1. Create the token

It is the password the MCP uses to ask the app for data: a random string of 32 characters or more. In PowerShell:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

Or on Mac/Linux: `openssl rand -hex 32`. Keep it safe and do not share it.

## 2. Turn it on in the app

- **On your server (Dokploy):** add `MCP_TOKEN=<the token>` in the **Environment** tab and deploy again.
  `docker-compose.yml` already has the Traefik route for the MCP.
- **On your computer:** add `MCP_TOKEN=<the token>` to your `.env` and restart `npm run dev`.

Without `MCP_TOKEN` the MCP is off and the app answers nothing on its route.

Open the app once in the browser after this step: it saves a copy of your settings (max HR, thresholds…) on the server,
so Claude uses the same numbers you see on screen.

## 3. Build the MCP

From the project folder, once (and again whenever you update the project):

```bash
npm --prefix mcp install
npm --prefix mcp run build
```

## 4. Connect it to Claude

**Claude Desktop:** open its configuration file, creating it if it does not exist:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`

And add this, with the path to your project, your app's address and your token:

```json
{
  "mcpServers": {
    "suunto-stats": {
      "command": "node",
      "args": ["C:\\path\\to\\project\\mcp\\dist\\index.js"],
      "env": {
        "SUUNTO_APP_URL": "https://suunto.yourdomain.com",
        "SUUNTO_MCP_TOKEN": "paste-the-token-here"
      }
    }
  }
}
```

- With the app on your computer, `SUUNTO_APP_URL` is `http://localhost:5173`.
- On a server it must be `https://`.

Quit Claude Desktop completely and open it again: «suunto-stats» will appear among its connections.

**Claude Code** (alternative):

```bash
claude mcp add suunto-stats --scope user --env SUUNTO_APP_URL=https://suunto.yourdomain.com --env SUUNTO_MCP_TOKEN=paste-the-token-here -- node /path/to/project/mcp/dist/index.js
```

## 5. Try it

Ask Claude «how is my fitness?». The first time, it asks for permission to use each tool. They are all
**read-only** except `guardar_propuesta_semana` and `borrar_propuesta`, so you can always allow the read-only ones and
let it ask you about those two.

## Tools

| Tool | What it gives |
|---|---|
| `perfil_atleta` | Your settings (HR, thresholds, zones), notes for the AI, totals, VO2max, plan and next race |
| `listar_actividades` | Activities between two dates, filtered by sport, text or races |
| `ver_actividad` | One activity in detail: laps, zones, best efforts and peak paces |
| `resumen_semanal` | Per week: km, time, sessions, long run, TSS, 80/20 split and ramp |
| `estado_de_forma` | CTL, ATL and TSB, their trend and the projection with your coach's plan |
| `records_y_predicciones` | Best marks, race time predictions and estimated threshold pace |
| `distribucion_intensidad` | Time in each HR zone and the 80/20 split |
| `plan_entrenador` | The sessions your coach planned, whether they were done and the compliance % |
| `estilo_entrenador` | How your coach plans, in short, with their last 2 weeks as examples |
| `competiciones` | Upcoming (with prediction) and past (with result) |
| `comparar_semana` | Planned versus done in one week, day by day |
| `propuestas_guardadas` | Proposed weeks already in the app (from Claude or from the AI coach) |
| `guardar_propuesta_semana` | **Writes:** saves a proposed week in the app (like your coach or without a coach) |
| `borrar_propuesta` | **Writes:** deletes a week Claude saved (it never touches the others or the calendar) |

To save one, just ask: «suggest next week the way my coach would and, if it looks good, save it». You will see it in
Entrenador IA and Plan as soon as you open the app or return to it.

## Privacy and security

| Claude **sees** | Claude **never sees** |
|---|---|
| Activity summaries, laps, zones, records and fitness | Your GPS routes |
| Your coach's plan and your races | The TrainingPeaks cookie, the Suunto session or AI keys |
| Your training settings | Your email or your Authelia user |

- **What Claude sees goes to Anthropic** inside your conversation, just as it goes to Google today if you use Gemini.
- **The token only opens the MCP route:** not the web app, not your data files, not the app's other routes.
- **On your server,** that route skips Authelia but still goes through Traefik, with a request limit. Traefik removes
  any user header sent from outside, and the route still requires the proxy secret, like everything else. Anyone
  arriving without a token gets an answer as if the route did not exist.
- **The only thing it can change is its own proposed weeks in the app.** They are validated like the app's (dates in
  that week, sensible numbers, from 12 weeks back to 26 ahead), it never overwrites an existing one unless asked and it
  only deletes the ones it saved. It never touches Suunto, TrainingPeaks, your activities, your settings or the calendar.
- **The token is written in Claude Desktop's configuration on your computer:** protect your user account and do not
  share that file.
- **If you think the token leaked,** change `MCP_TOKEN` on the server (and in Claude) and the old one stops working.

## Troubleshooting

| Message | What to do |
|---|---|
| «La app rechaza el token» | `SUUNTO_MCP_TOKEN` (in Claude) and `MCP_TOKEN` (in the app) must be identical. |
| «El MCP está desactivado» | `MCP_TOKEN` is missing in the app, or shorter than 32 characters. Deploy or restart the app again. |
| «Ha redirigido al login de Authelia» | The `suunto-mcp` Traefik route is missing: deploy with the current `docker-compose.yml`. |
| «No hay conexión con…» | The app is not running, or `SUUNTO_APP_URL` is mistyped. |
| «suunto-stats» does not show up in Claude Desktop | Check the path to `mcp/dist/index.js` and that you built the MCP. Logs are in `%APPDATA%\Claude\logs\`. |
| The numbers differ from the app | `perfil_atleta` says `ajustes_de_la_app: false`: open the app once so it saves your settings. |

To try the tools without Claude, use the official inspector with the same two variables:
`npm --prefix mcp run inspector`.
