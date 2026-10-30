import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
    'mcp-bridge': 'src/mcp-bridge.ts',
    'test-agent': 'src/test-agent.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // node:sqlite only exists with the node: prefix.
  removeNodeProtocol: false,
  // The shared package is consumed as TypeScript source, so bundle it; keep real deps external.
  noExternal: ['@agent-hub/shared'],
});
