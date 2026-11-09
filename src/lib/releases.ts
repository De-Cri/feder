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
      'Impostazioni → Aspetto → prova "Nero blu" e "Nero profondo".',
    ],
  },
  {
    version: '0.4.1',
    date: '9 novembre 2026',
    added: [
      'Tema Nero, con i colori scuri di prima.',
      'Condivisione schermo limitata alla qualità scelta (720p o 1080p): meno carico su PC con monitor 2K o 4K.',
      'La voce si sblocca da sola se una connessione resta su "connessione…".',
      'Volume degli amici fino al 200%.',
      'Elenco dispositivi senza doppioni e tendine leggibili su Windows.',
    ],
    test: [
      'Impostazioni → Aspetto → Nero.',
      'In chiamata, tasto destro su un amico → porta il volume oltre il 100%.',
      'Impostazioni → Voce e video: niente più voci doppie "Predefinito - …" o "Comunicazioni - …".',
    ],
  },
  {
    version: '0.4.0',
    date: '9 novembre 2026',
    added: [
      'Menù con il tasto destro sulle persone: volume e "silenzia per me"; per gli admin anche muta, espelli e banna.',
      'Ritaglio della foto profilo.',
      'Impostazioni ridisegnate.',
      'Le preferenze (tema, audio, volumi) sono le stesse nell\'app e nel browser.',
      'Microfono in mono: la voce arriva al centro anche con interfacce audio a due canali.',
    ],
    test: [
      'Tasto destro su un membro nella lista a destra, o su chi è in vocale nella barra laterale.',
      'Impostazioni → Il mio account → cambia foto e ritagliala.',
      'Cambia tema o un volume nell\'app, poi apri Paper dal browser: trovi le stesse impostazioni.',
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
