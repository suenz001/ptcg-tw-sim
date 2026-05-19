/**
 * PTCG 對戰音效系統 — Web Audio API 合成
 *
 * v4.928 大改：紙牌質感升級 — 7 個新音 + panning + throttle + sub-bus + cleanup
 *   - 新音：evolve / attach-energy / ability / prize-take / victory-fanfare /
 *           game-win / game-lose
 *   - click 改柔和 sine（不再電子刺感）/ shuffle 縮短 6 burst
 *   - panning：playSfx({pan: -1..1}) 加左右空間感（P1 偏左、P2 偏右）
 *   - throttle：同名音 100ms 內 skip 防堆疊
 *   - 子 bus：ui / sfx / status 三條獨立音量
 *   - 同時 osc 上限 32：滿了 dequeue 最舊避免 mobile 卡頓
 *   - closeAudio() cleanup：頁面切換時 release resources
 *
 * 設計原則：
 *   1. 零外部 asset：所有音效由 Web Audio 合成
 *   2. Lazy init：AudioContext 在首次 play 時建立
 *   3. 紙質感為主：noise + bandpass filter + 短脈衝，避免單純 oscillator beep
 *   4. 音色「輕量 UI」不擬真 — 目的是對戰 feedback
 */

import type { EnergyType } from '$lib/cards/types';

// ─── 型別 ─────────────────────────────────────────────────────────────────
export type SfxName =
  | 'coin' | 'deal' | 'draw' | 'shuffle' | 'click' | 'ko'
  | 'poison' | 'burn' | 'sleep' | 'confuse'
  | 'turn-start'
  | 'ready-go'  // v4.929 對戰開始通知音（sample-based）
  // v4.928 新增：紙牌質感升級
  | 'evolve'           // 進化儀式音（紙翻面 + 上升小琶音）
  | 'attach-energy'    // 附能量（紙片落下 + soft pluck）
  | 'ability'          // 特性發動（中頻 chime）
  | 'prize-take'       // 拿獎賞牌 1-5 張（紙抽出 + 上升二音）
  | 'victory-fanfare'  // 拿最後一張獎賞（即將勝利）
  | 'game-win'         // 對局勝利
  | 'game-lose'        // 對局失敗
  | `attack-${EnergyType}`;

// ─── Sub-bus 分類（決定走哪條音量控制） ──────────────────────────────────
type BusName = 'ui' | 'sfx' | 'status';
function classifyBus(name: SfxName): BusName {
  if (name === 'click' || name === 'draw' || name === 'deal' || name === 'shuffle'
      || name === 'coin' || name === 'turn-start' || name === 'evolve'
      || name === 'attach-energy' || name === 'ability' || name === 'prize-take') {
    return 'ui';
  }
  if (name === 'ko' || name === 'victory-fanfare' || name === 'game-win'
      || name === 'game-lose' || name === 'ready-go' || name.startsWith('attack-')) {
    return 'sfx';
  }
  // poison / burn / sleep / confuse
  return 'status';
}

// ─── AudioContext + Gain bus 結構 ──────────────────────────────────────────
//   destination ← masterGain ← (uiGain, sfxGain, statusGain) ← per-event gain
let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let uiGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let statusGain: GainNode | null = null;

let userVolume = 0.5;
let muted = false;
let uiVolume = 1.0;
let sfxVolume = 1.0;
let statusVolume = 1.0;
// v4.929 切到背景頁籤時是否仍播音（預設 true）
let playWhenHidden = true;
// v4.929 ready-go sample buffer cache
let readyGoBuffer: AudioBuffer | null = null;
let readyGoLoading: Promise<void> | null = null;

// ─── Throttle + osc cap ──────────────────────────────────────────────────
const recentSfx = new Map<SfxName, number>();
const THROTTLE_MS = 100;

const activeNodes = new Set<AudioScheduledSourceNode>();
const MAX_ACTIVE = 32;

function trackNode(node: AudioScheduledSourceNode): void {
  activeNodes.add(node);
  node.addEventListener('ended', () => activeNodes.delete(node));
  // 超過上限 → dequeue 最舊（Set iteration order = insertion order）
  if (activeNodes.size > MAX_ACTIVE) {
    const oldest = activeNodes.values().next().value;
    if (oldest) {
      try { oldest.stop(); } catch { /* already stopped */ }
      activeNodes.delete(oldest);
    }
  }
}

