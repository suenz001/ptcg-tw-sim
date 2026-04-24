/**
 * PTCG 對戰音效系統 — Web Audio API 合成（v2.118 / Leon 要求）
 *
 * 設計原則：
 *   1. 零外部 asset：所有音效由 Web Audio 的 OscillatorNode / GainNode / noise buffer
 *      合成，不需要 bundler 打包 mp3、也不會因 CDN / 版權壞掉。
 *   2. Lazy init：AudioContext 在首次 play 時建立；若 browser policy 要求
 *      user gesture 後才能 resume（Chrome / Safari 預設），會自動處理。
 *   3. 可全域靜音 / 調音量：master gain 統一控制。
 *   4. 音色風格「輕量 UI」而非寫實 — 目的是對戰 feedback 而非擬真。
 *
 * 音效清單（與 Leon 的要求 + ptcg 對戰事件 對應）：
 *   - coin          擲硬幣（兩個短音：叮、啷）
 *   - deal          發牌（短 noise burst）
 *   - draw          抽牌（比 deal 再短）
 *   - shuffle       洗牌（連續 noise bursts）
 *   - click         點選 UI（短 click）
 *   - attack-<Type> 戰鬥招式（按屬性不同 oscillator pattern）
 *                   Type ∈ Grass / Fire / Water / Lightning / Psychic /
 *                          Fighting / Darkness / Metal / Dragon / Colorless
 *   - ko            昏厥（低音墜落）
 *   - poison        中毒（低頻顫音 pattern）
 *   - burn          灼燒（crackle noise）
 *   - sleep         睡眠（低頻 sine + 呼吸感 LFO）
 *   - confuse       混亂（pitch wobble）
 */

import type { EnergyType } from '$lib/cards/types';

// ─── 型別 ─────────────────────────────────────────────────────────────────
export type SfxName =
  | 'coin' | 'deal' | 'draw' | 'shuffle' | 'click' | 'ko'
  | 'poison' | 'burn' | 'sleep' | 'confuse'
  | `attack-${EnergyType}`;

// ─── AudioContext（單例、lazy-init）────────────────────────────────────────
let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
/** 使用者偏好音量 0..1（與 masterGain.gain 同步） */
let userVolume = 0.5;
let muted = false;

/** 取得（或建立）AudioContext。首次呼叫時會設好 master gain。 */
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    // Safari 舊版用 webkitAudioContext
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : userVolume;
    masterGain.connect(ctx.destination);
  }
  // Chrome/Safari 要求 resume 在 user gesture 後
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => { /* 使用者未 gesture — 稍後重試 */ });
  }
  return ctx;
}

// ─── 對外 API ────────────────────────────────────────────────────────────
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

/**
 * 播放音效。name 不認識時 no-op（不丟錯，避免 ability 寫錯 type 就整頁壞）。
 */
export function playSfx(name: SfxName, opts?: { volume?: number }): void {
  const c = getCtx();
  if (!c || !masterGain) return;
  if (muted) return;

  const gain = c.createGain();
  gain.gain.value = opts?.volume ?? 1;
  gain.connect(masterGain);

  const now = c.currentTime;
  try {
    if (name === 'coin') {
      playCoin(c, gain, now);
    } else if (name === 'deal') {
      playDeal(c, gain, now);
    } else if (name === 'draw') {
      playDraw(c, gain, now);
    } else if (name === 'shuffle') {
      playShuffle(c, gain, now);
    } else if (name === 'click') {
      playClick(c, gain, now);
    } else if (name === 'ko') {
      playKO(c, gain, now);
    } else if (name === 'poison') {
      playPoison(c, gain, now);
    } else if (name === 'burn') {
      playBurn(c, gain, now);
    } else if (name === 'sleep') {
      playSleep(c, gain, now);
    } else if (name === 'confuse') {
      playConfuse(c, gain, now);
    } else if (name.startsWith('attack-')) {
      const etype = name.slice(7) as EnergyType;
      playAttack(c, gain, now, etype);
    }
  } catch {
    // 音效合成失敗不應影響遊戲邏輯
  }
}

