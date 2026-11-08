// Catena del microfono:
//   mic (cancellazione eco + AGC del browser)
//     → soppressione rumore (nessuna / standard del browser / RNNoise AI)
//     → noise gate opzionale (soglia di attivazione)
//     → guadagno di input
//     → traccia inviata agli altri (+ analizzatore per i meter)
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
  gateDb: number | null; // es. -50; null = disattivato
};

let ctx: AudioContext | null = null;
/** Un solo AudioContext a 48 kHz (richiesto da RNNoise). */
export function audioContext(): AudioContext {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
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
  /** true se è stata chiesta l'AI ma non è stato possibile caricarla. */
  aiFallback = false;
  private gainNode: GainNode;
  private analyserNode: AnalyserNode;
  private nodes: AudioNode[] = [];
  private buf: Float32Array<ArrayBuffer>;

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
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: o.deviceId ? { ideal: o.deviceId } : undefined,
        echoCancellation: o.echoCancellation,
        noiseSuppression: o.noise === 'standard',
        autoGainControl: o.autoGain,
        channelCount: 1,
      },
      video: false,
    });
    const c = audioContext();
    const nodes: AudioNode[] = [];
    const src = c.createMediaStreamSource(raw);
    nodes.push(src);
    let last: AudioNode = src;
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
        console.warn('RNNoise non disponibile', e);
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
        console.warn('Noise gate non disponibile', e);
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
    return p;
  }

  setGain(v: number) {
    this.gainNode.gain.setTargetAtTime(v, audioContext().currentTime, 0.02);
  }

  /** Livello in dBFS (≈ -100 silenzio, 0 massimo). */
  levelDb(): number {
    this.analyserNode.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    const rms = Math.sqrt(sum / this.buf.length);
    return rms > 0 ? 20 * Math.log10(rms) : -100;
  }

  stop() {
    this.raw.getTracks().forEach((t) => t.stop());
    this.track.stop();
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* già scollegato */
      }
      if (n instanceof RnnoiseWorkletNode) n.destroy?.();
    }
  }
}

/** Livello (dBFS) → 0..1 per le barre dei meter (scala -70..0 dB). */
export function dbToMeter(db: number): number {
  return Math.min(1, Math.max(0, (db + 70) / 70));
}
