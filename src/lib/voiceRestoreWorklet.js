// Gives back the top of the voice after GTCRN (AudioWorklet, 48 kHz, mono).
//
// GTCRN denoises at 16 kHz inside, so everything above ~8 kHz (the "s", the air of
// the voice) comes out 25-45 dB lower: the voice sounds far away, like a phone.
// Input 0 = GTCRN output, input 1 = the microphone before GTCRN. The dry high band
// (> 7.5 kHz) is added back, scaled by how much of the 3-7.5 kHz band GTCRN kept:
// voice there → the high band follows; noise or keys removed there → it stays out.
// The restored band is also capped at 2× the energy GTCRN kept in 3-7.5 kHz: a voice
// never has more on top, a key click has much more. Without the cap the start of a
// click GTCRN lets through opened the band and the whole click top went out
// (measured: audible clicks in the pauses 9% → 44%; with the cap back to 9%).

// GTCRN's latency at 48 kHz in samples (measured): the dry signal is delayed by the
// same amount so the two halves of the spectrum line up.
const GTCRN_DELAY = 1530;
const RING = 2048; // power of two > GTCRN_DELAY
// Band energy below which the dry side counts as silence (~ -70 dBFS): without it
// two near-silent signals give a ratio near 1 and a key click would open the band.
const FLOOR = 1e-7;
// 2nd-order high-pass for the restored band: a 4th-order one is 180° out of phase at
// the crossover and cancels GTCRN's own 6-8 kHz (measured: -6 dB dip instead of ±2 dB).
const CROSSOVER = 7500;
const TILT_CAP = 2;

// RBJ cookbook biquad, transposed direct form II.
class Biquad {
  constructor(type, freq, q) {
    const w = (2 * Math.PI * freq) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const k = type === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2;
    this.b0 = k / a0;
    this.b1 = (type === 'lowpass' ? 1 - cos : -(1 + cos)) / a0;
    this.b2 = k / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    this.z1 = 0;
    this.z2 = 0;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

// 4th-order Butterworth = two 2nd-order sections with these Q values
const BW4 = [0.5412, 1.3066];
const chain = (type, freq) => BW4.map((q) => new Biquad(type, freq, q));
const runChain = (fs, x) => {
  for (const f of fs) x = f.run(x);
  return x;
};
const coef = (ms) => 1 - Math.exp(-1 / ((ms / 1000) * sampleRate));

class VoiceRestoreProcessor extends AudioWorkletProcessor {
  ring = new Float32Array(RING);
  w = 0;
  high = new Biquad('highpass', CROSSOVER, Math.SQRT1_2);
  wetBand = [...chain('highpass', 3000), ...chain('lowpass', 7500)];
  dryBand = [...chain('highpass', 3000), ...chain('lowpass', 7500)];
  eWet = 0;
  eDry = 0;
  g = 0;
  kE = coef(5); // energy smoothing
  kUp = coef(2); // gain attack
  kDown = coef(40); // gain release
  eHigh = 0; // restored band energy, fast attack so a click is caught at once
  kHighUp = coef(0.3);
  kHighDown = coef(20);

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const wet = inputs[0][0];
    const dry = inputs[1][0];
    const { ring } = this;
    for (let i = 0; i < out.length; i++) {
      ring[this.w] = dry ? dry[i] : 0;
      const d = ring[(this.w - GTCRN_DELAY + RING) & (RING - 1)];
      this.w = (this.w + 1) & (RING - 1);
      const y = wet ? wet[i] : 0;

      const a = runChain(this.wetBand, y);
      const b = runChain(this.dryBand, d);
      this.eWet += this.kE * (a * a - this.eWet);
      this.eDry += this.kE * (b * b - this.eDry);
      const target = Math.min(1, Math.sqrt(this.eWet / Math.max(this.eDry, FLOOR)));
      this.g += (target > this.g ? this.kUp : this.kDown) * (target - this.g);

      const hi = this.high.run(d);
      const p = hi * hi;
      this.eHigh += (p > this.eHigh ? this.kHighUp : this.kHighDown) * (p - this.eHigh);
      const cap = Math.min(1, Math.sqrt((TILT_CAP * this.eWet) / Math.max(this.eHigh, 1e-12)));
      out[i] = y + this.g * cap * hi;
    }
    return true;
  }
}

registerProcessor('feder-voice-restore', VoiceRestoreProcessor);

