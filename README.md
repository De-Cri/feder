# Cerchio

Un Discord privato per pochi amici: **un solo server**, **2 canali chat**, **2 canali voce/video**, un solo admin.
App desktop per **Windows** (Tauri 2, circa 4 MB) e **Linux** (Electron, perché la webview di sistema su Linux spesso non ha WebRTC). Il backend è Supabase free, la voce viaggia P2P (WebRTC). **Costo: 0 €.**

## Cosa fa

- Ci si registra con email e password, poi si inserisce la **password del server** per entrare.
- `#generale` e `#random`: messaggi in tempo reale, immagini, video e file fino a 50 MB, link cliccabili, notifiche desktop.
- `Lounge` e `Gaming`: voce, webcam e condivisione schermo, peer-to-peer.
- **Audio**:
  - soppressione del rumore a scelta tra disattivata, standard del browser o **AI (RNNoise)**, che toglie tastiera, ventole e rumori di fondo;
  - cancellazione dell'eco e regolazione automatica del guadagno;
  - **soglia di attivazione** (noise gate);
  - **volume del microfono** fino al 200% e **volume di uscita**;
  - **volume per singolo amico**: tasto destro sul suo riquadro;
  - scelta dei dispositivi di input e output, e test del microfono con meter e ascolto di ritorno.
- **Condivisione schermo**:
  - qualità *Fluida* (720p 60fps) o *Nitida* (1080p 30fps);
  - audio del sistema su Windows;
  - selettore di schermo/finestra con anteprime (su Wayland si usa quello di sistema);
  - chi condivide viene messo in primo piano in automatico.
- Si vede chi è online e chi è in quale canale vocale, con indicatore di chi sta parlando.
- **Admin** (solo tu): cancella qualsiasi messaggio, espelle, banna/sbanna, muta in vocale, cambia la password del server.
- Aggiornamenti automatici: pubblichi una versione e l'app si aggiorna da sola.
- Interfaccia minimal stile macOS/GNOME che segue il tema chiaro/scuro di sistema.

## Creare gli installer (wizard)

Non serve installare niente a mano: il wizard controlla cosa manca, **ti chiede il permesso** e lo installa lui.

- **Windows:** doppio clic su **`Setup.cmd`**
- **Linux:** `./setup.sh`

Se manca Node.js lo installa (winget su Windows; dnf/apt/pacman su Linux), poi ti fa scegliere come creare gli installer:

| Modalità | Cosa installa sul PC | Cosa ottieni |
|---|---|---|
| **Nel cloud** (consigliata) | git e GitHub CLI (e il login a GitHub dal browser) | GitHub Actions compila `.exe` per Windows e `.AppImage`/`.rpm`/`.deb` per Linux, crea il link da mandare agli amici e gli aggiornamenti automatici. Alla fine scarica gli installer nella cartella `installer/`. |
| **Su questo PC** | Windows: Rust, Visual Studio Build Tools (C++, ~3–6 GB) e WebView2 se manca. Fedora: `rpm-build`. | L'installer per il sistema che stai usando, nella cartella `installer/`. Utile per provare subito, ma senza link condiviso né aggiornamenti automatici (a meno che tu non abbia già fatto la modalità cloud). |

Supabase è già configurato (`cerchio.config.json`). La modalità cloud, al primo giro, crea **due repo**:

- **`cerchio`**, privato: contiene il codice e le GitHub Actions che compilano.
- **`cerchio-releases`**, pubblico: contiene solo gli installer, niente codice. Da qui gli amici scaricano l'app e l'app scarica gli aggiornamenti, senza login.

Le chiavi private stanno in `.cerchio-secrets/`, una cartella ignorata da git: **fanne un backup**.

> Le Actions nei repo privati hanno 2000 minuti gratis al mese, e quelli su Windows contano doppio. Una release costa circa 40 minuti, quindi sono circa 50 release al mese.

## Per i tuoi amici

1. Aprono `https://github.com/<tuo-user>/cerchio-releases/releases/latest`
2. Windows: scaricano `Cerchio_x.y.z_x64-setup.exe`. Linux: `.rpm` (Fedora), `.deb` (Ubuntu/Debian) o `.AppImage` (qualsiasi distro).
3. Si registrano e inseriscono la password del server.

**Windows SmartScreen**: l'installer non è firmato (un certificato costa), quindi al primo avvio compare "Windows ha protetto il PC". Basta cliccare *Ulteriori informazioni → Esegui comunque*. Gli aggiornamenti successivi sono comunque verificati con la chiave di firma dell'updater.

## Pubblicare una nuova versione

```bash
npm run release -- 0.2.0
```

