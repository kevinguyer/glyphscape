import type { AudioFrame } from '../engine/types';

export type AudioSource = 'mic' | 'tab';
export type AudioStatus = 'off' | 'starting' | 'listening' | 'no-signal' | 'denied' | 'unsupported' | 'no-audio-track' | 'error';

// Band edges in Hz: bass, low mid, high mid, treble.
const BANDS: [number, number][] = [
  [25, 160],
  [160, 700],
  [700, 3200],
  [3200, 12000],
];

/**
 * Microphone or tab audio, analyzed in memory only. Produces a gentle, smoothed AudioFrame:
 * four bands, overall level, and a spectral-flux beat with an estimated beat phase.
 * Nothing is recorded, stored or transmitted.
 */
export class AudioEngine {
  status: AudioStatus = 'off';
  frame: AudioFrame = { bands: new Float32Array(4), level: 0, beat: 0, beatPhase: 0, active: false };
  sensitivity = 1;
  smoothing = 0.6;
  onStatus: (s: AudioStatus) => void = () => {};

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private spec = new Uint8Array(0);
  private prevMag = new Float32Array(0);
  private peaks = new Float32Array([0.2, 0.2, 0.2, 0.2]);
  private levelPeak = 0.2;
  private flux = new Float32Array(48);
  private fluxI = 0;
  private sinceBeat = 10;
  private intervals: number[] = [];
  private silentFor = 0;

  private setStatus(s: AudioStatus) {
    this.status = s;
    this.onStatus(s);
  }

  async start(source: AudioSource) {
    this.stop();
    this.setStatus('starting');
    const md = navigator.mediaDevices;
    try {
      let stream: MediaStream;
      if (source === 'mic') {
        if (!md?.getUserMedia) return this.setStatus('unsupported');
        stream = await md.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } else {
        if (!md?.getDisplayMedia) return this.setStatus('unsupported');
        stream = await md.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (stream.getAudioTracks().length === 0) {
          stream.getTracks().forEach((t) => t.stop());
          return this.setStatus('no-audio-track');
        }
      }
      this.stream = stream;
      const ctx = new AudioContext();
      this.ctx = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0.2;
      an.minDecibels = -90;
      an.maxDecibels = -15;
      src.connect(an);
      this.analyser = an;
      this.spec = new Uint8Array(an.frequencyBinCount);
      this.prevMag = new Float32Array(an.frequencyBinCount);
      stream.getAudioTracks()[0]?.addEventListener('ended', () => this.stop());
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      this.silentFor = 0;
      this.setStatus('listening');
    } catch (e) {
      const name = (e as DOMException)?.name;
      this.setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
    }
  }

  /** Browsers may suspend the context until a gesture; call this from input handlers. */
  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    const f = this.frame;
    f.bands.fill(0);
    f.level = f.beat = f.beatPhase = 0;
    f.active = false;
    if (this.status !== 'denied' && this.status !== 'unsupported' && this.status !== 'no-audio-track') this.setStatus('off');
  }

  update(dt: number) {
    const f = this.frame;
    const an = this.analyser;
    if (!an || !this.ctx) {
      // Relax to silence.
      for (let b = 0; b < 4; b++) f.bands[b] *= 0.9;
      f.level *= 0.9;
      f.beat *= 0.9;
      f.active = false;
      return;
    }
    an.getByteFrequencyData(this.spec);
    const hzPerBin = this.ctx.sampleRate / an.fftSize;
    const spec = this.spec;
    const sens = this.sensitivity;
    // Envelope coefficients: attack fast-ish, release slow; smoothing slider stretches both.
    const attack = 1 - Math.exp(-dt * (14 - this.smoothing * 11));
    const release = 1 - Math.exp(-dt * (5 - this.smoothing * 4.2));

    let total = 0;
    for (let b = 0; b < 4; b++) {
      const lo = Math.max(1, Math.floor(BANDS[b][0] / hzPerBin));
      const hi = Math.min(spec.length - 1, Math.ceil(BANDS[b][1] / hzPerBin));
      let sum = 0;
      for (let i = lo; i <= hi; i++) sum += spec[i];
      const raw = sum / ((hi - lo + 1) * 255);
      total += raw;
      // Adaptive gain: track a slowly decaying peak so quiet rooms still move.
      this.peaks[b] = Math.max(raw, this.peaks[b] * Math.exp(-dt / 8), 0.06);
      const target = Math.min(1, (raw / this.peaks[b]) * 0.85 * sens) ** 1.4;
      const k = target > f.bands[b] ? attack : release;
      f.bands[b] += (target - f.bands[b]) * k;
    }
    const lvlRaw = total / 4;
    this.levelPeak = Math.max(lvlRaw, this.levelPeak * Math.exp(-dt / 10), 0.05);
    const lvl = Math.min(1, (lvlRaw / this.levelPeak) * 0.8 * sens);
    f.level += (lvl - f.level) * (lvl > f.level ? attack : release);

    // Spectral flux onset detection, weighted toward the low end where beats live.
    let flux = 0;
    const maxBin = Math.min(spec.length, Math.ceil(4000 / hzPerBin));
    for (let i = 1; i < maxBin; i++) {
      const m = spec[i] / 255;
      const d = m - this.prevMag[i];
      if (d > 0) flux += d * (i < 20 ? 2 : 1);
      this.prevMag[i] = m;
    }
    const hist = this.flux;
    let mean = 0;
    for (let i = 0; i < hist.length; i++) mean += hist[i];
    mean /= hist.length;
    hist[this.fluxI] = flux;
    this.fluxI = (this.fluxI + 1) % hist.length;
    this.sinceBeat += dt;
    f.beat *= Math.exp(-dt / 0.25);
    if (flux > mean * (1.6 - 0.4 * Math.min(1.5, sens)) + 0.4 && this.sinceBeat > 0.28 && lvlRaw > 0.02) {
      if (this.sinceBeat < 2) {
        this.intervals.push(this.sinceBeat);
        if (this.intervals.length > 12) this.intervals.shift();
      }
      this.sinceBeat = 0;
      f.beat = Math.min(1, 0.6 + 0.4 * sens);
    }
    const period = this.intervals.length >= 3 ? median(this.intervals) : 0.5;
    f.beatPhase = Math.min(1, this.sinceBeat / period);

    // Silence detection, so the console can explain why nothing moves.
    if (lvlRaw < 0.004) this.silentFor += dt;
    else this.silentFor = 0;
    if (this.silentFor > 8 && this.status === 'listening') this.setStatus('no-signal');
    if (this.silentFor === 0 && this.status === 'no-signal') this.setStatus('listening');
    f.active = this.status === 'listening';
  }
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}
