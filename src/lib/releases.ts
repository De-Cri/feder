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
    version: '0.5.0',
    date: '2026-11-12',
    it: {
      added: [
        'Feder è in italiano e in inglese: segue la lingua del sistema e si cambia in Impostazioni → Aspetto → Lingua.',
        'Chiamate più sicure: i dati per collegarsi passano dal server e arrivano solo a chi è nella chiamata. Nessuno può spacciarsi per un altro né vedere da fuori gli indirizzi IP.',
        'I poke passano dal server: il mittente è verificato e c\'è un limite contro lo spam.',
        'Feder è open source (GPL-3.0): il codice è su github.com/De-Cri/feder.',
        'Su Linux il processo si chiama feder.',
        'Importante: chi è ancora sulla 0.4.7 non può più fare chiamate né mandare poke finché non aggiorna.',
      ],
      test: [
        'Impostazioni → Aspetto → Lingua: passa a English e torna a Italiano, senza riavviare.',
        'Entra in chiamata con un amico che ha già la 0.5.0: voce, webcam e schermo come prima.',
        'Fai un poke a chi ha l\'audio disattivato: deve arrivargli con il tuo nome.',
      ],
    },
    en: {
      added: [
        'Feder speaks Italian and English: it follows the system language and can be changed in Settings → Appearance → Language.',
        'Safer calls: connection data goes through the server and reaches only the people in the call. Nobody can pose as someone else or see IP addresses from outside.',
        'Pokes go through the server: the sender is verified and there\'s an anti-spam limit.',
        'Feder is open source (GPL-3.0): the code is on github.com/De-Cri/feder.',
        'On Linux the process is now called feder.',
        'Important: anyone still on 0.4.7 can\'t make calls or send pokes until they update.',
      ],
      test: [
        'Settings → Appearance → Language: switch to Italiano and back to English, without restarting.',
        'Join a call with a friend who already has 0.5.0: voice, webcam and screen work as before.',
        'Poke someone who has their audio off: it should reach them with your name.',
      ],
    },
  },
  {
    version: '0.4.7',
    date: '2026-11-11',
    it: {
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
    en: {
      added: [
        'Private messages: "Messages" at the bottom left opens a separate screen with your chats and "New chat" to look up a member.',
        'Private messages are end-to-end encrypted: not even the server can read them. When you activate them you get a recovery code to keep, only needed on another device.',
        'Private messages disappear after 30 days, except the ones you star.',
        'A shared screen no longer jumps to the front by itself: click to watch it, double-click to enlarge it. Whoever isn\'t watching doesn\'t download it.',
        'Microphone and headphones always visible at the bottom left: you can mute yourself before joining a call.',
        'Right-click on the microphone: input volume with a live level, and output volume.',
        'Redesigned volume sliders, without the white box around the percentage.',
      ],
      test: [
        'Messages → Activate, save the code and write to a friend who has activated them.',
        'Mute yourself before joining a voice channel: you should join already muted.',
        'When someone shares their screen, click the tile to watch it and the X to close it.',
      ],
    },
  },
  {
    version: '0.4.6',
    date: '2026-11-10',
    it: {
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
    en: {
      added: [
        'Paper is now called Feder, with the feather as its icon.',
        'RAM no longer grows with every screen or webcam share: before, every start left one extra channel per person in memory.',
        'Poke: right-click on someone with their audio off → Poke, with an optional message. They get a notice with a sound.',
        'Chats remember where you were: going back to a channel no longer always lands you at the bottom.',
        'In voice, with a wide window, webcams are no longer cut off at the top and bottom.',
        'Opened images resize together with the window.',
        'The contributor badge is now a sword.',
      ],
      test: [
        'Start and stop screen sharing several times: RAM shouldn\'t go up every round.',
        'Ask a friend to turn their audio off, then right-click their name → Poke.',
        'Scroll up in a chat, switch to another channel and come back: you should be where you were.',
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
