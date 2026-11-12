// Peer-to-peer voice/video (mesh): every participant connects directly to the others.
// Signaling via Supabase Realtime (private channel, members only) with the
// "perfect negotiation" pattern to handle simultaneous offers and renegotiations.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { app, presenceBudget as budget, type SignalBatch } from './state.svelte';
import { prefs, micOptions } from './prefs.svelte';
import { config } from './config';
import { MicPipeline, audioContext } from './audio';
import { isHidden } from './platform';
import { playSound } from './sounds';
import { screenSettings } from './screenQuality';
import { t } from './i18n.svelte';

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
  /** id of the sender's screen stream (null = not sharing). */
  screen?: string | null;
  /** id of the sender's connection: if it changes, the other side recreated it from scratch. */
  sid?: string;
  /** whether the sender is watching (true) or not (false) your shared screen */
  watch?: boolean;
};

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const CAM_BITRATE = 900_000; // 5-person mesh: ~0.9 Mbps upload per peer
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
    /* fall back to STUN only */
  }
  return STUN;
}

// ---------------------------------------------------------------------------
// "Is speaking" for remote streams (AnalyserNode on the shared context).
// Uses the microphone's AudioContext: one more context would mean another
// audio thread and another open output, just to measure a level.
// ---------------------------------------------------------------------------
function analyser(stream: MediaStream, onLevel: (speaking: boolean) => void): () => void {
  try {
    const c = audioContext();
    const src = c.createMediaStreamSource(stream);
    const an = c.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    let hold = 0;
    const t = setInterval(() => {
      if (isHidden()) return; // hidden window: nobody sees the indicator
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
      an.disconnect();
    };
  } catch {
    return () => {};
  }
}

/**
 * On Windows H.264 is encoded by the graphics card: much less CPU and a
 * smoother stream. We put it first (the others stay as fallback).
 * On Linux Chromium encodes in software anyway, so VP8 stays.
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
    /* preference not applicable: use the default */
  }
}

/**
 * Screen capture constraints. `ideal` alone isn't enough: on 1440p/4K monitors
 * Chromium captured at native resolution and every mesh peer encoded that
 * stream (CPU maxed out = lag). The `max` values are needed.
 */
function screenVideo(q: { fps: number; height: number }): MediaTrackConstraints {
  return {
    frameRate: { ideal: q.fps, max: q.fps },
    height: { ideal: q.height, max: q.height },
    width: { max: Math.round((q.height * 16) / 9) },
  };
}

