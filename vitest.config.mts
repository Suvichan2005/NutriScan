import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `.data` holds local images, model checkpoints and isolated build copies.
    // Never discover those private or generated files as repository tests.
    exclude: [...configDefaults.exclude, '**/.data/**'],
  },
});
