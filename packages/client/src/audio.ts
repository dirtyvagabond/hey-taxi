import type { CommentCategory } from './dialogue';
import { synthesizePassengerVoice } from './voice';

/**
 * Synthesized sound effects and procedural C64 passenger speech (Web Audio, zero asset files).
 * The AudioContext is created on the first key/pointer press because browsers block audio
 * until a user gesture.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { gain: GainNode; filter: BiquadFilterNode; rumble: GainNode } | null = null;
  private activeVoice: { src: AudioBufferSourceNode; priority: 'event' | 'hail'; endsAt: number } | null = null;
  private voiceEnabled = true;
  private volume = 0.6;
  private muted = false;
  private spectateDucked = false;

  constructor() {
    const unlock = () => this.unlock();
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('pointerdown', unlock, { capture: true });
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    if (muted) this.stopVoice();
    this.applyGain();
  }

  setVoiceEnabled(enabled: boolean): void {
    this.voiceEnabled = enabled;
    if (!enabled) this.stopVoice();
  }

  stopVoice(): void {
    const active = this.activeVoice;
    this.activeVoice = null;
    if (!active) return;
    try {
      active.src.onended = null;
      active.src.stop();
    } catch {
      // Ignore if already stopped.
    }
  }

  isVoiceSpeaking(): boolean {
    return this.ctx !== null && this.activeVoice !== null && this.ctx.currentTime < this.activeVoice.endsAt;
  }

  /** Soften world audio while spectating another taxi. */
  setSpectateDuck(ducked: boolean): void {
    if (this.spectateDucked === ducked) return;
    this.spectateDucked = ducked;
    this.applyGain();
  }

  private applyGain(): void {
    if (this.ctx && this.master) {
      const target = this.muted ? 0 : this.volume * (this.spectateDucked ? 0.3 : 1);
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
    }
  }

  /** Loud emergency siren for threats to the player's own taxi while spectating (bypasses ducking). */
  playerAlertBeep(): void {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1180, now);
    osc.frequency.setValueAtTime(880, now + 0.08);
    g.gain.setValueAtTime(Math.min(0.45, this.volume * 0.55), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  private unlock(): void {
    if (!this.ctx) {
      try {
        this.init();
      } catch (err) {
        console.warn('Audio unavailable', err);
        return;
      }
    }
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private init(): void {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    master.connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Continuous engine: filtered noise (jet hiss) + low sawtooth rumble, both silent until thrusting.
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    hiss.connect(filter).connect(gain).connect(master);
    hiss.start();

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 48;
    const oscFilter = ctx.createBiquadFilter();
    oscFilter.type = 'lowpass';
    oscFilter.frequency.value = 180;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    osc.connect(oscFilter).connect(rumble).connect(master);
    osc.start();

    this.ctx = ctx;
    this.master = master;
    this.noise = noise;
    this.engine = { gain, filter, rumble };
  }

  /**
   * Monophonic C64 formant speech channel. Direct player events (`priority: 'event'`)
   * preempt ambient pad hails (`priority: 'hail'`), while hails never interrupt an active line.
   */
  speak(
    text: string,
    opts: {
      kind: number;
      passengerId: number;
      category: CommentCategory;
      priority: 'event' | 'hail';
      delay?: number;
      pan?: number;
      gainScale?: number;
    },
  ): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || !this.voiceEnabled || ctx.state === 'suspended') return false;
    if (this.isVoiceSpeaking()) {
      if (opts.priority === 'hail') return false;
      this.stopVoice();
    }
    const rendered = synthesizePassengerVoice(text, opts);
    if (!rendered) return false;

    const buf = ctx.createBuffer(1, rendered.samples.length, rendered.sr);
    buf.getChannelData(0).set(rendered.samples);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rendered.shift;
    const g = ctx.createGain();
    g.gain.value = 0.95 * Math.max(0, Math.min(1.2, opts.gainScale ?? 1));
    let outNode: AudioNode = src.connect(g);
    const pan = Math.max(-0.65, Math.min(0.65, opts.pan ?? 0));
    if (Math.abs(pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      outNode = outNode.connect(panner);
    }
    outNode.connect(this.master);

    const startAt = ctx.currentTime + (opts.delay ?? 0);
    const endsAt = startAt + buf.duration / Math.max(0.1, rendered.shift);
    const entry = { src, priority: opts.priority, endsAt };
    this.activeVoice = entry;
    src.onended = () => {
      if (this.activeVoice === entry) this.activeVoice = null;
    };
    src.start(startAt);
    return true;
  }

  /** Call every frame. `thrusters` = number of thrusters firing, `main` = main (up) thruster on. */
  setThrust(thrusters: number, main: boolean): void {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const duck = this.isVoiceSpeaking() ? 0.75 : 1;
    const level = (thrusters === 0 ? 0 : (main ? 0.22 : 0.1) + 0.04 * (thrusters - 1)) * duck;
    this.engine.gain.gain.setTargetAtTime(level, t, 0.03);
    this.engine.rumble.gain.setTargetAtTime(main ? 0.18 * duck : 0, t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(main ? 900 : 650, t, 0.05);
  }

  /** Servo whine while the gear moves; pitch rises when extending, falls when retracting. */
  gearMotor(down: boolean, duration: number): void {
    const [a, b] = down ? [190, 320] : [320, 190];
    this.tone({ freq: a, to: b, dur: duration, type: 'square', gain: 0.05, filter: 1400 });
  }

  /** Mechanical clunk when the gear locks. */
  gearLock(down: boolean): void {
    this.noiseBurst({ dur: 0.06, from: 1800, to: 600, gain: 0.35 });
    this.tone({ freq: down ? 140 : 180, to: 70, dur: 0.1, type: 'sine', gain: 0.35 });
  }

  /** Touchdown thud scaled by impact (0–1), plus a chime for good landings. */
  land(impact: number, rating: 'smooth' | 'ok' | 'rough'): void {
    const k = Math.min(1, Math.max(0.15, impact));
    this.tone({ freq: 110, to: 40, dur: 0.18, type: 'sine', gain: 0.6 * k });
    this.noiseBurst({ dur: 0.12, from: 700, to: 150, gain: 0.4 * k });
    if (rating === 'smooth') {
      this.tone({ freq: 880, dur: 0.12, type: 'triangle', gain: 0.12, delay: 0.08 });
      this.tone({ freq: 1320, dur: 0.22, type: 'triangle', gain: 0.12, delay: 0.17 });
    } else if (rating === 'ok') {
      this.tone({ freq: 880, dur: 0.18, type: 'triangle', gain: 0.1, delay: 0.08 });
    }
  }

  explosion(): void {
    this.noiseBurst({ dur: 1.1, from: 3500, to: 120, gain: 0.8 });
    this.tone({ freq: 90, to: 28, dur: 0.7, type: 'sine', gain: 0.8 });
    this.tone({ freq: 60, to: 25, dur: 0.9, type: 'sawtooth', gain: 0.15, filter: 300 });
  }

  fuelEmpty(): void {
    this.tone({ freq: 220, dur: 0.14, type: 'square', gain: 0.1, filter: 1500 });
    this.tone({ freq: 165, dur: 0.22, type: 'square', gain: 0.1, filter: 1500, delay: 0.18 });
  }

  lowFuel(): void {
    this.tone({ freq: 660, dur: 0.08, type: 'square', gain: 0.06, filter: 2000 });
    this.tone({ freq: 660, dur: 0.08, type: 'square', gain: 0.06, filter: 2000, delay: 0.14 });
  }

  /** Short pump tick while refueling; `fill` (0–1) raises the pitch as the tank fills. */
  refuelTick(fill: number): void {
    this.tone({ freq: 500 + fill * 700, dur: 0.04, type: 'sine', gain: 0.07 });
  }

  /** Door chime when a passenger boards. */
  board(): void {
    this.tone({ freq: 660, dur: 0.14, type: 'sine', gain: 0.12 });
    this.tone({ freq: 990, dur: 0.22, type: 'sine', gain: 0.12, delay: 0.11 });
  }

  /** Coin arpeggio for a completed fare; more notes for a better tip (0–1). */
  cash(tipFrac: number): void {
    const notes = [1046, 1318, 1568, 2093].slice(0, 2 + Math.round(tipFrac * 2));
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.12, type: 'triangle', gain: 0.1, delay: i * 0.06 }));
    this.noiseBurst({ dur: 0.05, from: 6000, to: 3000, gain: 0.08 });
  }

  /** Missile launch: a rising hiss with a low thump. */
  missileLaunch(): void {
    this.noiseBurst({ dur: 0.45, from: 600, to: 5000, gain: 0.22 });
    this.tone({ freq: 120, to: 60, dur: 0.15, type: 'sine', gain: 0.3 });
  }

  /** Missile detonation; `direct` = it hit a taxi (bigger, with a victory blip). */
  missileBlast(direct: boolean): void {
    this.noiseBurst({ dur: direct ? 0.6 : 0.35, from: 2500, to: 150, gain: direct ? 0.5 : 0.3 });
    this.tone({ freq: 80, to: 35, dur: 0.3, type: 'sine', gain: 0.4 });
    if (direct) {
      this.tone({ freq: 784, dur: 0.1, type: 'square', gain: 0.06, filter: 2500, delay: 0.25 });
      this.tone({ freq: 1046, dur: 0.18, type: 'square', gain: 0.06, filter: 2500, delay: 0.35 });
    }
  }

  /** Flare burst: a few sharp pops and a fizz. */
  flares(): void {
    for (let i = 0; i < 4; i++) {
      this.noiseBurst({ dur: 0.05, from: 6000, to: 2000, gain: 0.2, delay: i * 0.06 });
    }
    this.noiseBurst({ dur: 0.7, from: 3000, to: 1500, gain: 0.06, delay: 0.2 });
  }

  /** Missile-lock warning blip (call repeatedly while a missile is chasing you). */
  missileWarning(): void {
    this.tone({ freq: 1250, dur: 0.06, type: 'square', gain: 0.07, filter: 3000 });
  }

  /** Register ding for a purchase. */
  purchase(): void {
    this.tone({ freq: 1568, dur: 0.07, type: 'triangle', gain: 0.1 });
    this.tone({ freq: 2093, dur: 0.12, type: 'triangle', gain: 0.1, delay: 0.06 });
  }

  /** Rival taxi appearing: a quick descending whoosh + two-note horn. */
  rivalArrives(): void {
    this.noiseBurst({ dur: 0.35, from: 3000, to: 400, gain: 0.12 });
    this.tone({ freq: 415, dur: 0.12, type: 'square', gain: 0.06, filter: 1600, delay: 0.15 });
    this.tone({ freq: 330, dur: 0.18, type: 'square', gain: 0.06, filter: 1600, delay: 0.29 });
  }

  /** Taxi-on-taxi clank; `strength` 0–1. */
  taxiBump(strength: number): void {
    const k = Math.max(0.1, Math.min(1, strength));
    this.noiseBurst({ dur: 0.07, from: 4000, to: 1200, gain: 0.25 * k });
    this.tone({ freq: 520, to: 260, dur: 0.12, type: 'triangle', gain: 0.18 * k });
  }

  /** Last hull point: a soft two-note alarm. */
  hullWarning(): void {
    this.tone({ freq: 740, dur: 0.09, type: 'square', gain: 0.05, filter: 1800 });
    this.tone({ freq: 590, dur: 0.12, type: 'square', gain: 0.05, filter: 1800, delay: 0.11 });
  }

  /** Rescue Service dispatched: brief retro 2-tone "wee-woo" siren burst. */
  rescueSummoned(): void {
    this.tone({ freq: 880, dur: 0.12, type: 'square', gain: 0.055, filter: 1800, delay: 0 });
    this.tone({ freq: 660, dur: 0.13, type: 'square', gain: 0.055, filter: 1800, delay: 0.13 });
    this.tone({ freq: 880, dur: 0.12, type: 'square', gain: 0.055, filter: 1800, delay: 0.27 });
    this.tone({ freq: 660, dur: 0.15, type: 'square', gain: 0.05, filter: 1800, delay: 0.4 });
  }

  /** Rescue Service touched down beside the taxi: gentle retro arrival chirp. */
  rescueArrived(): void {
    this.tone({ freq: 660, dur: 0.08, type: 'triangle', gain: 0.08 });
    this.tone({ freq: 990, dur: 0.12, type: 'triangle', gain: 0.08, delay: 0.08 });
  }

  tipLost(): void {
    this.tone({ freq: 320, to: 150, dur: 0.16, type: 'square', gain: 0.06, filter: 1200 });
  }

  /** Taxi bumped a passenger. */
  bonk(): void {
    this.noiseBurst({ dur: 0.08, from: 1500, to: 300, gain: 0.3 });
    this.tone({ freq: 220, to: 90, dur: 0.15, type: 'sine', gain: 0.3 });
  }

  private tone(o: {
    freq: number;
    to?: number;
    dur: number;
    type: OscillatorType;
    gain: number;
    delay?: number;
    filter?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    const env = this.envelope(t0, o.dur, o.gain);
    let node: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filter;
      node = node.connect(f);
    }
    node.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  private noiseBurst(o: { dur: number; from: number; to: number; gain: number; delay?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.from, t0);
    f.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    src.connect(f).connect(this.envelope(t0, o.dur, o.gain)).connect(this.master);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + o.dur + 0.05);
  }

  private envelope(t0: number, dur: number, peak: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    return g;
  }
}
