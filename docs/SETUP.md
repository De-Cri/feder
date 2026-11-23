# Feder: setup, releases and internals

Everything that used to be in the README, for whoever builds or hosts Feder.

## Building the installers (wizard)

You don't need to install anything by hand: the wizard checks what is missing, **asks for permission** and installs it.

- **Windows:** double-click **`Setup.cmd`**
- **Linux:** `./setup.sh`

If Node.js is missing it installs it (winget on Windows; dnf/apt/pacman on Linux), then lets you choose how to build the installers:

| Mode | What it installs on your PC | What you get |
|---|---|---|
| **In the cloud** (recommended) | git and GitHub CLI (plus the GitHub login in the browser) | GitHub Actions builds the `.exe` for Windows and `.AppImage`/`.rpm`/`.deb` for Linux, creates the link to send to your friends and the automatic updates. At the end it downloads the installers into the `installer/` folder. |
| **On this PC** | Windows: Rust, Visual Studio Build Tools (C++, ~3–6 GB) and WebView2 if missing. Fedora: `rpm-build`. | The installer for the system you are using, in the `installer/` folder. Useful to try it right away, but without a shared link or automatic updates (unless you already did the cloud mode). |

Supabase is already configured (`cerchio.config.json`). On the first run, the cloud mode creates **two repos**:

- **`feder`**: the code and the GitHub Actions that check it.
- **`feder-releases`**, public: only the installers, no code. Friends download the app from here and the app downloads its updates from here, without logging in.

The private keys live in `.cerchio-secrets/`, a folder ignored by git: **back it up**.

> Actions in private repos get 2000 free minutes a month, and Windows minutes count double. A release costs about 40 minutes, so about 50 releases a month. Public repos have no limit.

## For your friends

1. They open `https://github.com/<your-user>/feder-releases/releases/latest`
2. Windows: they download `Feder_x.y.z_x64-setup.exe`. Linux: `.rpm` (Fedora), `.deb` (Ubuntu/Debian) or `.AppImage` (any distro).
3. They sign up and press Join. While sign-ups are closed (Settings → Server → Open sign-ups) only the founders' password lets people in.

**Windows SmartScreen**: the installer isn't signed (a certificate costs money), so on first launch "Windows protected your PC" shows up. Just click *More info → Run anyway*. Later updates are still verified with the updater signing key.

## Publishing a new version

```bash
npm run release -- 0.4.0
```

The script bumps the version, creates the tag, pushes and starts the build in the public releases repo. After about 10 minutes the installed apps update themselves.

**Only the owner can publish.** The build workflow and the signing keys live in the public `feder-releases` repo, where only you can write. Collaborators on the code repo can push and open Pull Requests, but they can't start a release or read the keys. To set it up, once: `node scripts/secure-releases.mjs`, on the PC that has `.cerchio-secrets/`.

## Known limitations

| What | Details |
|---|---|
| **Linux = Electron** | On Linux the app is Electron, not Tauri, because distros' WebKitGTK often lacks WebRTC (checked on Ubuntu 24.04, WebKitGTK 2.52). It weighs ~90–125 MB instead of 4 MB, but voice, video and screen always work. |
| **AppImage on Ubuntu 24.04** | AppArmor blocks Electron's sandbox inside AppImages. On Ubuntu use the `.deb`, or start the AppImage with `--no-sandbox`. No problem on Fedora. |
| **Screen audio** | Only on Windows. On Linux Chromium doesn't support capturing system audio. |
| **P2P video with 5 people** | Everyone sends their video to the other 4. The webcam is capped at ~0.9 Mbps per peer and the screen at ~2.5 Mbps. Fine on fiber; on 4G or ADSL better stick to audio. |
| **Hard NATs** | Without TURN, some networks (mobile CGNAT, corporate networks) can't connect peer-to-peer. See *Optional TURN* below. |
| **Supabase pause** | The free tier pauses the project after ~7 days of inactivity. The `keepalive.yml` workflow pings it every day and once a month makes an empty commit, so GitHub doesn't disable the workflow. |
| **Forgotten password** | There is no email recovery, because email confirmation is disabled. The admin can reset it from the Supabase dashboard (Authentication → Users). |
| **Kick** | A kicked user loses database access immediately. Their app closes the call by itself, and the others immediately close the P2P connection with them. |

## Optional TURN (Cloudflare, free)

Only needed if two people can't hear each other (stuck on "connecting…").

1. Create a TURN key on Cloudflare (Dashboard → Realtime → TURN). The free tier is more than enough.
2. Deploy the function:
   ```bash
   npx supabase@latest login
   npx supabase@latest functions deploy turn --project-ref <ref>
   npx supabase@latest secrets set CF_TURN_KEY_ID=... CF_TURN_API_TOKEN=... --project-ref <ref>
   ```
3. Set `"turn": true` in `cerchio.config.json` and publish a new version.

## Development

```bash
npm run tauri dev        # app in development (Windows / Tauri)
npm run electron:dev     # app in development (Linux / Electron)
npm run electron:build   # Linux packages in release/
npm run check            # type-check
```

### Layout

```
supabase/migrations/                schema, RLS, admin functions, storage, realtime, private messages
supabase/functions/turn/            TURN credentials (optional)
src/lib/state.svelte.ts             app state, realtime, presence
src/lib/voice.svelte.ts             WebRTC mesh (perfect negotiation)
src/lib/audio.ts                    microphone chain: RNNoise, noise gate, gain
src/lib/dm.svelte.ts, dmcrypto.ts   private messages and their end-to-end encryption
src/lib/platform.ts                 Tauri / Electron abstraction
electron/                           Linux shell (Electron)
src/components/                     UI (Svelte 5)
src-tauri/                          Windows shell (Tauri / Rust)
scripts/setup.mjs                   automatic setup
.github/workflows/                  checks + keep-alive
```

### Security

- Open sign-ups (`join_open()`): off by default, at most 100 members and 10 public joins an hour. Public members see `#generale`, `#random` and the `Public Channel` voice room (max 8 people in the app, 10 on the server), plus the private chats they're invited to.
- The founders' password is stored as a bcrypt hash in a non-exposed `private` schema, and `join_server()` checks it inside the DB, with a limit of 5 attempts every 15 minutes.
- Every table has RLS: non-members only see their own profile.
- Realtime channels (presence and WebRTC signaling) are **private**, with policies on `realtime.messages`: only members can join, and only the channels the app uses.
- Attachments live in a private bucket, are read through signed URLs, and everyone can upload only to their own folder.
- Private messages are end-to-end encrypted in the app (ECDH P-256 + AES-GCM, WebCrypto only): the server sees who writes to whom and when, never the text. The private key is on the server only encrypted with a random recovery code that only the user knows. Details in `src/lib/dmcrypto.ts` and `supabase/migrations/0004_dm.sql`.
- Known open issues are tracked with the [`security`](https://github.com/De-Cri/feder/issues?q=label%3Asecurity) label.

### Tests

```bash
# SQL + RLS on a local Postgres (stubs of the Supabase environment)
psql -d test -f supabase/tests/00_stubs.sql $(printf -- '-f %s ' supabase/migrations/*.sql) \
  -f supabase/tests/01_test.sql -f supabase/tests/02_dm_test.sql -f supabase/tests/03_realtime_test.sql

# 3-peer WebRTC mesh in Chromium (simulated signaling): connection, audio,
# RNNoise, gain, microphone rebuild during a call, webcam, leave/rejoin
npm run test:voice

# UI with fake data
npx vite --config tests/ui/vite.config.ts
```

