# Run PitchReady on your Windows PC

This runs the real app on your computer: real sign-in, your Supabase database, live AI replies, voice and AI feedback. Only you can use it, at http://localhost:3000. Reps' phones can't reach it. That needs hosting, which comes later.

It takes about 15 minutes the first time.

---

## 0. One setting in Supabase (one time)

In the Supabase dashboard, open your project → **Project Settings → Data API → Exposed schemas**, add **`app_api`** to the list, and save. Don't add `app_private`. Without this, sign-in works but nothing loads.

## 1. Install Node.js (one time)

1. Go to **nodejs.org** and download the **LTS** version for Windows.
2. Run the installer and accept the defaults.
3. Restart your PC, or at least close any Command Prompt windows you already had open.

## 2. Put the PitchReady folder somewhere simple

Unzip the download to a plain folder such as **C:\PitchReady**.

Avoid Desktop, Documents or anything synced to OneDrive. The install creates thousands of small files, and OneDrive syncing them makes everything slow or broken.

Check: inside C:\PitchReady you should see `package.json`, this guide, and a file called `.env`.

## 3. Paste your three keys into `.env`

1. In the folder, right-click **`.env`** → **Open with** → **Notepad**.
2. Find the three lines marked **PASTE** and put each key straight after the `=`, with no spaces or quotes:
   - `SUPABASE_SECRET_KEY=` → Supabase dashboard → **Project Settings → API Keys → Secret keys** → reveal and copy (starts `sb_secret_`).
   - `ANTHROPIC_API_KEY=` → **console.anthropic.com → API Keys → Create Key** (starts `sk-ant-`).
   - `DEEPGRAM_API_KEY=` → **console.deepgram.com → API Keys → Create a New API Key**.
3. **File → Save**, then close Notepad.

Keep this file private. Don't email it, upload it, or paste it into a chat (including with Claude).

## 4. Open Command Prompt in the folder

In File Explorer, open C:\PitchReady, click the **address bar** at the top, type **`cmd`**, and press **Enter**. A black window opens, already in the right folder.

(Use Command Prompt, not PowerShell. PowerShell sometimes blocks `npm` with a "running scripts is disabled" error.)

## 5. Install, check, build and start

Type each line, press Enter, and wait for it to finish before the next:

```
npm ci
npm run setup:local
npm run build
npm start
```

- `npm ci` downloads what the app needs. It takes a few minutes the first time, and warnings are normal.
- `npm run setup:local` checks your keys without showing them. If it lists a problem, fix `.env`, save, and run it again.
- `npm run build` prepares the app. It takes a minute or two.
- `npm start` runs it. **Leave this window open** while you use the app. To stop it, press **Ctrl + C**.

## 6. Create your manager account

1. Open **Chrome or Edge** and go to **http://localhost:3000**.
2. Click **Sign in** (top right), then the **Create an account** link under the box. Use your own email and a password of at least 10 characters.
3. Open the confirmation email from Supabase and click the link. If it opens a page that won't load, that's fine. Go back to http://localhost:3000 and sign in.
4. **Tell Claude you've signed up and which email you used.** Claude will set up your agency and make you its manager. Until then your account isn't part of an agency, so the app won't show you anything useful yet. That's expected.

## 7. Try it

- **As manager:** check the **Rules & campaign** and **Scenarios** pages.
- **As a rep:** reps need their own account. Under **Team**, invite a second email address you own (a Gmail alias like `you+rep@gmail.com` works), copy the invite link, open it in a **private/InPrivate window**, and sign up with that address. Then start a practice and use the microphone. The browser will ask permission the first time.

---

## Starting it again another day

Open Command Prompt in C:\PitchReady (step 4) and run only:

```
npm start
```

Run `npm run build` again first only if you've received updated files.

## If something goes wrong

| What you see | What to do |
|---|---|
| `'npm' is not recognized` | Node.js isn't installed, or the window was open before you installed it. Install Node (step 1) and open a new Command Prompt. |
| "running scripts is disabled" | You're in PowerShell. Use Command Prompt instead (step 4). |
| Setup lists a key problem | Re-copy that key into `.env` with no spaces, save, and run `npm run setup:local` again. |
| "Port 3000 is in use" | The app is already running in another window. Use that one, or close it with Ctrl + C. |
| No confirmation email | Check spam. Supabase's built-in email only sends a few per hour, so wait a bit before trying again. |
| A practice or feedback gets stuck | Open a second Command Prompt in the folder and run `npm run maintenance`. |
| "Practice is paused: spend limit reached" | That's the built-in safety cap. Tell Claude and it can be raised. |
| Anything else | Copy the **last few lines** of the black window (never the `.env` file) and send them to Claude. |
