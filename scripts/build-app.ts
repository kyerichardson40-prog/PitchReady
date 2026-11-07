/**
 * Prepares the native app's bundled web content (dist/app-www) from the standalone demo build.
 * Then `npx cap sync` copies it into the iOS and Android projects. DECISIONS.md D27.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

execFileSync(process.execPath, ['scripts/build-static-demo.ts'], { stdio: 'inherit' });
rmSync('dist/app-www', { recursive: true, force: true });
mkdirSync('dist/app-www', { recursive: true });
copyFileSync('dist/pitchready-demo.html', 'dist/app-www/index.html');
console.log('App web content ready: dist/app-www (bundled demo). Next: npx cap sync');
