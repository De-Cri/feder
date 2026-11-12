// Microphone chain:
//   mic (browser echo cancellation + AGC)
//     → mono (downmixed to center)
//     → noise suppression (none / browser standard / RNNoise AI)
//     → optional noise gate
//     → input gain
//     → track sent to the others (+ analyser for the meters)
import { NoiseGateWorkletNode, RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import noiseGateWorkletUrl from '@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

export type NoiseMode = 'off' | 'standard' | 'ai';

export type MicOptions = {
  deviceId: string;
  noise: NoiseMode;
  echoCancellation: boolean;
  autoGain: boolean;
  gain: number; // 0..2
  gateDb: number | null; // e.g. -50; null = off
};

let ctx: AudioContext | null = null;
/** A single 48 kHz AudioContext (required by RNNoise). */
export function audioContext(): AudioContext {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Active microphone chains (call, settings test). When none is left the context
// closes: it frees the audio thread, the worklets and RNNoise's WASM memory
// instead of keeping them alive until the app quits.
let pipelines = 0;
function release() {
  if (--pipelines > 0 || !ctx) return;
  pipelines = 0;
  const c = ctx;
  ctx = null;
  c.close().catch(() => {});
}

let rnnoiseWasm: Promise<ArrayBuffer> | null = null;
const loadedWorklets = new WeakMap<AudioContext, Set<string>>();

async function addWorklet(c: AudioContext, url: string) {
  let set = loadedWorklets.get(c);
  if (!set) loadedWorklets.set(c, (set = new Set()));
  if (set.has(url)) return;
  await c.audioWorklet.addModule(url);
  set.add(url);
}

export class MicPipeline {
  readonly raw: MediaStream;
  readonly track: MediaStreamTrack;
  readonly stream: MediaStream;
  /** true if AI was requested but couldn't be loaded. */
  aiFallback = false;
  /** true if the chosen microphone wasn't available and the default one is used. */
  deviceFallback = false;
  /** Name of the microphone actually in use. */
  get deviceLabel(): string {
    return this.raw.getAudioTracks()[0]?.label ?? '';
  }
  private gainNode: GainNode;
  private analyserNode: AnalyserNode;
  private nodes: AudioNode[] = [];
  private buf: Float32Array<ArrayBuffer>;
  private stopped = false;

  private constructor(raw: MediaStream, out: MediaStream, gain: GainNode, an: AnalyserNode, nodes: AudioNode[]) {
    this.raw = raw;
    this.stream = out;
    this.track = out.getAudioTracks()[0];
    this.gainNode = gain;
    this.analyserNode = an;
    this.nodes = nodes;
    this.buf = new Float32Array(an.fftSize);
  }

  static async create(o: MicOptions): Promise<MicPipeline> {
    const audio = (deviceId?: string): MediaTrackConstraints => ({
      // "exact": with "ideal" Chromium may ignore the choice and stay on the default.
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: o.echoCancellation,
      noiseSuppression: o.noise === 'standard',
      autoGainControl: o.autoGain,
      channelCount: 1,
    });
    // Count it right away: another chain stopping while this one is being created
    // must not close the context under our feet.
    pipelines++;
    try {
      return await MicPipeline.build(o, audio);
    } catch (e) {
      release();
      throw e;
    }
  }

  private static async build(o: MicOptions, audio: (deviceId?: string) => MediaTrackConstraints): Promise<MicPipeline> {
    let raw: MediaStream;
    let deviceFallback = false;
    try {
      raw = await navigator.mediaDevices.getUserMedia({ audio: audio(o.deviceId || undefined), video: false });
    } catch (e) {
      // device unplugged or id no longer valid: fall back to the default
      if (!o.deviceId) throw e;
      raw = await navigator.mediaDevices.getUserMedia({ audio: audio(), video: false });
      deviceFallback = true;
    }
    const c = audioContext();
    const nodes: AudioNode[] = [];
    const src = c.createMediaStreamSource(raw);
    nodes.push(src);

    // Force mono. Some audio interfaces expose the microphone on two channels (one
    // empty): without this step the voice comes from one side only. The downmix
    // centers it. If the volume suddenly drops, raise the input gain.
    const mono = c.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    mono.channelInterpretation = 'speakers';
    src.connect(mono);
    nodes.push(mono);

    let last: AudioNode = mono;
    let aiFallback = false;

    if (o.noise === 'ai') {
      try {
        rnnoiseWasm ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdUrl });
        const [wasmBinary] = await Promise.all([rnnoiseWasm, addWorklet(c, rnnoiseWorkletUrl)]);
        const rn = new RnnoiseWorkletNode(c, { wasmBinary, maxChannels: 1 });
        last.connect(rn);
        last = rn;
        nodes.push(rn);
      } catch (e) {
        console.warn('RNNoise not available', e);
        rnnoiseWasm = null;
        aiFallback = true;
      }
    }

    if (o.gateDb !== null) {
      try {
        await addWorklet(c, noiseGateWorkletUrl);
        const gate = new NoiseGateWorkletNode(c, {
          openThreshold: o.gateDb,
          closeThreshold: o.gateDb - 6,
          holdMs: 250,
          maxChannels: 1,
        });
        last.connect(gate);
        last = gate;
        nodes.push(gate);
      } catch (e) {
        console.warn('Noise gate not available', e);
      }
    }

    const gain = c.createGain();
    gain.gain.value = o.gain;
    last.connect(gain);
    nodes.push(gain);

    const dest = c.createMediaStreamDestination();
    gain.connect(dest);
    const an = c.createAnalyser();
    an.fftSize = 1024;
    gain.connect(an);
    nodes.push(an, dest);

    const p = new MicPipeline(raw, dest.stream, gain, an, nodes);
    p.aiFallback = aiFallback;
    p.deviceFallback = deviceFallback;
    return p;
  }

  setGain(v: number) {
    // this chain's context (audioContext() would create a new one if closed)
    this.gainNode.gain.setTargetAtTime(v, this.gainNode.context.currentTime, 0.02);
  }

  /** Level in dBFS (≈ -100 silence, 0 max). */
  levelDb(): number {
    this.analyserNode.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    const rms = Math.sqrt(sum / this.buf.length);
    return rms > 0 ? 20 * Math.log10(rms) : -100;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.raw.getTracks().forEach((t) => t.stop());
    this.track.stop();
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
      if (n instanceof RnnoiseWorkletNode) n.destroy?.();
    }
    this.nodes = [];
    release();
  }
}

/** Level (dBFS) → 0..1 for the meter bars (-70..0 dB scale). */
export function dbToMeter(db: number): number {
  return Math.min(1, Math.max(0, (db + 70) / 70));
}