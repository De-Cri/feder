// Release notes shown in the "novità" channel (the last 3 versions, newest first).
// On every release: add the new one at the top (in Italian and English) and remove the last one.

export type Notes = {
  added: string[]; // what's new, briefly
  test: string[]; // how to try it in the app
};

export type Release = {
  version: string;
  date: string; // YYYY-MM-DD, shown in the interface language
  it: Notes;
  en: Notes;
};

export const RELEASES: Release[] = [
  {
    version: '0.5.1',
    date: '2026-11-21',
    it: {
      added: [
        'Se la connessione salta per qualche secondo durante una chiamata, vedi "riconnessione…" invece dell\'errore rosso, e niente suono di ingresso ripetuto.',
        'Le webcam si dispongono in base alla forma della finestra: in una finestra stretta e alta vanno in colonna.',
        'Chi parla non si sente più nella stream di chi condivide lo schermo con l\'audio.',
        'Il tasto Esci è in fondo alla pagina Account delle impostazioni.',
      ],
      test: [
        'In chiamata, stacca il Wi-Fi per 5 secondi e riattaccalo: niente errore rosso, la chiamata riprende.',
        'Con 2–3 webcam accese, stringi la finestra in verticale.',
        'Condividi lo schermo con l\'audio mentre un amico parla: non deve sentirsi nella tua stream.',
      ],
    },
    en: {
      added: [
        'If the connection drops for a few seconds during a call you see "reconnecting…" instead of a red error, and no repeated join sound.',
        'Webcams are laid out for the window\'s shape: in a tall, narrow window they stack in a column.',
        'Whoever talks no longer hears themselves in the stream of someone sharing their screen with audio.',
        'Log out is at the bottom of the Account page in settings.',
      ],
      test: [
        'In a call, turn Wi-Fi off for 5 seconds and back on: no red error, the call resumes.',
        'With 2–3 webcams on, make the window tall and narrow.',
        'Share your screen with audio while a friend talks: they shouldn\'t hear themselves in your stream.',
      ],
    },
  },
  {
    version: '0.5.0',
    date: '2026-11-12',
    it: {
      added: [
        'Feder è in italiano e in inglese: segue la lingua del sistema e si cambia in Impostazioni → Aspetto → Lingua.',
        'Chiamate più sicure: i dati per collegarsi passano dal server e arrivano solo a chi è nella chiamata. Nessuno può spacciarsi per un altro né vedere da fuori gli indirizzi IP.',
        'I poke passano dal server: il mittente è verificato e c\'è un limite contro lo spam.',
        'Feder è open source (GPL-3.0): il codice è su github.com/De-Cri/feder.',
        'Su Linux il processo si chiama feder.',
        'Importante: chi è ancora sulla 0.4.7 non può più fare chiamate né mandare poke finché non aggiorna.',
      ],
      test: [
        'Impostazioni → Aspetto → Lingua: passa a English e torna a Italiano, senza riavviare.',
        'Entra in chiamata con un amico che ha già la 0.5.0: voce, webcam e schermo come prima.',
        'Fai un poke a chi ha l\'audio disattivato: deve arrivargli con il tuo nome.',
      ],
    },
    en: {
      added: [
        'Feder speaks Italian and English: it follows the system language and can be changed in Settings → Appearance → Language.',
        'Safer calls: connection data goes through the server and reaches only the people in the call. Nobody can pose as someone else or see IP addresses from outside.',
        'Pokes go through the server: the sender is verified and there\'s an anti-spam limit.',
        'Feder is open source (GPL-3.0): the code is on github.com/De-Cri/feder.',
        'On Linux the process is now called feder.',
        'Important: anyone still on 0.4.7 can\'t make calls or send pokes until they update.',
      ],
      test: [
        'Settings → Appearance → Language: switch to Italiano and back to English, without restarting.',
        'Join a call with a friend who already has 0.5.0: voice, webcam and screen work as before.',
        'Poke someone who has their audio off: it should reach them with your name.',
      ],
    },
  },
  {
    version: '0.4.7',
    date: '2026-11-11',
    it: {
      added: [
        'Messaggi privati: "Messaggi" in basso a sinistra apre una schermata a parte, con le tue chat e "Nuova chat" per cercare un membro.',
        'I messaggi privati sono cifrati end-to-end: nemmeno il server li può leggere. All\'attivazione ricevi un codice di recupero da conservare, serve solo su un altro dispositivo.',
        'I messaggi privati spariscono dopo 30 giorni, tranne quelli a cui metti la stellina.',
        'Lo schermo condiviso non va più in primo piano da solo: clicca per guardarlo, doppio click per ingrandirlo. Chi non guarda non lo scarica.',
        'Microfono e cuffie sempre visibili in basso a sinistra: puoi mutarti prima di entrare in chiamata.',
        'Tasto destro sul microfono: volume di ingresso con il livello in tempo reale e volume di uscita.',
        'Cursori del volume ridisegnati, senza il riquadro bianco sulla percentuale.',
      ],
      test: [
        'Messaggi → Attiva, salva il codice e scrivi a un amico che li ha attivati.',
        'Mutati prima di entrare in un canale vocale: devi entrare già mutato.',
        'Quando qualcuno condivide lo schermo, clicca il riquadro per guardarlo e la X per chiuderlo.',
      ],
    },
    en: {
      added: [
        'Private messages: "Messages" at the bottom left opens a separate screen with your chats and "New chat" to look up a member.',
        'Private messages are end-to-end encrypted: not even the server can read them. When you activate them you get a recovery code to keep, only needed on another device.',
        'Private messages disappear after 30 days, except the ones you star.',
        'A shared screen no longer jumps to the front by itself: click to watch it, double-click to enlarge it. Whoever isn\'t watching doesn\'t download it.',
        'Microphone and headphones always visible at the bottom left: you can mute yourself before joining a call.',
        'Right-click on the microphone: input volume with a live level, and output volume.',
        'Redesigned volume sliders, without the white box around the percentage.',
      ],
      test: [
        'Messages → Activate, save the code and write to a friend who has activated them.',
        'Mute yourself before joining a voice channel: you should join already muted.',
        'When someone shares their screen, click the tile to watch it and the X to close it.',
      ],
    },
  },
];

const SEEN_KEY = 'cerchio-releases-seen';

/** There is a version the user hasn't read yet in the release notes channel. */
export function hasUnseenRelease(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== RELEASES[0].version;
  } catch {
    return false;
  }
}

export function markReleasesSeen() {
  try {
    localStorage.setItem(SEEN_KEY, RELEASES[0].version);
  } catch {
    /* ignore */
  }
}
