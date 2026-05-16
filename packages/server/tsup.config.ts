import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig({
  // Bundle @skytalk/core inline so dist/server.js is self-contained.
  // workspace symlinks don't survive rsync to a production server.
  noExternal: ['@skytalk/core'],

  // esbuild strips the node: prefix from imports it doesn't recognise as known
  // built-ins (sqlite was added in Node 22.5 and isn't in esbuild's list yet).
  // --external node:sqlite (CLI) correctly prevents bundling but esbuild then
  // emits `from "sqlite"` in the output. onSuccess patches it back.
  onSuccess: async () => {
    const file = join('dist', 'server.js');
    const src = readFileSync(file, 'utf8');
    const patched = src.replace(/from "sqlite"/g, 'from "node:sqlite"');
    if (patched !== src) writeFileSync(file, patched);
  },
});