// ─── AudioContext init（lazy）─────────────────────────────────────────────
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : userVolume;
    masterGain.connect(ctx.destination);
    // 建立三條 sub-bus
    uiGain = ctx.createGain();
    uiGain.gain.value = uiVolume;
    uiGain.connect(masterGain);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = sfxVolume;
    sfxGain.connect(masterGain);
    statusGain = ctx.createGain();
    statusGain.gain.value = statusVolume;
    statusGain.connect(masterGain);
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => { /* user gesture pending */ });
  }
  return ctx;
}

// ─── 對外音量 / mute API ─────────────────────────────────────────────────
export function setMasterVolume(v: number): void {
  userVolume = Math.max(0, Math.min(1, v));
  if (masterGain && !muted) masterGain.gain.value = userVolume;
}
export function getMasterVolume(): number { return userVolume; }

export function setMuted(m: boolean): void {
  muted = m;
  if (masterGain) masterGain.gain.value = muted ? 0 : userVolume;
}
export function isMuted(): boolean { return muted; }

// v4.928：子 bus 音量（UI / SFX / Status）
export function setUiVolume(v: number): void {
  uiVolume = Math.max(0, Math.min(1, v));
  if (uiGain) uiGain.gain.value = uiVolume;
}
export function getUiVolume(): number { return uiVolume; }

export function setSfxVolume(v: number): void {
  sfxVolume = Math.max(0, Math.min(1, v));
  if (sfxGain) sfxGain.gain.value = sfxVolume;
}
export function getSfxVolume(): number { return sfxVolume; }

export function setStatusVolume(v: number): void {
  statusVolume = Math.max(0, Math.min(1, v));
  if (statusGain) statusGain.gain.value = statusVolume;
}
export function getStatusVolume(): number { return statusVolume; }

// v4.929：playWhenHidden — 切到背景頁籤時是否仍播音
export function setPlayWhenHidden(v: boolean): void { playWhenHidden = v; }
export function getPlayWhenHidden(): boolean { return playWhenHidden; }

// v4.929：preload ready-go.wav — fetch + decodeAudioData，cache 進 buffer
//   首次呼叫 onMount 階段觸發，第一次播放零延遲。
export function preloadReadyGoSample(url: string): Promise<void> {
  if (readyGoBuffer) return Promise.resolve();
  if (readyGoLoading) return readyGoLoading;
  const c = getCtx();
  if (!c) return Promise.resolve();
  readyGoLoading = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const arr = await res.arrayBuffer();
      readyGoBuffer = await c.decodeAudioData(arr);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[sfx] preloadReadyGoSample failed', e);
    }
  })();
  return readyGoLoading;
}

// v4.928：cleanup — 頁面切換時釋放資源
export function closeAudio(): void {
  if (!ctx) return;
  try {
    for (const n of activeNodes) { try { n.stop(); } catch { /* */ } }
    activeNodes.clear();
    ctx.close().catch(() => { /* */ });
  } catch { /* */ }
  ctx = null; masterGain = null;
  uiGain = null; sfxGain = null; statusGain = null;
  recentSfx.clear();
}

// ─── 主入口 playSfx ──────────────────────────────────────────────────────
export interface PlaySfxOpts {
  volume?: number;
  /** v4.928: stereo pan -1..1（-0.3 = 偏左, +0.3 = 偏右） */
  pan?: number;
}

