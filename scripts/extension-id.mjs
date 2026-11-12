// Prints the extension ID that Chrome derives from the `key` in extension/wxt.config.ts.
// Usage: node scripts/extension-id.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const config = fs.readFileSync(path.join(root, 'extension', 'wxt.config.ts'), 'utf8');
const key = /PUBLIC_KEY\s*=\s*'([^']+)'/.exec(config)?.[1];
if (!key) throw new Error('PUBLIC_KEY not found in wxt.config.ts');
const hash = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
const id = [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
console.log(id);
