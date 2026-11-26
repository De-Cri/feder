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
    version: '0.6.6',
    date: '2026-11-26',
    it: {
      added: [
        'Scacchi con gli amici: nuova pagina "Scacchi" a sinistra. Sfida un amico, lui riceve la notifica e accetta. Mosse con clic o trascinamento, premosse come su chess.com, patta e abbandono.',
        'Classifica tra te e i tuoi amici, come nel calcio: vittoria 3 punti, pareggio 1, sconfitta 0.',
      ],
      test: [
        'Apri "Scacchi" a sinistra, premi "Sfida un amico" e scegli il colore e l\'amico.',
        'Mentre l\'altro pensa, trascina un pezzo: diventa rosso (premossa) e parte da solo appena tocca a te. Tasto destro per annullare.',
      ],
    },
    en: {
      added: [
        'Chess with friends: new "Chess" page on the left. Challenge a friend, they get a notification and accept. Move by click or drag, premoves like on chess.com, draw and resign.',
        'Standings for you and your friends, football style: a win is 3 points, a draw 1, a loss 0.',
      ],
      test: [
        'Open "Chess" on the left, press "Challenge a friend" and pick a color and a friend.',
        'While the other player is thinking, drag a piece: it turns red (premove) and is played as soon as it\'s your turn. Right click to cancel.',
      ],
    },
  },
  {
    version: '0.6.5',
    date: '2026-11-25',
    it: {
      added: [
        'Risolto l\'errore "JWT expired": con Feder nascosto o in chiamata per più di un\'ora il login non si rinnovava e chiamate e messaggi smettevano di funzionare. Ora si rinnova sempre, e se scade lo stesso Feder lo rinnova da solo.',
      ],
      test: [
        'Lascia Feder ridotto a icona (o nascosto vicino all\'orologio) per più di un\'ora, poi scrivi un messaggio o entra in un canale vocale.',
      ],
    },
    en: {
      added: [
        'Fixed the "JWT expired" error: with Feder hidden or in a call for over an hour the login wasn\'t renewed and calls and messages stopped working. Now it\'s always renewed, and if it expires anyway Feder renews it by itself.',
      ],
      test: [
        'Leave Feder minimized (or hidden next to the clock) for over an hour, then send a message or join a voice channel.',
      ],
    },
  },
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
