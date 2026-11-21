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
    version: '0.6.1',
    date: '2026-11-21',
    it: {
      added: [
        'Windows: l\'aggiornamento automatico ora si installa davvero. Prima, su alcuni PC, la finestra si chiudeva ma Feder restava aperto in background e l\'installazione non partiva.',
      ],
      test: [
        'Al prossimo aggiornamento premi "Aggiorna e riavvia": Feder si chiude e si riapre aggiornato in pochi secondi.',
      ],
    },
    en: {
      added: [
        'Windows: automatic updates now actually install. Before, on some PCs, the window closed but Feder kept running in the background and the update never started.',
      ],
      test: [
        'On the next update press "Update and restart": Feder closes and reopens updated within a few seconds.',
      ],
    },
  },
  {
    version: '0.6.0',
    date: '2026-11-21',
    it: {
      added: [
        'Amici: tutti i membri originali del server ora sono amici tra loro. Aggiungi altre persone dal loro nome o dalla lista membri.',
        'Chat private: crea chat di testo o vocali e invita solo chi vuoi. Le trovi nella barra a destra e le vedono solo i membri.',
        'Pagina Amici e inviti: richieste di amicizia, inviti alle chat, blocco.',
        'I messaggi privati e i poke funzionano solo tra amici.',
        'Chi è in quale chiamata, la webcam e lo schermo li vede solo chi può vedere quel canale.',
        'Presto Feder si aprirà a nuove persone (fino a 100): vedranno solo #generale e #random, Lounge e Gaming restano nostri.',
      ],
      test: [
        'Barra a destra → + : crea una chat vocale e invita un amico. Lui la trova in Amici e inviti.',
        'Entrate nella chat vocale: chi non è invitato non deve vederla.',
        'Dal menu di una chat (…) prova a rinominarla, rimuovere qualcuno e uscire.',
      ],
    },
    en: {
      added: [
        'Friends: all the original members of the server are now friends with each other. Add more people by username or from the member list.',
        'Private chats: create text or voice chats and invite only who you want. They are in the right sidebar and only members can see them.',
        'Friends & invites page: friend requests, chat invites, blocking.',
        'Private messages and pokes only work between friends.',
        'Who is in which call, webcams and screens are only visible to people who can see that channel.',
        'Feder will soon open to new people (up to 100): they will see only #generale and #random, Lounge and Gaming stay ours.',
      ],
      test: [
        'Right sidebar → + : create a voice chat and invite a friend. They find it in Friends & invites.',
        'Join the voice chat together: people who aren\'t invited must not see it.',
        'From a chat\'s menu (…) try renaming it, removing someone and leaving.',
      ],
    },
  },
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
