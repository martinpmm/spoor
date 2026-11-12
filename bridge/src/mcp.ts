#!/usr/bin/env node
/**
 * Spoor MCP server (stdio). Claude Desktop and Claude Code start it with
 *   node /absolute/path/to/spoor/bridge/dist/mcp.js
 * It opens ~/.spoor/events.db read only and exposes analysis tools.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dbPath } from './constants.js';
import { createServer } from './server.js';
import { Store } from './store.js';

// node:sqlite prints an ExperimentalWarning on some Node versions; keep stderr clean for MCP clients.
process.removeAllListeners('warning');

let store: Store | null = null;
const file = dbPath();

function getStore(): Store | null {
  if (!store) store = Store.openReadOnly(file);
  return store;
}

const server = createServer(getStore);
await server.connect(new StdioServerTransport());

const shutdown = () => {
  store?.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);
