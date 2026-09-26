import type { CarState } from './physics.ts';

export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engine?: OscillatorNode;
  private engine2?: OscillatorNode;
  private engineGain?: GainNode;
  private tireGain?: GainNode;
  private windGain?: GainNode;
  private filter?: BiquadFilterNode;
  volume = 0.45;
  muted = false;
  available = true;
  get state() { return this.context?.state ?? 'not-started'; }

  async start() {
    try {
      if (!this.context) this.init();
      if (this.context?.state === 'suspended') await this.context.resume();
    } catch { this.available = false; }
  }

  private init() {
    const ctx = this.context = new AudioContext();
    const master = this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -16; limiter.ratio.value = 5;
    master.gain.value = this.volume;
    master.connect(limiter).connect(ctx.destination);
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 700;
    this.engineGain.connect(this.filter).connect(master);
    this.engine = ctx.createOscillator(); this.engine.type = 'sawtooth';
    this.engine2 = ctx.createOscillator(); this.engine2.type = 'triangle';
    this.engine.connect(this.engineGain); this.engine2.connect(this.engineGain);
    this.engine.start(); this.engine2.start();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) { brown = (brown + (Math.random() * 2 - 1) * 0.05) / 1.02; data[i] = brown * 4; }
    const noise = ctx.createBufferSource(); noise.buffer = buffer; noise.loop = true;
    const tireFilter = ctx.createBiquadFilter(); tireFilter.type = 'bandpass'; tireFilter.frequency.value = 1900; tireFilter.Q.value = 0.8;
    this.tireGain = ctx.createGain(); this.tireGain.gain.value = 0;
    noise.connect(tireFilter).connect(this.tireGain).connect(master);
    const windFilter = ctx.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 900;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    noise.connect(windFilter).connect(this.windGain).connect(master); noise.start();
  }

  update(s: CarState, active: boolean) {
    if (!this.context || !this.master) return;
    const t = this.context.currentTime;
    const ratio = s.speed / 61;
    const gear = Math.min(4, Math.floor(s.speed / 11));
    const rpm = 44 + (s.speed - gear * 9) * 5;
    this.engine?.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engine2?.frequency.setTargetAtTime(rpm * 2.01, t, 0.08);
    this.engineGain?.gain.setTargetAtTime(active ? 0.025 + ratio * 0.045 : 0, t, 0.12);
    this.filter?.frequency.setTargetAtTime(400 + ratio * 1500, t, 0.08);
    this.tireGain?.gain.setTargetAtTime(active && s.drifting ? 0.20 : 0, t, 0.06);
    this.windGain?.gain.setTargetAtTime(active ? ratio ** 2 * 0.16 + (s.nitroTime > 0 ? 0.16 : 0) : 0, t, 0.12);
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, t, 0.04);
  }

  cue(kind: 'mini' | 'nitro' | 'tank' | 'collision' | 'mini-ready' | 'count' | 'go' | 'finish') {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const t = ctx.currentTime;
    const spec = {
      mini: [180, 700, 0.35, 0.09], nitro: [110, 1050, 0.65, 0.12],
      tank: [660, 1320, 0.22, 0.07], collision: [100, 30, 0.18, 0.18],
      'mini-ready': [620, 880, 0.15, 0.06], count: [440, 440, 0.16, 0.10],
      go: [880, 1320, 0.36, 0.11], finish: [660, 1760, 0.7, 0.08],
    }[kind];
    o.type = kind === 'collision' ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(spec[0], t); o.frequency.exponentialRampToValueAtTime(spec[1], t + spec[2]);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(spec[3], t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + spec[2]);
    o.connect(g).connect(this.master); o.start(); o.stop(t + spec[2] + 0.02);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
}
