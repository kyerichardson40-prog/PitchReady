# PitchReady on the App Store and Google Play

Status (6 Nov 2026): the iOS and Android app projects exist (`ios/`, `android/`, Capacitor 8.6). They have **not** been compiled. iOS needs macOS with Xcode, and the workspace this was built in can't download the Android SDK. Nothing has been submitted to either store. See DECISIONS.md D27.

## What the app is

A native shell (Capacitor) around the PitchReady web app:

| Build | How | Use |
|---|---|---|
| **Bundled demo** (default) | `npm run app:sync` | Offline, fictional demo with the scripted resident and rule-based feedback. For trying the app on your own phone and for internal testers. **Not for store release**: both stores reject apps that are only a demo. |
| **Pilot app** | `PITCHREADY_APP_URL=https://your-pilot-domain npm run app:sync` | Opens the hosted connected app: real sign-in, Supabase, AI feedback, spoken turns. **This is the build to submit**, so the pilot must be deployed first (README → Connected mode setup). |

Live AI through claude.ai does not work inside the app; there is no claude.ai viewer there. The bundled demo says so in its banner.

## Before either store (decisions only you can make)

1. **Name and identity.** "PitchReady" is a working name not cleared for commercial use. The app ID (for example `uk.co.yourcompany.pitchready`) can never change after the first upload. Set both, then sync:
   `node scripts/set-app-identity.ts --id uk.co.yourcompany.pitchready --name "PitchReady"` then `npm run app:sync`.
2. **Hosted pilot** at an https domain (the pilot build loads it).
3. **Privacy policy URL.** Both stores require one. `DATA_HANDLING.md` lists what is stored, but it is not a legal policy.
4. **Account deletion (Apple guideline 5.1.1(v)).** Apps that let people create accounts must let them *start* deleting the account inside the app. PitchReady has "Request deletion of my account" in Settings, and maintenance carries out deletion requests, but the Supabase Auth user is still deleted by hand (D13). Automate that before submitting.
5. **Reviewer access.** Both stores need a working sign-in for their reviewers. Create a test agency with `npm run bootstrap:agency` and fictional data, and give the reviewers that login.
6. **Accounts:**
   - Apple Developer Program: $99 a year, charged in local currency.
   - Google Play Console: $25 one-off. A *personal* account created after 13 Nov 2023 must run a **closed test with at least 12 testers opted in for 14 days in a row** before it can publish. An *organisation* account (needs a D-U-N-S number) is exempt.

## iPhone (App Store)

Needs a Mac with Xcode (or a cloud Mac build service).

```bash
npm ci
PITCHREADY_APP_URL=https://your-pilot-domain npm run app:sync   # omit the variable for the demo build
npx cap open ios                                                # opens Xcode
```

In Xcode:
1. App target → Signing & Capabilities: choose your team. Xcode creates the certificates.
2. Run on your iPhone to check it, including the microphone prompt (the text is in `Info.plist`).
3. Product → Archive → Distribute App → App Store Connect.
4. In App Store Connect: TestFlight for testers; then the listing (screenshots, privacy details, privacy policy URL, reviewer login) and Submit for Review.

## Android (Google Play)

**Option A: GitHub (no local setup).** Push the repo to GitHub, then Actions → **android** → Run workflow. It produces:
- `app-debug.apk`: install it on an Android phone to test.
- `app-release.aab`: the Play Store upload.

Settings → Secrets and variables → Actions:
- Variable `PITCHREADY_APP_URL`: leave empty for the demo; set it to the https pilot URL for the store build.
- Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`: the upload key that signs the bundle. Create the key once (keep the file and passwords safe):
  ```bash
  keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
  base64 -w0 upload.jks   # paste the output into ANDROID_KEYSTORE_BASE64
  ```
  Use Play App Signing in Play Console, so this key is only the *upload* key.

**Option B: Android Studio.** `npm run app:sync`, then `npx cap open android`, then Build → Generate Signed App Bundle.

Then in Play Console: create the app, then Testing → Closed testing (see the 12-tester rule above), then the store listing, Data safety form, content rating and privacy policy URL, then production.

## Changing the icon or splash

Edit `assets/icon.svg` (the source), export it to `assets/icon-only.png`, `icon-foreground.png`, `icon-background.png` and `splash.png`, then run:
`npx @capacitor/assets@4.0.0 generate --ios --android --iconBackgroundColor '#0f766e' --splashBackgroundColor '#faf7f2'`.
It's run on demand rather than installed, because it pulls in a dependency with a moderate advisory (uuid, via the xcode project library). It only runs on your own files and is never part of the app.

## Updating the app

- **Pilot build:** most changes are web changes. Deploy the pilot and the app shows them on next launch, with no store update. Rebuild and resubmit only for native changes: name, icon, permissions, Capacitor upgrades.
- **Bundled demo build:** rebuild (`npm run app:sync`) and reinstall.

## What has been checked

- Native projects generated by Capacitor CLI 8.6 (`npx cap add ios|android`, `npx cap sync`).
- `Info.plist`, `AndroidManifest.xml` and the backup rules parse.
- Microphone purpose text and Android audio permissions added.
- No Android cloud backup or device transfer of app data (sign-in cookies).
- Icons and splash screens generated for every required size.
- The bundled demo passes the standalone-demo browser tests: Back navigation steps through screens, and the in-app note appears when running inside the app shell.

**Not checked:** compiling either app; running it on a device or simulator; the GitHub Android workflow; store review.