export function playSfx(name: SfxName, opts?: PlaySfxOpts): void {
  const c = getCtx();
  if (!c || !masterGain) return;
  if (muted) return;
  // v4.929：切到背景頁籤時，依設定決定是否 mute（ready-go 也跟著走，給玩家統一控制）
  if (!playWhenHidden && typeof document !== 'undefined' && document.hidden) return;

  // v4.928 throttle：同名音 100ms 內 skip
  const now = c.currentTime * 1000;
  const last = recentSfx.get(name) ?? -Infinity;
  if (now - last < THROTTLE_MS) return;
  recentSfx.set(name, now);

  // 選 bus
  const busName = classifyBus(name);
  const bus = busName === 'ui' ? uiGain : busName === 'sfx' ? sfxGain : statusGain;
  if (!bus) return;

  // 建立 per-event gain → 接到 (optional pan →) bus
  const gain = c.createGain();
  gain.gain.value = opts?.volume ?? 1;
  let out: AudioNode = gain;
  if (opts?.pan !== undefined && opts.pan !== 0 && typeof c.createStereoPanner === 'function') {
    const panner = c.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
    gain.connect(panner);
    out = panner;
  }
  out.connect(bus);

  const t = c.currentTime;
  try {
    if (name === 'coin') playCoin(c, gain, t);
    else if (name === 'deal') playDeal(c, gain, t);
    else if (name === 'draw') playDraw(c, gain, t);
    else if (name === 'shuffle') playShuffle(c, gain, t);
    else if (name === 'click') playClick(c, gain, t);
    else if (name === 'ko') playKO(c, gain, t);
    else if (name === 'poison') playPoison(c, gain, t);
    else if (name === 'burn') playBurn(c, gain, t);
    else if (name === 'sleep') playSleep(c, gain, t);
    else if (name === 'confuse') playConfuse(c, gain, t);
    else if (name === 'turn-start') playTurnStart(c, gain, t);
    else if (name === 'evolve') playEvolve(c, gain, t);
    else if (name === 'attach-energy') playAttachEnergy(c, gain, t);
    else if (name === 'ability') playAbility(c, gain, t);
    else if (name === 'prize-take') playPrizeTake(c, gain, t);
    else if (name === 'victory-fanfare') playVictoryFanfare(c, gain, t);
    else if (name === 'game-win') playGameWin(c, gain, t);
    else if (name === 'game-lose') playGameLose(c, gain, t);
    else if (name === 'ready-go') playReadyGo(c, gain, t);
    else if (name.startsWith('attack-')) {
      const etype = name.slice(7) as EnergyType;
      playAttack(c, gain, t, etype);
    }
  } catch {
    /* 音效合成失敗不應影響遊戲 */
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 音效合成實作
// ═══════════════════════════════════════════════════════════════════════════

// 通用：white noise buffer
function noiseBuffer(c: AudioContext, durationSec: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * durationSec));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// 通用：oscillator beep，自動 fade-out
function beep(
  c: AudioContext, out: GainNode, start: number,
  freq: number, duration: number, type: OscillatorType = 'sine',
  peakGain = 0.3
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(peakGain, start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g); g.connect(out);
  osc.start(start); osc.stop(start + duration + 0.05);
  trackNode(osc);
}

// ─ Coin flip：金屬敲擊 inharmonic partials ────────
function metalClink(c: AudioContext, out: GainNode, t: number, base: number, peak: number): void {
  const partials = [
    { freq: base,        gain: peak,        type: 'sine' as OscillatorType,     dur: 0.45 },
    { freq: base * 2.31, gain: peak * 0.6,  type: 'sine' as OscillatorType,     dur: 0.35 },
    { freq: base * 3.75, gain: peak * 0.35, type: 'sine' as OscillatorType,     dur: 0.28 },
    { freq: base * 1.5,  gain: peak * 0.15, type: 'square' as OscillatorType,   dur: 0.08 },
  ];
  for (const p of partials) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = p.type;
    osc.frequency.value = p.freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(p.gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + p.dur);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + p.dur + 0.05);
    trackNode(osc);
  }
}
function playCoin(c: AudioContext, out: GainNode, t: number): void {
  metalClink(c, out, t,         1400, 0.22);
  metalClink(c, out, t + 0.18,  1050, 0.18);
}

// ─ Paper swish helper（紙張纖維摩擦感）─────────
interface PaperSwishOpts {
  bursts?: number;
  durationPerBurst?: number;
  gap?: number;
  peakGain?: number;
  hpCenter?: number;
  hpJitter?: number;
}
function paperSwish(c: AudioContext, out: GainNode, t: number, opts: PaperSwishOpts = {}): void {
  const bursts = opts.bursts ?? 1;
  const dur = opts.durationPerBurst ?? 0.06;
  const gap = opts.gap ?? 0.02;
  const peak = opts.peakGain ?? 0.28;
  const hpC = opts.hpCenter ?? 2800;
  const hpJ = opts.hpJitter ?? 800;
  for (let i = 0; i < bursts; i++) {
    const start = t + i * (dur + gap);
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, dur);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = hpC + (Math.random() - 0.5) * hpJ;
    hp.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(hp); hp.connect(g); g.connect(out);
    src.start(start); src.stop(start + dur + 0.05);
    trackNode(src);
  }
}

