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
    version: '0.6.8',
    date: '2026-11-27',
    it: {
      added: [
        'Spettatori negli scacchi: puoi guardare dal vivo le partite in corso dei tuoi amici, con mosse e orologi in tempo reale. Solo i giocatori possono muovere.',
        'Le vedono solo gli amici di almeno uno dei due giocatori (e mai chi è bloccato); le sfide in attesa restano private.',
      ],
      test: [
        'Apri Scacchi: sotto "Partite degli amici" trovi le partite in corso degli amici. Cliccane una per guardarla.',
      ],
    },
    en: {
      added: [
        'Chess spectators: watch your friends\' ongoing games live, with moves and clocks in real time. Only the players can move.',
        'Only friends of at least one of the two players can see them (never someone who is blocked); pending challenges stay private.',
      ],
      test: [
        'Open Chess: under "Friends\' games" you find your friends\' ongoing games. Click one to watch it.',
      ],
    },
  },
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
