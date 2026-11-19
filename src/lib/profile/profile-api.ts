/**
 * v6.653 玩家個人名片與官方卡牌圓圈頭像（client 端統一資料與裁切出口）。
 *
 *   ・所有請求（/api/player-profile/*）集中在這裡：零輪詢，按需發送；
 *     公開檢視與批次端點永不回傳 email；裁切僅保存 { cardId, x, y, zoom }。
 *   ・裁切幾何保證（全尺寸縮放不變、零白邊）：
 *       卡牌比例 H / W = 1212 / 868。
 *       zoom ∈ [1, 3.5]，x ∈ [0.5 / zoom, 1 - 0.5 / zoom]，
 *       y ∈ [0.5 / (zoom * H/W), 1 - 0.5 / (zoom * H/W)]。
 */
import type { Card } from '$lib/cards/types';
import { loadIndex, loadSet, loadAllSets, loadCardSetMap } from '$lib/cards/pool';

export const PROF_NICK_MAX = 16;
export const PROF_BIO_MAX = 100;
export const PROF_MAX_HONORS = 10;
export const PROF_CARD_HW = 1212 / 868;
export const PROF_DEFAULT_CROP = { x: 0.5, y: 0.34, zoom: 1.4 } as const;

export type AvatarFrameId =
  | 'admin_gold'
  | 'champion_master'
  | 'sponsor_diamond'
  | 'premier_trophy'
  | 'rainbow_rare'
  | 'flame_flare'
  | 'emerald_leaf'
  | 'aqua_wave'
  | 'psychic_nebula'
  | 'shadow_phantom'
  | 'cyber_neon'
  | 'eevee_fluff'
  | 'fairy_ribbon'
  | 'gengar_grin'
  | 'snorlax_cozy'
  | 'dragon_crest'
  | 'frost_glacier'
  | 'steel_gear'
  | 'sakura_spring'
  | 'moon_eclipse';

export interface AvatarFrameSpec {
  id: AvatarFrameId;
  name: string;
  badge: string;
  stops: readonly [string, string, string, string];
  glow: string;
  innerBorder: string;
}

export type AvatarFrameGrad =
  | {
    kind: 'lin';
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    stops: readonly (readonly [string, string])[];
  }
  | {
    kind: 'rad';
    id: string;
    cx: string;
    cy: string;
    r: string;
    stops: readonly (readonly [string, string])[];
  };

export interface AvatarFrameShape {
  t: 'circle' | 'path' | 'polygon' | 'rect' | 'ellipse' | 'line';
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  d?: string;
  points?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  fill?: string;
  fo?: number;
  stroke?: string;
  sw?: number;
  so?: number;
  slj?: 'round' | 'miter' | 'bevel';
  slc?: 'round' | 'butt' | 'square';
  sd?: string;
  tf?: string;
}

export interface AvatarFrameArt {
  grads: readonly AvatarFrameGrad[];
  shapes: readonly AvatarFrameShape[];
}

/**
 * 20 款原創寶可夢／PTCG 風格立體裝飾頭像外框圖鑑表（僅限 Admin 後台指派，玩家端純粹展示外框不顯示名稱與角落小圖示）。
 */
export const AVATAR_FRAMES: readonly AvatarFrameSpec[] = [
  // ── 榮耀殿堂 (5) ──
  { id: 'admin_gold', name: '👑 聖金冠翼', badge: '👑', stops: ['#fff5ba', '#f7c844', '#b8760e', '#ffe785'], glow: 'rgba(247, 200, 68, 0.56)', innerBorder: '#4a2c04' },
  { id: 'champion_master', name: '🏆 大師桂冠', badge: '🏆', stops: ['#d8b4fe', '#8b5cf6', '#4c1d95', '#f59e0b'], glow: 'rgba(139, 92, 246, 0.56)', innerBorder: '#220e47' },
  { id: 'sponsor_diamond', name: '💎 太晶星鑽', badge: '💎', stops: ['#f0fdff', '#67e8f9', '#818cf8', '#f472b6'], glow: 'rgba(103, 232, 249, 0.56)', innerBorder: '#0c2d48' },
  { id: 'premier_trophy', name: '🏅 紅白冠軍球', badge: '🏅', stops: ['#ef4444', '#f8fafc', '#f59e0b', '#dc2626'], glow: 'rgba(239, 68, 68, 0.52)', innerBorder: '#18181b' },
  { id: 'rainbow_rare', name: '🌈 虹彩超稀有', badge: '🌈', stops: ['#ff6b9d', '#fde047', '#38bdf8', '#c084fc'], glow: 'rgba(244, 114, 182, 0.54)', innerBorder: '#1e1b4b' },
  // ── 屬性王牌 (5) ──
  { id: 'flame_flare', name: '🔥 熾焰龍翼', badge: '🔥', stops: ['#fff7ed', '#fde047', '#f97316', '#dc2626'], glow: 'rgba(249, 115, 22, 0.56)', innerBorder: '#3b0a04' },
  { id: 'emerald_leaf', name: '🌿 奇異藤花', badge: '🌿', stops: ['#bbf7d0', '#34d399', '#15803d', '#fb7185'], glow: 'rgba(52, 211, 153, 0.52)', innerBorder: '#0f3d1e' },
  { id: 'aqua_wave', name: '🌊 蒼海湧浪', badge: '🌊', stops: ['#e0f2fe', '#38bdf8', '#0ea5e9', '#1d4ed8'], glow: 'rgba(14, 165, 233, 0.54)', innerBorder: '#082f49' },
  { id: 'psychic_nebula', name: '🔮 超能星環', badge: '🔮', stops: ['#f5d0fe', '#e879f9', '#a855f7', '#4338ca'], glow: 'rgba(168, 85, 247, 0.54)', innerBorder: '#2e1065' },
  { id: 'shadow_phantom', name: '👻 幽影鬼火', badge: '👻', stops: ['#a78bfa', '#6366f1', '#2dd4bf', '#312e81'], glow: 'rgba(99, 102, 241, 0.52)', innerBorder: '#0f172a' },
  // ── 萌耳精靈 (5) ──
  { id: 'cyber_neon', name: '⚡ 電氣萌耳', badge: '⚡', stops: ['#fef08a', '#facc15', '#eab308', '#38bdf8'], glow: 'rgba(250, 204, 21, 0.56)', innerBorder: '#422006' },
  { id: 'eevee_fluff', name: '🦊 絨耳褐尾', badge: '🦊', stops: ['#fef3c7', '#d99a5b', '#b46e34', '#854d21'], glow: 'rgba(217, 154, 91, 0.5)', innerBorder: '#45210a' },
  { id: 'fairy_ribbon', name: '🎀 仙子緞帶', badge: '🎀', stops: ['#fbcfe8', '#f472b6', '#7dd3fc', '#f9a8d4'], glow: 'rgba(244, 114, 182, 0.52)', innerBorder: '#831843' },
  { id: 'gengar_grin', name: '😈 暗紫鬼耳', badge: '😈', stops: ['#a78bfa', '#8b5cf6', '#5b21b6', '#2e1065'], glow: 'rgba(139, 92, 246, 0.54)', innerBorder: '#1e0a3c' },
  { id: 'snorlax_cozy', name: '💤 慵懶藍耳', badge: '💤', stops: ['#2dd4bf', '#0f766e', '#fef3c7', '#134e4a'], glow: 'rgba(45, 212, 191, 0.48)', innerBorder: '#042f2e' },
  // ── 經典珍藏 (5) ──
  { id: 'dragon_crest', name: '🐉 古龍金鱗', badge: '🐉', stops: ['#34d399', '#059669', '#facc15', '#064e3b'], glow: 'rgba(16, 185, 129, 0.52)', innerBorder: '#052e16' },
  { id: 'frost_glacier', name: '❄️ 冰晶雪冠', badge: '❄️', stops: ['#f0f9ff', '#bae6fd', '#7dd3fc', '#0284c7'], glow: 'rgba(125, 211, 252, 0.54)', innerBorder: '#0c4a6e' },
  { id: 'steel_gear', name: '⚙️ 鋼鐵齒輪', badge: '⚙️', stops: ['#f1f5f9', '#94a3b8', '#475569', '#f59e0b'], glow: 'rgba(148, 163, 184, 0.5)', innerBorder: '#1e293b' },
  { id: 'sakura_spring', name: '🌸 緋櫻吹雪', badge: '🌸', stops: ['#fce7f3', '#fbcfe8', '#f9a8d4', '#83324a'], glow: 'rgba(249, 168, 212, 0.52)', innerBorder: '#4a1929' },
  { id: 'moon_eclipse', name: '🌗 日月雙曜', badge: '🌗', stops: ['#fef08a', '#f59e0b', '#60a5fa', '#4338ca'], glow: 'rgba(245, 158, 11, 0.52)', innerBorder: '#1e1b4b' },
] as const;

const AVATAR_FRAME_MAP = new Map<string, AvatarFrameSpec>(AVATAR_FRAMES.map((f) => [f.id, f]));

/**
 * 20 款立體裝飾 SVG 外框幾何描述（viewBox 0 0 140 140，內圓頭像中心 (70,70)、半徑 46）。
 * Svelte AvatarCircle 與 Canvas PNG 下載共用同一份資料，零 {@html}、零外部網路請求。
 */
