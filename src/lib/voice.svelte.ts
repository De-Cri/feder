// Voce/video peer-to-peer (mesh): ogni partecipante è collegato direttamente agli altri.
// Signaling via Supabase Realtime (canale privato, solo membri) con il pattern
// "perfect negotiation" per gestire offerte simultanee e rinegoziazioni.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { app } from './state.svelte';
import { prefs, micOptions } from './prefs.svelte';
import { config } from './config';
import { MicPipeline } from './audio';
import { playSound } from './sounds';
import { screenSettings, screenWarning } from './screenQuality';

export const rtcSupported =
  typeof RTCPeerConnection !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia;

export const screenShareSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

type Signal = {
  from: string;
  to: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
  /** id dello stream dello schermo di chi invia (null = non condivide). */
  screen?: string | null;
};

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const CAM_BITRATE = 900_000; // mesh a 5: ~0.9 Mbps per peer in upload
const SPEAKING_DB = -50;

async function loadIceServers(): Promise<RTCIceServer[]> {
  if (!config.turn) return STUN;
  try {
    const { data, error } = await supabase.functions.invoke('turn');
    if (!error && data?.iceServers) {
      const extra = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
      return [...STUN, ...extra];
    }
  } catch {
    /* fallback a solo STUN */
  }
  return STUN;
}

// ---------------------------------------------------------------------------
// "Sta parlando" per gli stream remoti (AnalyserNode sul contesto condiviso).
// ---------------------------------------------------------------------------
let meterCtx: AudioContext | null = null;
function analyser(stream: MediaStream, onLevel: (speaking: boolean) => void): () => void {
  try {
    meterCtx ??= new AudioContext();
    if (meterCtx.state === 'suspended') meterCtx.resume();
    const src = meterCtx.createMediaStreamSource(stream);
    const an = meterCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    let hold = 0;
    const t = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) * (v - 128);
      const rms = Math.sqrt(sum / buf.length);
      if (rms > 4) hold = 3;
      else if (hold > 0) hold--;
      onLevel(hold > 0);
    }, 100);
    return () => {
      clearInterval(t);
      src.disconnect();
    };
  } catch {
    return () => {};
  }
}

/**
 * Su Windows il codec H.264 è codificato dalla scheda video: molta meno CPU e
 * stream più fluida. Lo mettiamo per primo (gli altri restano come riserva).
 * Su Linux Chromium codifica comunque via software, quindi resta VP8.
 */
export function preferHardwareCodec(pc: RTCPeerConnection, sender: RTCRtpSender, force = false) {
  try {
    if (!force && !/Windows/.test(navigator.userAgent)) return;
    const tr = pc.getTransceivers().find((t) => t.sender === sender);
    const caps = RTCRtpSender.getCapabilities?.('video')?.codecs;
    if (!tr || !caps || !tr.setCodecPreferences) return;
    const h264 = caps.filter((c) => /h264/i.test(c.mimeType));
    if (!h264.length) return;
    tr.setCodecPreferences([...h264, ...caps.filter((c) => !/h264/i.test(c.mimeType))]);
  } catch {
    /* preferenza non applicabile: si usa il predefinito */
  }
}

/**
 * Vincoli di cattura dello schermo. Solo `ideal` non basta: su monitor 1440p/4K
 * Chromium catturava a risoluzione nativa e ogni peer della mesh codificava quel
 * flusso (CPU al limite = lag). Servono i `max`.
 */
function screenVideo(q: { fps: number; height: number }): MediaTrackConstraints {
  return {
    frameRate: { ideal: q.fps, max: q.fps },
    ...(q.height ? { height: { ideal: q.height, max: q.height }, width: { max: Math.round((q.height * 16) / 9) } } : {}),
  };
}