// ─── 音效合成實作 ──────────────────────────────────────────────────────────
// 通用：建立一段 white noise buffer
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
  osc.connect(g);
  g.connect(out);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

// ─ Coin flip（v2.120 Leon 要求改為金屬鏘鏘聲）────────
// 金屬敲擊的聲學特徵：多個 inharmonic partial（1f、~2.3f、~3.7f）同時響起後
// 快速 attack + 長 ring decay。用 3 個 sine + 1 個少量 square（帶少許刺痛感）
// 疊加，每次 coin flip 產生 2 次敲擊（硬幣彈起落下的兩個接觸聲）。
function metalClink(c: AudioContext, out: GainNode, t: number, base: number, peak: number): void {
  const partials = [
    { freq: base,        gain: peak,        type: 'sine' as OscillatorType,     dur: 0.45 },
    { freq: base * 2.31, gain: peak * 0.6,  type: 'sine' as OscillatorType,     dur: 0.35 },
    { freq: base * 3.75, gain: peak * 0.35, type: 'sine' as OscillatorType,     dur: 0.28 },
    { freq: base * 1.5,  gain: peak * 0.15, type: 'square' as OscillatorType,   dur: 0.08 }, // 刺耳 attack transient
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
  }
}
function playCoin(c: AudioContext, out: GainNode, t: number): void {
  // 兩次敲擊：第一次亮、第二次稍低（硬幣旋轉落地感）
  metalClink(c, out, t,         1400, 0.22);
  metalClink(c, out, t + 0.18,  1050, 0.18);
}

// ─ 紙張「刷」通用 helper（v2.119 換音色 — Leon 反饋：之前像電子嗶嗶聲）────
// 用 low-pass + high-pass 夾擠 white noise，讓它聽起來像紙張纖維摩擦而不是電子音：
//   - low-pass ~1200~2200Hz 去掉刺耳的高頻
//   - high-pass ~350Hz 去掉低頻隆隆聲，保留「刷」的 crinkle 質感
//   - 短 envelope（attack 8ms / decay 跟 duration 一致）
// 每個 burst 都用輕微 randomized filter freq，讓多 burst 聽起來更有「連續紙張」感。
interface PaperSwishOpts {
  bursts?: number;
  durationPerBurst?: number;
  gap?: number;
  peakGain?: number;
  lpCenter?: number;
  lpJitter?: number;
}
function paperSwish(c: AudioContext, out: GainNode, t: number, opts: PaperSwishOpts = {}): void {
  const bursts = opts.bursts ?? 1;
  const dur = opts.durationPerBurst ?? 0.1;
  const gap = opts.gap ?? 0.02;
  const peak = opts.peakGain ?? 0.28;
  const lpC = opts.lpCenter ?? 1600;
  const lpJ = opts.lpJitter ?? 700;
  for (let i = 0; i < bursts; i++) {
    const start = t + i * (dur + gap);
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, dur);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 350;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lpC + (Math.random() - 0.5) * lpJ;
    lp.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
    src.start(start); src.stop(start + dur + 0.05);
  }
}

// ─ Deal（發牌）— 兩個短紙張刷 ────
function playDeal(c: AudioContext, out: GainNode, t: number): void {
  paperSwish(c, out, t, { bursts: 2, durationPerBurst: 0.09, gap: 0.015, peakGain: 0.26, lpCenter: 1800 });
}

// ─ Draw（抽牌）— 單一紙張刷 ────
function playDraw(c: AudioContext, out: GainNode, t: number): void {
  paperSwish(c, out, t, { bursts: 1, durationPerBurst: 0.11, peakGain: 0.3, lpCenter: 1900 });
}

