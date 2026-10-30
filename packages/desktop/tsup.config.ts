import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts', preload: 'src/preload.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  outExtension: () => ({ js: '.cjs' }),
  clean: true,
  external: ['electron'],
});
