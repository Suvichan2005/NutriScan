import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nextCli = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const env = { ...process.env };

// TypeScript 7's native Go checker can exhaust memory on Windows when it uses
// the machine-wide worker count. Keep builds reliable on constrained machines
// while allowing an explicit user override.
if (process.platform === 'win32' && !env.GOMAXPROCS) env.GOMAXPROCS = '2';

const result = spawnSync(process.execPath, [nextCli, 'build', '--webpack'], {
  env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