// ─ Shuffle — 多張紙互相摩擦（連續快速 burst）────
function playShuffle(c: AudioContext, out: GainNode, t: number): void {
  paperSwish(c, out, t, {
    bursts: 8,
    durationPerBurst: 0.06,
    gap: 0.018,
    peakGain: 0.2,
    lpCenter: 1500,
    lpJitter: 1000,
  });
}

// ─ Click — UI 短 click
function playClick(c: AudioContext, out: GainNode, t: number): void {
  beep(c, out, t, 1600, 0.03, 'square', 0.12);
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
}

// ─ Poison — 低頻顫音（毒的 creepy 感）
function playPoison(c: AudioContext, out: GainNode, t: number): void {
  const osc = c.createOscillator();
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  const g = c.createGain();
  osc.type = 'sine'; osc.frequency.value = 220;
  lfo.type = 'sine'; lfo.frequency.value = 8;      // 顫音速率
  lfoGain.gain.value = 20;                          // 顫音深度
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.22, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g); g.connect(out);
  osc.start(t); osc.stop(t + 0.55);
  lfo.start(t); lfo.stop(t + 0.55);
}

// ─ Burn — crackle noise + 高頻嘶嘶
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
}

// ─ Sleep — 低頻 sine + 呼吸感（兩次淡入淡出）
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
}

// ─ Confuse — pitch wobble（幾個隨機快速上下）
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
}

// ─ Attack — 按屬性特性 ────────────────────────────────────────────────────
// 每種屬性有自己的 oscillator / noise pattern，長度 ~0.35s
interface AttackPattern {
  osc?: { type: OscillatorType; start: number; end: number; peakGain: number };
  noise?: { hp?: number; lp?: number; peakGain: number };
  durationSec: number;
}

const ATTACK_PATTERNS: Record<EnergyType, AttackPattern> = {
  // 草：柔和上升（類似風切葉片）
  Grass:     { osc: { type: 'triangle', start: 500, end: 800, peakGain: 0.25 }, noise: { hp: 1500, peakGain: 0.08 }, durationSec: 0.35 },
  // 火：中頻嘶吼（sawtooth）
  Fire:      { osc: { type: 'sawtooth', start: 300, end: 140, peakGain: 0.3 }, noise: { hp: 800, peakGain: 0.12 }, durationSec: 0.4 },
  // 水：低頻水滴下降
  Water:     { osc: { type: 'sine', start: 900, end: 300, peakGain: 0.3 }, durationSec: 0.4 },
  // 雷：短促高頻 + 噪音 crackle
  Lightning: { osc: { type: 'square', start: 2000, end: 1200, peakGain: 0.25 }, noise: { hp: 3000, peakGain: 0.2 }, durationSec: 0.25 },
  // 超：金屬共鳴 high sine
  Psychic:   { osc: { type: 'sine', start: 1500, end: 700, peakGain: 0.28 }, durationSec: 0.5 },
  // 鬥：低沉 impact（低頻 + 短噪音）
  Fighting:  { osc: { type: 'sine', start: 150, end: 60, peakGain: 0.35 }, noise: { peakGain: 0.15 }, durationSec: 0.3 },
  // 惡：低頻 dark growl（sawtooth 下降）
  Darkness:  { osc: { type: 'sawtooth', start: 200, end: 80, peakGain: 0.3 }, durationSec: 0.45 },
  // 鋼：金屬敲擊（square + 高頻 ring）
  Metal:     { osc: { type: 'square', start: 800, end: 800, peakGain: 0.2 }, noise: { hp: 4000, peakGain: 0.15 }, durationSec: 0.3 },
  // 龍：氣勢深厚（低頻 saw + 中頻 triangle）
  Dragon:    { osc: { type: 'sawtooth', start: 350, end: 120, peakGain: 0.35 }, noise: { hp: 500, lp: 3000, peakGain: 0.1 }, durationSec: 0.55 },
  // 無：中性 sine
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
  }
}
