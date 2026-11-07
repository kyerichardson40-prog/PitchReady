/**
 * Sets the store identity (bundle/application ID and display name) in app-identity.json AND in the
 * generated native projects, which `cap sync` never updates. Usage:
 *   node scripts/set-app-identity.ts --id uk.co.example.pitchready --name "PitchReady"
 * The Android `namespace` (Java package of MainActivity) is left as generated: it is internal and
 * does not need to match the store ID. DECISIONS.md D27.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const identity = JSON.parse(readFileSync('app-identity.json', 'utf8')) as { appId: string; appName: string };
const id = arg('--id') ?? identity.appId;
const name = arg('--name') ?? identity.appName;
if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(id)) { console.error(`Invalid app ID "${id}": use reverse-DNS like uk.co.yourcompany.pitchready`); process.exit(2); }
if (!name.trim() || name.length > 30) { console.error('App name must be 1–30 characters.'); process.exit(2); }
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'");

const edit = (path: string, fn: (s: string) => string) => {
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (after === before) console.log(`unchanged  ${path}`); else { writeFileSync(path, after); console.log(`updated    ${path}`); }
};
edit('app-identity.json', (s) => { const j = JSON.parse(s); j.appId = id; j.appName = name; return JSON.stringify(j, null, 2) + '\n'; });
edit('android/app/build.gradle', (s) => s.replace(/applicationId "[^"]*"/, `applicationId "${id}"`));
edit('android/app/src/main/res/values/strings.xml', (s) => s
  .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${xml(name)}$2`)
  .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${xml(name)}$2`)
  .replace(/(<string name="package_name">)[^<]*(<\/string>)/, `$1${id}$2`)
  .replace(/(<string name="custom_url_scheme">)[^<]*(<\/string>)/, `$1${id}$2`));
edit('ios/App/App.xcodeproj/project.pbxproj', (s) => s.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${id};`));
edit('ios/App/App/Info.plist', (s) => s.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${xml(name).replace(/\\'/g, "'")}$2`));
console.log(`App identity: ${id} · "${name}". Run npm run app:sync next.`);