// ─ Deal / Draw / Shuffle ────
function playDeal(c: AudioContext, out: GainNode, t: number): void {
  paperSwish(c, out, t, { bursts: 1, durationPerBurst: 0.07, peakGain: 0.3, hpCenter: 2800 });
}
function playDraw(c: AudioContext, out: GainNode, t: number): void {
  paperSwish(c, out, t, { bursts: 1, durationPerBurst: 0.06, peakGain: 0.32, hpCenter: 3200 });
}
// v4.928: shuffle 縮短 10→6 burst，更乾淨
function playShuffle(c: AudioContext, out: GainNode, t: number): void {
  paperSwish(c, out, t, {
    bursts: 6,
    durationPerBurst: 0.045,
    gap: 0.025,
    peakGain: 0.22,
    hpCenter: 2600,
    hpJitter: 1200,
  });
}

// ─ Click — v4.928: 改柔和紙質 tap（sine + 微 noise tick）────
//   原 square 1600Hz 30ms 太電子刺感 → 改成低頻 sine + 短 high-pass noise tick，
//   聽起來像「指尖輕拍卡牌」而非「PC click」。
function playClick(c: AudioContext, out: GainNode, t: number): void {
  // 主音：sine 1100Hz 短脈衝
  beep(c, out, t, 1100, 0.04, 'sine', 0.18);
  // 副音：短 noise tick（紙質感）
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.015);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 3500;
  const g = c.createGain();
  g.gain.setValueAtTime(0.10, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
  src.connect(hp); hp.connect(g); g.connect(out);
  src.start(t); src.stop(t + 0.02);
  trackNode(src);
}

// ─ KO — 低音墜落
function playKO(c: AudioContext, out: GainNode, t: number): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.6);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  osc.connect(g); g.connect(out);
  osc.start(t); osc.stop(t + 0.65);
  trackNode(osc);
}

// ─ Status — Poison / Burn / Sleep / Confuse ──────
function playPoison(c: AudioContext, out: GainNode, t: number): void {
  const osc = c.createOscillator();
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  const g = c.createGain();
  osc.type = 'sine'; osc.frequency.value = 220;
  lfo.type = 'sine'; lfo.frequency.value = 8;
  lfoGain.gain.value = 20;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.22, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g); g.connect(out);
  osc.start(t); osc.stop(t + 0.55);
  lfo.start(t); lfo.stop(t + 0.55);
  trackNode(osc); trackNode(lfo);
}

function playBurn(c: AudioContext, out: GainNode, t: number): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.4);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 2000;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.18, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  src.connect(hp); hp.connect(g); g.connect(out);
  src.start(t); src.stop(t + 0.45);
  trackNode(src);
}

function playSleep(c: AudioContext, out: GainNode, t: number): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine'; osc.frequency.value = 180;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.2, t + 0.2);
  g.gain.linearRampToValueAtTime(0.05, t + 0.4);
  g.gain.linearRampToValueAtTime(0.2, t + 0.6);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  osc.connect(g); g.connect(out);
  osc.start(t); osc.stop(t + 0.95);
  trackNode(osc);
}

function playConfuse(c: AudioContext, out: GainNode, t: number): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(600, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.1);
  osc.frequency.exponentialRampToValueAtTime(800, t + 0.2);
  osc.frequency.exponentialRampToValueAtTime(400, t + 0.3);
  osc.frequency.exponentialRampToValueAtTime(700, t + 0.4);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.22, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g); g.connect(out);
  osc.start(t); osc.stop(t + 0.55);
  trackNode(osc);
}

// ─ Attack ────────────────────────────────────────
interface AttackPattern {
  osc?: { type: OscillatorType; start: number; end: number; peakGain: number };
  noise?: { hp?: number; lp?: number; peakGain: number };
  durationSec: number;
}

const ATTACK_PATTERNS: Record<EnergyType, AttackPattern> = {
  Grass:     { osc: { type: 'triangle', start: 500, end: 800, peakGain: 0.25 }, noise: { hp: 1500, peakGain: 0.08 }, durationSec: 0.35 },
  Fire:      { osc: { type: 'sawtooth', start: 300, end: 140, peakGain: 0.3 }, noise: { hp: 800, peakGain: 0.12 }, durationSec: 0.4 },
  Water:     { osc: { type: 'sine', start: 900, end: 300, peakGain: 0.3 }, durationSec: 0.4 },
  Lightning: { osc: { type: 'square', start: 2000, end: 1200, peakGain: 0.25 }, noise: { hp: 3000, peakGain: 0.2 }, durationSec: 0.25 },
  Psychic:   { osc: { type: 'sine', start: 1500, end: 700, peakGain: 0.28 }, durationSec: 0.5 },
  Fighting:  { osc: { type: 'sine', start: 150, end: 60, peakGain: 0.35 }, noise: { peakGain: 0.15 }, durationSec: 0.3 },
  Darkness:  { osc: { type: 'sawtooth', start: 200, end: 80, peakGain: 0.3 }, durationSec: 0.45 },
  Metal:     { osc: { type: 'square', start: 800, end: 800, peakGain: 0.2 }, noise: { hp: 4000, peakGain: 0.15 }, durationSec: 0.3 },
  Dragon:    { osc: { type: 'sawtooth', start: 350, end: 120, peakGain: 0.35 }, noise: { hp: 500, lp: 3000, peakGain: 0.1 }, durationSec: 0.55 },
  Fairy:     { osc: { type: 'sine', start: 1800, end: 1200, peakGain: 0.22 }, noise: { hp: 4000, peakGain: 0.06 }, durationSec: 0.35 },
  Colorless: { osc: { type: 'sine', start: 600, end: 400, peakGain: 0.25 }, durationSec: 0.3 },
};

