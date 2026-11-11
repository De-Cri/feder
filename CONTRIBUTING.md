# Contributing to Feder

The code lives in the `feder` repo. Installers are published in the public `feder-releases` repo.

The repos used to be called `cerchio` and `cerchio-releases`: GitHub redirects the old addresses, which is how apps installed with older versions still find their updates. **Never create a repo with one of the old names**, or the redirect stops working.

Everything in the repo is written in **English**: commits, branches, Pull Requests, issues, comments and docs. The app itself is in Italian and English.

## First run (Windows or Linux)

You only need **Node.js 22** and **git**. Rust isn't needed for development.

```bash
git clone https://github.com/De-Cri/feder.git
cd feder
npm install
npm run electron:dev
```

`electron:dev` opens the app in development mode: when you save a UI file (`src/`), it reloads by itself. F12 opens the developer tools.

> The development app uses **the same database as your friends** (Supabase, `cerchio.config.json`): everyone sees the messages you write. To try things out, use the `#random` channel.

Optional, Windows only: to try the Tauri version (the one Windows friends get) you need Rust and Visual Studio Build Tools. Then `npm run tauri dev`.

## How we work

1. Before starting: `git pull`.
2. Create a branch: `git checkout -b short-description`.
3. Make your changes and try them with `npm run electron:dev`.
4. Check that it compiles: `npm run check` (it must report 0 errors).
5. `git add -A && git commit -m "What you did"`, then `git push -u origin short-description`.
6. On GitHub open a **Pull Request** against `main`. Samuele approves it.

**Only Samuele makes releases** (`npm run release -- X.Y.Z`): every release reaches all friends right away as an update.
The build starts from the public `feder-releases` repo, where only he has write access: nobody can publish from the code repo, and the update signing keys aren't here. If you run `npm run release` without being him, the script stops immediately.

On every Pull Request GitHub checks by itself that the code compiles (the **Controlli** workflow, job `check`).

## Translations (Italian + English)

Every piece of text shown in the app exists in both languages:

- strings live in `src/locales/it.ts` and `src/locales/en.ts`, with the same keys;
- in code use `t('key')`, or `t('key', { name })` for placeholders like `{name}` (from `src/lib/i18n.svelte.ts`);
- `en.ts` is typed from `it.ts`: if a key is missing in either, `npm run check` fails;
- release notes (`src/lib/releases.ts`) have an `it` and an `en` block for every version.

The language follows the system and can be changed in Settings → Appearance.

## Where things are

| Folder / file | What it contains |
|---|---|
| `src/components/` | user interface (Svelte 5) |
| `src/lib/state.svelte.ts` | server data, real-time messages, who is online |
| `src/lib/voice.svelte.ts` | calls: voice, webcam, screen (peer-to-peer WebRTC) |
| `src/lib/audio.ts` | microphone: noise suppression, gain |
| `src/lib/dm.svelte.ts`, `src/lib/dmcrypto.ts` | private messages and their end-to-end encryption |
| `src/lib/sounds.ts` | interface sounds |
| `supabase/migrations/` | database (tables and permissions). **Don't change without discussing it first**: it's applied by hand on Supabase |
| `src-tauri/` | Windows app (Rust) |
| `electron/` | Linux app |

## Tests

The first time: `npx playwright install chromium` (downloads the browser used by the tests).

```bash
npm run test:voice      # all simulated calls in Chromium: voice, presence, screen, limits, memory
npm run test:memory     # only the memory-leak hunt (10 rounds; `-- 30` for 30 rounds)
```

The test server starts by itself. `test:memory` turns screen and webcam on and off on both sides
and checks that nothing is left behind after each round (WebRTC channels, AudioContext, `<video>`/`<audio>`,
nodes, listeners, JS heap after garbage collection). If something grows, it fails and says what.
Run it before a PR that touches `voice.svelte.ts`, `audio.ts` or the voice components.

Database tests (RLS, private messages, realtime) run on a plain Postgres with the stubs in
`supabase/tests/00_stubs.sql`: see the *Tests* section of the README.

## How much RAM the app uses

With Feder open (the installed app, the code doesn't need to be running):

```bash
npm run mem                 # one line every 2 s; Ctrl+C for the summary
npm run mem -- --for 600    # 10 minutes, then it stops by itself
npm run mem -- --once       # a single measurement
```

It adds up all of the app's processes and splits them by type (page, GPU, audio, network, webcam/screen…).
On Windows the number matches the *Memory* column of Task Manager; on Linux it's private memory
(USS): summing `top`/`htop` gives more because they count shared parts several times.
It saves a CSV (`mem-….csv`) to compare two runs. To look for a leak: repeat the same action
(e.g. start/stop the screen 10 times) and check whether the total keeps rising or levels off.

## How a change gets into main

`main` is protected (rule in `.github/ruleset-main.json`, approver in `.github/CODEOWNERS`):

- nobody can push directly to `main`, force-push it or delete it;
- you open a Pull Request: it needs green checks (`check`) and Samuele's approval;
- if more commits arrive after the approval, a new approval is needed.

Only the repo administrator (Samuele) can push directly.

## License of contributions

Feder is released under the GPL-3.0-or-later license (see `LICENSE`). By opening a Pull Request you agree that your contribution is released under the same license.

## Don't

- Don't commit `.cerchio-secrets/` (it's already in `.gitignore`): it holds the keys that sign updates.
- Don't change `identifier` in `src-tauri/tauri.conf.json`, the repo names or the realtime channel names (`cerchio:lobby`, `cerchio:voice:*`): it would break updates and calls between different versions.
