import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const moduleNames = ['ocr', 'knowledge', 'inference'] as const;
const allowedPackages: Record<(typeof moduleNames)[number], Set<string>> = {
  ocr: new Set(['tesseract.js', 'vitest']),
  knowledge: new Set(['@huggingface/transformers', 'vitest']),
  inference: new Set(['zod', 'vitest']),
};
const violations: string[] = [];
let checkedFiles = 0;

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function sourceFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(absolute));
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) output.push(absolute);
  }
  return output;
}

function moduleSpecifiers(source: string): string[] {
  const pattern = /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s*(['"])([^'"]+)\1|\b(?:import|export)\s*(['"])([^'"]+)\3|\bimport\(\s*(['"])([^'"]+)\5|\brequire\(\s*(['"])([^'"]+)\7/g;
  return [...source.matchAll(pattern)].map(match => match[2] ?? match[4] ?? match[6] ?? match[8]).filter((value): value is string => Boolean(value));
}

async function resolveLocalImport(fromDirectory: string, specifier: string): Promise<string | null> {
  const base = path.resolve(fromDirectory, specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    try { if ((await stat(candidate)).isFile()) return await realpath(candidate); } catch { /* try the next extension */ }
  }
  return null;
}

for (const moduleName of moduleNames) {
  const moduleRoot = path.resolve(root, 'src', 'modules', moduleName);
  const files = await sourceFiles(moduleRoot);
  for (const file of files) {
    checkedFiles++;
    const source = await readFile(file, 'utf8');
    for (const specifier of moduleSpecifiers(source)) {
      if (specifier.startsWith('@/')) {
        violations.push(`${path.relative(root, file)}: use relative imports; alias imports are not resolved by module-only Vitest runs (${specifier})`);
        continue;
      }
      if (specifier.startsWith('.')) {
        const target = await resolveLocalImport(path.dirname(file), specifier);
        if (!target) {
          violations.push(`${path.relative(root, file)}: unresolved local import ${specifier}`);
          continue;
        }
        const sharedContracts = path.resolve(root, 'src', 'lib', 'contracts.ts');
        if (target === sharedContracts) continue;
        for (const other of moduleNames) {
          if (other !== moduleName && isWithin(path.resolve(root, 'src', 'modules', other), target)) {
            violations.push(`${path.relative(root, file)}: cross-module import to ${path.relative(root, target)}`);
          }
        }
        if (!isWithin(moduleRoot, target)) violations.push(`${path.relative(root, file)}: import escapes its module to ${path.relative(root, target)}`);
        continue;
      }
      if (specifier.startsWith('node:')) {
        const relative = path.relative(moduleRoot, file).replaceAll('\\', '/');
        if (moduleName !== 'knowledge' || relative !== 'server.ts') violations.push(`${path.relative(root, file)}: Node builtin is not allowed in this entry (${specifier})`);
        continue;
      }
      if (!allowedPackages[moduleName].has(specifier)) violations.push(`${path.relative(root, file)}: external dependency is not allowed (${specifier})`);
      if (moduleName === 'knowledge' && specifier === '@huggingface/transformers' && path.basename(file) !== 'server.ts') violations.push(`${path.relative(root, file)}: MiniLM must stay behind knowledge/server.ts`);
      if (moduleName === 'ocr' && specifier === 'tesseract.js' && path.basename(file) !== 'browser.ts') violations.push(`${path.relative(root, file)}: Tesseract must stay behind ocr/browser.ts`);
    }
  }
}

if (violations.length) {
  process.stderr.write(`Module boundary check failed (${violations.length} issue${violations.length === 1 ? '' : 's'}):\n${violations.map(item => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Module boundary check passed for ${checkedFiles} TypeScript files across ${moduleNames.length} modules. Shared contracts remain in src/lib/contracts.ts.\n`);
}
