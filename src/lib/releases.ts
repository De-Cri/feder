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
    version: '0.6.7',
    date: '2026-11-26',
    it: {
      added: [
        'Scacchi col timer: quando sfidi scegli il tempo (1, 3, 3+2, 5, 10, 15+10, 30 minuti o senza tempo). Il tempo lo conta il server: chi lo finisce perde.',
        'Classifica: la sconfitta ora toglie 3 punti (vittoria +3, pareggio +1), ma il punteggio non scende mai sotto 0.',
        'Suoni delle mosse (mossa, cattura, scacco) al posto delle notifiche: nessuna notifica a ogni mossa. Si possono spegnere in Impostazioni → Voce e video → Suoni.',
      ],
      test: [
        'Sfida un amico a 3+2 e guarda gli orologi sopra e sotto la scacchiera.',
      ],
    },
    en: {
      added: [
        'Chess with a clock: when you challenge, pick the time (1, 3, 3+2, 5, 10, 15+10, 30 minutes or no clock). The server keeps time: whoever runs out loses.',
        'Standings: a loss now takes 3 points away (win +3, draw +1), but points never go below 0.',
        'Move sounds (move, capture, check) instead of notifications: no notification on every move. They can be turned off in Settings → Voice and video → Sounds.',
      ],
      test: [
        'Challenge a friend at 3+2 and watch the clocks above and below the board.',
      ],
    },
  },
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
