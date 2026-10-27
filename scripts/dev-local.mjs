import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  'env-dir': { type: 'string', default: '.' },
  port: { type: 'string', default: '3420' },
  check: { type: 'boolean', default: false },
} });
const envDirectory = path.resolve(root, values['env-dir']);
if (!existsSync(path.join(envDirectory, '.env.local'))) {
  throw new Error('Private .env.local not found. Pass --env-dir pointing to this project’s configured checkout. No server was started.');
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');

// Load server-side settings without passing Node's --env-file through Next's
// dev-worker NODE_OPTIONS forwarding. Never copy or print credential values.
const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(envDirectory, true, { info() {}, error() {} });
const env = { ...process.env };
if (values.check) {
  const result = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify({
    geminiEnabled:process.env.ENABLE_GEMINI==='true',
    configuredMode:process.env.GEMINI_PROVIDER??null,
    configuredModel:process.env.GEMINI_MODEL??null,
    freeKeyConfigured:Boolean(process.env.FREE_GEMINI_API_KEY),
    envFileNodeOptionPresent:(process.env.NODE_OPTIONS??'').includes('--env-file')
  }))`], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'),
    'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)],
  { cwd: root, env, stdio: 'inherit', windowsHide: true });
  child.on('error', () => { console.error('Could not start the local Next.js server.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