Aggiorna la versione, crea il tag e fa il push. GitHub Actions compila gli installer e le app installate si aggiornano da sole al prossimo avvio.

## Limiti da conoscere

| Cosa | Dettaglio |
|---|---|
| **Linux = Electron** | Su Linux l'app è Electron e non Tauri, perché WebKitGTK delle distro spesso non ha WebRTC (verificato su Ubuntu 24.04, WebKitGTK 2.52). Pesa ~90–125 MB invece di 4 MB, ma voce, video e schermo funzionano sempre. |
| **AppImage su Ubuntu 24.04** | AppArmor blocca la sandbox di Electron negli AppImage. Su Ubuntu usa il `.deb`, oppure avvia l'AppImage con `--no-sandbox`. Su Fedora nessun problema. |
| **Audio dello schermo** | Si può condividere solo su Windows. Su Linux Chromium non supporta la cattura dell'audio di sistema. |
| **Video P2P a 5** | Ognuno invia il proprio video agli altri 4. La webcam è limitata a ~0,9 Mbps per peer e lo schermo a ~2,5 Mbps. Con la fibra non ci sono problemi, con 4G o ADSL meglio solo audio. |
| **NAT difficili** | Senza TURN, alcune reti (CGNAT mobile, reti aziendali) non riescono a collegarsi in P2P. Vedi *TURN opzionale* più sotto. |
| **Pausa Supabase** | Il piano free mette in pausa il progetto dopo ~7 giorni di inattività. Il workflow `keepalive.yml` lo pinga ogni giorno e una volta al mese fa un commit vuoto, così GitHub non disattiva il workflow. |
| **Password dimenticata** | Non c'è recupero via email, perché la conferma email è disattivata. L'admin può resettarla dalla dashboard di Supabase (Authentication → Users). |
| **Kick** | L'espulso perde subito l'accesso al database. La sua app chiude da sola la chiamata, e gli altri chiudono subito la connessione P2P con lui. |

## TURN opzionale (Cloudflare, gratis)

Serve solo se due persone non riescono a sentirsi (resta su "connessione…").

1. Crea una TURN key su Cloudflare (Dashboard → Realtime → TURN). Il free tier basta e avanza.
2. Fai il deploy della funzione:
   ```bash
   npx supabase@latest login
   npx supabase@latest functions deploy turn --project-ref <ref>
   npx supabase@latest secrets set CF_TURN_KEY_ID=... CF_TURN_API_TOKEN=... --project-ref <ref>
   ```
3. In `cerchio.config.json` metti `"turn": true` e pubblica una nuova versione.

## Sviluppo

```bash
npm run tauri dev        # app in sviluppo (Windows / Tauri)
npm run electron:dev     # app in sviluppo (Linux / Electron)
npm run electron:build   # pacchetti Linux in release/
npm run check            # type-check
```

### Struttura

```
supabase/migrations/0001_init.sql   schema, RLS, funzioni admin, storage, realtime
supabase/functions/turn/            credenziali TURN (opzionale)
src/lib/state.svelte.ts             stato app, realtime, presence
src/lib/voice.svelte.ts             mesh WebRTC (perfect negotiation)
src/lib/audio.ts                    catena microfono: RNNoise, noise gate, guadagno
src/lib/platform.ts                 astrazione Tauri / Electron
electron/                           shell Linux (Electron)
src/components/                     UI (Svelte 5)
src-tauri/                          shell Windows (Tauri / Rust)
scripts/setup.mjs                   setup automatico
.github/workflows/                  release + keep-alive
```

### Sicurezza

- La password del server è salvata come hash bcrypt in uno schema `private` non esposto, e la verifica `join_server()` gira nel DB, con un limite di 5 tentativi ogni 15 minuti.
- Tutte le tabelle hanno RLS: chi non è membro vede solo il proprio profilo.
- I canali Realtime (presenza e signaling WebRTC) sono **privati**, con policy su `realtime.messages`: solo i membri possono iscriversi.
- Gli allegati stanno in un bucket privato, si leggono con URL firmati e ognuno può caricare solo nella propria cartella.

### Test

```bash
# SQL + RLS su Postgres locale (stub dell'ambiente Supabase)
psql -d test -f supabase/tests/00_stubs.sql -f supabase/migrations/0001_init.sql -f supabase/tests/01_test.sql

# Mesh WebRTC a 3 peer in Chromium (signaling simulato): connessione, audio,
# RNNoise, gain, rebuild del microfono in chiamata, webcam, uscita/rientro
npx vite --config tests/voice/vite.config.ts &  node tests/voice/run.cjs

# UI con dati finti
npx vite --config tests/ui/vite.config.ts
```
