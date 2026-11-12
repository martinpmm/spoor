import os from 'node:os';
import path from 'node:path';

/** Native messaging host name. Must match the name used by the extension. */
export const HOST_NAME = 'com.spoor.bridge';

/**
 * Extension ID derived from the fixed `key` in extension/wxt.config.ts.
 * If you change the key, recompute it with `node scripts/extension-id.mjs`.
 */
export const EXTENSION_ID = 'nfdcncheigkogigcjnjpinbmfoibebme';

export const BRIDGE_VERSION = '0.1.0';

export const SCHEMA_VERSION = 1;

/** Data directory. Defaults to ~/.spoor, can be moved with SPOOR_HOME. */
export function dataDir(): string {
  return process.env.SPOOR_HOME || path.join(os.homedir(), '.spoor');
}

export function dbPath(): string {
  return process.env.SPOOR_DB || path.join(dataDir(), 'events.db');
}
