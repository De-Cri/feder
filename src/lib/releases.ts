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
  {
    version: '0.4.2',
    date: '10 novembre 2026',
    added: [
      'La barra laterale si aggiorna sempre: prima, dopo tanti cambi di microfono, webcam o schermo, il server chiudeva la connessione e non si vedeva più chi era in chiamata.',
      'Se la connessione con il server cade, Paper si ricollega da solo.',
      'Paper aperto su app e browser insieme: gli altri ti vedono in chiamata senza "sfarfallii".',
      'Nuovi temi: Nero blu (identico a prima della 0.4) e Nero profondo (quasi nero).',
      'Questo canale con le novità.',
    ],
    test: [
      'Entra in un canale vocale e accendi/spegni microfono e webcam più volte di fila: chi è fuori dalla chiamata deve vederti sempre nel canale giusto (al massimo con qualche secondo di ritardo).',
      'Mentre sei in vocale, entra in un altro canale: devi continuare a vedere chi c\'è nel primo.',
      'Mentre sei in chiamata dall\'app, apri Paper anche dal browser: gli altri devono vederti ancora in chiamata.',
      'Impostazioni → Aspetto → prova "Nero profondo".',
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
