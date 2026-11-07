/**
 * Builds the standalone demo: dist/pitchready-demo.html, one file with inlined JS and CSS.
 * Demo mode only (browser localStorage, scripted resident, rule-based "Demo feedback"); no server,
 * no API, no keys. next/link and next/navigation are swapped for in-memory stand-ins.
 * See DECISIONS.md D23.
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [join(root, 'src/static-demo/main.tsx')],
  bundle: true, write: false, format: 'iife', target: ['es2022', 'safari16'], jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { 'next/link': join(root, 'src/static-demo/next-link.tsx'), 'next/navigation': join(root, 'src/static-demo/next-navigation.ts') },
  logLevel: 'warning',
});
const js = out.outputFiles[0]!.text.replace(/<\/script/gi, '<\\/script');
// One self-contained file: the self-hosted font is embedded as a data URI.
const font = readFileSync(join(root, 'public/fonts/bricolage-grotesque.woff2')).toString('base64');
const css = readFileSync(join(root, 'src/client/styles.css'), 'utf8').replace('url("/fonts/bricolage-grotesque.woff2")', `url("data:font/woff2;base64,${font}")`);
const html = `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PitchReady demo (fictional)</title><meta name="theme-color" content="#faf7f2">
<style>${css}</style></head>
<body><div id="root"></div><script>${js}</script></body></html>
`;
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/pitchready-demo.html'), html);
console.log(`Standalone demo written: dist/pitchready-demo.html (${(html.length / 1024).toFixed(0)} KiB)`);
