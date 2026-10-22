import { configDefaults, defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': resolve(root, 'src') } },
  test: {
    // `.data` holds local images, model checkpoints and isolated build copies.
    // Never discover those private or generated files as repository tests.
    exclude: [...configDefaults.exclude, '**/.data/**'],
  },
});
