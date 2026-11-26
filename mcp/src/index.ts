#!/usr/bin/env node
// MCP de Suunto Stats (cómo usarlo: GUIA_MCP.md). Claude Desktop o Claude Code lo arrancan y hablan con él por stdio;
// cada herramienta pide los datos a la app (local o en tu servidor) con el token del MCP.
// stdout es del protocolo: los mensajes para ti van por stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { configFromEnv, type ApiConfig } from './api.js'
import { INSTRUCTIONS, registerPrompts } from './prompts.js'
import { registerTools } from './tools.js'

let cfg: ApiConfig
try {
  cfg = configFromEnv()
} catch (e) {
  console.error(`[suunto-stats] ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}

const server = new McpServer({ name: 'suunto-stats', version: '1.0.0' }, { instructions: INSTRUCTIONS })
registerTools(server, cfg)
registerPrompts(server)
await server.connect(new StdioServerTransport())
console.error(`[suunto-stats] MCP listo; datos de ${cfg.baseUrl}`)