/** Aggiunge x-google-start/min-bitrate ai codec video dell'SDP (kbps). */
export function boostVideoBitrate(sdp: string, start = 1500, min = 300): string {
  if (!sdp.includes('m=video')) return sdp;
  const lines = sdp.split('\r\n');
  const out: string[] = [];
  let inVideo = false;
  const seenFmtp = new Set<string>();
  const videoPts: string[] = [];
  for (const line of lines) {
    if (line.startsWith('m=')) {
      // chiude la sezione video precedente aggiungendo fmtp mancanti
      if (inVideo) for (const pt of videoPts) if (!seenFmtp.has(pt)) out.push(`a=fmtp:${pt} x-google-start-bitrate=${start};x-google-min-bitrate=${min}`);
      inVideo = line.startsWith('m=video');
      seenFmtp.clear();
      videoPts.length = 0;
      out.push(line);
      continue;
    }
    if (inVideo) {
      const rtp = line.match(/^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//i);
      if (rtp) videoPts.push(rtp[1]);
      const fmtp = line.match(/^a=fmtp:(\d+) (.*)$/);
      if (fmtp && videoPts.includes(fmtp[1]) && !fmtp[2].includes('x-google-start-bitrate')) {
        seenFmtp.add(fmtp[1]);
        out.push(`${line};x-google-start-bitrate=${start};x-google-min-bitrate=${min}`);
        continue;
      }
      if (fmtp) seenFmtp.add(fmtp[1]);
    }
    out.push(line);
  }
  if (inVideo) {
    // sezione video in fondo: inserisce prima della riga vuota finale
    const tail = out.length && out[out.length - 1] === '' ? out.pop() : undefined;
    for (const pt of videoPts) if (!seenFmtp.has(pt)) out.push(`a=fmtp:${pt} x-google-start-bitrate=${start};x-google-min-bitrate=${min}`);
    if (tail !== undefined) out.push(tail);
  }
  return out.join('\r\n');
}

// ---------------------------------------------------------------------------
class Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer = false;
  ignoreOffer = false;
  /** Tutte le tracce remote ricevute (diagnostica). */
  stream = new MediaStream();
  /** Audio da riprodurre, uno stream per sorgente (microfono, audio dello schermo). */
  audioStreams = $state<{ key: string; stream: MediaStream }[]>([]);
  audioSender: RTCRtpSender | null = null;
  camSender: RTCRtpSender | null = null;
  screenSender: RTCRtpSender | null = null;
  screenAudioSender: RTCRtpSender | null = null;
  private stopAnalyser: (() => void) | null = null;
  private streamMap = new Map<string, MediaStream>();

  /** id dello stream dello schermo dell'altro (undefined = versione vecchia, non lo manda). */
  screenStreamId: string | null | undefined = undefined;
  private camTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  /** Uno stream nuovo per ogni traccia video: il <video> non resta mai su una traccia vecchia (nero). */
  camView = $state<MediaStream | null>(null);
  screenView = $state<MediaStream | null>(null);
  hasCam = $state(false);
  hasScreen = $state(false);
  speaking = $state(false);
  connection = $state<RTCPeerConnectionState>('new');
  rev = $state(0);

  constructor(
    public id: string,
    private room: VoiceRoom,
    iceServers: RTCIceServer[],
  ) {
    this.polite = room.me > id;
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });

    this.pc.onicecandidate = ({ candidate }) => {
      this.stats.sent++;
      room.send(id, { candidate: candidate?.toJSON() ?? null });
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        room.send(id, { description: this.pc.localDescription!.toJSON(), screen: room.screenStreamIdIfActive });
      } catch (e) {
        console.warn('negotiation', e);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.ontrack = ({ track, streams }) => {
      if (!this.stream.getTracks().includes(track)) this.stream.addTrack(track);
      if (track.kind === 'video') {
        // Schermo o webcam? Lo dice l'id dello stream che l'altro ci ha comunicato.
        const isScreen = !!streams[0] && streams[0].id === this.screenStreamId;
        if (isScreen) {
          // Un piccolo buffer in più (150 ms) assorbe gli sbalzi di rete: stream più regolare.
          try {
            const r = this.pc.getReceivers().find((x) => x.track === track) as RTCRtpReceiver & { jitterBufferTarget?: number };
            if (r && 'jitterBufferTarget' in r) r.jitterBufferTarget = 150;
          } catch {
            /* non supportato */
          }
          this.screenTrack = track;
          this.screenView = new MediaStream([track]);
        } else {
          this.camTrack = track;
          this.camView = new MediaStream([track]);
        }
      }
      if (track.kind === 'audio') {
        const key = streams[0]?.id ?? track.id;
        let s = this.streamMap.get(key);
        if (!s) {
          s = new MediaStream();
          this.streamMap.set(key, s);
          this.audioStreams = [...this.audioStreams, { key, stream: s }];
        }
        if (!s.getTracks().includes(track)) s.addTrack(track);
        if (!this.stopAnalyser) this.stopAnalyser = analyser(s, (v) => (this.speaking = v));
      }
      track.onmute = track.onunmute = () => this.refresh();
      track.onended = () => {
        this.stream.removeTrack(track);
        this.refresh();
      };
      this.refresh();
    };

    this.pc.onconnectionstatechange = () => {
      this.connection = this.pc.connectionState;
      if (this.pc.connectionState === 'failed') this.pc.restartIce();
      if (this.pc.connectionState === 'connected') this.room.tuneBitrate(this);
    };

    // Evita offerte incrociate alla prima connessione (causano candidati ICE persi
    // in Chromium): chi ha l'id minore offre subito, l'altro aggiunge le sue
    // tracce quando riceve l'offerta (o dopo 2,5 s se l'offerta non arriva).
    if (!this.polite) this.attachLocalTracks();
    else this.attachTimer = setTimeout(() => this.attachLocalTracks(), 2500);

    // Watchdog: se dopo 10 s non è connesso, riavvia ICE.
    this.watchdog = setInterval(() => {
      const st = this.pc.connectionState;
      if (st === 'connected' || st === 'closed') return;
      if (!this.polite && this.pc.signalingState === 'stable') this.pc.restartIce();
    }, 10_000);
  }

  private attached = false;
  private attachTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;

  attachLocalTracks() {
    if (this.attached) return;
    this.attached = true;
    clearTimeout(this.attachTimer);
    const room = this.room;
    if (room.audioTrack) this.audioSender = this.pc.addTrack(room.audioTrack, room.localStream);
    if (room.camTrack) this.camSender = this.pc.addTrack(room.camTrack, room.localStream);
    if (room.screenTrack) {
      this.screenSender = this.pc.addTrack(room.screenTrack, room.screenStream);
      preferHardwareCodec(this.pc, this.screenSender);
    }
    if (room.screenAudioTrack) this.screenAudioSender = this.pc.addTrack(room.screenAudioTrack, room.screenStream);
    this.room.tuneBitrate(this);
  }

  /** Le tracce aggiunte dopo (webcam/schermo) passano di qui solo se già collegato. */
  get ready() {
    return this.attached;
  }

  refresh() {
    const live = (t: MediaStreamTrack | null) => !!t && t.readyState === 'live' && !t.muted;
    this.hasCam = live(this.camTrack);
    this.hasScreen = live(this.screenTrack);
    this.rev++;
  }

  /** L'audio con questa chiave è quello dello schermo condiviso (non la voce)? */
  isScreenAudio(key: string) {
    return !!this.screenStreamId && key === this.screenStreamId;
  }

  /** Compatibilità (test e codice vecchio): c'è almeno un video attivo. */
  get hasVideo() {
    return this.hasCam || this.hasScreen;
  }

  // I segnali vanno applicati in ordine: un candidato ICE elaborato prima che
  // la descrizione remota sia impostata andrebbe perso.
  private queue: Promise<void> = Promise.resolve();
  /** Contatori diagnostici (utili nei test). */
  stats = { sent: 0, recv: 0, candErr: 0, ignored: 0 };
  handle(sig: Signal) {
    this.queue = this.queue.then(() => this.apply(sig));
    return this.queue;
  }

  private async apply(sig: Signal) {
    const pc = this.pc;
    try {
      if (sig.description) {
        const d = sig.description;
        const collision = d.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) {
          this.stats.ignored++;
          return;
        }
        if (sig.screen !== undefined) this.screenStreamId = sig.screen;
        // Partenza veloce del video: senza, Chromium parte da ~300 kbps e lo schermo
        // resta sgranato per decine di secondi. Se la modifica non piace al browser
        // si usa la descrizione originale.
        try {
          await pc.setRemoteDescription({ type: d.type, sdp: boostVideoBitrate(d.sdp ?? '') });
        } catch {
          await pc.setRemoteDescription(d);
        }
        if (d.type === 'offer') {
          // Aggiunte dopo l'offerta, le tracce riusano i transceiver già negoziati.
          this.attachLocalTracks();
          await pc.setLocalDescription();
          this.room.send(this.id, { description: pc.localDescription!.toJSON(), screen: this.room.screenStreamIdIfActive });
        }
      } else if (sig.candidate !== undefined) {
        this.stats.recv++;
        try {
          await pc.addIceCandidate(sig.candidate ?? undefined);
        } catch (e) {
          this.stats.candErr++;
          if (!this.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn('signal', e);
    }
  }

  close() {
    clearTimeout(this.attachTimer);
    clearInterval(this.watchdog);
    this.stopAnalyser?.();
    this.pc.close();
    this.stream.getTracks().forEach((t) => t.stop());
  }
}

// ---------------------------------------------------------------------------
class VoiceRoom {
  channelId = $state<number | null>(null);
  peers = $state<Record<string, Peer>>({});
  micOn = $state(true);
  deaf = $state(false);
  camOn = $state(false);
  screenOn = $state(false);
  /** Anteprime locali: uno stream per la webcam e uno per lo schermo. */
  camPreview = $state<MediaStream | null>(null);
  screenPreview = $state<MediaStream | null>(null);
  localSpeaking = $state(false);
  localRev = $state(0);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);
  joining = $state(false);

  me = '';
  mic: MicPipeline | null = null;
  localStream = new MediaStream();
  screenStream = new MediaStream();
  audioTrack: MediaStreamTrack | null = null;
  camTrack: MediaStreamTrack | null = null;
  screenTrack: MediaStreamTrack | null = null;
  screenAudioTrack: MediaStreamTrack | null = null;
  private rt: RealtimeChannel | null = null;
  private ice: RTCIceServer[] = STUN;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private rebuilding: Promise<void> | null = null;

  get adminMuted() {
    return !!app.voiceMutes[this.me];
  }

  private joinSeq = 0;

  async join(channelId: number) {
    if (this.channelId === channelId) return;
    if (!rtcSupported) {
      this.error = 'WebRTC non disponibile in questa installazione.';
      return;
    }
    // Un clic su un altro canale annulla anche un ingresso ancora in corso.
    if (this.channelId !== null || this.joining) await this.leave(true);
    const seq = ++this.joinSeq;
    this.joining = true;
    this.error = null;
    this.me = app.me!;
    try {
      const [mic, ice] = await Promise.all([MicPipeline.create(micOptions()), loadIceServers()]);
      if (seq !== this.joinSeq) return mic.stop(); // superato da un altro clic
      this.ice = ice;
      this.setMic(mic);
    } catch (e) {
      this.joining = false;
      this.error = 'Impossibile accedere al microfono: ' + ((e as Error).message ?? e);
      return;
    }

    this.channelId = channelId;
    await supabase.realtime.setAuth();
    if (seq !== this.joinSeq) return;
    const rt = supabase.channel(`cerchio:voice:${channelId}`, {
      config: { private: true, broadcast: { self: false }, presence: { key: this.me } },
    });
    this.rt = rt;
    let known: Set<string> | null = null; // chi c'era al mio ingresso (niente suono per loro)
    let settledAt = Infinity; // fino a poco dopo l'ingresso lo stato può arrivare a pezzi
    let subscribed = false;
    let retrack: ReturnType<typeof setTimeout> | undefined;
    rt.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const sig = payload as Signal;
      if (sig.to !== this.me || sig.from === this.me) return;
      if (!app.members.some((m) => m.user_id === sig.from)) return;
      this.peer(sig.from).handle(sig);
    })
      .on('presence', { event: 'sync' }, () => {
        const state = rt.presenceState();
        // Se il server ci ha perso dalla stanza, ci ripresentiamo (gli altri non ci vedrebbero).
        if (subscribed && !(this.me in state)) {
          clearTimeout(retrack);
          retrack = setTimeout(() => {
            if (this.rt === rt && !(this.me in rt.presenceState())) rt.track({ at: Date.now() });
          }, 800);
        }
        const ids = new Set(Object.keys(state));
        app.room = { channel: channelId, ids: [this.me, ...[...ids].filter((id) => id !== this.me && app.members.some((m) => m.user_id === id))] };
        ids.delete(this.me);
        // Solo chi ha l'id minore avvia la connessione; l'altro risponde all'offerta.
        for (const id of ids) {
          if (!app.members.some((m) => m.user_id === id)) continue;
          if (this.me < id) this.peer(id);
          else
            // Rete di sicurezza: se l'altro non si fa vivo, avvio io.
            setTimeout(() => {
              if (this.rt === rt && !this.peers[id] && id in rt.presenceState()) this.peer(id);
            }, 3000);
        }
        for (const id of Object.keys(this.peers)) if (!ids.has(id)) this.drop(id);
        if (known && Date.now() > settledAt) {
          if ([...ids].some((id) => !known!.has(id))) playSound('join');
          if ([...known].some((id) => !ids.has(id))) playSound('leave');
        }
        known = ids;
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await rt.track({ at: Date.now() });
          subscribed = true;
          this.joining = false;
          settledAt = Date.now() + 1500;
          playSound('selfJoin');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.error = 'Connessione al canale vocale non riuscita.';
        }
      });

    app.myPresence.voice = channelId;
    this.syncPresence();
  }

  /** @param switching true quando si passa a un altro canale (niente suono di uscita). */
  async leave(switching = false) {
    this.joinSeq++; // annulla eventuali ingressi in corso
    if (this.channelId !== null && !switching) playSound('selfLeave');
    const rt = this.rt;
    this.rt = null;
    if (rt) await supabase.removeChannel(rt);
    for (const id of Object.keys(this.peers)) this.drop(id);
    this.stopVideo(false);
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.mic?.stop();
    this.mic = null;
    for (const t of this.localStream.getTracks()) {
      t.stop();
      this.localStream.removeTrack(t);
    }
    this.audioTrack = null;
    this.channelId = null;
    this.joining = false;
    this.localSpeaking = false;
    app.myPresence.voice = null;
    app.room = { channel: null, ids: [] };
    this.syncPresence();
  }

  send(to: string, sig: Omit<Signal, 'from' | 'to'>) {
    this.rt?.send({ type: 'broadcast', event: 'signal', payload: { ...sig, from: this.me, to } });
  }

  private peer(id: string): Peer {
    return (this.peers[id] ??= new Peer(id, this, this.ice));
  }

  drop(id: string) {
    const p = this.peers[id];
    if (!p) return;
    p.close();
    delete this.peers[id];
  }

  // ---- microfono ---------------------------------------------------------
  private setMic(mic: MicPipeline) {
    const old = this.audioTrack;
    if (old) this.localStream.removeTrack(old);
    this.mic = mic;
    this.audioTrack = mic.track;
    this.localStream.addTrack(mic.track);
    this.applyMic();
    if (mic.aiFallback) this.notice = 'Soppressione rumore AI non disponibile: uso quella standard.';
    else if (mic.deviceFallback) this.notice = 'Il microfono scelto non è disponibile: uso quello predefinito.';
    else this.notice = null;
    if (this.meterTimer) clearInterval(this.meterTimer);
    let hold = 0;
    this.meterTimer = setInterval(() => {
      if (!this.mic || !this.effectiveMic) {
        this.localSpeaking = false;
        return;
      }
      const threshold = prefs.gateEnabled ? prefs.gateDb : SPEAKING_DB;
      if (this.mic.levelDb() > threshold) hold = 3;
      else if (hold > 0) hold--;
      this.localSpeaking = hold > 0;
    }, 100);
  }

  /** Ricrea la catena del microfono (cambio dispositivo/soppressione/gate) senza uscire. */
  async rebuildMic() {
    if (this.channelId === null) return;
    const run = async () => {
      try {
        const mic = await MicPipeline.create(micOptions());
        for (const p of Object.values(this.peers)) await p.audioSender?.replaceTrack(mic.track);
        const old = this.mic;
        this.setMic(mic);
        old?.stop();
      } catch {
        this.error = 'Cambio impostazioni microfono non riuscito.';
      }
    };
    this.rebuilding = (this.rebuilding ?? Promise.resolve()).then(run);
    await this.rebuilding;
  }

  setInputGain(v: number) {
    this.mic?.setGain(v);
  }

  get effectiveMic() {
    return this.micOn && !this.deaf && !this.adminMuted;
  }

  applyMic() {
    if (this.audioTrack) this.audioTrack.enabled = this.effectiveMic;
    if (!this.effectiveMic) this.localSpeaking = false;
  }

  toggleMic() {
    if (this.adminMuted) return;
    this.micOn = !this.micOn;
    playSound(this.micOn ? 'unmute' : 'mute');
    if (this.micOn && this.deaf) this.deaf = false;
    this.applyMic();
    this.syncPresence();
  }

  toggleDeaf() {
    this.deaf = !this.deaf;
    playSound(this.deaf ? 'mute' : 'unmute');
    this.applyMic();
    this.syncPresence();
  }

  // ---- video: webcam e schermo sono indipendenti (anche insieme) --------
  /** id dello stream dello schermo da comunicare agli altri (null se non condividi). */
  get screenStreamIdIfActive(): string | null {
    return this.screenTrack ? this.screenStream.id : null;
  }

  private forReadyPeers(fn: (p: Peer) => void) {
    for (const p of Object.values(this.peers)) if (p.ready) fn(p); // gli altri ricevono tutto quando si collegano
  }

  private removeSender(p: Peer, key: 'camSender' | 'screenSender' | 'screenAudioSender') {
    const sender = p[key];
    if (!sender) return;
    try {
      p.pc.removeTrack(sender);
    } catch {
      /* connessione già chiusa */
    }
    p[key] = null;
  }

  async toggleCam() {
    if (this.camTrack) return this.stopCam();
    const video = (id?: string): MediaTrackConstraints => ({
      deviceId: id ? { exact: id } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    });
    let track: MediaStreamTrack;
    try {
      const s = await navigator.mediaDevices
        .getUserMedia({ video: video(prefs.camId || undefined) })
        .catch((e) => (prefs.camId ? navigator.mediaDevices.getUserMedia({ video: video() }) : Promise.reject(e)));
      track = s.getVideoTracks()[0];
    } catch {
      this.error = 'Impossibile accedere alla webcam.';
      return;
    }
    if (this.channelId === null) return track.stop();
    this.camTrack = track;
    this.localStream.addTrack(track);
    this.camPreview = new MediaStream([track]);
    this.camOn = true;
    track.onended = () => this.camTrack === track && this.stopCam();
    this.forReadyPeers((p) => {
      p.camSender = p.pc.addTrack(track, this.localStream);
      this.tuneBitrate(p);
    });
    this.localRev++;
    this.syncPresence();
  }

  stopCam(sync = true) {
    const t = this.camTrack;
    if (!t) return;
    for (const p of Object.values(this.peers)) this.removeSender(p, 'camSender');
    this.localStream.removeTrack(t);
    t.stop();
    this.camTrack = null;
    this.camPreview = null;
    this.camOn = false;
    this.localRev++;
    if (sync) this.syncPresence();
  }

  async toggleScreen() {
    if (this.screenTrack) return this.stopScreen();
    if (!screenShareSupported) {
      this.error = 'Condivisione schermo non supportata qui.';
      return;
    }
    const q = screenSettings();
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getDisplayMedia({
        video: screenVideo(q),
        audio: prefs.screenAudio
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : false,
      });
    } catch {
      return; // annullato dall'utente
    }
    const track = s.getVideoTracks()[0];
    if (!track) return;
    if (this.channelId === null) return s.getTracks().forEach((t) => t.stop());
    track.contentHint = q.hint;
    track.onended = () => this.screenTrack === track && this.stopScreen(); // "Interrompi condivisione" del sistema
    this.screenTrack = track;
    this.screenStream.addTrack(track);
    this.screenPreview = new MediaStream([track]);
    this.screenOn = true;
    // Audio di sistema/scheda (Windows: spunta "Condividi audio" nel selettore).
    const audio = s.getAudioTracks()[0] ?? null;
    if (audio) {
      this.screenAudioTrack = audio;
      this.screenStream.addTrack(audio);
    }
    const w = screenWarning(Math.max(1, Object.keys(this.peers).length));
    this.notice = w.level !== 'ok' ? 'Stream ad alta qualità: se a chi guarda scatta, passa a 720p · 30 fps nelle impostazioni.' : null;
    this.forReadyPeers((p) => {
      p.screenSender = p.pc.addTrack(track, this.screenStream);
      preferHardwareCodec(p.pc, p.screenSender);
      if (audio) p.screenAudioSender = p.pc.addTrack(audio, this.screenStream);
      this.tuneBitrate(p);
    });
    this.localRev++;
    this.syncPresence();
  }

  stopScreen(sync = true) {
    for (const p of Object.values(this.peers)) {
      this.removeSender(p, 'screenSender');
      this.removeSender(p, 'screenAudioSender');
    }
    for (const t of [this.screenTrack, this.screenAudioTrack]) {
      if (!t) continue;
      this.screenStream.removeTrack(t);
      t.stop();
    }
    const had = !!this.screenTrack;
    this.screenTrack = this.screenAudioTrack = null;
    this.screenPreview = null;
    this.screenOn = false;
    this.localRev++;
    if (sync && had) this.syncPresence();
  }

  /** Applica subito le nuove impostazioni di qualità a una condivisione in corso. */
  async applyScreenSettings() {
    const t = this.screenTrack;
    if (!t) return;
    const q = screenSettings();
    t.contentHint = q.hint;
    try {
      await t.applyConstraints(screenVideo(q));
    } catch {
      /* il sistema non permette di cambiarla al volo: varrà alla prossima condivisione */
    }
    for (const p of Object.values(this.peers)) this.tuneBitrate(p);
  }

  /** Spegne webcam e schermo. */
  stopVideo(sync = true) {
    this.stopCam(false);
    this.stopScreen(false);
    if (sync) this.syncPresence();
  }

  async tuneBitrate(p: Peer) {
    const set = async (sender: RTCRtpSender | null, bitrate: number, fps: number, degradation?: RTCDegradationPreference) => {
      if (!sender) return;
      try {
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = bitrate;
        params.encodings[0].maxFramerate = fps;
        if (degradation) params.degradationPreference = degradation;
        await sender.setParameters(params);
      } catch {
        /* non ancora negoziato: riprova a connessione avvenuta */
      }
    };
    await set(p.camSender, CAM_BITRATE, 30);
    const q = screenSettings();
    await set(p.screenSender, q.bitrate, q.fps, q.degradation);
  }

  private syncPresence() {
    app.myPresence.mic = this.micOn && !this.adminMuted;
    app.myPresence.deaf = this.deaf;
    app.myPresence.cam = this.camOn;
    app.myPresence.screen = this.screenOn;
    app.publishPresence();
  }
}

