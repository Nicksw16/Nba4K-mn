/**
 * AUDIO (secoes 38, 104, 106).
 *
 * Tudo e sintetizado em tempo real com WebAudio - nenhum arquivo externo.
 * O som e derivado do evento fisico: a intensidade do quique vem da
 * velocidade de impacto, o rangido do tenis vem do deslizamento real do pe,
 * e a torcida tem um estado (CALMA -> ATENTA -> ALTA -> EXPLOSIVA) que reage
 * ao contexto da partida, nao a um gatilho aleatorio.
 */
import { clamp, clamp01, lerp } from '../../core/math/util.js';

export type Surface = 'hardwood' | 'concrete' | 'rubber';
export type CrowdLevel = 'calm' | 'alert' | 'loud' | 'explosive';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdSource: AudioBufferSourceNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private sfxGain: GainNode | null = null;
  private started = false;
  surface: Surface = 'hardwood';
  crowdTarget = 0.18;
  private crowdCurrent = 0.18;
  enabled = true;
  volume = 0.7;

  /** WebAudio exige um gesto do usuario para iniciar. */
  async start(): Promise<void> {
    if (this.started) return;
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;
    this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    // Torcida: ruido rosa filtrado, modulado por estado.
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.18;
    this.crowdFilter = this.ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 520;
    this.crowdFilter.Q.value = 0.6;
    this.crowdGain.connect(this.master);
    this.crowdFilter.connect(this.crowdGain);

    const buffer = this.makeNoiseBuffer(6);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.crowdFilter);
    src.start();
    this.crowdSource = src;
    this.started = true;
  }

  private makeNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Ruido rosa aproximado (Voss-McCartney simplificado): soa como multidao.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
    }
    return buf;
  }

  setCrowd(level: CrowdLevel, intensity = 1): void {
    const base: Record<CrowdLevel, number> = { calm: 0.12, alert: 0.24, loud: 0.42, explosive: 0.72 };
    this.crowdTarget = base[level] * clamp(intensity, 0.4, 1.4);
  }

  /** Chamar a cada frame para suavizar a torcida. */
  update(dt: number): void {
    if (!this.started || !this.crowdGain || !this.crowdFilter || !this.ctx) return;
    // A torcida sobe rapido e desce devagar - e assim que soa de verdade.
    const rate = this.crowdTarget > this.crowdCurrent ? 5.5 : 0.9;
    this.crowdCurrent = lerp(this.crowdCurrent, this.crowdTarget, 1 - Math.exp(-rate * dt));
    this.crowdGain.gain.value = this.enabled ? this.crowdCurrent : 0;
    this.crowdFilter.frequency.value = lerp(420, 900, clamp01(this.crowdCurrent / 0.8));
  }

  private env(gainValue: number, attack: number, decay: number): GainNode | null {
    if (!this.ctx || !this.sfxGain) return null;
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    g.connect(this.sfxGain);
    return g;
  }

  /** Posicao estereo simples a partir da posicao na quadra (-1..1). */
  private pan(x: number): StereoPannerNode | null {
    if (!this.ctx) return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(x, -1, 1);
    return p;
  }

  /** Quique da bola. O timbre muda com a superficie. */
  bounce(strength: number, panX = 0): void {
    if (!this.ctx || !this.enabled || !this.started) return;
    const freq = this.surface === 'hardwood' ? 180 : this.surface === 'concrete' ? 240 : 140;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * (0.9 + Math.random() * 0.2), this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, this.ctx.currentTime + 0.09);
    const g = this.env(clamp01(strength) * 0.35, 0.002, 0.11);
    const p = this.pan(panX);
    if (!g || !p) return;
    osc.connect(g);
    g.disconnect();
    g.connect(p);
    p.connect(this.sfxGain!);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.14);
  }

  /** Rangido do tenis: so toca quando existe deslizamento real. */
  squeak(intensity: number, panX = 0): void {
    if (!this.ctx || !this.enabled || !this.started || intensity < 0.05) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = this.surface === 'hardwood' ? 1200 : 700;
    osc.frequency.setValueAtTime(base * (0.8 + Math.random() * 0.6), this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(base * 0.45, this.ctx.currentTime + 0.14);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = base;
    filter.Q.value = 6;
    const g = this.env(clamp01(intensity) * 0.14, 0.004, 0.16);
    const p = this.pan(panX);
    if (!g || !p) return;
    osc.connect(filter);
    filter.connect(g);
    g.disconnect();
    g.connect(p);
    p.connect(this.sfxGain!);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  rim(strength: number, panX = 0): void {
    if (!this.ctx || !this.enabled || !this.started) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 520 + Math.random() * 180;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 400;
    const g = this.env(clamp01(strength) * 0.3, 0.001, 0.3);
    const p = this.pan(panX);
    if (!g || !p) return;
    osc.connect(filter);
    filter.connect(g);
    g.disconnect();
    g.connect(p);
    p.connect(this.sfxGain!);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.34);
  }

  backboard(strength: number, panX = 0): void {
    if (!this.ctx || !this.enabled || !this.started) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(0.22);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 1.2;
    const g = this.env(clamp01(strength) * 0.4, 0.001, 0.2);
    const p = this.pan(panX);
    if (!g || !p) return;
    src.connect(filter);
    filter.connect(g);
    g.disconnect();
    g.connect(p);
    p.connect(this.sfxGain!);
    src.start();
    src.stop(this.ctx.currentTime + 0.24);
  }

  /** Rede: som curto e suave de cesta convertida. */
  swish(panX = 0): void {
    if (!this.ctx || !this.enabled || !this.started) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(0.3);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3200, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1400, this.ctx.currentTime + 0.18);
    filter.Q.value = 2.4;
    const g = this.env(0.22, 0.004, 0.22);
    const p = this.pan(panX);
    if (!g || !p) return;
    src.connect(filter);
    filter.connect(g);
    g.disconnect();
    g.connect(p);
    p.connect(this.sfxGain!);
    src.start();
    src.stop(this.ctx.currentTime + 0.3);
  }

  /** Contato corporal. */
  contact(severity: number, panX = 0): void {
    if (!this.ctx || !this.enabled || !this.started || severity < 0.12) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(48, this.ctx.currentTime + 0.1);
    const g = this.env(clamp01(severity) * 0.3, 0.002, 0.12);
    const p = this.pan(panX);
    if (!g || !p) return;
    osc.connect(g);
    g.disconnect();
    g.connect(p);
    p.connect(this.sfxGain!);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  whistle(): void {
    if (!this.ctx || !this.enabled || !this.started) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2100, this.ctx.currentTime);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 22;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const g = this.env(0.12, 0.01, 0.34);
    if (!g) return;
    osc.connect(g);
    osc.start();
    lfo.start();
    osc.stop(this.ctx.currentTime + 0.4);
    lfo.stop(this.ctx.currentTime + 0.4);
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    if (this.master) this.master.gain.value = this.volume;
  }

  dispose(): void {
    this.crowdSource?.stop();
    this.ctx?.close();
    this.started = false;
  }
}

/** Decide o estado da torcida a partir do contexto da partida (Crowd AI). */
export function crowdLevelFor(opts: {
  homeRun: number;
  scoreDiff: number;
  clock: number;
  period: number;
  lastEventDrama: number;
}): { level: CrowdLevel; intensity: number } {
  const clutch = opts.period >= 4 && opts.clock < 120 && Math.abs(opts.scoreDiff) <= 6;
  if (opts.lastEventDrama > 0.8) return { level: 'explosive', intensity: 1.2 };
  if (clutch) return { level: 'loud', intensity: 1.15 };
  if (opts.homeRun >= 8) return { level: 'loud', intensity: 1 };
  if (Math.abs(opts.scoreDiff) > 22) return { level: 'calm', intensity: 0.7 };
  return { level: 'alert', intensity: 1 };
}
