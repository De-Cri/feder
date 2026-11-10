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
      'Lista membri: passa il mouse sullo scudo dell\'admin e sull\'icona </> dei contributor.',
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
  {
    version: '0.4.3',
    date: '10 novembre 2026',
    added: [
      'Barra laterale più pulita: i controlli della chiamata (microfono, audio, webcam, schermo, termina) sono in basso a sinistra, sempre a portata di mano.',
      'Canale vocale più spazioso: niente più barra dei pulsanti sotto i riquadri.',
      'La lista membri resta sempre aperta nei canali di testo.',
      'Ritaglio della foto profilo: l\'immagine si sposta nel verso in cui trascini.',
      'Tolto il tema Nero blu: chi lo usava passa a Nero.',
    ],
    test: [
      'Entra in un canale vocale e usa i pulsanti in basso nella barra laterale: microfono, audio, webcam, schermo e termina chiamata.',
      'Apri un canale di testo: a destra c\'è la lista membri. In un canale vocale non deve comparire.',
      'Impostazioni → Account → cambia foto e trascinala: deve seguire il mouse.',
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
