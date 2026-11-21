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
    version: '0.6.2',
    date: '2026-11-21',
    it: {
      added: [
        'La barra di destra (chat, amici, membri) si può nascondere: pulsante con le persone in alto a destra, anche nei canali vocali. La scelta resta salvata.',
        'Con la barra nascosta, un pallino sul pulsante ti avvisa di inviti, richieste di amicizia e messaggi nelle chat private.',
      ],
      test: [
        'Entra in Lounge e premi il pulsante in alto a destra: la barra sparisce e le webcam hanno più spazio.',
      ],
    },
    en: {
      added: [
        'The right column (chats, friends, members) can be hidden: people button at the top right, in voice channels too. Your choice is saved.',
        'While it\'s hidden, a dot on the button tells you about invites, friend requests and messages in private chats.',
      ],
      test: [
        'Open Lounge and press the button at the top right: the column disappears and webcams get more room.',
      ],
    },
  },
  {
    version: '0.6.1',
    date: '2026-11-21',
    it: {
      added: [
        'Windows: se un aggiornamento lascia Feder aperto in background, il nuovo installer lo chiude prima di installare.',
        'Se l\'aggiornamento non parte proprio, probabilmente è Smart App Control di Windows 11: blocca i programmi non firmati. Stiamo lavorando per firmare Feder.',
      ],
      test: [
        'Premi "Aggiorna e riavvia" e controlla in Impostazioni → Info che la versione sia cambiata.',
      ],
    },
    en: {
      added: [
        'Windows: if an update leaves Feder running in the background, the new installer closes it before installing.',
        'If the update doesn\'t start at all, it\'s probably Windows 11 Smart App Control: it blocks unsigned programs. We\'re working on signing Feder.',
      ],
      test: [
        'Press "Update and restart" and check in Settings → About that the version changed.',
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