export const AVATAR_FRAME_ART: Readonly<Record<AvatarFrameId, AvatarFrameArt>> = {
  admin_gold: {
    grads: [
      { kind: 'lin', id: 'g1', x1: 18, y1: 12, x2: 122, y2: 128, stops: [['0%', '#fff5ba'], ['35%', '#f7c844'], ['70%', '#b8760e'], ['100%', '#ffe785']] },
      { kind: 'rad', id: 'gem', cx: '40%', cy: '35%', r: '65%', stops: [['0%', '#ff9ea8'], ['50%', '#e11d48'], ['100%', '#7f0b24']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#2d1d04', sw: 7 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@g1', sw: 4.2 },
      { t: 'circle', cx: 70, cy: 70, r: 45.8, stroke: '#fff2b2', sw: 1, so: 0.75 },
      { t: 'path', d: 'M22 76 C9 66, 7 50, 14 38 C16 48, 20 55, 25 59 C19 63, 19 70, 22 76 Z', fill: '@g1', stroke: '#4a2c04', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M25 89 C12 84, 7 72, 10 61 C14 69, 19 74, 24 77 C21 81, 22 85, 25 89 Z', fill: '@g1', stroke: '#4a2c04', sw: 1.2, slj: 'round' },
      { t: 'path', d: 'M118 76 C131 66, 133 50, 126 38 C124 48, 120 55, 115 59 C121 63, 121 70, 118 76 Z', fill: '@g1', stroke: '#4a2c04', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M115 89 C128 84, 133 72, 130 61 C126 69, 121 74, 116 77 C119 81, 118 85, 115 89 Z', fill: '@g1', stroke: '#4a2c04', sw: 1.2, slj: 'round' },
      { t: 'path', d: 'M51 24 L47 11 L59 18 L70 6 L81 18 L93 11 L89 24 Q70 20 51 24 Z', fill: '@g1', stroke: '#4a2c04', sw: 1.5, slj: 'round' },
      { t: 'circle', cx: 70, cy: 17.5, r: 3.6, fill: '@gem', stroke: '#fff3c4', sw: 1 },
      { t: 'circle', cx: 57, cy: 20, r: 1.9, fill: '#fff6cc' },
      { t: 'circle', cx: 83, cy: 20, r: 1.9, fill: '#fff6cc' },
      { t: 'circle', cx: 70, cy: 119, r: 6.8, fill: '#2b1904', stroke: '@g1', sw: 2 },
      { t: 'path', d: 'M64.2 119 A5.8 5.8 0 0 1 75.8 119 Z', fill: '#e11d48' },
      { t: 'path', d: 'M64.2 119 A5.8 5.8 0 0 0 75.8 119 Z', fill: '#f8fafc' },
      { t: 'line', x1: 63.8, y1: 119, x2: 76.2, y2: 119, stroke: '#2b1904', sw: 1.6 },
      { t: 'circle', cx: 70, cy: 119, r: 2.2, fill: '#ffffff', stroke: '#2b1904', sw: 1.1 },
    ],
  },
  champion_master: {
    grads: [
      { kind: 'lin', id: 'p1', x1: 20, y1: 15, x2: 120, y2: 125, stops: [['0%', '#d8b4fe'], ['45%', '#8b5cf6'], ['100%', '#4c1d95']] },
      { kind: 'lin', id: 'lg', x1: 25, y1: 40, x2: 115, y2: 125, stops: [['0%', '#fef08a'], ['50%', '#f59e0b'], ['100%', '#b45309']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#220e47', sw: 6.8 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@p1', sw: 4 },
      { t: 'circle', cx: 70, cy: 70, r: 46, stroke: '#fde68a', sw: 1.1, so: 0.8 },
      { t: 'path', d: 'M23 94 C13 92, 11 81, 18 76 C22 82, 24 88, 23 94 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M18 76 C9 71, 10 59, 18 56 C21 63, 21 70, 18 76 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M21 57 C14 50, 18 39, 27 38 C28 45, 25 52, 21 57 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M35 109 C25 110, 20 101, 25 94 C31 99, 34 104, 35 109 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M51 119 C41 122, 34 116, 37 109 C44 112, 48 115, 51 119 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M117 94 C127 92, 129 81, 122 76 C118 82, 116 88, 117 94 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M122 76 C131 71, 130 59, 122 56 C119 63, 119 70, 122 76 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M119 57 C126 50, 122 39, 113 38 C112 45, 115 52, 119 57 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M105 109 C115 110, 120 101, 115 94 C109 99, 106 104, 105 109 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M89 119 C99 122, 106 116, 103 109 C96 112, 92 115, 89 119 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'circle', cx: 70, cy: 18, r: 10.5, fill: '#2e1065', stroke: '@lg', sw: 2.2 },
      { t: 'path', d: 'M60.8 18 A9.2 9.2 0 0 1 79.2 18 Z', fill: '#7c3aed' },
      { t: 'path', d: 'M60.8 18 A9.2 9.2 0 0 0 79.2 18 Z', fill: '#f8fafc' },
      { t: 'circle', cx: 64.5, cy: 13.8, r: 2.2, fill: '#f472b6' },
      { t: 'circle', cx: 75.5, cy: 13.8, r: 2.2, fill: '#f472b6' },
      { t: 'line', x1: 60.5, y1: 18, x2: 79.5, y2: 18, stroke: '#1e1b4b', sw: 1.8 },
      { t: 'circle', cx: 70, cy: 18, r: 2.8, fill: '#ffffff', stroke: '#1e1b4b', sw: 1.2 },
      { t: 'path', d: 'M44 17 L45.6 21.4 L50 23 L45.6 24.6 L44 29 L42.4 24.6 L38 23 L42.4 21.4 Z', fill: '#fef08a' },
      { t: 'path', d: 'M96 17 L97.6 21.4 L102 23 L97.6 24.6 L96 29 L94.4 24.6 L90 23 L94.4 21.4 Z', fill: '#fef08a' },
      { t: 'polygon', points: '70,113 78,121 70,127 62,121', fill: '@lg', stroke: '#422006', sw: 1.2 },
    ],
  },
  sponsor_diamond: {
    grads: [
      { kind: 'lin', id: 't1', x1: 15, y1: 10, x2: 125, y2: 130, stops: [['0%', '#f0fdff'], ['30%', '#67e8f9'], ['65%', '#818cf8'], ['100%', '#f472b6']] },
      { kind: 'lin', id: 'c1', x1: 70, y1: 4, x2: 70, y2: 30, stops: [['0%', '#ffffff'], ['45%', '#a5f3fc'], ['100%', '#38bdf8']] },
      { kind: 'lin', id: 'c2', x1: 90, y1: 88, x2: 128, y2: 124, stops: [['0%', '#e0f2fe'], ['55%', '#60a5fa'], ['100%', '#c084fc']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#0c2d48', sw: 6.6 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@t1', sw: 4.2 },
      { t: 'circle', cx: 70, cy: 70, r: 46, stroke: '#ffffff', sw: 1.1, so: 0.85, sd: '10 6' },
      { t: 'polygon', points: '70,4 78,19 70,27 62,19', fill: '@c1', stroke: '#0e4f73', sw: 1.3, slj: 'round' },
      { t: 'polygon', points: '70,4 78,19 70,21', fill: '#ffffff', fo: 0.65 },
      { t: 'polygon', points: '56,11 64,22 57,26 51,19', fill: '@c2', stroke: '#0e4f73', sw: 1.2, slj: 'round' },
      { t: 'polygon', points: '84,11 89,19 83,26 76,22', fill: '@c2', stroke: '#0e4f73', sw: 1.2, slj: 'round' },
      { t: 'polygon', points: '122,94 113,111 101,106 108,94', fill: '@c2', stroke: '#0e4f73', sw: 1.2, slj: 'round' },
      { t: 'polygon', points: '108,113 94,125 89,115 99,108', fill: '@c1', stroke: '#0e4f73', sw: 1.2, slj: 'round' },
      { t: 'polygon', points: '22,42 30,49 23,58 15,50', fill: '@c1', stroke: '#0e4f73', sw: 1.2, slj: 'round' },
      { t: 'path', d: 'M117 34 L119 40 L125 42 L119 44 L117 50 L115 44 L109 42 L115 40 Z', fill: '#ffffff' },
      { t: 'path', d: 'M24 96 L25.6 100.4 L30 102 L25.6 103.6 L24 108 L22.4 103.6 L18 102 L22.4 100.4 Z', fill: '#bae6fd' },
    ],
  },
  premier_trophy: {
    grads: [
      { kind: 'lin', id: 'gd', x1: 55, y1: 4, x2: 85, y2: 30, stops: [['0%', '#fef9c3'], ['50%', '#f59e0b'], ['100%', '#b45309']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#18181b', sw: 7.2 },
      { t: 'path', d: 'M21 70 A49 49 0 0 1 119 70', stroke: '#ef4444', sw: 4.4 },
      { t: 'path', d: 'M21 70 A49 49 0 0 0 119 70', stroke: '#f8fafc', sw: 4.4 },
      { t: 'rect', x: 16, y: 66, w: 11, h: 8, rx: 3, fill: '#18181b', stroke: '#facc15', sw: 1.4 },
      { t: 'rect', x: 113, y: 66, w: 11, h: 8, rx: 3, fill: '#18181b', stroke: '#facc15', sw: 1.4 },
      { t: 'path', d: 'M52 117 L41 131 L51 128 L56 135 L64 119 Z', fill: '#dc2626', stroke: '#7f1d1d', sw: 1.2, slj: 'round' },
      { t: 'path', d: 'M88 117 L99 131 L89 128 L84 135 L76 119 Z', fill: '#dc2626', stroke: '#7f1d1d', sw: 1.2, slj: 'round' },
      { t: 'path', d: 'M59 8 H81 L78 20 C76 24, 64 24, 62 20 Z', fill: '@gd', stroke: '#451a03', sw: 1.4, slj: 'round' },
      { t: 'path', d: 'M59 11 C53 11, 53 18, 60 18', stroke: '#f59e0b', sw: 2, slc: 'round' },
      { t: 'path', d: 'M81 11 C87 11, 87 18, 80 18', stroke: '#f59e0b', sw: 2, slc: 'round' },
      { t: 'rect', x: 66.5, y: 22, w: 7, h: 4, fill: '#d97706', stroke: '#451a03', sw: 1 },
      { t: 'rect', x: 62, y: 25.5, w: 16, h: 3.5, rx: 1.5, fill: '@gd', stroke: '#451a03', sw: 1 },
      { t: 'circle', cx: 70, cy: 119, r: 5, fill: '#f8fafc', stroke: '#18181b', sw: 2.2 },
      { t: 'circle', cx: 70, cy: 119, r: 2, fill: '#ef4444' },
    ],
  },
  rainbow_rare: {
    grads: [
      { kind: 'lin', id: 'rb', x1: 12, y1: 12, x2: 128, y2: 128, stops: [['0%', '#ff6b9d'], ['22%', '#fde047'], ['45%', '#4ade80'], ['70%', '#38bdf8'], ['100%', '#c084fc']] },
      { kind: 'lin', id: 'rb2', x1: 128, y1: 12, x2: 12, y2: 128, stops: [['0%', '#ffffff'], ['50%', '#f0abfc'], ['100%', '#67e8f9']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.5, stroke: '#1e1b4b', sw: 7 },
      { t: 'circle', cx: 70, cy: 70, r: 49.5, stroke: '@rb', sw: 4.6 },
      { t: 'circle', cx: 70, cy: 70, r: 46, stroke: '#ffffff', sw: 1.2, so: 0.9 },
      { t: 'path', d: 'M27 27 L31 15 L35 27 L47 31 L35 35 L31 47 L27 35 L15 31 Z', fill: '@rb2', stroke: '#312e81', sw: 1.1 },
      { t: 'path', d: 'M107 24 L110 15 L113 24 L122 27 L113 30 L110 39 L107 30 L98 27 Z', fill: '#fef08a', stroke: '#713f12', sw: 1 },
      { t: 'path', d: 'M106 105 L110 95 L114 105 L124 109 L114 113 L110 123 L106 113 L96 109 Z', fill: '@rb2', stroke: '#312e81', sw: 1.1 },
      { t: 'path', d: 'M26 107 L29 99 L32 107 L40 110 L32 113 L29 121 L26 113 L18 110 Z', fill: '#67e8f9', stroke: '#164e63', sw: 1 },
      { t: 'path', d: 'M52 17 Q70 11 88 17', stroke: '@rb', sw: 2.6, slc: 'round' },
      { t: 'path', d: 'M52 123 Q70 129 88 123', stroke: '@rb', sw: 2.6, slc: 'round' },
      { t: 'circle', cx: 70, cy: 14, r: 2.8, fill: '#ffffff' },
      { t: 'circle', cx: 70, cy: 126, r: 2.8, fill: '#ffffff' },
    ],
  },
  flame_flare: {
    grads: [
      { kind: 'lin', id: 'f1', x1: 20, y1: 120, x2: 120, y2: 15, stops: [['0%', '#dc2626'], ['45%', '#f97316'], ['85%', '#fde047'], ['100%', '#fff7ed']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#3b0a04', sw: 7 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@f1', sw: 4.2 },
      { t: 'path', d: 'M98 28 C112 24, 122 14, 124 8 C127 21, 124 34, 115 44 C122 41, 128 38, 130 33 C129 48, 122 58, 114 64 C113 48, 107 36, 98 28 Z', fill: '@f1', stroke: '#5c1106', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M107 35 C114 31, 119 25, 120 19 C121 28, 118 37, 112 43 Z', fill: '#fef9c3' },
      { t: 'path', d: 'M40 112 C24 114, 14 104, 10 92 C17 97, 23 97, 27 94 C16 86, 13 73, 18 62 C21 71, 24 77, 29 82 C29 94, 33 104, 40 112 Z', fill: '@f1', stroke: '#5c1106', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M31 103 C23 103, 18 98, 16 92 C22 95, 27 95, 31 92 Z', fill: '#fef08a' },
      { t: 'path', d: 'M70 108 C75 113, 79 117, 77 123 C75 127, 72 128, 70 128 C68 128, 65 127, 63 123 C61 117, 65 113, 70 108 Z', fill: '@f1', stroke: '#4a0d04', sw: 1.3 },
      { t: 'path', d: 'M70 115 C73 118, 74 121, 72 124 C70.8 125.5, 69.2 125.5, 68 124 C66 121, 67 118, 70 115 Z', fill: '#fffbeb' },
      { t: 'circle', cx: 104, cy: 14, r: 2.6, fill: '#fde047' },
      { t: 'circle', cx: 128, cy: 24, r: 2, fill: '#fb923c' },
      { t: 'circle', cx: 18, cy: 52, r: 2.3, fill: '#fde047' },
    ],
  },
  emerald_leaf: {
    grads: [
      { kind: 'lin', id: 'v1', x1: 18, y1: 18, x2: 122, y2: 122, stops: [['0%', '#6b4423'], ['50%', '#472b15'], ['100%', '#2e4d25']] },
      { kind: 'lin', id: 'lf', x1: 80, y1: 15, x2: 125, y2: 60, stops: [['0%', '#bbf7d0'], ['45%', '#34d399'], ['100%', '#15803d']] },
      { kind: 'rad', id: 'fl', cx: '50%', cy: '50%', r: '55%', stops: [['0%', '#ffe4e6'], ['55%', '#fb7185'], ['100%', '#be123c']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@v1', sw: 5.6 },
      { t: 'path', d: 'M107 38 C120 53, 122 76, 114 96', stroke: '#4ade80', sw: 2.4, slc: 'round' },
      { t: 'path', d: 'M35 106 C50 119, 73 123, 93 115', stroke: '#4ade80', sw: 2.2, slc: 'round' },
      { t: 'path', d: 'M101 32 C108 17, 122 14, 128 21 C124 32, 112 37, 101 32 Z', fill: '@lf', stroke: '#0f3d1e', sw: 1.3 },
      { t: 'path', d: 'M111 45 C124 38, 134 45, 132 55 C122 57, 114 53, 111 45 Z', fill: '@lf', stroke: '#0f3d1e', sw: 1.3 },
      { t: 'path', d: 'M92 24 C91 13, 99 7, 106 10 C105 18, 99 23, 92 24 Z', fill: '#86efac', stroke: '#0f3d1e', sw: 1.1 },
      { t: 'path', d: 'M24 85 C10 83, 8 70, 17 65 C24 70, 27 78, 24 85 Z', fill: '@lf', stroke: '#0f3d1e', sw: 1.2 },
      { t: 'path', d: 'M48 117 C47 129, 59 133, 66 125 C61 119, 54 116, 48 117 Z', fill: '@lf', stroke: '#0f3d1e', sw: 1.2 },
      { t: 'ellipse', cx: 0, cy: -10, rx: 6.2, ry: 8.5, fill: '@fl', stroke: '#581122', sw: 1.1, tf: 'translate(32 104)' },
      { t: 'ellipse', cx: 9.5, cy: -3, rx: 6.2, ry: 8.5, fill: '@fl', stroke: '#581122', sw: 1.1, tf: 'translate(32 104) rotate(72 9.5 -3)' },
      { t: 'ellipse', cx: 6, cy: 8.2, rx: 6.2, ry: 8.5, fill: '@fl', stroke: '#581122', sw: 1.1, tf: 'translate(32 104) rotate(144 6 8.2)' },
      { t: 'ellipse', cx: -6, cy: 8.2, rx: 6.2, ry: 8.5, fill: '@fl', stroke: '#581122', sw: 1.1, tf: 'translate(32 104) rotate(216 -6 8.2)' },
      { t: 'ellipse', cx: -9.5, cy: -3, rx: 6.2, ry: 8.5, fill: '@fl', stroke: '#581122', sw: 1.1, tf: 'translate(32 104) rotate(288 -9.5 -3)' },
      { t: 'circle', cx: 32, cy: 104, r: 5, fill: '#fde047', stroke: '#713f12', sw: 1.1 },
      { t: 'path', d: 'M24 44 C17 39, 17 32, 24 30 C27 35, 27 40, 24 44 Z', fill: '#fda4af', stroke: '#881337', sw: 0.9 },
    ],
  },
  aqua_wave: {
    grads: [
      { kind: 'lin', id: 'w1', x1: 15, y1: 15, x2: 125, y2: 125, stops: [['0%', '#bae6fd'], ['45%', '#0ea5e9'], ['100%', '#1d4ed8']] },
      { kind: 'lin', id: 'w2', x1: 12, y1: 80, x2: 80, y2: 128, stops: [['0%', '#e0f2fe'], ['55%', '#38bdf8'], ['100%', '#0369a1']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#082f49', sw: 6.8 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@w1', sw: 4.2 },
      { t: 'path', d: 'M16 74 C9 94, 24 123, 56 126 C72 128, 86 123, 95 114 C78 119, 55 117, 41 105 C28 94, 25 81, 31 74 C24 72, 20 72, 16 74 Z', fill: '@w2', stroke: '#0c4a6e', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M16 74 C12 65, 19 57, 27 61 C22 65, 22 70, 26 73', fill: '#f0f9ff', stroke: '#0369a1', sw: 1.2 },
      { t: 'path', d: 'M29 102 C43 114, 62 118, 79 115', stroke: '#ffffff', sw: 2, slc: 'round', so: 0.8 },
      { t: 'path', d: 'M111 22 C111 22, 121 34, 118 42 C116 47, 111 49, 106 47 C101 44, 101 37, 111 22 Z', fill: '@w1', stroke: '#0c4a6e', sw: 1.3 },
      { t: 'ellipse', cx: 109, cy: 39, rx: 2, ry: 3.6, fill: '#ffffff', fo: 0.75 },
      { t: 'circle', cx: 96, cy: 20, r: 4.5, fill: '#e0f2fe', fo: 0.75, stroke: '#0284c7', sw: 1.1 },
      { t: 'circle', cx: 123, cy: 52, r: 3.4, fill: '#bae6fd', stroke: '#0284c7', sw: 1 },
      { t: 'circle', cx: 24, cy: 48, r: 3.2, fill: '#e0f2fe', stroke: '#0284c7', sw: 1 },
      { t: 'circle', cx: 99, cy: 117, r: 2.8, fill: '#ffffff' },
    ],
  },
  psychic_nebula: {
    grads: [
      { kind: 'lin', id: 'ps', x1: 12, y1: 20, x2: 128, y2: 120, stops: [['0%', '#f5d0fe'], ['50%', '#a855f7'], ['100%', '#4338ca']] },
    ],
    shapes: [
      { t: 'path', d: 'M116.63 54.93 A64 22 0 0 1 116.63 85.07', tf: 'rotate(-24 70 70)', stroke: '#e879f9', sw: 2.2, so: 0.85, slc: 'round' },
      { t: 'path', d: 'M23.37 85.07 A64 22 0 0 1 23.37 54.93', tf: 'rotate(-24 70 70)', stroke: '#e879f9', sw: 2.2, so: 0.85, slc: 'round' },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#2e1065', sw: 6.8 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@ps', sw: 4 },
      { t: 'path', d: 'M35 19 A12 12 0 1 0 47 36 A9.2 9.2 0 1 1 35 19 Z', fill: '#fef08a', stroke: '#581c87', sw: 1.3 },
      { t: 'polygon', points: '116,32 122,42 115,50 109,40', fill: '#e879f9', stroke: '#4c1d95', sw: 1.2 },
      { t: 'polygon', points: '22,92 29,98 22,107 16,99', fill: '#c084fc', stroke: '#4c1d95', sw: 1.2 },
      { t: 'path', d: 'M56 119 Q70 111 84 119 Q70 127 56 119 Z', fill: '#3b0764', stroke: '#f0abfc', sw: 1.5 },
      { t: 'circle', cx: 70, cy: 119, r: 3.4, fill: '#f5d0fe' },
      { t: 'circle', cx: 70, cy: 119, r: 1.4, fill: '#581c87' },
      { t: 'path', d: 'M104 95 L106 100 L111 102 L106 104 L104 109 L102 104 L97 102 L102 100 Z', fill: '#fef08a' },
    ],
  },
  shadow_phantom: {
    grads: [
      { kind: 'lin', id: 'sh', x1: 20, y1: 15, x2: 120, y2: 125, stops: [['0%', '#6366f1'], ['50%', '#312e81'], ['100%', '#0f172a']] },
      { kind: 'rad', id: 'wf', cx: '50%', cy: '65%', r: '55%', stops: [['0%', '#ccfbf1'], ['50%', '#2dd4bf'], ['100%', '#6d28d9']] },
    ],
    shapes: [
      { t: 'path', d: 'M44 26 C35 17, 34 8, 41 6 C41 13, 47 18, 55 22 Z', fill: '#1e1b4b', stroke: '#818cf8', sw: 1.4, slj: 'round' },
      { t: 'path', d: 'M96 26 C105 17, 106 8, 99 6 C99 13, 93 18, 85 22 Z', fill: '#1e1b4b', stroke: '#818cf8', sw: 1.4, slj: 'round' },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#09090b', sw: 7 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@sh', sw: 4.2 },
      { t: 'circle', cx: 70, cy: 70, r: 46, stroke: '#a78bfa', sw: 1, so: 0.7 },
      { t: 'path', d: 'M20 72 C24 80, 29 84, 27 92 C25 97, 20 99, 15 96 C10 92, 12 83, 18 79 C16 76, 17 73, 20 72 Z', fill: '@wf', stroke: '#1e1b4b', sw: 1.2 },
      { t: 'path', d: 'M120 46 C125 54, 129 59, 126 66 C124 71, 118 72, 114 68 C110 64, 113 56, 118 52 C117 49, 118 47, 120 46 Z', fill: '@wf', stroke: '#1e1b4b', sw: 1.2 },
      { t: 'path', d: 'M96 112 C108 109, 118 100, 122 89', stroke: '#7c3aed', sw: 2.6, slc: 'round' },
      { t: 'circle', cx: 114, cy: 103, r: 3, fill: '#2dd4bf' },
      { t: 'circle', cx: 29, cy: 40, r: 2.4, fill: '#a78bfa' },
    ],
  },
  cyber_neon: {
    grads: [
      { kind: 'lin', id: 'e1', x1: 25, y1: 12, x2: 115, y2: 125, stops: [['0%', '#fef08a'], ['50%', '#facc15'], ['100%', '#eab308']] },
    ],
    shapes: [
      { t: 'path', d: 'M36 33 C25 22, 16 12, 17 6 C25 8, 39 16, 49 25 Z', fill: '@e1', stroke: '#422006', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M17 6 C22 7.5, 27.5 10.5, 31 14 L24.5 21 C20 15.5, 16.5 10, 17 6 Z', fill: '#1e1b18' },
      { t: 'path', d: 'M104 33 C115 22, 124 12, 123 6 C115 8, 101 16, 91 25 Z', fill: '@e1', stroke: '#422006', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M123 6 C118 7.5, 112.5 10.5, 109 14 L115.5 21 C120 15.5, 123.5 10, 123 6 Z', fill: '#1e1b18' },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#422006', sw: 7 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@e1', sw: 4.4 },
      { t: 'circle', cx: 24, cy: 84, r: 6.4, fill: '#ef4444', stroke: '#7f1d1d', sw: 1.3 },
      { t: 'circle', cx: 22.3, cy: 82.2, r: 1.8, fill: '#fecaca' },
      { t: 'circle', cx: 116, cy: 84, r: 6.4, fill: '#ef4444', stroke: '#7f1d1d', sw: 1.3 },
      { t: 'circle', cx: 114.3, cy: 82.2, r: 1.8, fill: '#fecaca' },
      { t: 'path', d: 'M101 114 L111 102 L106 99 L123 82 L133 93 L118 104 L123 108 L106 122 Z', fill: '@e1', stroke: '#422006', sw: 1.5, slj: 'round' },
      { t: 'path', d: 'M14 64 L20 67 L15 71', stroke: '#38bdf8', sw: 1.8, slc: 'round' },
      { t: 'path', d: 'M126 56 L120 60 L125 64', stroke: '#38bdf8', sw: 1.8, slc: 'round' },
    ],
  },
  eevee_fluff: {
    grads: [
      { kind: 'lin', id: 'ev', x1: 20, y1: 15, x2: 120, y2: 125, stops: [['0%', '#d99a5b'], ['55%', '#b46e34'], ['100%', '#854d21']] },
    ],
    shapes: [
      { t: 'path', d: 'M35 34 C22 20, 17 8, 22 4 C32 7, 45 17, 52 26 Z', fill: '@ev', stroke: '#45210a', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M25 9 C31 12, 39 18, 44 25 L36 28 C30 22, 25 14, 25 9 Z', fill: '#45210a' },
      { t: 'path', d: 'M105 34 C118 20, 123 8, 118 4 C108 7, 95 17, 88 26 Z', fill: '@ev', stroke: '#45210a', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M115 9 C109 12, 101 18, 96 25 L104 28 C110 22, 115 14, 115 9 Z', fill: '#45210a' },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#45210a', sw: 7 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@ev', sw: 4.4 },
      { t: 'path', d: 'M40 112 C45 104, 54 107, 58 112 C63 105, 77 105, 82 112 C86 107, 95 104, 100 112 C94 123, 83 128, 70 128 C57 128, 46 123, 40 112 Z', fill: '#fef3c7', stroke: '#78350f', sw: 1.4, slj: 'round' },
      { t: 'path', d: 'M114 96 C126 94, 133 84, 130 74 C126 78, 122 78, 120 75 C116 83, 115 89, 114 96 Z', fill: '#fef3c7', stroke: '#78350f', sw: 1.3, slj: 'round' },
    ],
  },
  fairy_ribbon: {
    grads: [
      { kind: 'lin', id: 'fr', x1: 15, y1: 15, x2: 125, y2: 125, stops: [['0%', '#fbcfe8'], ['50%', '#f472b6'], ['100%', '#7dd3fc']] },
    ],
    shapes: [
      { t: 'path', d: 'M36 32 C26 16, 25 6, 33 5 C41 8, 48 18, 52 26 Z', fill: '#fbcfe8', stroke: '#9d174d', sw: 1.4 },
      { t: 'path', d: 'M33 10 C38 13, 43 19, 46 25 L40 27 C36 21, 33 14, 33 10 Z', fill: '#38bdf8' },
      { t: 'path', d: 'M104 32 C114 16, 115 6, 107 5 C99 8, 92 18, 88 26 Z', fill: '#fbcfe8', stroke: '#9d174d', sw: 1.4 },
      { t: 'path', d: 'M107 10 C102 13, 97 19, 94 25 L100 27 C104 21, 107 14, 107 10 Z', fill: '#38bdf8' },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#831843', sw: 6.5 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@fr', sw: 4.2 },
      { t: 'path', d: 'M22 68 C8 76, 10 96, 23 108 C17 95, 18 83, 25 76 Z', fill: '#f9a8d4', stroke: '#9d174d', sw: 1.1 },
      { t: 'path', d: 'M118 68 C132 76, 130 96, 117 108 C123 95, 122 83, 115 76 Z', fill: '#7dd3fc', stroke: '#0369a1', sw: 1.1 },
      { t: 'path', d: 'M70 21 C61 12, 52 15, 55 24 C59 27, 65 25, 70 22 Z', fill: '#f472b6', stroke: '#831843', sw: 1.3 },
      { t: 'path', d: 'M70 21 C79 12, 88 15, 85 24 C81 27, 75 25, 70 22 Z', fill: '#f472b6', stroke: '#831843', sw: 1.3 },
      { t: 'circle', cx: 70, cy: 21.5, r: 3.6, fill: '#fff1f2', stroke: '#831843', sw: 1.2 },
    ],
  },
  gengar_grin: {
    grads: [
      { kind: 'lin', id: 'gg', x1: 20, y1: 12, x2: 120, y2: 128, stops: [['0%', '#8b5cf6'], ['55%', '#5b21b6'], ['100%', '#2e1065']] },
    ],
    shapes: [
      { t: 'path', d: 'M35 35 L20 10 L51 25 Z', fill: '@gg', stroke: '#1e0a3c', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M105 35 L120 10 L89 25 Z', fill: '@gg', stroke: '#1e0a3c', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M57 22 L62 12 L66 21 L70 9 L74 21 L78 12 L83 22 Z', fill: '#4c1d95', stroke: '#1e0a3c', sw: 1.4, slj: 'round' },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#1e0a3c', sw: 7 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@gg', sw: 4.4 },
      { t: 'path', d: 'M24 51 L31 55 L26 57 Z', fill: '#ef4444' },
      { t: 'path', d: 'M116 51 L109 55 L114 57 Z', fill: '#ef4444' },
      { t: 'path', d: 'M52 116 Q70 126 88 116 Q70 120 52 116 Z', fill: '#f8fafc', stroke: '#1e0a3c', sw: 1.4 },
      { t: 'polygon', points: '58,117 61,123 64,118', fill: '#ffffff', stroke: '#1e0a3c', sw: 1 },
      { t: 'polygon', points: '76,118 79,123 82,117', fill: '#ffffff', stroke: '#1e0a3c', sw: 1 },
    ],
  },
  snorlax_cozy: {
    grads: [
      { kind: 'lin', id: 'sn', x1: 20, y1: 15, x2: 120, y2: 125, stops: [['0%', '#2dd4bf'], ['45%', '#0f766e'], ['100%', '#134e4a']] },
    ],
    shapes: [
      { t: 'path', d: 'M32 37 C26 22, 31 12, 42 15 C49 17, 54 22, 56 26 Z', fill: '@sn', stroke: '#042f2e', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M108 37 C114 22, 109 12, 98 15 C91 17, 86 22, 84 26 Z', fill: '@sn', stroke: '#042f2e', sw: 1.6, slj: 'round' },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#042f2e', sw: 7 },
      { t: 'path', d: 'M21 70 A49 49 0 0 1 119 70', stroke: '@sn', sw: 4.5 },
      { t: 'path', d: 'M21 70 A49 49 0 0 0 119 70', stroke: '#fef3c7', sw: 4.5 },
      { t: 'ellipse', cx: 48, cy: 117, rx: 8, ry: 6, fill: '#fef3c7', stroke: '#042f2e', sw: 1.4 },
      { t: 'circle', cx: 48, cy: 118, r: 3, fill: '#b45309', fo: 0.55 },
      { t: 'ellipse', cx: 92, cy: 117, rx: 8, ry: 6, fill: '#fef3c7', stroke: '#042f2e', sw: 1.4 },
      { t: 'circle', cx: 92, cy: 118, r: 3, fill: '#b45309', fo: 0.55 },
      { t: 'circle', cx: 119, cy: 36, r: 5, fill: '#e0f2fe', stroke: '#0f766e', sw: 1.2 },
      { t: 'circle', cx: 127, cy: 24, r: 3.4, fill: '#e0f2fe', stroke: '#0f766e', sw: 1.1 },
      { t: 'path', d: 'M19 36 L20.5 40 L24.5 41.5 L20.5 43 L19 47 L17.5 43 L13.5 41.5 L17.5 40 Z', fill: '#fde047' },
    ],
  },
  dragon_crest: {
    grads: [
      { kind: 'lin', id: 'dr', x1: 15, y1: 15, x2: 125, y2: 125, stops: [['0%', '#34d399'], ['50%', '#059669'], ['100%', '#064e3b']] },
    ],
    shapes: [
      { t: 'path', d: 'M46 25 C34 15, 29 7, 36 4 C40 11, 49 16, 58 21 Z', fill: '#facc15', stroke: '#422006', sw: 1.4, slj: 'round' },
      { t: 'path', d: 'M94 25 C106 15, 111 7, 104 4 C100 11, 91 16, 82 21 Z', fill: '#facc15', stroke: '#422006', sw: 1.4, slj: 'round' },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#052e16', sw: 7.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@dr', sw: 4.4 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#facc15', sw: 1.5, sd: '6 9' },
      { t: 'path', d: 'M21 62 L7 52 L17 70 L8 84 L23 80 Z', fill: '#10b981', stroke: '#052e16', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M119 62 L133 52 L123 70 L132 84 L117 80 Z', fill: '#10b981', stroke: '#052e16', sw: 1.3, slj: 'round' },
      { t: 'circle', cx: 70, cy: 18, r: 6, fill: '#ef4444', stroke: '#facc15', sw: 2 },
      { t: 'circle', cx: 68.2, cy: 16.2, r: 1.8, fill: '#fecaca' },
    ],
  },
  frost_glacier: {
    grads: [
      { kind: 'lin', id: 'ic', x1: 15, y1: 15, x2: 125, y2: 125, stops: [['0%', '#f0f9ff'], ['45%', '#7dd3fc'], ['100%', '#0284c7']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#0c4a6e', sw: 6.6 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@ic', sw: 4.2 },
      { t: 'circle', cx: 70, cy: 70, r: 46, stroke: '#ffffff', sw: 1.2 },
      { t: 'line', x1: 30, y1: 19, x2: 30, y2: 45, stroke: '#e0f2fe', sw: 2, slc: 'round' },
      { t: 'line', x1: 18.8, y1: 25.5, x2: 41.2, y2: 38.5, stroke: '#e0f2fe', sw: 2, slc: 'round' },
      { t: 'line', x1: 18.8, y1: 38.5, x2: 41.2, y2: 25.5, stroke: '#e0f2fe', sw: 2, slc: 'round' },
      { t: 'circle', cx: 30, cy: 32, r: 3.2, fill: '#38bdf8', stroke: '#0369a1', sw: 1.2 },
      { t: 'line', x1: 109, y1: 96, x2: 109, y2: 118, stroke: '#ffffff', sw: 1.8, slc: 'round' },
      { t: 'line', x1: 99.5, y1: 101.5, x2: 118.5, y2: 112.5, stroke: '#ffffff', sw: 1.8, slc: 'round' },
      { t: 'line', x1: 99.5, y1: 112.5, x2: 118.5, y2: 101.5, stroke: '#ffffff', sw: 1.8, slc: 'round' },
      { t: 'circle', cx: 109, cy: 107, r: 2.8, fill: '#7dd3fc', stroke: '#0369a1', sw: 1.1 },
      { t: 'polygon', points: '117,36 125,46 115,49', fill: '#bae6fd', stroke: '#0369a1', sw: 1 },
      { t: 'polygon', points: '24,104 16,112 27,114', fill: '#e0f2fe', stroke: '#0369a1', sw: 1 },
      { t: 'circle', cx: 70, cy: 19, r: 3, fill: '#ffffff' },
      { t: 'circle', cx: 70, cy: 121, r: 2.6, fill: '#bae6fd' },
    ],
  },
  steel_gear: {
    grads: [
      { kind: 'lin', id: 'st', x1: 15, y1: 15, x2: 125, y2: 125, stops: [['0%', '#f1f5f9'], ['45%', '#94a3b8'], ['100%', '#475569']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#1e293b', sw: 7.4 },
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@st', sw: 4.6 },
      { t: 'circle', cx: 70, cy: 70, r: 45.8, stroke: '#cbd5e1', sw: 1 },
      { t: 'circle', cx: 70, cy: 21, r: 2, fill: '#38bdf8' },
      { t: 'circle', cx: 70, cy: 119, r: 2, fill: '#38bdf8' },
      { t: 'circle', cx: 21, cy: 70, r: 2, fill: '#e2e8f0' },
      { t: 'circle', cx: 119, cy: 70, r: 2, fill: '#e2e8f0' },
      { t: 'circle', cx: 29, cy: 32, r: 10, fill: '@st', stroke: '#1e293b', sw: 1.5 },
      { t: 'rect', x: 26.8, y: 19, w: 4.4, h: 26, rx: 1, fill: '#94a3b8', stroke: '#1e293b', sw: 1 },
      { t: 'rect', x: 16, y: 29.8, w: 26, h: 4.4, rx: 1, fill: '#94a3b8', stroke: '#1e293b', sw: 1 },
      { t: 'circle', cx: 29, cy: 32, r: 8.5, fill: '@st' },
      { t: 'circle', cx: 29, cy: 32, r: 4, fill: '#0ea5e9', stroke: '#1e293b', sw: 1.3 },
      { t: 'rect', x: -2, y: -11.5, w: 4, h: 23, rx: 1, fill: '#f59e0b', stroke: '#451a03', sw: 1, tf: 'translate(110 108) rotate(22)' },
      { t: 'rect', x: -11.5, y: -2, w: 23, h: 4, rx: 1, fill: '#f59e0b', stroke: '#451a03', sw: 1, tf: 'translate(110 108) rotate(22)' },
      { t: 'circle', cx: 110, cy: 108, r: 7.5, fill: '#fbbf24', stroke: '#451a03', sw: 1.3 },
      { t: 'circle', cx: 110, cy: 108, r: 3, fill: '#1e293b' },
    ],
  },
  sakura_spring: {
    grads: [
      { kind: 'lin', id: 'sk', x1: 20, y1: 20, x2: 120, y2: 120, stops: [['0%', '#83324a'], ['100%', '#4a1929']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '@sk', sw: 4.6 },
      { t: 'path', d: 'M22 65 C22 46, 31 32, 46 24', stroke: '#f9a8d4', sw: 1.6, slc: 'round' },
      { t: 'path', d: 'M118 74 C118 93, 109 107, 94 115', stroke: '#f9a8d4', sw: 1.6, slc: 'round' },
      { t: 'circle', cx: 0, cy: -7.5, r: 5.4, fill: '#fbcfe8', stroke: '#be185d', sw: 1, tf: 'translate(30 101)' },
      { t: 'circle', cx: 7.1, cy: -2.3, r: 5.4, fill: '#fbcfe8', stroke: '#be185d', sw: 1, tf: 'translate(30 101)' },
      { t: 'circle', cx: 4.4, cy: 6.1, r: 5.4, fill: '#fbcfe8', stroke: '#be185d', sw: 1, tf: 'translate(30 101)' },
      { t: 'circle', cx: -4.4, cy: 6.1, r: 5.4, fill: '#fbcfe8', stroke: '#be185d', sw: 1, tf: 'translate(30 101)' },
      { t: 'circle', cx: -7.1, cy: -2.3, r: 5.4, fill: '#fbcfe8', stroke: '#be185d', sw: 1, tf: 'translate(30 101)' },
      { t: 'circle', cx: 30, cy: 101, r: 3.4, fill: '#f43f5e' },
      { t: 'circle', cx: 30, cy: 101, r: 1.4, fill: '#fef08a' },
      { t: 'circle', cx: 0, cy: -7.5, r: 5.4, fill: '#fce7f3', stroke: '#be185d', sw: 1.1, tf: 'translate(110 38) scale(0.88)' },
      { t: 'circle', cx: 7.1, cy: -2.3, r: 5.4, fill: '#fce7f3', stroke: '#be185d', sw: 1.1, tf: 'translate(110 38) scale(0.88)' },
      { t: 'circle', cx: 4.4, cy: 6.1, r: 5.4, fill: '#fce7f3', stroke: '#be185d', sw: 1.1, tf: 'translate(110 38) scale(0.88)' },
      { t: 'circle', cx: -4.4, cy: 6.1, r: 5.4, fill: '#fce7f3', stroke: '#be185d', sw: 1.1, tf: 'translate(110 38) scale(0.88)' },
      { t: 'circle', cx: -7.1, cy: -2.3, r: 5.4, fill: '#fce7f3', stroke: '#be185d', sw: 1.1, tf: 'translate(110 38) scale(0.88)' },
      { t: 'circle', cx: 110, cy: 38, r: 2.8, fill: '#f43f5e' },
      { t: 'circle', cx: 110, cy: 38, r: 1.15, fill: '#fef08a' },
      { t: 'circle', cx: 0, cy: -7.5, r: 5.4, fill: '#f9a8d4', stroke: '#9d174d', sw: 1.3, tf: 'translate(116 56) scale(0.55)' },
      { t: 'circle', cx: 7.1, cy: -2.3, r: 5.4, fill: '#f9a8d4', stroke: '#9d174d', sw: 1.3, tf: 'translate(116 56) scale(0.55)' },
      { t: 'circle', cx: 4.4, cy: 6.1, r: 5.4, fill: '#f9a8d4', stroke: '#9d174d', sw: 1.3, tf: 'translate(116 56) scale(0.55)' },
      { t: 'circle', cx: -4.4, cy: 6.1, r: 5.4, fill: '#f9a8d4', stroke: '#9d174d', sw: 1.3, tf: 'translate(116 56) scale(0.55)' },
      { t: 'circle', cx: -7.1, cy: -2.3, r: 5.4, fill: '#f9a8d4', stroke: '#9d174d', sw: 1.3, tf: 'translate(116 56) scale(0.55)' },
      { t: 'circle', cx: 116, cy: 56, r: 1.65, fill: '#fde047' },
      { t: 'path', d: 'M96 17 C101 13, 108 15, 107 21 C102 22, 98 20, 96 17 Z', fill: '#fbcfe8', stroke: '#be185d', sw: 0.9 },
      { t: 'path', d: 'M18 78 C12 75, 11 69, 17 67 C20 71, 20 75, 18 78 Z', fill: '#f9a8d4', stroke: '#be185d', sw: 0.9 },
      { t: 'path', d: 'M52 121 C57 118, 63 121, 61 126 C56 127, 53 124, 52 121 Z', fill: '#fbcfe8', stroke: '#be185d', sw: 0.9 },
    ],
  },
  moon_eclipse: {
    grads: [
      { kind: 'lin', id: 'su', x1: 20, y1: 20, x2: 70, y2: 120, stops: [['0%', '#fef08a'], ['50%', '#f59e0b'], ['100%', '#ea580c']] },
      { kind: 'lin', id: 'mo', x1: 70, y1: 20, x2: 120, y2: 120, stops: [['0%', '#e0f2fe'], ['55%', '#60a5fa'], ['100%', '#4338ca']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49, stroke: '#1e1b4b', sw: 7 },
      { t: 'path', d: 'M70 21 A49 49 0 0 0 70 119', stroke: '@su', sw: 4.4 },
      { t: 'path', d: 'M70 21 A49 49 0 0 1 70 119', stroke: '@mo', sw: 4.4 },
      { t: 'polygon', points: '0,-14 2.5,-7 9.5,-9.5 7,-2.5 14,0 7,2.5 9.5,9.5 2.5,7 0,14 -2.5,7 -9.5,9.5 -7,2.5 -14,0 -7,-2.5 -9.5,-9.5 -2.5,-7', fill: '#facc15', stroke: '#78350f', sw: 1, tf: 'translate(31 31)' },
      { t: 'circle', cx: 31, cy: 31, r: 6, fill: '#fef9c3', stroke: '#b45309', sw: 1.2 },
      { t: 'path', d: 'M107 95 A12.5 12.5 0 1 1 95 113 A9.5 9.5 0 1 0 107 95 Z', fill: '#e0f2fe', stroke: '#1e3a8a', sw: 1.3 },
      { t: 'path', d: 'M121 44 L122.6 48.4 L127 50 L122.6 51.6 L121 56 L119.4 51.6 L115 50 L119.4 48.4 Z', fill: '#bae6fd' },
      { t: 'circle', cx: 116, cy: 72, r: 2.2, fill: '#fef08a' },
    ],
  },
};

export function clampAvatarFrame(raw: unknown): AvatarFrameId | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return AVATAR_FRAME_MAP.has(id) ? (id as AvatarFrameId) : null;
}

export function getAvatarFrameSpec(raw: unknown): AvatarFrameSpec | null {
  const id = clampAvatarFrame(raw);
  return id ? (AVATAR_FRAME_MAP.get(id) ?? null) : null;
}

export function getAvatarFrameArt(raw: unknown): AvatarFrameArt | null {
  const id = clampAvatarFrame(raw);
  return id ? (AVATAR_FRAME_ART[id] ?? null) : null;
}

export function resolveFramePaint(paint: string | undefined, prefix: string): string | undefined {
  if (!paint) return undefined;
  return paint.startsWith('@') ? `url(#${prefix}${paint.slice(1)})` : paint;
}

const frameSvgDataUrlCache = new Map<AvatarFrameId, string>();

/** 將指定頭像外框幾何序列化為獨立 SVG（供 Canvas PNG 匯出使用，零外部請求）。 */
export function buildAvatarFrameSvgMarkup(id: AvatarFrameId, prefix = 'f_'): string {
  const art = AVATAR_FRAME_ART[id];
  if (!art) return '';
  const defs = art.grads.map((g) => {
    const stops = g.stops.map(([off, col]) => `<stop offset="${off}" stop-color="${col}"/>`).join('');
    if (g.kind === 'lin') {
      return `<linearGradient id="${prefix}${g.id}" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`;
    }
    return `<radialGradient id="${prefix}${g.id}" cx="${g.cx}" cy="${g.cy}" r="${g.r}">${stops}</radialGradient>`;
  }).join('');
  const els = art.shapes.map((s) => {
    const attrs: string[] = [];
    if (s.t === 'circle') {
      attrs.push(`cx="${s.cx}"`, `cy="${s.cy}"`, `r="${s.r}"`);
    } else if (s.t === 'path') {
      attrs.push(`d="${s.d}"`);
    } else if (s.t === 'polygon') {
      attrs.push(`points="${s.points}"`);
    } else if (s.t === 'rect') {
      attrs.push(`x="${s.x}"`, `y="${s.y}"`, `width="${s.w}"`, `height="${s.h}"`);
      if (s.rx !== undefined) attrs.push(`rx="${s.rx}"`);
    } else if (s.t === 'ellipse') {
      attrs.push(`cx="${s.cx}"`, `cy="${s.cy}"`, `rx="${s.rx}"`, `ry="${s.ry}"`);
    } else if (s.t === 'line') {
      attrs.push(`x1="${s.x1}"`, `y1="${s.y1}"`, `x2="${s.x2}"`, `y2="${s.y2}"`);
    }
    if (s.fill) attrs.push(`fill="${resolveFramePaint(s.fill, prefix)}"`);
    if (s.fo !== undefined) attrs.push(`fill-opacity="${s.fo}"`);
    if (s.stroke) attrs.push(`stroke="${resolveFramePaint(s.stroke, prefix)}"`);
    if (s.sw !== undefined) attrs.push(`stroke-width="${s.sw}"`);
    if (s.so !== undefined) attrs.push(`stroke-opacity="${s.so}"`);
    if (s.slj) attrs.push(`stroke-linejoin="${s.slj}"`);
    if (s.slc) attrs.push(`stroke-linecap="${s.slc}"`);
    if (s.sd) attrs.push(`stroke-dasharray="${s.sd}"`);
    if (s.tf) attrs.push(`transform="${s.tf}"`);
    return `<${s.t} ${attrs.join(' ')}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140" width="280" height="280" fill="none"><defs>${defs}</defs>${els}</svg>`;
}

export function buildAvatarFrameSvgDataUrl(raw: unknown): string | null {
  const id = clampAvatarFrame(raw);
  if (!id) return null;
  const cached = frameSvgDataUrlCache.get(id);
  if (cached) return cached;
  const svg = buildAvatarFrameSvgMarkup(id, `c_${id}_`);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  frameSvgDataUrlCache.set(id, url);
  return url;
}

export interface AvatarCrop {
  cardId: string;
  x: number;
  y: number;
  zoom: number;
}

export interface ProfileHonor {
  eventId: string;
  eventName: string;
  date: number;
  kind: 'site' | 'comm';
  placementLabel: string;
}

export interface PlayerProfileSelf {
  profileKey: string;
  nick: string;
  defaultNick: string;
  bio: string;
  avatar: AvatarCrop | null;
  googleVerified: boolean;
  champOfficial: number;
  champCommunity: number;
  totalWins?: number;
  casualOnlineWins?: number;
  tournamentWins?: number;
  showTotalWins?: boolean;
  showOfficialCrowns?: boolean;
  showCommunityCrowns?: boolean;
  avatarFrame?: AvatarFrameId | null;
  pinnedHonorIds: string[];
  availableHonors: ProfileHonor[];
}

export type FriendRelationStatus =
  | 'self'
  | 'accepted'
  | 'pending_out'
  | 'pending_in'
  | 'blocked_by_me'
  | 'none'
  | 'unavailable';

export interface PlayerProfilePublic {
  found: boolean;
  profileKey: string;
  nick: string;
  bio: string;
  avatar: AvatarCrop | null;
  googleVerified: boolean;
  champOfficial: number;
  champCommunity: number;
  totalWins?: number;
  showTotalWins?: boolean;
  showOfficialCrowns?: boolean;
  showCommunityCrowns?: boolean;
  avatarFrame?: AvatarFrameId | null;
  pinnedHonors: ProfileHonor[];
  canFriend: boolean;
  friendStatus: FriendRelationStatus;
}

export interface ProfileLiteSummary {
  profileKey: string;
  nick: string;
  avatar: AvatarCrop | null;
  avatarFrame?: AvatarFrameId | null;
  googleVerified: boolean;
}

export type ProfileLookupTarget = {
  k?: string;
  profileKey?: string;
  fid?: string;
  roomCode?: string;
  seatIdx?: number;
  tournRoom?: string;
  targetUid?: string;
  eventId?: string;
  round?: number;
  idx?: number;
  side?: 'p1' | 'p2';
  hofChamp?: boolean | '1';
  standingName?: string;
  postId?: string;
  lbNick?: string;
  fallbackNick?: string;
};

export interface ProfileAuthCtx {
  uid: string;
  token: string | null;
}

function apiBase(): string {
  const b = ((((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || '').trim();
  return b.replace(/\/$/, '');
}

export function profileApiAvailable(): boolean {
  return !!apiBase();
}

export function clampAvatarCrop(raw: Partial<AvatarCrop> | null | undefined): AvatarCrop | null {
  if (!raw || typeof raw !== 'object') return null;
  const cardId = String(raw.cardId ?? '').trim();
  if (!cardId) return null;
  const zRaw = Number(raw.zoom);
  const zoom = Math.round(Math.min(3.5, Math.max(1, Number.isFinite(zRaw) ? zRaw : PROF_DEFAULT_CROP.zoom)) * 1000) / 1000;
  const minX = 0.5 / zoom;
  const maxX = 1 - minX;
  const minY = 0.5 / (zoom * PROF_CARD_HW);
  const maxY = 1 - minY;
  const xRaw = Number(raw.x);
  const yRaw = Number(raw.y);
  const x = Math.round(Math.min(maxX, Math.max(minX, Number.isFinite(xRaw) ? xRaw : PROF_DEFAULT_CROP.x)) * 10000) / 10000;
  const y = Math.round(Math.min(maxY, Math.max(minY, Number.isFinite(yRaw) ? yRaw : PROF_DEFAULT_CROP.y)) * 10000) / 10000;
  return { cardId, x, y, zoom };
}

export function clampProfileNick(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return Array.from(raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, PROF_NICK_MAX).join('');
}

export function clampProfileBio(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return Array.from(raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim()).slice(0, PROF_BIO_MAX).join('');
}

/** 依官方卡號解析圖片 URL（固定 `https://asia.pokemon-card.com/tw/card-img/tw{id}.png`）。 */
export function cardImageUrlFromId(cardId: string | null | undefined): string | null {
  const cid = String(cardId ?? '').trim();
  if (!cid) return null;
  if (/^\d+$/.test(cid)) return `https://asia.pokemon-card.com/tw/card-img/tw${cid.padStart(8, '0')}.png`;
  return null;
}

export function formatHonorDate(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export function buildSelfProfilePreview(
  p: PlayerProfileSelf,
  override?: {
    nick?: string;
    bio?: string;
    avatar?: AvatarCrop | null;
    pinnedHonorIds?: string[];
    showTotalWins?: boolean;
    showOfficialCrowns?: boolean;
    showCommunityCrowns?: boolean;
  },
): PlayerProfilePublic {
  const avail = p.availableHonors || [];
  const honorMap = new Map(avail.map((h) => [h.eventId, h]));
  const ids = override?.pinnedHonorIds ?? p.pinnedHonorIds ?? [];
  const pinned = ids
    .map((id) => honorMap.get(id))
    .filter((h): h is ProfileHonor => !!h)
    .slice(0, PROF_MAX_HONORS);
  const rawNick = override?.nick ?? p.nick ?? p.defaultNick ?? '玩家';
  const showTotalWins = override?.showTotalWins ?? (p.showTotalWins !== false);
  const showOfficialCrowns = override?.showOfficialCrowns ?? (p.showOfficialCrowns !== false);
  const showCommunityCrowns = override?.showCommunityCrowns ?? (p.showCommunityCrowns !== false);
  return {
    found: true,
    profileKey: p.profileKey || '',
    nick: clampProfileNick(rawNick) || clampProfileNick(p.defaultNick) || '玩家',
    bio: override?.bio !== undefined ? clampProfileBio(override.bio) : clampProfileBio(p.bio),
    avatar: override?.avatar !== undefined ? clampAvatarCrop(override.avatar) : clampAvatarCrop(p.avatar),
    googleVerified: !!p.googleVerified,
    champOfficial: showOfficialCrowns ? (p.champOfficial ?? 0) : 0,
    champCommunity: showCommunityCrowns ? (p.champCommunity ?? 0) : 0,
    totalWins: showTotalWins ? Math.max(0, Number(p.totalWins) || 0) : 0,
    showTotalWins,
    showOfficialCrowns,
    showCommunityCrowns,
    avatarFrame: clampAvatarFrame(p.avatarFrame),
    pinnedHonors: pinned,
    canFriend: false,
    friendStatus: 'self',
  };
}

async function reqJson<T>(
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; ctx?: ProfileAuthCtx | null } = {},
): Promise<{ ok: true; data: T } | { ok: false; message: string; status: number }> {
  const base = apiBase();
  if (!base) return { ok: false, message: '目前環境未連線至線上伺服器', status: 0 };
  const headers: Record<string, string> = {};
  if (opts.ctx?.token) headers.Authorization = `Bearer ${opts.ctx.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(`${base}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) {
      return { ok: false, message: '伺服器尚未支援個人名片功能', status: r.status };
    }
    const j = await r.json();
    if (!r.ok) {
      return { ok: false, message: String(j?.error || `請求失敗 (${r.status})`), status: r.status };
    }
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, message: '網路連線異常，請稍後再試', status: 0 };
  }
}

export async function fetchMyProfile(ctx: ProfileAuthCtx, refresh = false) {
  const res = await reqJson<{ playerProfileApi: number; profile: PlayerProfileSelf }>(
    `/api/player-profile/me${refresh ? '?refresh=1' : ''}`,
    { ctx },
  );
  if (!res.ok) return res;
  const p = res.data.profile;
  return {
    ok: true as const,
    data: {
      ...p,
      avatar: clampAvatarCrop(p.avatar),
      avatarFrame: clampAvatarFrame(p.avatarFrame),
      showTotalWins: p.showTotalWins !== false,
      showOfficialCrowns: p.showOfficialCrowns !== false,
      showCommunityCrowns: p.showCommunityCrowns !== false,
    },
  };
}

export async function saveMyProfile(
  ctx: ProfileAuthCtx,
  payload: {
    nick: string;
    bio: string;
    avatar: AvatarCrop | null;
    pinnedHonorIds: string[];
    showTotalWins?: boolean;
    showOfficialCrowns?: boolean;
    showCommunityCrowns?: boolean;
  },
) {
  const clean: Record<string, unknown> = {
    nick: clampProfileNick(payload.nick),
    bio: clampProfileBio(payload.bio),
    avatar: clampAvatarCrop(payload.avatar),
    pinnedHonorIds: [...new Set((payload.pinnedHonorIds || []).map(String).filter(Boolean))].slice(0, PROF_MAX_HONORS),
  };
  if (payload.showTotalWins !== undefined) clean.showTotalWins = !!payload.showTotalWins;
  if (payload.showOfficialCrowns !== undefined) clean.showOfficialCrowns = !!payload.showOfficialCrowns;
  if (payload.showCommunityCrowns !== undefined) clean.showCommunityCrowns = !!payload.showCommunityCrowns;
  const res = await reqJson<{ playerProfileApi: number; ok: boolean; profile: PlayerProfileSelf & { pinnedHonors?: ProfileHonor[] } }>(
    '/api/player-profile/save',
    { method: 'POST', body: clean, ctx },
  );
  if (!res.ok) return res;
  const p = res.data.profile;
  return {
    ok: true as const,
    data: {
      ...p,
      avatar: clampAvatarCrop(p.avatar),
      avatarFrame: clampAvatarFrame(p.avatarFrame),
      showTotalWins: p.showTotalWins !== false,
      showOfficialCrowns: p.showOfficialCrowns !== false,
      showCommunityCrowns: p.showCommunityCrowns !== false,
    },
  };
}

export async function fetchPlayerProfileView(
  target: ProfileLookupTarget,
  ctx?: ProfileAuthCtx | null,
) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(target)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, v === true ? '1' : String(v));
  }
  const res = await reqJson<{ playerProfileApi: number } & PlayerProfilePublic>(
    `/api/player-profile/view?${qs.toString()}`,
    { ctx: ctx ?? null },
  );
  if (!res.ok) return res;
  return {
    ok: true as const,
    data: {
      ...res.data,
      avatar: clampAvatarCrop(res.data.avatar),
      avatarFrame: clampAvatarFrame(res.data.avatarFrame),
    } as PlayerProfilePublic,
  };
}

export async function fetchProfileBatch(
  items: ProfileLookupTarget[],
  ctx?: ProfileAuthCtx | null,
) {
  if (!items.length || !apiBase()) {
    return { ok: true as const, data: {} as Record<string, ProfileLiteSummary> };
  }
  const res = await reqJson<{ playerProfileApi: number; profiles: Record<string, ProfileLiteSummary> }>(
    '/api/player-profile/batch',
    { method: 'POST', body: { items: items.slice(0, 40) }, ctx: ctx ?? null },
  );
  if (!res.ok) return { ok: false as const, message: res.message, status: res.status };
  const out: Record<string, ProfileLiteSummary> = {};
  for (const [k, v] of Object.entries(res.data.profiles || {})) {
    out[k] = {
      ...v,
      avatar: clampAvatarCrop(v.avatar),
      avatarFrame: clampAvatarFrame(v.avatarFrame),
    };
  }
  return { ok: true as const, data: out };
}

export async function sendFriendRequestFromProfile(
  ctx: ProfileAuthCtx,
  target: ProfileLookupTarget,
  via = 'profile',
) {
  return reqJson<{ ok: boolean; status: 'pending' | 'accepted'; already?: boolean; fid?: string }>(
    '/api/player-profile/friend-request',
    { method: 'POST', body: { target, via }, ctx },
  );
}

/** 組合玩家名片分享網址（/game?card=<profileKey>，零 email）。 */
export function buildProfileShareUrl(profileKey: string, origin?: string, basePath?: string): string {
  const pk = String(profileKey || '').trim();
  if (!pk) return '';
  let org = typeof origin === 'string' ? origin.trim() : '';
  if (!org && typeof window !== 'undefined' && window.location?.origin) {
    org = window.location.origin;
  }
  org = org.replace(/\/$/, '');
  let bp = typeof basePath === 'string' ? basePath : '';
  if (basePath === undefined && typeof window !== 'undefined' && window.location?.pathname) {
    bp = window.location.pathname
      .replace(/\/(?:game|friends|deck-posts|decks|cards|card|tournament|privacy)(?:\/.*)?$/, '')
      .replace(/\/$/, '');
  }
  bp = bp ? (bp.startsWith('/') ? bp.replace(/\/$/, '') : `/${bp.replace(/\/$/, '')}`) : '';
  return `${org}${bp}/game?card=${encodeURIComponent(pk)}`;
}

function drawRoundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function wrapCanvasLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of String(text || '').split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const ch of Array.from(para)) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxW) {
        out.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function fitCanvasEllipsis(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  const s = String(text || '');
  if (ctx.measureText(s).width <= maxW) return s;
  const chars = Array.from(s);
  while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxW) {
    chars.pop();
  }
  return chars.join('') + '…';
}

function corsCardCandidates(cardId: string): string[] {
  const raw = cardImageUrlFromId(cardId);
  if (!raw) return [];
  const m = /^https:\/\/asia\.pokemon-card\.com\/(tw|hk)\/card-img\/((?:tw|hk)\d+)\.png$/.exec(raw);
  const out: string[] = [];
  if (m) out.push(`https://suenz001.github.io/ptcg-tw-sim-img/w450/${m[2]}.webp`);
  out.push(`https://images.weserv.nl/?url=${encodeURIComponent(raw.replace(/^https?:\/\//, ''))}`);
  return out;
}

const failedProfileImageUntil = new Map<string, number>();

export function profileNameInitial(name: string): string {
  return (Array.from(String(name || '玩').trim())[0] || '玩').toUpperCase();
}

function defaultLoadCorsImage(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  const isDataUrl = url.startsWith('data:');
  if (!isDataUrl) {
    if ((failedProfileImageUntil.get(url) ?? 0) > Date.now()) return Promise.resolve(null);
    failedProfileImageUntil.delete(url);
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      if (!v && !isDataUrl) {
        if (failedProfileImageUntil.size >= 64) {
          const oldest = failedProfileImageUntil.keys().next().value;
          if (oldest) failedProfileImageUntil.delete(oldest);
        }
        failedProfileImageUntil.set(url, Date.now() + 60_000);
      }
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 6000);
    const img = new Image();
    if (!isDataUrl) img.crossOrigin = 'anonymous';
    img.onload = () => { clearTimeout(timer); done(img); };
    img.onerror = () => { clearTimeout(timer); done(null); };
    img.src = url;
  });
}

async function resolveAvatarCanvasImg(
  cardId: string,
  loader: (url: string) => Promise<HTMLImageElement | null>,
): Promise<HTMLImageElement | null> {
  for (const url of corsCardCandidates(cardId)) {
    const img = await loader(url).catch(() => null);
    if (img) return img;
  }
  return null;
}

/** 將玩家名片繪製成 2× 高解析度 Canvas，供 PNG 下載使用。 */
export async function renderProfileCardToCanvas(
  card: PlayerProfilePublic,
  opts?: { loadImage?: (url: string) => Promise<HTMLImageElement | null> },
): Promise<HTMLCanvasElement> {
  if (typeof document === 'undefined') {
    throw new Error('瀏覽器畫布環境未就緒');
  }
  const W = 780;
  const PAD_X = 32;
  const BANNER_H = 96;
  const AV_R = 72;
  const frameSpec = getAvatarFrameSpec(card.avatarFrame);
  const AV_CX = PAD_X + AV_R + (frameSpec ? 18 : 0);
  const AV_CY = BANNER_H + (frameSpec ? 22 : 16);
  const FONT = 'system-ui,-apple-system,"Noto Sans TC","Microsoft JhengHei",sans-serif';

  const probe = document.createElement('canvas');
  probe.width = W;
  probe.height = 100;
  const pCtx = probe.getContext('2d');
  if (!pCtx) throw new Error('Canvas 2D 不支援');

  pCtx.font = `26px ${FONT}`;
  const bioLines = card.bio ? wrapCanvasLines(pCtx, card.bio, W - PAD_X * 2 - 44) : [];
  const bioBoxH = bioLines.length > 0 ? (34 + bioLines.length * 36) : (!card.found ? 72 : 0);
  const honors = (card.pinnedHonors || []).slice(0, PROF_MAX_HONORS);
  const honorsH = honors.length > 0 ? (64 + honors.length * 42) : 0;

  const headBottom = frameSpec
    ? Math.max(AV_CY + AV_R + 36, BANNER_H + 114)
    : Math.max(AV_CY + AV_R + 12, BANNER_H + 114);
  const bodyGapTop = bioBoxH > 0 ? 20 : 0;
  const honorsGapTop = honorsH > 0 ? 22 : 0;
  const H = Math.max(360, headBottom + bodyGapTop + bioBoxH + honorsGapTop + honorsH + 66);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 建立失敗');

  // 底卡背景＋邊框
  drawRoundedRectPath(ctx, 0, 0, W, H, 32);
  ctx.fillStyle = '#132219';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#3c6548';
  ctx.stroke();

  // 頂部橫幅
  ctx.save();
  drawRoundedRectPath(ctx, 0, 0, W, H, 32);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, W, BANNER_H);
  bg.addColorStop(0, '#214530');
  bg.addColorStop(0.65, '#163022');
  bg.addColorStop(1, '#1d3c2b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, BANNER_H);
  ctx.fillStyle = 'rgba(120, 196, 138, 0.22)';
  ctx.fillRect(0, BANNER_H - 1, W, 2);

  // 右上角徽章（先總勝場，再網站賽／社群賽奪冠）
  const pills: Array<{ text: string; bg: string; border: string; fg: string }> = [];
  if (card.showTotalWins !== false && (card.totalWins ?? 0) > 0) {
    pills.push({ text: `⚔️ ${card.totalWins}勝`, bg: 'rgba(11, 20, 15, 0.68)', border: 'rgba(130, 224, 166, 0.48)', fg: '#b8f5cb' });
  }
  if (card.showOfficialCrowns !== false && card.champOfficial > 0) {
    pills.push({ text: `網站 ${card.champOfficial}冠`, bg: 'rgba(11, 20, 15, 0.68)', border: 'rgba(255, 211, 90, 0.45)', fg: '#ffe28a' });
  }
  if (card.showCommunityCrowns !== false && card.champCommunity > 0) {
    pills.push({ text: `社群 ${card.champCommunity}冠`, bg: 'rgba(11, 20, 15, 0.68)', border: 'rgba(143, 220, 192, 0.45)', fg: '#9ae8cb' });
  }
  ctx.font = `bold 21px ${FONT}`;
  ctx.textBaseline = 'middle';
  let px = W - 26;
  const maxBadgeLeft = AV_CX + AV_R + (frameSpec ? 36 : 18);
  for (let i = pills.length - 1; i >= 0; i--) {
    const p = pills[i];
    const tw = ctx.measureText(p.text).width;
    const pw = tw + 26;
    const ph = 38;
    const py = (BANNER_H - ph) / 2;
    if (px - pw < maxBadgeLeft) break;
    px -= pw;
    drawRoundedRectPath(ctx, px, py, pw, ph, 19);
    ctx.fillStyle = p.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.border;
    ctx.stroke();
    ctx.fillStyle = p.fg;
    ctx.textAlign = 'center';
    ctx.fillText(p.text, px + pw / 2, py + ph / 2 + 1);
    px -= 10;
  }

  // 圓形頭像（與 AvatarCircle 一致幾何 + 可選立體 SVG 裝飾外框；不畫外框名稱與角落小圖示）
  const imgLoader = opts?.loadImage ?? defaultLoadCorsImage;
  const crop = clampAvatarCrop(card.avatar);
  const frameUrl = frameSpec ? buildAvatarFrameSvgDataUrl(frameSpec.id) : null;
  const [avImg, frameImg] = await Promise.all([
    crop ? resolveAvatarCanvasImg(crop.cardId, imgLoader) : Promise.resolve(null),
    frameUrl ? imgLoader(frameUrl).catch(() => null) : Promise.resolve(null),
  ]);

  if (!frameSpec) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(AV_CX, AV_CY, AV_R + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#0f2419';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(106, 184, 122, 0.55)';
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(AV_CX, AV_CY, AV_R, 0, Math.PI * 2);
  ctx.clip();
  const avBg = ctx.createLinearGradient(AV_CX - AV_R, AV_CY - AV_R, AV_CX + AV_R, AV_CY + AV_R);
  avBg.addColorStop(0, '#274837');
  avBg.addColorStop(1, '#162b21');
  ctx.fillStyle = avBg;
  ctx.fillRect(AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
  if (crop && avImg) {
    const imgW = AV_R * 2 * crop.zoom;
    const imgH = imgW * PROF_CARD_HW;
    ctx.drawImage(avImg, AV_CX - crop.x * imgW, AV_CY - crop.y * imgH, imgW, imgH);
  } else {
    const initial = profileNameInitial(card.nick);
    ctx.fillStyle = '#e6f5ea';
    ctx.font = `bold 62px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, AV_CX, AV_CY + 2);
  }
  ctx.restore();

  if (frameSpec) {
    ctx.save();
    if (frameImg) {
      const frameSize = (AV_R * 2 * 140) / 92;
      const frameHalf = frameSize / 2;
      ctx.drawImage(frameImg, AV_CX - frameHalf, AV_CY - frameHalf, frameSize, frameSize);
    } else {
      ctx.shadowColor = frameSpec.glow;
      ctx.shadowBlur = 14;
      const fg = ctx.createLinearGradient(AV_CX - AV_R, AV_CY - AV_R, AV_CX + AV_R, AV_CY + AV_R);
      fg.addColorStop(0, frameSpec.stops[0]);
      fg.addColorStop(0.35, frameSpec.stops[1]);
      fg.addColorStop(0.7, frameSpec.stops[2]);
      fg.addColorStop(1, frameSpec.stops[3]);
      ctx.beginPath();
      ctx.arc(AV_CX, AV_CY, AV_R + 4, 0, Math.PI * 2);
      ctx.lineWidth = 7;
      ctx.strokeStyle = fg;
      ctx.stroke();
    }
    ctx.restore();
  }

  // 暱稱與認證標籤（純粹展示外框，不加外框名稱標籤）
  const idX = AV_CX + AV_R + (frameSpec ? 40 : 24);
  ctx.fillStyle = '#eef7f0';
  ctx.font = `bold 34px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(fitCanvasEllipsis(ctx, card.nick || '玩家', W - PAD_X - idX), idX, BANNER_H + 16);

  const badgeX = idX;
  const badgeY = BANNER_H + 64;
  if (card.googleVerified) {
    const gTxt = '✓ Google 已認證';
    ctx.font = `bold 20px ${FONT}`;
    const gw = ctx.measureText(gTxt).width + 26;
    drawRoundedRectPath(ctx, badgeX, badgeY, gw, 34, 17);
    ctx.fillStyle = 'rgba(66, 133, 244, 0.2)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(114, 171, 255, 0.45)';
    ctx.stroke();
    ctx.fillStyle = '#b7d7ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(gTxt, badgeX + gw / 2, badgeY + 18);
  }

  let curY = headBottom;
  if (bioBoxH > 0) {
    curY += bodyGapTop;
    drawRoundedRectPath(ctx, PAD_X, curY, W - PAD_X * 2, bioBoxH, 20);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(120, 196, 138, 0.16)';
    ctx.stroke();
    ctx.font = `26px ${FONT}`;
    ctx.fillStyle = bioLines.length > 0 ? '#eef7f0' : '#96b09f';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const linesToDraw = bioLines.length > 0 ? bioLines : ['這位玩家尚未設定個人名片或尚未綁定帳號紀錄。'];
    linesToDraw.forEach((ln, idx) => {
      ctx.fillText(ln, PAD_X + 22, curY + 18 + idx * 36);
    });
    curY += bioBoxH;
  }

  if (honorsH > 0) {
    curY += honorsGapTop;
    ctx.fillStyle = 'rgba(120, 196, 138, 0.18)';
    ctx.fillRect(PAD_X, curY, W - PAD_X * 2, 2);
    curY += 18;
    ctx.font = `bold 25px ${FONT}`;
    ctx.fillStyle = '#eef7f0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('🏅 代表榮譽', PAD_X, curY);
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillStyle = '#9ec0aa';
    ctx.textAlign = 'right';
    ctx.fillText(`${honors.length} / ${PROF_MAX_HONORS}`, W - PAD_X, curY + 2);
    curY += 42;

    for (const h of honors) {
      const isComm = h.kind === 'comm';
      const tag = isComm ? '🎖️ 社群賽' : '🏛️ 網站賽';
      ctx.font = `bold 20px ${FONT}`;
      const tagW = ctx.measureText(tag).width + 20;
      drawRoundedRectPath(ctx, PAD_X, curY + 2, tagW, 30, 8);
      ctx.fillStyle = isComm ? 'rgba(143, 220, 192, 0.15)' : 'rgba(255, 211, 90, 0.15)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isComm ? 'rgba(143, 220, 192, 0.42)' : 'rgba(255, 211, 90, 0.42)';
      ctx.stroke();
      ctx.fillStyle = isComm ? '#9be7cb' : '#ffe28a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, PAD_X + tagW / 2, curY + 18);

      let tx = PAD_X + tagW + 12;
      if (h.date) {
        const dt = formatHonorDate(h.date);
        ctx.font = `21px ${FONT}`;
        ctx.fillStyle = 'rgba(238, 247, 240, 0.75)';
        ctx.textAlign = 'left';
        ctx.fillText(dt, tx, curY + 18);
        tx += ctx.measureText(dt).width + 12;
      }
      ctx.font = `23px ${FONT}`;
      ctx.fillStyle = '#eef7f0';
      ctx.textAlign = 'left';
      const label = `${h.eventName}・${h.placementLabel}`;
      ctx.fillText(fitCanvasEllipsis(ctx, label, W - PAD_X - tx), tx, curY + 18);
      curY += 42;
    }
  }

  // 底部標記
  ctx.font = `20px ${FONT}`;
  ctx.fillStyle = 'rgba(168, 199, 178, 0.65)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('PTCG TW Sim ・ 玩家個人名片', W - PAD_X, H - 18);
  ctx.restore();
  return canvas;
}

export async function downloadProfileCardPng(
  card: PlayerProfilePublic,
  stillOwnCard: () => boolean = () => true,
): Promise<{ ok: boolean; filename: string; error?: string }> {
  const safeNick = (card.nick || 'player').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) || 'player';
  const filename = `ptcg-名片-${safeNick}.png`;
  try {
    const canvas = await renderProfileCardToCanvas(card);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    if (!stillOwnCard()) return { ok: false, filename };
    if (!blob) return { ok: false, filename, error: '無法產生 PNG 圖片檔' };
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, filename };
  } catch (e) {
    return { ok: false, filename, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 懶載入官方卡池清單供頭像選卡（全部卡種皆可選：寶可夢／訓練家／能量）。
 * 只在玩家打開「選取頭像卡片」後按需求呼叫。
 */
export async function listAllCardSetsForPicker() {
  return loadIndex();
}

export async function loadCardsForPickerSet(setCode: string): Promise<Card[]> {
  return loadSet(setCode);
}

export async function loadAllCardsForPicker(): Promise<Card[]> {
  return loadAllSets();
}

export async function loadCardSetLookup(): Promise<Record<string, string>> {
  return loadCardSetMap();
}
