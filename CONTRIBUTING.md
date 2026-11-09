# Sviluppare Paper insieme

Il codice sta nel repo **privato** `cerchio` (il nome del repo è rimasto quello vecchio: cambiarlo romperebbe gli aggiornamenti automatici). Gli installer vengono pubblicati nel repo pubblico `cerchio-releases`.

## Primo avvio (Windows o Linux)

Serve solo **Node.js 22** e **git**. Rust non serve per sviluppare.

```bash
git clone https://github.com/De-Cri/cerchio.git
cd cerchio
npm install
npm run electron:dev
```

`electron:dev` apre l'app in sviluppo: quando salvi un file dell'interfaccia (`src/`), si aggiorna da sola. Per F12 si aprono gli strumenti per sviluppatori.

> L'app di sviluppo usa **lo stesso database dei tuoi amici** (Supabase, `cerchio.config.json`): i messaggi che scrivi li vedono tutti. Per provare, usa il canale `#random`.

Facoltativo, solo su Windows: per provare la versione Tauri (quella che ricevono gli amici Windows) servono Rust e Visual Studio Build Tools. Poi `npm run tauri dev`.

## Come lavoriamo

1. Prima di iniziare: `git pull`.
2. Crea un ramo: `git checkout -b nome-della-modifica`.
3. Fai le modifiche e prova con `npm run electron:dev`.
4. Controlla che compili: `npm run check` (deve dire 0 errori).
5. `git add -A && git commit -m "cosa hai fatto"` e poi `git push -u origin nome-della-modifica`.
6. Su GitHub apri una **Pull Request** verso `main`. La approva Samuele.

**Le release le fa solo Samuele** (`npm run release -- X.Y.Z`): ogni release arriva subito a tutti gli amici come aggiornamento.
La build parte dal repo pubblico `cerchio-releases`, dove solo lui ha accesso in scrittura: dal repo del codice nessuno può pubblicare, e le chiavi per firmare gli aggiornamenti non sono qui. Se lanci `npm run release` senza essere lui, lo script si ferma subito.

Ad ogni Pull Request GitHub controlla da solo che il codice compili (workflow **Controlli**).

## Dove sta cosa

| Cartella / file | Cosa contiene |
|---|---|
| `src/components/` | interfaccia (Svelte 5) |
| `src/lib/state.svelte.ts` | dati del server, messaggi in tempo reale, chi è online |
| `src/lib/voice.svelte.ts` | chiamate: voce, webcam, schermo (WebRTC peer-to-peer) |
| `src/lib/audio.ts` | microfono: soppressione rumore, guadagno |
| `src/lib/sounds.ts` | suoni dell'interfaccia |
| `supabase/migrations/` | database (tabelle e permessi). **Non modificare senza parlarne**: si applica a mano su Supabase |
| `src-tauri/` | app Windows (Rust) |
| `electron/` | app Linux |

## Test

```bash
# chiamate simulate in Chromium (3 utenti), presenza, schermo
npx vite --config tests/voice/vite.config.ts &
node tests/voice/run.cjs && node tests/voice/presence.cjs && node tests/voice/screen.cjs
```

## Da non fare

- Non committare `.cerchio-secrets/` (è già in `.gitignore`): contiene le chiavi per firmare gli aggiornamenti.
- Non cambiare `identifier` in `src-tauri/tauri.conf.json`, i nomi dei repo o i nomi dei canali realtime (`cerchio:lobby`, `cerchio:voice:*`): romperebbero aggiornamenti e chiamate tra versioni diverse.