/** Adds x-google-start/min-bitrate to the SDP's video codecs (kbps). */
export function boostVideoBitrate(sdp: string, start = 1500, min = 300): string {
  if (!sdp.includes('m=video')) return sdp;
  const lines = sdp.split('\r\n');
  const out: string[] = [];
  let inVideo = false;
  const seenFmtp = new Set<string>();
  const videoPts: string[] = [];
  // closes the video section adding the missing fmtp lines
  const flush = () => {
    for (const pt of videoPts) if (!seenFmtp.has(pt)) out.push(`a=fmtp:${pt} x-google-start-bitrate=${start};x-google-min-bitrate=${min}`);
  };
  for (const line of lines) {
    if (line.startsWith('m=')) {
      if (inVideo) flush();
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
    // video section at the end: insert before the final empty line
    const tail = out.length && out[out.length - 1] === '' ? out.pop() : undefined;
    flush();
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
  /** All received remote tracks (diagnostics). */
  stream = new MediaStream();
  /** Audio to play, one stream per source (microphone, screen audio). */
  audioStreams = $state<{ key: string; stream: MediaStream }[]>([]);
  audioSender: RTCRtpSender | null = null;
  camSender: RTCRtpSender | null = null;
  screenSender: RTCRtpSender | null = null;
  screenAudioSender: RTCRtpSender | null = null;
  /** Is the other side watching my screen? If not, my stream to them is paused.
   *  Starts as true: old versions don't say it and always show it. */
  wantsScreen = true;
  /**
   * Senders left idle after turning webcam/screen off. When turned back on, the
   * same transceiver is reused: with addTrack a new one was created every time
   * (+2 for every screen share, on both sides, never freed).
   */
  idle: Partial<Record<SenderKey, RTCRtpSender>> = {};
  private stopAnalyser: (() => void) | null = null;
  /** Key of the audio stream the analyser runs on. */
  private analysedKey: string | null = null;
  private streamMap = new Map<string, MediaStream>();

  /** id of the other side's screen stream (undefined = old version, doesn't send it). */
  screenStreamId: string | null | undefined = undefined;
  private camTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  /** A new stream for every video track: the <video> never sticks to an old (black) track. */
  camView = $state<MediaStream | null>(null);
  screenView = $state<MediaStream | null>(null);
  hasCam = $state(false);
  hasScreen = $state(false);
  speaking = $state(false);
  connection = $state<RTCPeerConnectionState>('new');
  rev = $state(0);
  sid = crypto.randomUUID();
  remoteSid: string | undefined;

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
        // Screen or webcam? The stream id the other side sent us tells.
        const isScreen = !!streams[0] && streams[0].id === this.screenStreamId;
        if (isScreen) {
          // A slightly larger buffer (150 ms) absorbs network jitter: smoother stream.
          try {
            const r = this.pc.getReceivers().find((x) => x.track === track) as RTCRtpReceiver & { jitterBufferTarget?: number };
            if (r && 'jitterBufferTarget' in r) r.jitterBufferTarget = 150;
          } catch {
            /* not supported */
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
        if (!this.stopAnalyser) {
          this.stopAnalyser = analyser(s, (v) => (this.speaking = v));
          this.analysedKey = key;
        }
      }
      track.onmute = track.onunmute = () => this.refresh();
      track.onended = () => {
        this.forget(track);
        this.refresh();
      };
      this.refresh();
    };

    this.pc.onconnectionstatechange = () => {
      this.connection = this.pc.connectionState;
      if (this.pc.connectionState === 'failed') this.pc.restartIce();
      if (this.pc.connectionState === 'connected') this.room.tuneBitrate(this);
    };

    // Avoid crossed offers on the first connection (they cause lost ICE candidates
    // in Chromium): the lower id offers right away, the other adds its
    // tracks when the offer arrives (or after 2.5 s if it doesn't).
    if (!this.polite) this.attachLocalTracks();
    else this.attachTimer = setTimeout(() => this.attachLocalTracks(), 2500);

    // Watchdog: after 10 s without connection restart ICE; after 20 s recreate the connection.
    // Otherwise a lost signal (offer/answer) leaves one side on "connecting…"
    // forever, while the other keeps the old one; the new `sid` realigns the other side.
    let stuck = 0;
    this.watchdog = setInterval(() => {
      const st = this.pc.connectionState;
      if (st === 'connected' || st === 'closed') return void (stuck = 0);
      if (++stuck >= 2) return room.recreate(id);
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

  /** Tracks added later (webcam/screen) go through here only once connected. */
  get ready() {
    return this.attached;
  }

  /**
   * A remote track won't receive anything anymore (the other side removed webcam/screen,
   * or it ended): drop it from every reference, so <video>/<audio> and their buffers
   * are freed instead of staying attached to a silent track.
   */
  private forget(track: MediaStreamTrack) {
    this.stream.removeTrack(track);
    if (track === this.camTrack) {
      this.camTrack = null;
      this.camView = null;
    }
    if (track === this.screenTrack) {
      this.screenTrack = null;
      this.screenView = null;
    }
    if (track.kind !== 'audio') return;
    for (const [key, s] of this.streamMap) {
      if (!s.getTracks().includes(track)) continue;
      s.removeTrack(track);
      if (s.getTracks().length) continue;
      this.streamMap.delete(key);
      this.audioStreams = this.audioStreams.filter((a) => a.key !== key);
      if (this.analysedKey === key) {
        this.stopAnalyser?.();
        this.stopAnalyser = null;
        this.analysedKey = null;
        this.speaking = false;
      }
    }
  }

  /**
   * After each negotiation: transceivers the other side no longer sends on
   * (removeTrack on their side → sendonly/inactive) have a track
   * that would stay silent forever. Chromium doesn't end it: we do.
   */
  private prune() {
    let changed = false;
    for (const tr of this.pc.getTransceivers()) {
      const d = tr.currentDirection;
      if (d !== 'sendonly' && d !== 'inactive' && d !== 'stopped') continue;
      const t = tr.receiver.track;
      if (!this.stream.getTracks().includes(t)) continue;
      this.forget(t);
      changed = true;
    }
    if (changed) this.refresh();
  }

  refresh() {
    const live = (t: MediaStreamTrack | null) => !!t && t.readyState === 'live' && !t.muted;
    this.hasCam = live(this.camTrack);
    this.hasScreen = live(this.screenTrack);
    this.rev++;
  }

  /** Is the audio with this key the shared screen's audio (not the voice)? */
  isScreenAudio(key: string) {
    return !!this.screenStreamId && key === this.screenStreamId;
  }

  /** Compatibility (tests and old code): there is at least one active video. */
  get hasVideo() {
    return this.hasCam || this.hasScreen;
  }

  // Signals must be applied in order: an ICE candidate processed before the
  // remote description is set would be lost.
  private queue: Promise<void> = Promise.resolve();
  /** Diagnostic counters (useful in tests). */
  stats = { sent: 0, recv: 0, candErr: 0, ignored: 0 };
  handle(sig: Signal) {
    this.remoteSid ??= sig.sid;
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
        // Fast video start: without it, Chromium starts at ~300 kbps and the screen
        // stays blurry for tens of seconds. If the browser rejects the change
        // the original description is used.
        try {
          await pc.setRemoteDescription({ type: d.type, sdp: boostVideoBitrate(d.sdp ?? '') });
        } catch {
          await pc.setRemoteDescription(d);
        }
        if (d.type === 'offer') {
          // Added after the offer, the tracks reuse the already negotiated transceivers.
          this.attachLocalTracks();
          await pc.setLocalDescription();
          this.room.send(this.id, { description: pc.localDescription!.toJSON(), screen: this.room.screenStreamIdIfActive });
        }
        this.prune(); // negotiation done (answer applied): directions are up to date
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
    this.stopAnalyser = null;
    this.pc.close();
    this.stream.getTracks().forEach((t) => t.stop());
    // No leftover references: the components showing them release them right away.
    this.streamMap.clear();
    this.audioStreams = [];
    this.camView = this.screenView = null;
    this.camTrack = this.screenTrack = null;
    this.speaking = false;
  }
}

type SenderKey = 'camSender' | 'screenSender' | 'screenAudioSender';

// ---------------------------------------------------------------------------
class VoiceRoom {
  channelId = $state<number | null>(null);
  peers = $state<Record<string, Peer>>({});
  micOn = $state(true);
  deaf = $state(false);
  camOn = $state(false);
  screenOn = $state(false);
  /** Local previews: one stream for the webcam and one for the screen. */
  camPreview = $state<MediaStream | null>(null);
  screenPreview = $state<MediaStream | null>(null);
  localSpeaking = $state(false);
  localRev = $state(0);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);
  joining = $state(false);
  /** Screen shares you chose to watch (key = sharer's id). */
  watching = $state<Record<string, true>>({});

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
  /** Signals waiting to be relayed by the server, per recipient, sent in order and in batches. */
  private outbox: Record<string, { queue: Record<string, unknown>[]; busy: boolean }> = {};
  /** voice_join / voice_leave run one after another, so a slow leave can't undo the next join. */
  private roomOp: Promise<unknown> = Promise.resolve();
  /** Re-reads the room presence (called when the server's room registry changes). */
  private resyncRoom: (() => void) | null = null;

  constructor() {
    app.onSignal = (batch) => this.receive(batch);
    app.onRoomsChange = () => this.resyncRoom?.();
  }

  private registerRoom(channelId: number | null) {
    const op = this.roomOp.then(() =>
      channelId === null ? supabase.rpc('voice_leave') : supabase.rpc('voice_join', { p_channel: channelId }),
    );
    this.roomOp = op.catch(() => {});
    return op;
  }
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private rebuilding: Promise<void> | null = null;

  get adminMuted() {
    return !!app.voiceMutes[this.me];
  }

  private joinSeq = 0;

  async join(channelId: number) {
    if (this.channelId === channelId) return;
    if (!rtcSupported) {
      this.error = t('voice.noWebrtc');
      return;
    }
    // A click on another channel also cancels a join still in progress.
    if (this.channelId !== null || this.joining) await this.leave(true);
    const seq = ++this.joinSeq;
    this.joining = true;
    this.error = null;
    this.me = app.me!;
    try {
      const [mic, ice] = await Promise.all([MicPipeline.create(micOptions()), loadIceServers()]);
      if (seq !== this.joinSeq) return mic.stop(); // superseded by another click
      this.ice = ice;
      this.setMic(mic);
    } catch (e) {
      this.joining = false;
      this.error = t('voice.micError', { reason: String((e as Error).message ?? e) });
      return;
    }

    this.channelId = channelId;
    // The server records which room we're in: signaling is relayed only between
    // people in the same room, and the others use it to trust our presence.
    const { error: joinError } = (await this.registerRoom(channelId)) as { error: { message: string } | null };
    if (seq !== this.joinSeq) return;
    if (joinError) {
      await this.leave(true);
      this.error = t('voice.joinFailed');
      return;
    }
    await supabase.realtime.setAuth();
    if (seq !== this.joinSeq) return;
    // Presence only: signaling goes through the server (voice_signal), never through this channel.
    const rt = supabase.channel(`cerchio:voice:${channelId}`, {
      config: { private: true, presence: { key: this.me } },
    });
    this.rt = rt;
    let known: Set<string> | null = null; // who was there when I joined (no sound for them)
    let settledAt = Infinity; // until shortly after joining, state may arrive in pieces
    let subscribed = false;
    let retrack: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      const state = rt.presenceState();
      // If the server lost us from the room, we show up again (the others wouldn't see us).
      if (subscribed && !(this.me in state)) {
        clearTimeout(retrack);
        retrack = setTimeout(() => {
          if (this.rt !== rt || this.me in rt.presenceState()) return;
          budget.take();
          rt.track({ at: Date.now() });
        }, Math.max(800, budget.wait()));
      }
      // Only people the server agrees are in this room: presence keys can be forged.
      const ids = new Set(Object.keys(state).filter((id) => id === this.me || app.voiceRooms[id] === channelId));
      app.room = { channel: channelId, ids: [this.me, ...[...ids].filter((id) => id !== this.me && app.members.some((m) => m.user_id === id))] };
      ids.delete(this.me);
      // Only the lower id starts the connection; the other answers the offer.
      for (const id of ids) {
        if (!app.members.some((m) => m.user_id === id)) continue;
        if (this.me < id) this.peer(id);
        else
          // Safety net: if the other side doesn't show up, I start.
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
    };
    this.resyncRoom = () => this.rt === rt && sync();
    rt.on('presence', { event: 'sync' }, sync)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          budget.take();
          await rt.track({ at: Date.now() });
          subscribed = true;
          this.joining = false;
          settledAt = Date.now() + 1500;
          playSound('selfJoin');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.error = t('voice.joinFailed');
        }
      });

    app.myPresence.voice = channelId;
    this.syncPresence();
  }

  /** @param switching true when moving to another channel (no leave sound). */
  async leave(switching = false) {
    this.joinSeq++; // cancels joins in progress
    if (this.channelId !== null && !switching) playSound('selfLeave');
    const rt = this.rt;
    const wasInRoom = this.channelId !== null;
    this.rt = null;
    this.resyncRoom = null;
    if (rt) await supabase.removeChannel(rt);
    // when switching, the next voice_join replaces the room anyway
    if (wasInRoom && !switching) void this.registerRoom(null);
    for (const id of Object.keys(this.peers)) this.drop(id);
    this.outbox = {};
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
    this.watching = {};
    app.myPresence.voice = null;
    app.room = { channel: null, ids: [] };
    this.syncPresence();
  }

  /** Queues a signal for `to`: the server relays it (voice_signal) with our verified id. */
  send(to: string, sig: Omit<Signal, 'from' | 'to' | 'sid'>) {
    if (this.channelId === null) return;
    const box = (this.outbox[to] ??= { queue: [], busy: false });
    box.queue.push({ ...sig, sid: this.peers[to]?.sid });
    if (!box.busy) void this.flush(to, box);
  }

  // One request at a time per recipient, so signals arrive in order (an ICE candidate
  // before its offer would be lost); whatever queues up meanwhile goes in the next batch.
  private async flush(to: string, box: { queue: Record<string, unknown>[]; busy: boolean }) {
    box.busy = true;
    try {
      while (box.queue.length && this.outbox[to] === box) {
        const batch = box.queue.splice(0, 50);
        const { error } = await supabase.rpc('voice_signal', { p_to: to, p_signals: batch });
        // not delivered (e.g. they just left): the connection watchdog recovers if needed
        if (error) console.warn('[voice] signal not delivered:', error.message);
      }
    } finally {
      box.busy = false;
    }
  }

  /** Signals relayed by the server: the sender is verified, and they're in our room. */
  private receive(batch: SignalBatch) {
    if (this.channelId === null || batch.from === this.me) return;
    if (!app.members.some((m) => m.user_id === batch.from)) return;
    for (const raw of batch.signals) this.handleSignal({ ...(raw as Omit<Signal, 'from' | 'to'>), from: batch.from, to: this.me });
  }

  private handleSignal(sig: Signal) {
    if (!app.members.some((m) => m.user_id === sig.from)) return;
    // The other side recreated the connection (e.g. presence lost us for a moment)
    // while we keep the old one, still "connected": their new offer would
    // never stick and they would stay on "connecting…". We recreate ours too.
    const old = this.peers[sig.from];
    if (old?.remoteSid && sig.sid && sig.sid !== old.remoteSid) {
      if (sig.description?.type !== 'offer') return; // leftovers of the old connection
      this.drop(sig.from);
    }
    if (sig.watch !== undefined) {
      if (old && old.wantsScreen !== sig.watch) {
        old.wantsScreen = sig.watch;
        void this.tuneBitrate(old);
      }
      return;
    }
    this.peer(sig.from).handle(sig);
  }

  private peer(id: string): Peer {
    return (this.peers[id] ??= new Peer(id, this, this.ice));
  }

  recreate(id: string) {
    if (!this.peers[id]) return;
    this.drop(id);
    this.peer(id);
  }

  drop(id: string) {
    delete this.outbox[id];
    const p = this.peers[id];
    if (!p) return;
    p.close();
    delete this.peers[id];
  }

  // ---- microphone --------------------------------------------------------
  private setMic(mic: MicPipeline) {
    const old = this.audioTrack;
    if (old) this.localStream.removeTrack(old);
    this.mic = mic;
    this.audioTrack = mic.track;
    this.localStream.addTrack(mic.track);
    this.applyMic();
    if (mic.aiFallback) this.notice = t('voice.aiFallback');
    else if (mic.deviceFallback) this.notice = t('voice.deviceFallback');
    else this.notice = null;
    if (this.meterTimer) clearInterval(this.meterTimer);
    let hold = 0;
    this.meterTimer = setInterval(() => {
      if (!this.mic || !this.effectiveMic) {
        this.localSpeaking = false;
        return;
      }
      if (isHidden()) return; // hidden window: the indicator isn't visible
      const threshold = prefs.gateEnabled ? prefs.gateDb : SPEAKING_DB;
      if (this.mic.levelDb() > threshold) hold = 3;
      else if (hold > 0) hold--;
      this.localSpeaking = hold > 0;
    }, 100);
  }

  /** Rebuilds the microphone chain (device/suppression/gate change) without leaving. */
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
        this.error = t('voice.rebuildFailed');
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

  // ---- video: webcam and screen are independent (even together) ---------
  /** id of the screen stream to send to the others (null if not sharing). */
  get screenStreamIdIfActive(): string | null {
    return this.screenTrack ? this.screenStream.id : null;
  }

  private forReadyPeers(fn: (p: Peer) => void) {
    for (const p of Object.values(this.peers)) if (p.ready) fn(p); // the others get everything when they connect
  }

  private removeSender(p: Peer, key: SenderKey) {
    const sender = p[key];
    if (!sender) return;
    try {
      // The transceiver stays (it only stops sending): viewers see the track
      // go off as before, and we reuse it next time.
      p.pc.removeTrack(sender);
      p.idle[key] = sender;
    } catch {
      /* connection already closed */
    }
    p[key] = null;
  }

  /**
   * Starts sending `track`: on the transceiver last used for the same purpose
   * if there is one (same SDP line, no new transceivers every time),
   * otherwise with addTrack as usual. For the receiver it's identical: the line
   * becomes active again with the same stream id, so old versions still
   * recognize it (screen or webcam) as before.
   */
  private addSender(p: Peer, key: SenderKey, track: MediaStreamTrack, stream: MediaStream): RTCRtpSender {
    const old = p.idle[key];
    delete p.idle[key];
    const tr = old && p.pc.getTransceivers().find((t) => t.sender === old);
    if (old && tr && tr.direction !== 'stopped' && tr.currentDirection !== 'stopped' && !old.track) {
      try {
        old.setStreams?.(stream);
        void old.replaceTrack(track).catch(() => {});
        // the inverse of removeTrack: recvonly → sendrecv, inactive → sendonly
        tr.direction = tr.direction === 'inactive' || tr.direction === 'sendonly' ? 'sendonly' : 'sendrecv';
        return old;
      } catch {
        /* not reusable: create a new one */
      }
    }
    return p.pc.addTrack(track, stream);
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
      this.error = t('voice.camError');
      return;
    }
    if (this.channelId === null) return track.stop();
    this.camTrack = track;
    this.localStream.addTrack(track);
    this.camPreview = new MediaStream([track]);
    this.camOn = true;
    track.onended = () => this.camTrack === track && this.stopCam();
    this.forReadyPeers((p) => {
      p.camSender = this.addSender(p, 'camSender', track, this.localStream);
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
    t.onended = null;
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
      this.error = t('voice.screenUnsupported');
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
      return; // cancelled by the user
    }
    const track = s.getVideoTracks()[0];
    const audio = s.getAudioTracks()[0] ?? null;
    // Extra tracks we don't use: stop them now, or the capture stays open.
    for (const t of s.getTracks()) if (t !== track && t !== audio) t.stop();
    if (!track || this.channelId === null) return s.getTracks().forEach((t) => t.stop());
    track.contentHint = q.hint;
    track.onended = () => this.screenTrack === track && this.stopScreen(); // the system's "Stop sharing"
    this.screenTrack = track;
    this.screenStream.addTrack(track);
    this.screenPreview = new MediaStream([track]);
    this.screenOn = true;
    // System/tab audio (Windows: "Share audio" checkbox in the picker).
    if (audio) {
      this.screenAudioTrack = audio;
      this.screenStream.addTrack(audio);
    }
    this.forReadyPeers((p) => {
      p.screenSender = this.addSender(p, 'screenSender', track, this.screenStream);
      preferHardwareCodec(p.pc, p.screenSender);
      if (audio) p.screenAudioSender = this.addSender(p, 'screenAudioSender', audio, this.screenStream);
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
      t.onended = null;
      t.stop();
    }
    const had = !!this.screenTrack;
    this.screenTrack = this.screenAudioTrack = null;
    this.screenPreview = null;
    this.screenOn = false;
    this.localRev++;
    if (sync && had) this.syncPresence();
  }

  /** Applies new quality settings to an ongoing share right away. */
  async applyScreenSettings() {
    const t = this.screenTrack;
    if (!t) return;
    const q = screenSettings();
    t.contentHint = q.hint;
    try {
      await t.applyConstraints(screenVideo(q));
    } catch {
      /* the system doesn't allow changing it on the fly: it applies to the next share */
    }
    for (const p of Object.values(this.peers)) this.tuneBitrate(p);
  }

  /** Turns webcam and screen off. */
  stopVideo(sync = true) {
    this.stopCam(false);
    this.stopScreen(false);
    if (sync) this.syncPresence();
  }

  async tuneBitrate(p: Peer) {
    const set = async (sender: RTCRtpSender | null, enc: RTCRtpEncodingParameters, degradation?: RTCDegradationPreference) => {
      if (!sender) return;
      try {
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        Object.assign(params.encodings[0], enc);
        if (degradation) params.degradationPreference = degradation;
        await sender.setParameters(params);
      } catch {
        /* not negotiated yet: retry once connected */
      }
    };
    await set(p.camSender, { maxBitrate: CAM_BITRATE, maxFramerate: 30 });
    const q = screenSettings();
    // Whoever isn't watching my screen doesn't receive it: no wasted encoding or bandwidth.
    const active = p.wantsScreen;
    await set(p.screenSender, { maxBitrate: q.bitrate, maxFramerate: q.fps, active }, q.degradation);
    await set(p.screenAudioSender, { active });
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

// If the user is kicked or leaves, close the call; if a member is
// removed, close the direct connection with them right away.
app.onKicked = () => {
  if (voice.channelId !== null) voice.leave();
};
app.onMemberLeft = (id) => voice.drop(id);

// Console diagnostics (F12): `await cerchioStats()` shows what is sent and
// received with each person (useful if someone sees black or can't be heard).
(globalThis as { cerchioStats?: () => Promise<unknown> }).cerchioStats = async () => {
  const rows: Record<string, unknown>[] = [];
  for (const p of Object.values(voice.peers)) {
    const stats = await p.pc.getStats();
    stats.forEach((r) => {
      // network between you (round-trip) from the active ICE pair
      if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
        rows.push({
          peer: app.name(p.id),
          dir: 'network',
          kind: stats.get(r.localCandidateId)?.candidateType === 'relay' ? 'via TURN' : 'direct',
          limit: `ping ${Math.round((r.currentRoundTripTime ?? 0) * 1000)} ms`,
          codec: r.availableOutgoingBitrate ? `${Math.round(r.availableOutgoingBitrate / 1000)} kbps avail.` : '',
          state: p.connection,
        });
      }
      if ((r.type === 'outbound-rtp' || r.type === 'inbound-rtp') && (r.kind === 'video' || r.kind === 'audio')) {
        rows.push({
          peer: app.name(p.id),
          dir: r.type === 'outbound-rtp' ? 'send' : 'recv',
          kind: r.kind,
          frames: r.type === 'outbound-rtp' ? r.framesEncoded : r.framesDecoded,
          size: r.frameWidth ? `${r.frameWidth}x${r.frameHeight}` : '',
          fps: r.framesPerSecond ?? '',
          limit: r.qualityLimitationReason ?? '',
          // viewer side: video freezes, dropped frames, buffer delay
          freezes: r.type === 'inbound-rtp' && r.kind === 'video' ? `${r.freezeCount ?? 0} (${(r.totalFreezesDuration ?? 0).toFixed(1)} s)` : '',
          lost: r.type === 'inbound-rtp' ? `${r.packetsLost ?? 0} pkt / ${r.framesDropped ?? 0} frm` : '',
          buffer:
            r.type === 'inbound-rtp' && r.jitterBufferEmittedCount
              ? `${Math.round((r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000)} ms`
              : '',
          codec: stats.get(r.codecId)?.mimeType ?? '',
          state: p.connection,
        });
      }
    });
  }
  console.table(rows);
  return rows;
};