export const voice = new VoiceRoom();

// Se l'utente viene espulso o esce, chiude la chiamata; se un membro viene
// rimosso, chiude subito la connessione diretta con lui.
app.onKicked = () => {
  if (voice.channelId !== null) voice.leave();
};
app.onMemberLeft = (id) => voice.drop(id);

// Diagnostica da console (F12): `await cerchioStats()` mostra cosa viene inviato e
// ricevuto con ogni persona (utile se qualcuno vede nero o non si sente).
(globalThis as { cerchioStats?: () => Promise<unknown> }).cerchioStats = async () => {
  const rows: Record<string, unknown>[] = [];
  for (const p of Object.values(voice.peers)) {
    const stats = await p.pc.getStats();
    stats.forEach((r) => {
      if ((r.type === 'outbound-rtp' || r.type === 'inbound-rtp') && (r.kind === 'video' || r.kind === 'audio')) {
        rows.push({
          con: app.name(p.id),
          dir: r.type === 'outbound-rtp' ? 'invio' : 'ricevo',
          kind: r.kind,
          frames: r.type === 'outbound-rtp' ? r.framesEncoded : r.framesDecoded,
          size: r.frameWidth ? `${r.frameWidth}x${r.frameHeight}` : '',
          fps: r.framesPerSecond ?? '',
          limite: r.qualityLimitationReason ?? '',
          // lato chi guarda: blocchi del video, fotogrammi buttati, ritardo del buffer
          blocchi: r.type === 'inbound-rtp' && r.kind === 'video' ? `${r.freezeCount ?? 0} (${(r.totalFreezesDuration ?? 0).toFixed(1)} s)` : '',
          persi: r.type === 'inbound-rtp' ? `${r.packetsLost ?? 0} pkt / ${r.framesDropped ?? 0} frm` : '',
          buffer:
            r.type === 'inbound-rtp' && r.jitterBufferEmittedCount
              ? `${Math.round((r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000)} ms`
              : '',
          codec: stats.get(r.codecId)?.mimeType ?? '',
          stato: p.connection,
        });
      }
    });
  }
  // rete tra voi (round-trip) dalla coppia ICE attiva
  for (const p of Object.values(voice.peers)) {
    const stats = await p.pc.getStats();
    stats.forEach((r) => {
      if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
        const local = stats.get(r.localCandidateId);
        rows.push({
          con: app.name(p.id),
          dir: 'rete',
          kind: local?.candidateType === 'relay' ? 'via TURN' : 'diretta',
          fps: '',
          frames: '',
          size: '',
          limite: `ping ${Math.round((r.currentRoundTripTime ?? 0) * 1000)} ms`,
          blocchi: '',
          persi: '',
          buffer: '',
          codec: r.availableOutgoingBitrate ? `${Math.round(r.availableOutgoingBitrate / 1000)} kbps disp.` : '',
          stato: p.connection,
        });
      }
    });
  }
  console.table(rows);
  return rows;
};
