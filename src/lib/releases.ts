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
    version: '0.6.4',
    date: '2026-11-24',
    it: {
      added: [
        'Tasto destro sull\'icona del microfono in basso a sinistra: scegli quale microfono usare, anche durante una chiamata.',
        'Impostazioni → Notifiche: "Tieni Feder aperto quando lo chiudi". Chiudendo la finestra Feder resta vicino all\'orologio, ricevi le notifiche e le chiamate continuano. Spento di default.',
        'Impostazioni → Notifiche: "Avvia Feder con il PC". Spento di default.',
        'L\'admin può rendere fondatore un membro (tasto destro sul nome → Rendi fondatore): vede Lounge e Gaming e diventa amico degli altri fondatori.',
      ],
      test: [
        'Tasto destro sul microfono in basso a sinistra e cambia microfono mentre sei in Public Channel.',
        'Attiva "Tieni Feder aperto", chiudi la finestra con la X e riaprila dall\'icona vicino all\'orologio.',
      ],
    },
    en: {
      added: [
        'Right-click the microphone icon at the bottom left: pick which microphone to use, during a call too.',
        'Settings → Notifications: "Keep Feder running when you close it". Closing the window leaves Feder next to the clock, you still get notifications and calls keep going. Off by default.',
        'Settings → Notifications: "Start Feder with your PC". Off by default.',
        'The admin can make a member a founder (right-click their name → Make founder): they see Lounge and Gaming and become friends with the other founders.',
      ],
      test: [
        'Right-click the microphone at the bottom left and switch microphone while you\'re in Public Channel.',
        'Turn on "Keep Feder running", close the window with the X and reopen it from the icon next to the clock.',
      ],
    },
  },
  {
    version: '0.6.3',
    date: '2026-11-23',
    it: {
      added: [
        'Nuovo canale vocale "Public Channel", aperto a tutti i membri del server (fino a 8 persone).',
        'Le tue chat private ora sono a sinistra, sotto i canali, con il + per crearne una. A destra restano solo le persone: amici, inviti e membri.',
      ],
      test: [
        'Entra in Public Channel dalla colonna di sinistra.',
        'Crea una chat con il + accanto a "Le tue chat".',
      ],
    },
    en: {
      added: [
        'New voice channel "Public Channel", open to every member of the server (up to 8 people).',
        'Your private chats are now on the left, under the channels, with the + to create one. The right column is just people: friends, invites and members.',
      ],
      test: [
        'Join Public Channel from the left column.',
        'Create a chat with the + next to "Your chats".',
      ],
    },
  },
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
