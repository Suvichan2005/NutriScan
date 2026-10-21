#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, '../../..');
const vitestEntry = resolve(repositoryRoot, 'node_modules/vitest/vitest.mjs');

const result = spawnSync(process.execPath, [vitestEntry, 'run', moduleDirectory], {
  cwd: repositoryRoot,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(`Could not start the local Vitest runner: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.signal) {
  console.error(`The local Vitest runner stopped after signal ${result.signal}.`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
