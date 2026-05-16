import { defineConfig } from 'vitest/config';

// Vite 5.4 strips 'node:' then checks builtinModules.includes('sqlite') → false,
// and ignores external:true from resolveId. Workaround: intercept the import early
// and return a virtual module that loads node:sqlite via createRequire at runtime.
export default defineConfig({
  plugins: [
    {
      name: 'node-sqlite-shim',
      enforce: 'pre',
      resolveId(id: string) {
        if (id === 'node:sqlite' || id === 'sqlite') {
          return '\0node-sqlite-shim';
        }
      },
      load(id: string) {
        if (id === '\0node-sqlite-shim') {
          return `
import { createRequire } from 'module';
const _req = createRequire(import.meta.url);
const _m = _req('node:sqlite');
export const DatabaseSync = _m.DatabaseSync;
export const StatementSync = _m.StatementSync;
`;
        }
      },
    },
  ],
});
