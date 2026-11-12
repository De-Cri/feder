// Release notes shown in the "novità" channel (the last 3 versions, newest first).
// On every release: add the new one at the top and remove the last one.

export type Release = {
  version: string;
  date: string; // dd month yyyy
  added: string[]; // what's new, briefly
  test: string[]; // how to try it in the app
};

export const RELEASES: Release[] = [
  {
    version: '0.4.7',
    date: '11 novembre 2026',
    added: [
      'Messaggi privati: "Messaggi" in basso a sinistra apre una schermata a parte, con le tue chat e "Nuova chat" per cercare un membro.',
      'I messaggi privati sono cifrati end-to-end: nemmeno il server li può leggere. All\'attivazione ricevi un codice di recupero da conservare, serve solo su un altro dispositivo.',
      'I messaggi privati spariscono dopo 30 giorni, tranne quelli a cui metti la stellina.',
      'Lo schermo condiviso non va più in primo piano da solo: clicca per guardarlo, doppio click per ingrandirlo. Chi non guarda non lo scarica.',
      'Microfono e cuffie sempre visibili in basso a sinistra: puoi mutarti prima di entrare in chiamata.',
      'Tasto destro sul microfono: volume di ingresso con il livello in tempo reale e volume di uscita.',
      'Cursori del volume ridisegnati, senza il riquadro bianco sulla percentuale.',
    ],
    test: [
      'Messaggi → Attiva, salva il codice e scrivi a un amico che li ha attivati.',
      'Mutati prima di entrare in un canale vocale: devi entrare già mutato.',
      'Quando qualcuno condivide lo schermo, clicca il riquadro per guardarlo e la X per chiuderlo.',
    ],
  },
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