function playAttack(c: AudioContext, out: GainNode, t: number, etype: EnergyType): void {
  const pat = ATTACK_PATTERNS[etype] ?? ATTACK_PATTERNS.Colorless;
  if (pat.osc) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = pat.osc.type;
    osc.frequency.setValueAtTime(pat.osc.start, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, pat.osc.end), t + pat.durationSec);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pat.osc.peakGain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + pat.durationSec);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + pat.durationSec + 0.05);
    trackNode(osc);
  }
  if (pat.noise) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, pat.durationSec);
    let node: AudioNode = src;
    if (pat.noise.hp !== undefined) {
      const hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = pat.noise.hp;
      node.connect(hp); node = hp;
    }
    if (pat.noise.lp !== undefined) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = pat.noise.lp;
      node.connect(lp); node = lp;
    }
    const g = c.createGain();
    g.gain.setValueAtTime(pat.noise.peakGain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + pat.durationSec);
    node.connect(g); g.connect(out);
    src.start(t); src.stop(t + pat.durationSec + 0.05);
    trackNode(src);
  }
}

// ─ Turn-start：清亮上行三音 C5→E5→G5 ────
function playTurnStart(c: AudioContext, out: GainNode, t: number): void {
  beep(c, out, t,         523.25, 0.10, 'sine', 0.22);
  beep(c, out, t + 0.07,  659.25, 0.10, 'sine', 0.22);
  beep(c, out, t + 0.14,  783.99, 0.14, 'sine', 0.25);
}

// ═══════════════════════════════════════════════════════════════════════════
// v4.928 新音效 — 紙牌質感
// ═══════════════════════════════════════════════════════════════════════════

// ─ Evolve（進化）— 紙翻面 + 上升小琶音 ────
//   設計：先 paperSwish（卡片翻面）→ 緊接小三和弦上升（F5→A5→C6 = F major triad）
//   ~0.45 秒，給人「進化升級」儀式感。
function playEvolve(c: AudioContext, out: GainNode, t: number): void {
  // 翻牌音
  paperSwish(c, out, t, { bursts: 2, durationPerBurst: 0.05, gap: 0.015, peakGain: 0.22, hpCenter: 3000 });
  // 上升琶音 F5→A5→C6
  beep(c, out, t + 0.08, 698.46, 0.10, 'sine', 0.20);  // F5
  beep(c, out, t + 0.16, 880.00, 0.10, 'sine', 0.22);  // A5
  beep(c, out, t + 0.24, 1046.5, 0.16, 'sine', 0.26);  // C6
}

// ─ Attach Energy（附能量）— 紙片落下 + soft pluck ────
//   設計：短 noise burst（卡片落下接觸聲）+ triangle pitch sweep 400→200Hz
//   ~0.22 秒，給人「能量附加上去」的清脆感。
function playAttachEnergy(c: AudioContext, out: GainNode, t: number): void {
  // 落下 noise（極短）
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.04);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.2;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.18, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  src.connect(bp); bp.connect(ng); ng.connect(out);
  src.start(t); src.stop(t + 0.05);
  trackNode(src);
  // Soft pluck（triangle pitch sweep）
  const osc = c.createOscillator();
  const og = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(400, t + 0.02);
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.18);
  og.gain.setValueAtTime(0, t + 0.02);
  og.gain.linearRampToValueAtTime(0.22, t + 0.04);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
  osc.connect(og); og.connect(out);
  osc.start(t + 0.02); osc.stop(t + 0.22);
  trackNode(osc);
}

