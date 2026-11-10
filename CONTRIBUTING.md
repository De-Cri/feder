# Sviluppare Feder insieme

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

La prima volta: `npx playwright install chromium` (scarica il browser per i test).

```bash
npm run test:voice      # tutte le chiamate simulate in Chromium: voce, presenza, schermo, limiti, memoria
npm run test:memory     # solo la caccia alle perdite di memoria (10 giri; `-- 30` per 30 giri)
```

Il server di test parte da solo. `test:memory` accende e spegne schermo e webcam da entrambe le parti
e controlla che dopo ogni giro non resti niente in più (canali WebRTC, AudioContext, `<video>`/`<audio>`,
nodi, listener, heap JS dopo il garbage collector). Se qualcosa cresce, fallisce e dice cosa.
Lancialo prima di una PR che tocca `voice.svelte.ts`, `audio.ts` o i componenti della vocale.

## Quanta RAM usa l'app

Con Feder aperto (l'app installata, non serve il codice in esecuzione):

```bash
npm run mem                 # una riga ogni 2 s; Ctrl+C per il riepilogo
npm run mem -- --for 600    # 10 minuti, poi si ferma da solo
npm run mem -- --once       # una sola misura
```

Somma tutti i processi dell'app e li divide per tipo (pagina, GPU, audio, rete, webcam/schermo…).
Su Windows il numero è lo stesso della colonna *Memoria* del Task Manager; su Linux è la memoria privata
(USS): `top`/`htop` sommati danno di più perché contano più volte le parti condivise.
Salva un CSV (`mem-….csv`) per confrontare due prove. Per cercare una perdita: ripeti la stessa azione
(es. avvia/ferma lo schermo 10 volte) e guarda se il totale continua a salire o si stabilizza.

## Da non fare

- Non committare `.cerchio-secrets/` (è già in `.gitignore`): contiene le chiavi per firmare gli aggiornamenti.
- Non cambiare `identifier` in `src-tauri/tauri.conf.json`, i nomi dei repo o i nomi dei canali realtime (`cerchio:lobby`, `cerchio:voice:*`): romperebbero aggiornamenti e chiamate tra versioni diverse.
