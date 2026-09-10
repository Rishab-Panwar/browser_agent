/*
 * build.mjs — bundle the extension.
 *
 * The agent is written as ES modules so it can be tested in node without a
 * browser; a content script cannot be a module, so each entry point is bundled
 * into one classic script. Static assets are copied as they are.
 */

import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: { content: 'src/content.js', panel: 'src/panel.js', background: 'src/background.js' },
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  legalComments: 'none',
  logLevel: 'info',
});

for (const file of ['manifest.json', 'panel.html', 'panel.css']) {
  await cp(`src/${file}`, `${outdir}/${file}`);
}
// The icons the manifest names, and the one the panel shows in its masthead.
await cp('src/icons', `${outdir}/icons`, { recursive: true });

console.log(`built -> ${outdir}/`);