// ─ Ability（特性發動）— 中頻 chime ────
//   設計：兩個 sine 同時（perfect fifth 880Hz + 1320Hz），柔和 attack + 短 decay
//   ~0.4 秒，給人「咒語/魔法」感但比攻擊溫和。
function playAbility(c: AudioContext, out: GainNode, t: number): void {
  beep(c, out, t,        880,  0.35, 'sine', 0.22); // A5
  beep(c, out, t + 0.02, 1320, 0.30, 'sine', 0.18); // E6
  // 高頻 sparkle 點綴
  beep(c, out, t + 0.08, 2640, 0.18, 'sine', 0.10);
}

// ─ Prize Take（拿獎賞 1-5 張）— 紙抽出 + 上升二音 ────
//   設計：紙張抽出 noise + 上升二音 D5→F#5（major 3rd 樂觀感）
//   ~0.35 秒。
function playPrizeTake(c: AudioContext, out: GainNode, t: number): void {
  paperSwish(c, out, t, { bursts: 1, durationPerBurst: 0.08, peakGain: 0.28, hpCenter: 2400 });
  beep(c, out, t + 0.06, 587.33, 0.12, 'sine', 0.22); // D5
  beep(c, out, t + 0.16, 739.99, 0.18, 'sine', 0.26); // F#5
}

// ─ Victory Fanfare（拿最後一張獎賞）— 大調琶音 ────
//   設計：C5→E5→G5→C6 完整大三和弦 + 末尾 sustain
//   ~1.0 秒，慶祝即將獲勝。
function playVictoryFanfare(c: AudioContext, out: GainNode, t: number): void {
  beep(c, out, t,        523.25, 0.18, 'sine', 0.25); // C5
  beep(c, out, t + 0.10, 659.25, 0.18, 'sine', 0.25); // E5
  beep(c, out, t + 0.20, 783.99, 0.18, 'sine', 0.28); // G5
  beep(c, out, t + 0.32, 1046.5, 0.45, 'sine', 0.32); // C6 sustain
  // 一點高頻 shimmer
  beep(c, out, t + 0.35, 2093, 0.30, 'sine', 0.12);   // C7
}

// ─ Game Win（對局結束 - 勝）— 完整勝利曲 ────
//   設計：C5→E5→G5→C6→E6 + 長 sustain，2 秒。
function playGameWin(c: AudioContext, out: GainNode, t: number): void {
  beep(c, out, t,        523.25, 0.20, 'sine', 0.25); // C5
  beep(c, out, t + 0.12, 659.25, 0.20, 'sine', 0.25); // E5
  beep(c, out, t + 0.24, 783.99, 0.20, 'sine', 0.27); // G5
  beep(c, out, t + 0.36, 1046.5, 0.20, 'sine', 0.30); // C6
  beep(c, out, t + 0.48, 1318.5, 0.80, 'sine', 0.32); // E6 sustain
  // sparkle 點綴
  beep(c, out, t + 0.50, 2637, 0.50, 'sine', 0.10);
  beep(c, out, t + 0.70, 3136, 0.30, 'sine', 0.08);
}

// ─ Game Lose（對局結束 - 敗）— 下行小調 ────
//   設計：A4→F4→D4→C4 minor descent + low sustain，1.5 秒。
function playGameLose(c: AudioContext, out: GainNode, t: number): void {
  beep(c, out, t,        440.00, 0.22, 'sine', 0.22); // A4
  beep(c, out, t + 0.18, 349.23, 0.22, 'sine', 0.22); // F4
  beep(c, out, t + 0.36, 293.66, 0.22, 'sine', 0.22); // D4
  beep(c, out, t + 0.54, 261.63, 0.70, 'sawtooth', 0.18); // C4 sustain（sawtooth 更悲）
}

// ─ Ready Go（對戰開始通知，sample-based） ─────────────────────────
//   v4.929：使用預錄音檔 static/sounds/ready-go.wav。
//   onMount 階段 preloadReadyGoSample() 已 cache 進 readyGoBuffer，
//   第一次播放零延遲。若 buffer 未載完（極快進入對戰），降級 fallback：
//   播 turn-start 三音琶音當代替（玩家仍能聽到通知）。
function playReadyGo(c: AudioContext, out: GainNode, t: number): void {
  if (!readyGoBuffer) {
    // fallback：用三音琶音當作 ready-go 提醒
    playTurnStart(c, out, t);
    return;
  }
  const src = c.createBufferSource();
  src.buffer = readyGoBuffer;
  src.connect(out);
  src.start(t);
  trackNode(src);
}
