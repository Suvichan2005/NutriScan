import { execFileSync } from 'node:child_process';

const [moduleName, baseRef] = process.argv.slice(2);
const allowedModules = new Set(['ocr', 'knowledge', 'inference']);
if (!allowedModules.has(moduleName) || !baseRef) {
  process.stderr.write('Usage: npx tsx scripts/check-module-ownership.mts <ocr|knowledge|inference> <base-ref>\n');
  process.exit(2);
}

function git(args: string[]): string[] {
  const output = execFileSync('git', args, { encoding: 'utf8' });
  return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

const mergeBase = git(['merge-base', baseRef, 'HEAD'])[0];
if (!mergeBase) throw new Error(`Could not resolve a merge base for ${baseRef}.`);
const changed = new Set([
  ...git(['diff', '--name-only', mergeBase]),
  ...git(['ls-files', '--others', '--exclude-standard']),
]);
const prefix = `src/modules/${moduleName}/`;
const outside = [...changed].filter(file => !file.replaceAll('\\', '/').startsWith(prefix));

if (outside.length) {
  process.stderr.write(`Ownership check failed for ${moduleName}; these changed paths are owner-controlled or belong to another module:\n${outside.map(file => `- ${file}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Ownership check passed for ${moduleName}: ${changed.size} changed path${changed.size === 1 ? '' : 's'}, all under ${prefix}\n`);
}
