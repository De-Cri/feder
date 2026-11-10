// Note di rilascio mostrate nel canale "novità" (le ultime 3 versioni, la più recente prima).
// A ogni release: aggiungi la nuova in cima e togli l'ultima.

export type Release = {
  version: string;
  date: string; // gg mese aaaa
  added: string[]; // cosa c'è di nuovo, in breve
  test: string[]; // come provarlo nell'app
};

export const RELEASES: Release[] = [
  {
    version: '0.4.6',
    date: '10 novembre 2026',
    added: [
      'Paper ora si chiama Feder, con la piuma come icona.',
      'La RAM non cresce più a ogni condivisione schermo o webcam: prima ogni avvio lasciava in memoria un canale in più per ogni persona.',
      'Poke: tasto destro su chi ha l\'audio disattivato → Poke, con un messaggio facoltativo. Gli arriva un avviso con un suono.',
      'Le chat si ricordano dove eri rimasto: tornando in un canale non ti ritrovi sempre in fondo.',
      'In vocale, con la finestra larga, le webcam non vengono più tagliate sopra e sotto.',
      'Le immagini aperte si ridimensionano insieme alla finestra.',
      'Il badge dei contributor ora è una spada.',
    ],
    test: [
      'Avvia e ferma la condivisione schermo più volte: la RAM non deve salire a ogni giro.',
      'Chiedi a un amico di disattivare l\'audio, poi tasto destro sul suo nome → Poke.',
      'Scorri in alto in una chat, passa a un altro canale e torna: devi essere dove eri.',
    ],
  },
  {
    version: '0.4.5',
    date: '10 novembre 2026',
    added: [
      'Meno RAM in chiamata: webcam e schermi chiusi vengono liberati subito e, con la finestra minimizzata, i video non vengono più disegnati (audio e microfono continuano).',
      'Volume degli amici regolabile a passi di 1% (rotellina o frecce) e percentuale scrivibile a mano.',
      'Badge Contributor per chi ha contribuito al codice; passa il mouse sui badge per vedere Admin o Contributor.',
      'Più spazio tra i nomi in vocale e nella lista membri.',
      'Barra laterale più pulita: tolti avatar e nome in basso e l\'avviso sulla qualità della stream.',
    ],
    test: [
      'In chiamata, tasto destro su un amico: porta il volume da 82 a 83 con la rotellina o scrivendo il numero.',
      'Lista membri: passa il mouse sullo scudo dell\'admin e sulla spada dei contributor.',
      'In chiamata con webcam o schermo accesi, minimizza Paper: devi continuare a sentire e gli altri a vederti.',
    ],
  },
  {
    version: '0.4.4',
    date: '10 novembre 2026',
    added: [
      'Impostazioni con un nuovo stile, allineato alla barra laterale delle chat.',
      'Nuove tendine per scegliere microfono, uscita audio e webcam.',
    ],
    test: [
      'Impostazioni → Voce e video: apri le tendine di microfono, uscita audio e webcam e cambia dispositivo.',
      'Controlla che nelle tendine non ci siano voci doppie "Predefinito - …" o "Comunicazioni - …".',
    ],
  },
];

const SEEN_KEY = 'cerchio-releases-seen';

/** C'è una versione che l'utente non ha ancora letto nel canale novità. */
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
