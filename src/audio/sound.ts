import type { LandingQuality } from '../sim/tricks';
import type { SnowType } from '../sim/tuning';

// Every sound is synthesized with WebAudio from filtered noise and a few tones, so there are no
// audio files to download or license. Like the renderer, this only reads riding state.

/** What the rider is doing this frame, for the continuous layers (wind, snow, rail). */
export interface SoundFrame {
  speed: number;
  grounded: boolean;
  crashed: boolean;
  edge: number;
  skidding: boolean;
  snow: SnowType;
  /** 'rail' or 'box' while grinding, otherwise null. */
  grind: 'rail' | 'box' | null;
}

/** How each snow type sounds under the edges: band centre (Hz), sharpness, loudness. */
const SNOW_VOICE: Record<SnowType, { freq: number; q: number; gain: number }> = {
  groomed: { freq: 950, q: 0.8, gain: 1 },
  powder: { freq: 420, q: 0.6, gain: 0.8 },
  ice: { freq: 2700, q: 1.6, gain: 1.15 },
};

const NOTES: Record<LandingQuality, number[]> = {
  clean: [1046.5, 1568],
  solid: [784, 1046.5],
  sketchy: [523.3],
};

interface Layer {
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private wind!: Layer;
  private snow!: Layer;
  private railHiss!: Layer;
  private railRing!: Layer;
  private boxScrape!: Layer;
  private meter: AnalyserNode | null = null;
  private meterData: Float32Array<ArrayBuffer> | null = null;
  muted = false;
  /** Weather wind (m/s), a gusting floor under the wind of your own speed. */
  private gusts = 0;
  private gustPhase = 0;

  constructor(target: Window) {
    // Browsers only allow audio after the player presses something.
    const unlock = () => this.unlock();
    target.addEventListener('keydown', unlock);
    target.addEventListener('pointerdown', unlock);
  }

  get state(): string {
    if (this.muted) return 'muted';
    return this.ctx?.state ?? 'off';
  }

  /** Loudness (RMS, 0..1) of what is playing right now; for play tests. */
  level(): number {
    if (!this.meter || !this.meterData) return 0;
    this.meter.getFloatTimeDomainData(this.meterData);
    let sum = 0;
    for (const v of this.meterData) sum += v * v;
    return Math.sqrt(sum / this.meterData.length);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    // A gentle limiter so landings stacked on wind never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 1024;
    this.meterData = new Float32Array(this.meter.fftSize);
    comp.connect(this.meter);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.wind = this.layer('lowpass', 400, 0.7);
    this.snow = this.layer('bandpass', 950, 0.8);
    this.railHiss = this.layer('bandpass', 3400, 9);
    this.railRing = this.layer('bandpass', 5300, 14);
    this.boxScrape = this.layer('bandpass', 700, 1.8);
  }

  /** A looping noise source through one filter, silent until update() raises it. */
  private layer(type: BiquadFilterType, freq: number, q: number): Layer {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // Start each layer at a different point in the noise so they don't phase together.
    src.start(0, Math.random() * 2);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    return { filter, gain };
  }

  private set(param: AudioParam, value: number, smoothing = 0.06): void {
    param.setTargetAtTime(value, this.ctx!.currentTime, smoothing);
  }

  /** Sets the weather's wind (m/s); a storm howls even when you stand still. */
  setGusts(wind: number): void {
    this.gusts = wind;
  }

  /** Continuous layers, called every rendered frame. */
  update(f: SoundFrame): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const fast = Math.min(1, f.speed / 30);
    const airborne = !f.grounded && !f.grind;
    // Wind rises with speed, and opens up when you leave the snow.
    this.gustPhase += 0.016;
    const gust = Math.min(1, this.gusts / 8) * (0.6 + 0.4 * Math.sin(this.gustPhase * 0.9) * Math.sin(this.gustPhase * 0.37));
    this.set(this.wind.gain.gain, 0.02 + 0.3 * fast * fast + (airborne ? 0.06 : 0) + 0.12 * gust);
    this.set(this.wind.filter.frequency, 260 + 900 * fast + (airborne ? 300 : 0) + 250 * gust);

    // Edges in the snow: louder on edge and much louder skidding; each snow type has its own colour.
    const onSnow = f.grounded && !f.grind && !f.crashed;
    const v = SNOW_VOICE[f.snow];
    const moving = Math.min(1, f.speed / 4);
    const carve = 0.03 + 0.11 * Math.abs(f.edge) * Math.min(1, f.speed / 15);
    const snow = onSnow ? moving * v.gain * (f.skidding ? 0.22 : carve) : 0;
    this.set(this.snow.gain.gain, snow, 0.04);
    this.set(this.snow.filter.frequency, v.freq * (f.skidding ? 1.4 : 1));
    this.set(this.snow.filter.Q, v.q);

    // Steel rails hiss and ring; boxes scrape lower.
    const grindLevel = Math.min(1, 0.4 + f.speed / 14);
    this.set(this.railHiss.gain.gain, f.grind === 'rail' ? 0.22 * grindLevel : 0, 0.02);
    this.set(this.railRing.gain.gain, f.grind === 'rail' ? 0.12 * grindLevel : 0, 0.02);
    this.set(this.boxScrape.gain.gain, f.grind === 'box' ? 0.2 * grindLevel : 0, 0.02);
  }

  /** A short burst of filtered noise with a fast attack and an exponential tail. */
  private burst(type: BiquadFilterType, freq: number, q: number, peak: number, decay: number, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + decay + 0.05);
  }

  private tone(freq: number, peak: number, decay: number, delay = 0, dropTo?: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (dropTo) osc.frequency.exponentialRampToValueAtTime(dropTo, t + decay);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  /** Touching down on snow; strength 0..1 grows with time in the air. */
  landing(strength: number): void {
    const s = 0.3 + 0.7 * Math.min(1, strength);
    this.burst('lowpass', 900, 0.7, 0.5 * s, 0.18 + 0.2 * s, 200);
    this.tone(95, 0.35 * s, 0.22, 0, 45);
  }

  /** Springing off the snow. */
  pop(): void {
    this.burst('bandpass', 700, 1.2, 0.18, 0.16, 2200);
  }

  /** Landing on a rail or box. */
  railOn(kind: 'rail' | 'box'): void {
    if (kind === 'rail') {
      this.tone(1180, 0.12, 0.35, 0, undefined, 'triangle');
      this.tone(1770, 0.07, 0.25, 0, undefined, 'triangle');
      this.burst('highpass', 2500, 0.7, 0.15, 0.08);
    } else {
      this.burst('lowpass', 500, 1, 0.35, 0.15);
      this.tone(140, 0.2, 0.12, 0, 90);
    }
  }

  /** A trick that landed: a little two-note chime, brighter when cleaner. */
  trick(quality: LandingQuality): void {
    NOTES[quality].forEach((f, i) => this.tone(f, 0.07, 0.4, 0.06 + i * 0.09, undefined, 'triangle'));
  }

  bail(): void {
    this.burst('lowpass', 600, 0.8, 0.6, 0.6, 150);
    this.tone(70, 0.4, 0.4, 0, 35);
  }

  /** Clipping branches: a crunchy shower of snow. */
  branch(): void {
    this.burst('bandpass', 1800, 0.9, 0.35, 0.45, 500);
  }
}
