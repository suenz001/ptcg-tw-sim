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

export const AVATAR_FRAME_INNER_R = 46;
export const AVATAR_FRAME_MASK_R = 46.5;

/**
 * 20 款立體裝飾 SVG 外框幾何描述（viewBox 0 0 140 140，內圓頭像中心 (70,70)、半徑 46）。
 * Svelte AvatarCircle 與 Canvas PNG 下載共用同一份資料與內圓透明保護遮罩，零 {@html}、零外部網路請求。
 */
export const AVATAR_FRAME_ART: Readonly<Record<AvatarFrameId, AvatarFrameArt>> = {
  admin_gold: {
    grads: [
      { kind: 'lin', id: 'g1', x1: 18, y1: 12, x2: 122, y2: 128, stops: [['0%', '#fff5ba'], ['35%', '#f7c844'], ['70%', '#b8760e'], ['100%', '#ffe785']] },
      { kind: 'rad', id: 'gem', cx: '40%', cy: '35%', r: '65%', stops: [['0%', '#ff9ea8'], ['50%', '#e11d48'], ['100%', '#7f0b24']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#2d1d04', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@g1', sw: 4 },
      { t: 'circle', cx: 70, cy: 70, r: 47.2, stroke: '#fff2b2', sw: 0.9, so: 0.75 },
      { t: 'path', d: 'M21 76 C9 66, 7 50, 14 38 C16 48, 20 55, 24 59 C19 63, 19 70, 21 76 Z', fill: '@g1', stroke: '#4a2c04', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M24 89 C12 84, 7 72, 10 61 C14 69, 19 74, 23 77 C21 81, 22 85, 24 89 Z', fill: '@g1', stroke: '#4a2c04', sw: 1.2, slj: 'round' },
      { t: 'path', d: 'M119 76 C131 66, 133 50, 126 38 C124 48, 120 55, 116 59 C121 63, 121 70, 119 76 Z', fill: '@g1', stroke: '#4a2c04', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M116 89 C128 84, 133 72, 130 61 C126 69, 121 74, 117 77 C119 81, 118 85, 116 89 Z', fill: '@g1', stroke: '#4a2c04', sw: 1.2, slj: 'round' },
      { t: 'path', d: 'M51 22 L47 9 L59 16 L70 4 L81 16 L93 9 L89 22 Q70 18 51 22 Z', fill: '@g1', stroke: '#4a2c04', sw: 1.5, slj: 'round' },
      { t: 'circle', cx: 70, cy: 15.5, r: 3.5, fill: '@gem', stroke: '#fff3c4', sw: 1 },
      { t: 'circle', cx: 57, cy: 18, r: 1.9, fill: '#fff6cc' },
      { t: 'circle', cx: 83, cy: 18, r: 1.9, fill: '#fff6cc' },
      { t: 'circle', cx: 70, cy: 123, r: 6.4, fill: '#2b1904', stroke: '@g1', sw: 1.9 },
      { t: 'path', d: 'M64.5 123 A5.5 5.5 0 0 1 75.5 123 Z', fill: '#e11d48' },
      { t: 'path', d: 'M64.5 123 A5.5 5.5 0 0 0 75.5 123 Z', fill: '#f8fafc' },
      { t: 'line', x1: 64.2, y1: 123, x2: 75.8, y2: 123, stroke: '#2b1904', sw: 1.5 },
      { t: 'circle', cx: 70, cy: 123, r: 2.1, fill: '#ffffff', stroke: '#2b1904', sw: 1.1 },
    ],
  },
  champion_master: {
    grads: [
      { kind: 'lin', id: 'p1', x1: 20, y1: 15, x2: 120, y2: 125, stops: [['0%', '#d8b4fe'], ['45%', '#8b5cf6'], ['100%', '#4c1d95']] },
      { kind: 'lin', id: 'lg', x1: 25, y1: 40, x2: 115, y2: 125, stops: [['0%', '#fef08a'], ['50%', '#f59e0b'], ['100%', '#b45309']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#220e47', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@p1', sw: 3.9 },
      { t: 'circle', cx: 70, cy: 70, r: 47.2, stroke: '#fde68a', sw: 1, so: 0.8 },
      { t: 'path', d: 'M22 94 C12 92, 10 81, 17 76 C21 82, 23 88, 22 94 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M17 76 C8 71, 9 59, 17 56 C20 63, 20 70, 17 76 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M20 57 C13 50, 17 39, 26 38 C27 45, 24 52, 20 57 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M34 110 C24 111, 19 102, 24 95 C30 100, 33 105, 34 110 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M51 120 C41 123, 34 117, 37 110 C44 113, 48 116, 51 120 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M118 94 C128 92, 130 81, 123 76 C119 82, 117 88, 118 94 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M123 76 C132 71, 131 59, 123 56 C120 63, 120 70, 123 76 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M120 57 C127 50, 123 39, 114 38 C113 45, 116 52, 120 57 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M106 110 C116 111, 121 102, 116 95 C110 100, 107 105, 106 110 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'path', d: 'M89 120 C99 123, 106 117, 103 110 C96 113, 92 116, 89 120 Z', fill: '@lg', stroke: '#422006', sw: 1.1 },
      { t: 'circle', cx: 70, cy: 14.5, r: 9.2, fill: '#2e1065', stroke: '@lg', sw: 2 },
      { t: 'path', d: 'M61.8 14.5 A8.2 8.2 0 0 1 78.2 14.5 Z', fill: '#7c3aed' },
      { t: 'path', d: 'M61.8 14.5 A8.2 8.2 0 0 0 78.2 14.5 Z', fill: '#f8fafc' },
      { t: 'circle', cx: 65.1, cy: 10.8, r: 2, fill: '#f472b6' },
      { t: 'circle', cx: 74.9, cy: 10.8, r: 2, fill: '#f472b6' },
      { t: 'line', x1: 61.5, y1: 14.5, x2: 78.5, y2: 14.5, stroke: '#1e1b4b', sw: 1.6 },
      { t: 'circle', cx: 70, cy: 14.5, r: 2.5, fill: '#ffffff', stroke: '#1e1b4b', sw: 1.1 },
      { t: 'path', d: 'M43 15 L44.6 19.4 L49 21 L44.6 22.6 L43 27 L41.4 22.6 L37 21 L41.4 19.4 Z', fill: '#fef08a' },
      { t: 'path', d: 'M97 15 L98.6 19.4 L103 21 L98.6 22.6 L97 27 L95.4 22.6 L91 21 L95.4 19.4 Z', fill: '#fef08a' },
      { t: 'polygon', points: '70,117 77,124 70,130 63,124', fill: '@lg', stroke: '#422006', sw: 1.2 },
    ],
  },
  sponsor_diamond: {
    grads: [
      { kind: 'lin', id: 't1', x1: 15, y1: 10, x2: 125, y2: 130, stops: [['0%', '#f0fdff'], ['30%', '#67e8f9'], ['65%', '#818cf8'], ['100%', '#f472b6']] },
      { kind: 'lin', id: 'c1', x1: 70, y1: 3, x2: 70, y2: 26, stops: [['0%', '#ffffff'], ['45%', '#a5f3fc'], ['100%', '#38bdf8']] },
      { kind: 'lin', id: 'c2', x1: 90, y1: 88, x2: 128, y2: 124, stops: [['0%', '#e0f2fe'], ['55%', '#60a5fa'], ['100%', '#c084fc']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#0c2d48', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@t1', sw: 4 },
      { t: 'circle', cx: 70, cy: 70, r: 47.2, stroke: '#ffffff', sw: 1, so: 0.85, sd: '10 6' },
      { t: 'polygon', points: '70,3 77.5,16 70,23.5 62.5,16', fill: '@c1', stroke: '#0e4f73', sw: 1.3, slj: 'round' },
      { t: 'polygon', points: '70,3 77.5,16 70,18', fill: '#ffffff', fo: 0.65 },
      { t: 'polygon', points: '55,9 63,19.5 56,23.5 50,17', fill: '@c2', stroke: '#0e4f73', sw: 1.2, slj: 'round' },
      { t: 'polygon', points: '85,9 90,17 84,23.5 77,19.5', fill: '@c2', stroke: '#0e4f73', sw: 1.2, slj: 'round' },
      { t: 'polygon', points: '124,96 115,113 104,108 111,96', fill: '@c2', stroke: '#0e4f73', sw: 1.2, slj: 'round' },
      { t: 'polygon', points: '110,115 96,127 91,117 101,110', fill: '@c1', stroke: '#0e4f73', sw: 1.2, slj: 'round' },
      { t: 'polygon', points: '19,40 27,47 20,56 12,48', fill: '@c1', stroke: '#0e4f73', sw: 1.2, slj: 'round' },
      { t: 'path', d: 'M118 33 L120 39 L126 41 L120 43 L118 49 L116 43 L110 41 L116 39 Z', fill: '#ffffff' },
      { t: 'path', d: 'M22 97 L23.6 101.4 L28 103 L23.6 104.6 L22 109 L20.4 104.6 L16 103 L20.4 101.4 Z', fill: '#bae6fd' },
    ],
  },
  premier_trophy: {
    grads: [
      { kind: 'lin', id: 'gd', x1: 55, y1: 3, x2: 85, y2: 26, stops: [['0%', '#fef9c3'], ['50%', '#f59e0b'], ['100%', '#b45309']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#18181b', sw: 6.2 },
      { t: 'path', d: 'M20.4 70 A49.6 49.6 0 0 1 119.6 70', stroke: '#ef4444', sw: 4.2 },
      { t: 'path', d: 'M20.4 70 A49.6 49.6 0 0 0 119.6 70', stroke: '#f8fafc', sw: 4.2 },
      { t: 'rect', x: 12, y: 66, w: 11, h: 8, rx: 3, fill: '#18181b', stroke: '#facc15', sw: 1.4 },
      { t: 'rect', x: 117, y: 66, w: 11, h: 8, rx: 3, fill: '#18181b', stroke: '#facc15', sw: 1.4 },
      { t: 'path', d: 'M52 119 L41 132 L51 129 L56 136 L64 121 Z', fill: '#dc2626', stroke: '#7f1d1d', sw: 1.2, slj: 'round' },
      { t: 'path', d: 'M88 119 L99 132 L89 129 L84 136 L76 121 Z', fill: '#dc2626', stroke: '#7f1d1d', sw: 1.2, slj: 'round' },
      { t: 'path', d: 'M59 4 H81 L78 15.5 C76 19.5, 64 19.5, 62 15.5 Z', fill: '@gd', stroke: '#451a03', sw: 1.4, slj: 'round' },
      { t: 'path', d: 'M59 7 C53 7, 53 14, 60 14', stroke: '#f59e0b', sw: 2, slc: 'round' },
      { t: 'path', d: 'M81 7 C87 7, 87 14, 80 14', stroke: '#f59e0b', sw: 2, slc: 'round' },
      { t: 'rect', x: 66.5, y: 17.5, w: 7, h: 3.5, fill: '#d97706', stroke: '#451a03', sw: 1 },
      { t: 'rect', x: 62, y: 20.5, w: 16, h: 3.2, rx: 1.4, fill: '@gd', stroke: '#451a03', sw: 1 },
      { t: 'circle', cx: 70, cy: 122.5, r: 5, fill: '#f8fafc', stroke: '#18181b', sw: 2.1 },
      { t: 'circle', cx: 70, cy: 122.5, r: 2, fill: '#ef4444' },
    ],
  },
  rainbow_rare: {
    grads: [
      { kind: 'lin', id: 'rb', x1: 12, y1: 12, x2: 128, y2: 128, stops: [['0%', '#ff6b9d'], ['22%', '#fde047'], ['45%', '#4ade80'], ['70%', '#38bdf8'], ['100%', '#c084fc']] },
      { kind: 'lin', id: 'rb2', x1: 128, y1: 12, x2: 12, y2: 128, stops: [['0%', '#ffffff'], ['50%', '#f0abfc'], ['100%', '#67e8f9']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.8, stroke: '#1e1b4b', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.8, stroke: '@rb', sw: 4.4 },
      { t: 'circle', cx: 70, cy: 70, r: 47.3, stroke: '#ffffff', sw: 1, so: 0.9 },
      { t: 'path', d: 'M25 25 L29 13 L33 25 L45 29 L33 33 L29 45 L25 33 L13 29 Z', fill: '@rb2', stroke: '#312e81', sw: 1.1 },
      { t: 'path', d: 'M109 22 L112 13 L115 22 L124 25 L115 28 L112 37 L109 28 L100 25 Z', fill: '#fef08a', stroke: '#713f12', sw: 1 },
      { t: 'path', d: 'M108 107 L112 97 L116 107 L126 111 L116 115 L112 125 L108 115 L98 111 Z', fill: '@rb2', stroke: '#312e81', sw: 1.1 },
      { t: 'path', d: 'M24 109 L27 101 L30 109 L38 112 L30 115 L27 123 L24 115 L16 112 Z', fill: '#67e8f9', stroke: '#164e63', sw: 1 },
      { t: 'path', d: 'M52 16 Q70 10 88 16', stroke: '@rb', sw: 2.6, slc: 'round' },
      { t: 'path', d: 'M52 124 Q70 130 88 124', stroke: '@rb', sw: 2.6, slc: 'round' },
      { t: 'circle', cx: 70, cy: 13, r: 2.8, fill: '#ffffff' },
      { t: 'circle', cx: 70, cy: 127, r: 2.8, fill: '#ffffff' },
    ],
  },
  flame_flare: {
    grads: [
      { kind: 'lin', id: 'f1', x1: 20, y1: 120, x2: 120, y2: 15, stops: [['0%', '#dc2626'], ['45%', '#f97316'], ['85%', '#fde047'], ['100%', '#fff7ed']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#3b0a04', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@f1', sw: 4 },
      { t: 'path', d: 'M102 27 C114 23, 123 14, 125 8 C128 21, 125 34, 117 44 C123 41, 129 38, 131 33 C130 48, 124 58, 117 64 C116 49, 110 36, 102 27 Z', fill: '@f1', stroke: '#5c1106', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M110 34 C116 30, 120 24, 121 18 C122 27, 119 36, 114 42 Z', fill: '#fef9c3' },
      { t: 'path', d: 'M37 115 C22 117, 13 106, 9 93 C16 98, 22 98, 25 95 C15 87, 12 74, 16 62 C19 71, 21 78, 25 84 C25 96, 30 107, 37 115 Z', fill: '@f1', stroke: '#5c1106', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M28 106 C20 106, 16 100, 14 94 C19 97, 24 97, 28 94 Z', fill: '#fef08a' },
      { t: 'path', d: 'M70 117 C75 121.5, 78.5 125.5, 76.5 131 C74.8 134.5, 72 135.5, 70 135.5 C68 135.5, 65.2 134.5, 63.5 131 C61.5 125.5, 65 121.5, 70 117 Z', fill: '@f1', stroke: '#4a0d04', sw: 1.3 },
      { t: 'path', d: 'M70 123 C72.6 126, 73.5 128.5, 71.8 131.2 C70.7 132.5, 69.3 132.5, 68.2 131.2 C66.5 128.5, 67.4 126, 70 123 Z', fill: '#fffbeb' },
      { t: 'circle', cx: 105, cy: 13, r: 2.5, fill: '#fde047' },
      { t: 'circle', cx: 129, cy: 23, r: 2, fill: '#fb923c' },
      { t: 'circle', cx: 16, cy: 51, r: 2.3, fill: '#fde047' },
    ],
  },
  emerald_leaf: {
    grads: [
      { kind: 'lin', id: 'v1', x1: 18, y1: 18, x2: 122, y2: 122, stops: [['0%', '#6b4423'], ['50%', '#472b15'], ['100%', '#2e4d25']] },
      { kind: 'lin', id: 'lf', x1: 80, y1: 15, x2: 125, y2: 60, stops: [['0%', '#bbf7d0'], ['45%', '#34d399'], ['100%', '#15803d']] },
      { kind: 'rad', id: 'fl', cx: '50%', cy: '50%', r: '55%', stops: [['0%', '#ffe4e6'], ['55%', '#fb7185'], ['100%', '#be123c']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@v1', sw: 5.4 },
      { t: 'path', d: 'M108 38 C121 53, 123 76, 115 96', stroke: '#4ade80', sw: 2.4, slc: 'round' },
      { t: 'path', d: 'M36 108 C51 121, 74 124, 94 116', stroke: '#4ade80', sw: 2.2, slc: 'round' },
      { t: 'path', d: 'M102 31 C109 16, 123 13, 129 20 C125 31, 113 36, 102 31 Z', fill: '@lf', stroke: '#0f3d1e', sw: 1.3 },
      { t: 'path', d: 'M112 44 C125 37, 135 44, 133 54 C123 56, 115 52, 112 44 Z', fill: '@lf', stroke: '#0f3d1e', sw: 1.3 },
      { t: 'path', d: 'M92 23 C91 12, 99 6, 106 9 C105 17, 99 22, 92 23 Z', fill: '#86efac', stroke: '#0f3d1e', sw: 1.1 },
      { t: 'path', d: 'M21 85 C9 83, 7 70, 16 65 C22 70, 24 78, 21 85 Z', fill: '@lf', stroke: '#0f3d1e', sw: 1.2 },
      { t: 'path', d: 'M49 119 C48 131, 60 135, 67 127 C62 121, 55 118, 49 119 Z', fill: '@lf', stroke: '#0f3d1e', sw: 1.2 },
      { t: 'ellipse', cx: 0, cy: -8.6, rx: 5.4, ry: 7.4, fill: '@fl', stroke: '#581122', sw: 1.1, tf: 'translate(24 111)' },
      { t: 'ellipse', cx: 8.2, cy: -2.6, rx: 5.4, ry: 7.4, fill: '@fl', stroke: '#581122', sw: 1.1, tf: 'translate(24 111) rotate(72 8.2 -2.6)' },
      { t: 'ellipse', cx: 5.1, cy: 7.1, rx: 5.4, ry: 7.4, fill: '@fl', stroke: '#581122', sw: 1.1, tf: 'translate(24 111) rotate(144 5.1 7.1)' },
      { t: 'ellipse', cx: -5.1, cy: 7.1, rx: 5.4, ry: 7.4, fill: '@fl', stroke: '#581122', sw: 1.1, tf: 'translate(24 111) rotate(216 -5.1 7.1)' },
      { t: 'ellipse', cx: -8.2, cy: -2.6, rx: 5.4, ry: 7.4, fill: '@fl', stroke: '#581122', sw: 1.1, tf: 'translate(24 111) rotate(288 -8.2 -2.6)' },
      { t: 'circle', cx: 24, cy: 111, r: 4.4, fill: '#fde047', stroke: '#713f12', sw: 1.1 },
      { t: 'path', d: 'M22 43 C15 38, 15 31, 22 29 C25 34, 25 39, 22 43 Z', fill: '#fda4af', stroke: '#881337', sw: 0.9 },
    ],
  },
  aqua_wave: {
    grads: [
      { kind: 'lin', id: 'w1', x1: 15, y1: 15, x2: 125, y2: 125, stops: [['0%', '#bae6fd'], ['45%', '#0ea5e9'], ['100%', '#1d4ed8']] },
      { kind: 'lin', id: 'w2', x1: 12, y1: 80, x2: 80, y2: 128, stops: [['0%', '#e0f2fe'], ['55%', '#38bdf8'], ['100%', '#0369a1']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#082f49', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@w1', sw: 4 },
      { t: 'path', d: 'M14 74 C7 95, 22 126, 56 130 C73 132, 88 126, 97 117 C81 122, 57 121, 41 109 C28 99, 22 86, 23 75 C19 73, 17 73, 14 74 Z', fill: '@w2', stroke: '#0c4a6e', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M14 74 C10 65, 17 57, 24 61 C19 65, 19 70, 23 73', fill: '#f0f9ff', stroke: '#0369a1', sw: 1.2 },
      { t: 'path', d: 'M27 106 C42 119, 62 123, 81 120', stroke: '#ffffff', sw: 2, slc: 'round', so: 0.8 },
      { t: 'path', d: 'M116 17 C116 17, 126 29, 123 37 C121 42, 116 44, 111 42 C106 39, 106 32, 116 17 Z', fill: '@w1', stroke: '#0c4a6e', sw: 1.3 },
      { t: 'ellipse', cx: 114, cy: 34, rx: 1.9, ry: 3.4, fill: '#ffffff', fo: 0.75 },
      { t: 'circle', cx: 98, cy: 17, r: 4.2, fill: '#e0f2fe', fo: 0.75, stroke: '#0284c7', sw: 1.1 },
      { t: 'circle', cx: 126, cy: 52, r: 3.4, fill: '#bae6fd', stroke: '#0284c7', sw: 1 },
      { t: 'circle', cx: 21, cy: 46, r: 3.2, fill: '#e0f2fe', stroke: '#0284c7', sw: 1 },
      { t: 'circle', cx: 101, cy: 118, r: 2.8, fill: '#ffffff' },
    ],
  },
  psychic_nebula: {
    grads: [
      { kind: 'lin', id: 'ps', x1: 12, y1: 20, x2: 128, y2: 120, stops: [['0%', '#f5d0fe'], ['50%', '#a855f7'], ['100%', '#4338ca']] },
    ],
    shapes: [
      { t: 'path', d: 'M118.4 55.2 A65 22 0 0 1 118.4 84.8', tf: 'rotate(-24 70 70)', stroke: '#e879f9', sw: 2.2, so: 0.85, slc: 'round' },
      { t: 'path', d: 'M21.6 84.8 A65 22 0 0 1 21.6 55.2', tf: 'rotate(-24 70 70)', stroke: '#e879f9', sw: 2.2, so: 0.85, slc: 'round' },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#2e1065', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@ps', sw: 4 },
      { t: 'path', d: 'M29 14 A11 11 0 1 0 41 29 A8.4 8.4 0 1 1 29 14 Z', fill: '#fef08a', stroke: '#581c87', sw: 1.3 },
      { t: 'polygon', points: '119,31 125,41 118,49 112,39', fill: '#e879f9', stroke: '#4c1d95', sw: 1.2 },
      { t: 'polygon', points: '19,93 26,99 19,108 13,100', fill: '#c084fc', stroke: '#4c1d95', sw: 1.2 },
      { t: 'path', d: 'M56 123 Q70 116 84 123 Q70 130 56 123 Z', fill: '#3b0764', stroke: '#f0abfc', sw: 1.5 },
      { t: 'circle', cx: 70, cy: 123, r: 3.2, fill: '#f5d0fe' },
      { t: 'circle', cx: 70, cy: 123, r: 1.3, fill: '#581c87' },
      { t: 'path', d: 'M110 99 L112 104 L117 106 L112 108 L110 113 L108 108 L103 106 L108 104 Z', fill: '#fef08a' },
    ],
  },
  shadow_phantom: {
    grads: [
      { kind: 'lin', id: 'sh', x1: 20, y1: 15, x2: 120, y2: 125, stops: [['0%', '#6366f1'], ['50%', '#312e81'], ['100%', '#0f172a']] },
      { kind: 'rad', id: 'wf', cx: '50%', cy: '65%', r: '55%', stops: [['0%', '#ccfbf1'], ['50%', '#2dd4bf'], ['100%', '#6d28d9']] },
    ],
    shapes: [
      { t: 'path', d: 'M44 24 C35 15, 34 6, 41 4 C41 11, 47 16, 55 20 Z', fill: '#1e1b4b', stroke: '#818cf8', sw: 1.4, slj: 'round' },
      { t: 'path', d: 'M96 24 C105 15, 106 6, 99 4 C99 11, 93 16, 85 20 Z', fill: '#1e1b4b', stroke: '#818cf8', sw: 1.4, slj: 'round' },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#09090b', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@sh', sw: 4 },
      { t: 'circle', cx: 70, cy: 70, r: 47.2, stroke: '#a78bfa', sw: 0.9, so: 0.7 },
      { t: 'path', d: 'M17 74 C21 82, 25 86, 23 94 C21 99, 16 101, 11 98 C6 94, 8 85, 14 81 C12 78, 13 75, 17 74 Z', fill: '@wf', stroke: '#1e1b4b', sw: 1.2 },
      { t: 'path', d: 'M124 44 C129 52, 133 57, 130 64 C128 69, 122 70, 118 66 C114 62, 117 54, 122 50 C121 47, 122 45, 124 44 Z', fill: '@wf', stroke: '#1e1b4b', sw: 1.2 },
      { t: 'path', d: 'M97 114 C109 111, 119 102, 123 91', stroke: '#7c3aed', sw: 2.6, slc: 'round' },
      { t: 'circle', cx: 115, cy: 105, r: 3, fill: '#2dd4bf' },
      { t: 'circle', cx: 26, cy: 38, r: 2.4, fill: '#a78bfa' },
    ],
  },
  cyber_neon: {
    grads: [
      { kind: 'lin', id: 'e1', x1: 25, y1: 12, x2: 115, y2: 125, stops: [['0%', '#fef08a'], ['50%', '#facc15'], ['100%', '#eab308']] },
    ],
    shapes: [
      { t: 'path', d: 'M36 31 C25 20, 16 10, 17 4 C25 6, 39 14, 49 23 Z', fill: '@e1', stroke: '#422006', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M17 4 C22 5.5, 27.5 8.5, 31 12 L24.5 19 C20 13.5, 16.5 8, 17 4 Z', fill: '#1e1b18' },
      { t: 'path', d: 'M104 31 C115 20, 124 10, 123 4 C115 6, 101 14, 91 23 Z', fill: '@e1', stroke: '#422006', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M123 4 C118 5.5, 112.5 8.5, 109 12 L115.5 19 C120 13.5, 123.5 8, 123 4 Z', fill: '#1e1b18' },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#422006', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@e1', sw: 4.2 },
      { t: 'circle', cx: 18.5, cy: 86, r: 5.8, fill: '#ef4444', stroke: '#7f1d1d', sw: 1.3 },
      { t: 'circle', cx: 17, cy: 84.3, r: 1.6, fill: '#fecaca' },
      { t: 'circle', cx: 121.5, cy: 86, r: 5.8, fill: '#ef4444', stroke: '#7f1d1d', sw: 1.3 },
      { t: 'circle', cx: 120, cy: 84.3, r: 1.6, fill: '#fecaca' },
      { t: 'path', d: 'M103 116 L113 104 L108 101 L125 84 L135 95 L120 106 L125 110 L108 124 Z', fill: '@e1', stroke: '#422006', sw: 1.5, slj: 'round' },
      { t: 'path', d: 'M12 64 L18 67 L13 71', stroke: '#38bdf8', sw: 1.8, slc: 'round' },
      { t: 'path', d: 'M128 56 L122 60 L127 64', stroke: '#38bdf8', sw: 1.8, slc: 'round' },
    ],
  },
  eevee_fluff: {
    grads: [
      { kind: 'lin', id: 'ev', x1: 20, y1: 15, x2: 120, y2: 125, stops: [['0%', '#d99a5b'], ['55%', '#b46e34'], ['100%', '#854d21']] },
    ],
    shapes: [
      { t: 'path', d: 'M35 32 C22 18, 17 6, 22 2 C32 5, 45 15, 52 24 Z', fill: '@ev', stroke: '#45210a', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M25 7 C31 10, 39 16, 44 23 L36 26 C30 20, 25 12, 25 7 Z', fill: '#45210a' },
      { t: 'path', d: 'M105 32 C118 18, 123 6, 118 2 C108 5, 95 15, 88 24 Z', fill: '@ev', stroke: '#45210a', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M115 7 C109 10, 101 16, 96 23 L104 26 C110 20, 115 12, 115 7 Z', fill: '#45210a' },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#45210a', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@ev', sw: 4.2 },
      { t: 'path', d: 'M38 117 C44 114, 52 116, 57 120 C63 117, 77 117, 83 120 C88 116, 96 114, 102 117 C96 128, 84 134, 70 134 C56 134, 44 128, 38 117 Z', fill: '#fef3c7', stroke: '#78350f', sw: 1.4, slj: 'round' },
      { t: 'path', d: 'M116 96 C128 94, 134 84, 131 74 C127 78, 123 78, 121 75 C118 83, 117 89, 116 96 Z', fill: '#fef3c7', stroke: '#78350f', sw: 1.3, slj: 'round' },
    ],
  },
  fairy_ribbon: {
    grads: [
      { kind: 'lin', id: 'fr', x1: 15, y1: 15, x2: 125, y2: 125, stops: [['0%', '#fbcfe8'], ['50%', '#f472b6'], ['100%', '#7dd3fc']] },
    ],
    shapes: [
      { t: 'path', d: 'M36 30 C26 14, 25 4, 33 3 C41 6, 48 16, 52 24 Z', fill: '#fbcfe8', stroke: '#9d174d', sw: 1.4 },
      { t: 'path', d: 'M33 8 C38 11, 43 17, 46 23 L40 25 C36 19, 33 12, 33 8 Z', fill: '#38bdf8' },
      { t: 'path', d: 'M104 30 C114 14, 115 4, 107 3 C99 6, 92 16, 88 24 Z', fill: '#fbcfe8', stroke: '#9d174d', sw: 1.4 },
      { t: 'path', d: 'M107 8 C102 11, 97 17, 94 23 L100 25 C104 19, 107 12, 107 8 Z', fill: '#38bdf8' },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#831843', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@fr', sw: 4 },
      { t: 'path', d: 'M20 68 C7 76, 9 96, 22 108 C16 95, 17 83, 23 76 Z', fill: '#f9a8d4', stroke: '#9d174d', sw: 1.1 },
      { t: 'path', d: 'M120 68 C133 76, 131 96, 118 108 C124 95, 123 83, 117 76 Z', fill: '#7dd3fc', stroke: '#0369a1', sw: 1.1 },
      { t: 'path', d: 'M70 18.5 C61 9.5, 52 12.5, 55 21.5 C59 24.5, 65 22.5, 70 19.5 Z', fill: '#f472b6', stroke: '#831843', sw: 1.3 },
      { t: 'path', d: 'M70 18.5 C79 9.5, 88 12.5, 85 21.5 C81 24.5, 75 22.5, 70 19.5 Z', fill: '#f472b6', stroke: '#831843', sw: 1.3 },
      { t: 'circle', cx: 70, cy: 19, r: 3.4, fill: '#fff1f2', stroke: '#831843', sw: 1.2 },
    ],
  },
  gengar_grin: {
    grads: [
      { kind: 'lin', id: 'gg', x1: 20, y1: 12, x2: 120, y2: 128, stops: [['0%', '#8b5cf6'], ['55%', '#5b21b6'], ['100%', '#2e1065']] },
    ],
    shapes: [
      { t: 'path', d: 'M35 33 L20 8 L51 23 Z', fill: '@gg', stroke: '#1e0a3c', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M105 33 L120 8 L89 23 Z', fill: '@gg', stroke: '#1e0a3c', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M57 20 L62 10 L66 19 L70 7 L74 19 L78 10 L83 20 Z', fill: '#4c1d95', stroke: '#1e0a3c', sw: 1.4, slj: 'round' },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#1e0a3c', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@gg', sw: 4.2 },
      { t: 'path', d: 'M19 48 L26 52 L21 54 Z', fill: '#ef4444' },
      { t: 'path', d: 'M121 48 L114 52 L119 54 Z', fill: '#ef4444' },
      { t: 'path', d: 'M52 119 Q70 129 88 119 Q70 123 52 119 Z', fill: '#f8fafc', stroke: '#1e0a3c', sw: 1.4 },
      { t: 'polygon', points: '58,120 61,126 64,121', fill: '#ffffff', stroke: '#1e0a3c', sw: 1 },
      { t: 'polygon', points: '76,121 79,126 82,120', fill: '#ffffff', stroke: '#1e0a3c', sw: 1 },
    ],
  },
  snorlax_cozy: {
    grads: [
      { kind: 'lin', id: 'sn', x1: 20, y1: 15, x2: 120, y2: 125, stops: [['0%', '#2dd4bf'], ['45%', '#0f766e'], ['100%', '#134e4a']] },
    ],
    shapes: [
      { t: 'path', d: 'M32 35 C26 20, 31 10, 42 13 C49 15, 54 20, 56 24 Z', fill: '@sn', stroke: '#042f2e', sw: 1.6, slj: 'round' },
      { t: 'path', d: 'M108 35 C114 20, 109 10, 98 13 C91 15, 86 20, 84 24 Z', fill: '@sn', stroke: '#042f2e', sw: 1.6, slj: 'round' },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#042f2e', sw: 6.2 },
      { t: 'path', d: 'M20.4 70 A49.6 49.6 0 0 1 119.6 70', stroke: '@sn', sw: 4.2 },
      { t: 'path', d: 'M20.4 70 A49.6 49.6 0 0 0 119.6 70', stroke: '#fef3c7', sw: 4.2 },
      { t: 'ellipse', cx: 47, cy: 120, rx: 8, ry: 5.8, fill: '#fef3c7', stroke: '#042f2e', sw: 1.4 },
      { t: 'circle', cx: 47, cy: 121, r: 2.8, fill: '#b45309', fo: 0.55 },
      { t: 'ellipse', cx: 93, cy: 120, rx: 8, ry: 5.8, fill: '#fef3c7', stroke: '#042f2e', sw: 1.4 },
      { t: 'circle', cx: 93, cy: 121, r: 2.8, fill: '#b45309', fo: 0.55 },
      { t: 'circle', cx: 121, cy: 35, r: 5, fill: '#e0f2fe', stroke: '#0f766e', sw: 1.2 },
      { t: 'circle', cx: 129, cy: 23, r: 3.4, fill: '#e0f2fe', stroke: '#0f766e', sw: 1.1 },
      { t: 'path', d: 'M18 35 L19.5 39 L23.5 40.5 L19.5 42 L18 46 L16.5 42 L12.5 40.5 L16.5 39 Z', fill: '#fde047' },
    ],
  },
  dragon_crest: {
    grads: [
      { kind: 'lin', id: 'dr', x1: 15, y1: 15, x2: 125, y2: 125, stops: [['0%', '#34d399'], ['50%', '#059669'], ['100%', '#064e3b']] },
    ],
    shapes: [
      { t: 'path', d: 'M46 23 C34 13, 29 5, 36 2 C40 9, 49 14, 58 19 Z', fill: '#facc15', stroke: '#422006', sw: 1.4, slj: 'round' },
      { t: 'path', d: 'M94 23 C106 13, 111 5, 104 2 C100 9, 91 14, 82 19 Z', fill: '#facc15', stroke: '#422006', sw: 1.4, slj: 'round' },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#052e16', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@dr', sw: 4.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#facc15', sw: 1.5, sd: '6 9' },
      { t: 'path', d: 'M20 62 L6 52 L16 70 L7 84 L22 80 Z', fill: '#10b981', stroke: '#052e16', sw: 1.3, slj: 'round' },
      { t: 'path', d: 'M120 62 L134 52 L124 70 L133 84 L118 80 Z', fill: '#10b981', stroke: '#052e16', sw: 1.3, slj: 'round' },
      { t: 'circle', cx: 70, cy: 16, r: 5.8, fill: '#ef4444', stroke: '#facc15', sw: 2 },
      { t: 'circle', cx: 68.3, cy: 14.3, r: 1.7, fill: '#fecaca' },
    ],
  },
  frost_glacier: {
    grads: [
      { kind: 'lin', id: 'ic', x1: 15, y1: 15, x2: 125, y2: 125, stops: [['0%', '#f0f9ff'], ['45%', '#7dd3fc'], ['100%', '#0284c7']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#0c4a6e', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@ic', sw: 4 },
      { t: 'circle', cx: 70, cy: 70, r: 47.2, stroke: '#ffffff', sw: 1 },
      { t: 'line', x1: 26, y1: 16, x2: 26, y2: 40, stroke: '#e0f2fe', sw: 2, slc: 'round' },
      { t: 'line', x1: 15.6, y1: 22, x2: 36.4, y2: 34, stroke: '#e0f2fe', sw: 2, slc: 'round' },
      { t: 'line', x1: 15.6, y1: 34, x2: 36.4, y2: 22, stroke: '#e0f2fe', sw: 2, slc: 'round' },
      { t: 'circle', cx: 26, cy: 28, r: 3.1, fill: '#38bdf8', stroke: '#0369a1', sw: 1.2 },
      { t: 'line', x1: 113, y1: 100, x2: 113, y2: 122, stroke: '#ffffff', sw: 1.8, slc: 'round' },
      { t: 'line', x1: 103.5, y1: 105.5, x2: 122.5, y2: 116.5, stroke: '#ffffff', sw: 1.8, slc: 'round' },
      { t: 'line', x1: 103.5, y1: 116.5, x2: 122.5, y2: 105.5, stroke: '#ffffff', sw: 1.8, slc: 'round' },
      { t: 'circle', cx: 113, cy: 111, r: 2.8, fill: '#7dd3fc', stroke: '#0369a1', sw: 1.1 },
      { t: 'polygon', points: '119,35 127,45 117,48', fill: '#bae6fd', stroke: '#0369a1', sw: 1 },
      { t: 'polygon', points: '22,105 14,113 25,115', fill: '#e0f2fe', stroke: '#0369a1', sw: 1 },
      { t: 'circle', cx: 70, cy: 18, r: 2.8, fill: '#ffffff' },
      { t: 'circle', cx: 70, cy: 122, r: 2.6, fill: '#bae6fd' },
    ],
  },
  steel_gear: {
    grads: [
      { kind: 'lin', id: 'st', x1: 15, y1: 15, x2: 125, y2: 125, stops: [['0%', '#f1f5f9'], ['45%', '#94a3b8'], ['100%', '#475569']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#1e293b', sw: 6.2 },
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@st', sw: 4.2 },
      { t: 'circle', cx: 70, cy: 70, r: 47.2, stroke: '#cbd5e1', sw: 0.9 },
      { t: 'circle', cx: 70, cy: 20.4, r: 2, fill: '#38bdf8' },
      { t: 'circle', cx: 70, cy: 119.6, r: 2, fill: '#38bdf8' },
      { t: 'circle', cx: 20.4, cy: 70, r: 2, fill: '#e2e8f0' },
      { t: 'circle', cx: 119.6, cy: 70, r: 2, fill: '#e2e8f0' },
      { t: 'circle', cx: 26, cy: 29, r: 9.5, fill: '@st', stroke: '#1e293b', sw: 1.5 },
      { t: 'rect', x: 23.9, y: 16.5, w: 4.2, h: 25, rx: 1, fill: '#94a3b8', stroke: '#1e293b', sw: 1 },
      { t: 'rect', x: 13.5, y: 26.9, w: 25, h: 4.2, rx: 1, fill: '#94a3b8', stroke: '#1e293b', sw: 1 },
      { t: 'circle', cx: 26, cy: 29, r: 8, fill: '@st' },
      { t: 'circle', cx: 26, cy: 29, r: 3.8, fill: '#0ea5e9', stroke: '#1e293b', sw: 1.3 },
      { t: 'rect', x: -2, y: -11, w: 4, h: 22, rx: 1, fill: '#f59e0b', stroke: '#451a03', sw: 1, tf: 'translate(113 111) rotate(22)' },
      { t: 'rect', x: -11, y: -2, w: 22, h: 4, rx: 1, fill: '#f59e0b', stroke: '#451a03', sw: 1, tf: 'translate(113 111) rotate(22)' },
      { t: 'circle', cx: 113, cy: 111, r: 7.2, fill: '#fbbf24', stroke: '#451a03', sw: 1.3 },
      { t: 'circle', cx: 113, cy: 111, r: 2.9, fill: '#1e293b' },
    ],
  },
  sakura_spring: {
    grads: [
      { kind: 'lin', id: 'sk', x1: 20, y1: 20, x2: 120, y2: 120, stops: [['0%', '#83324a'], ['100%', '#4a1929']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '@sk', sw: 4.6 },
      { t: 'path', d: 'M21 65 C21 46, 30 31, 46 23', stroke: '#f9a8d4', sw: 1.6, slc: 'round' },
      { t: 'path', d: 'M119 74 C119 93, 110 108, 94 116', stroke: '#f9a8d4', sw: 1.6, slc: 'round' },
      { t: 'circle', cx: 0, cy: -7.5, r: 5.4, fill: '#fbcfe8', stroke: '#be185d', sw: 1, tf: 'translate(24 108) scale(0.92)' },
      { t: 'circle', cx: 7.1, cy: -2.3, r: 5.4, fill: '#fbcfe8', stroke: '#be185d', sw: 1, tf: 'translate(24 108) scale(0.92)' },
      { t: 'circle', cx: 4.4, cy: 6.1, r: 5.4, fill: '#fbcfe8', stroke: '#be185d', sw: 1, tf: 'translate(24 108) scale(0.92)' },
      { t: 'circle', cx: -4.4, cy: 6.1, r: 5.4, fill: '#fbcfe8', stroke: '#be185d', sw: 1, tf: 'translate(24 108) scale(0.92)' },
      { t: 'circle', cx: -7.1, cy: -2.3, r: 5.4, fill: '#fbcfe8', stroke: '#be185d', sw: 1, tf: 'translate(24 108) scale(0.92)' },
      { t: 'circle', cx: 24, cy: 108, r: 3.1, fill: '#f43f5e' },
      { t: 'circle', cx: 24, cy: 108, r: 1.3, fill: '#fef08a' },
      { t: 'circle', cx: 0, cy: -7.5, r: 5.4, fill: '#fce7f3', stroke: '#be185d', sw: 1.1, tf: 'translate(115 32) scale(0.84)' },
      { t: 'circle', cx: 7.1, cy: -2.3, r: 5.4, fill: '#fce7f3', stroke: '#be185d', sw: 1.1, tf: 'translate(115 32) scale(0.84)' },
      { t: 'circle', cx: 4.4, cy: 6.1, r: 5.4, fill: '#fce7f3', stroke: '#be185d', sw: 1.1, tf: 'translate(115 32) scale(0.84)' },
      { t: 'circle', cx: -4.4, cy: 6.1, r: 5.4, fill: '#fce7f3', stroke: '#be185d', sw: 1.1, tf: 'translate(115 32) scale(0.84)' },
      { t: 'circle', cx: -7.1, cy: -2.3, r: 5.4, fill: '#fce7f3', stroke: '#be185d', sw: 1.1, tf: 'translate(115 32) scale(0.84)' },
      { t: 'circle', cx: 115, cy: 32, r: 2.6, fill: '#f43f5e' },
      { t: 'circle', cx: 115, cy: 32, r: 1.1, fill: '#fef08a' },
      { t: 'circle', cx: 0, cy: -7.5, r: 5.4, fill: '#f9a8d4', stroke: '#9d174d', sw: 1.3, tf: 'translate(122 54) scale(0.55)' },
      { t: 'circle', cx: 7.1, cy: -2.3, r: 5.4, fill: '#f9a8d4', stroke: '#9d174d', sw: 1.3, tf: 'translate(122 54) scale(0.55)' },
      { t: 'circle', cx: 4.4, cy: 6.1, r: 5.4, fill: '#f9a8d4', stroke: '#9d174d', sw: 1.3, tf: 'translate(122 54) scale(0.55)' },
      { t: 'circle', cx: -4.4, cy: 6.1, r: 5.4, fill: '#f9a8d4', stroke: '#9d174d', sw: 1.3, tf: 'translate(122 54) scale(0.55)' },
      { t: 'circle', cx: -7.1, cy: -2.3, r: 5.4, fill: '#f9a8d4', stroke: '#9d174d', sw: 1.3, tf: 'translate(122 54) scale(0.55)' },
      { t: 'circle', cx: 122, cy: 54, r: 1.65, fill: '#fde047' },
      { t: 'path', d: 'M97 15 C102 11, 109 13, 108 19 C103 20, 99 18, 97 15 Z', fill: '#fbcfe8', stroke: '#be185d', sw: 0.9 },
      { t: 'path', d: 'M16 78 C10 75, 9 69, 15 67 C18 71, 18 75, 16 78 Z', fill: '#f9a8d4', stroke: '#be185d', sw: 0.9 },
      { t: 'path', d: 'M52 123 C57 120, 63 123, 61 128 C56 129, 53 126, 52 123 Z', fill: '#fbcfe8', stroke: '#be185d', sw: 0.9 },
    ],
  },
  moon_eclipse: {
    grads: [
      { kind: 'lin', id: 'su', x1: 20, y1: 20, x2: 70, y2: 120, stops: [['0%', '#fef08a'], ['50%', '#f59e0b'], ['100%', '#ea580c']] },
      { kind: 'lin', id: 'mo', x1: 70, y1: 20, x2: 120, y2: 120, stops: [['0%', '#e0f2fe'], ['55%', '#60a5fa'], ['100%', '#4338ca']] },
    ],
    shapes: [
      { t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#1e1b4b', sw: 6.2 },
      { t: 'path', d: 'M70 20.4 A49.6 49.6 0 0 0 70 119.6', stroke: '@su', sw: 4.2 },
      { t: 'path', d: 'M70 20.4 A49.6 49.6 0 0 1 70 119.6', stroke: '@mo', sw: 4.2 },
      { t: 'polygon', points: '0,-13 2.3,-6.5 8.8,-8.8 6.5,-2.3 13,0 6.5,2.3 8.8,8.8 2.3,6.5 0,13 -2.3,6.5 -8.8,8.8 -6.5,2.3 -13,0 -6.5,-2.3 -8.8,-8.8 -2.3,-6.5', fill: '#facc15', stroke: '#78350f', sw: 1, tf: 'translate(27 27)' },
      { t: 'circle', cx: 27, cy: 27, r: 5.5, fill: '#fef9c3', stroke: '#b45309', sw: 1.2 },
      { t: 'path', d: 'M111 98 A12 12 0 1 1 99 116 A9 9 0 1 0 111 98 Z', fill: '#e0f2fe', stroke: '#1e3a8a', sw: 1.3 },
      { t: 'path', d: 'M123 44 L124.6 48.4 L129 50 L124.6 51.6 L123 56 L121.4 51.6 L117 50 L121.4 48.4 Z', fill: '#bae6fd' },
      { t: 'circle', cx: 121, cy: 72, r: 2.2, fill: '#fef08a' },
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
  const maskId = `${prefix}hole`;
  const holeMask = `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="-10" y="-10" width="160" height="160"><rect x="-10" y="-10" width="160" height="160" fill="#ffffff"/><circle cx="70" cy="70" r="${AVATAR_FRAME_MASK_R}" fill="#000000"/></mask>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140" width="280" height="280" fill="none"><defs>${defs}${holeMask}</defs><g mask="url(#${maskId})">${els}</g></svg>`;
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

export interface LobbyRoomProfileRef {
  roomId?: string | null;
  hostUid?: string | null;
  hostName?: string | null;
  seats?: ReadonlyArray<{ uid?: string | null; name?: string | null } | null> | null;
}

/** 線上大廳等待中房間房主名片目標：僅憑實際 hostUid 查詢，缺 UID 時不以座位或名稱猜測。 */
export function buildLobbyHostProfileTarget(room: LobbyRoomProfileRef | null | undefined): ProfileLookupTarget | null {
  const rc = String(room?.roomId ?? '').trim();
  const uid = String(room?.hostUid ?? '').trim();
  if (!rc || !uid) return null;
  const fb = String(room?.hostName ?? '').trim();
  return { roomCode: rc, targetUid: uid, ...(fb ? { fallbackNick: fb } : {}) };
}

/** 線上大廳對戰中房間座位名片目標：以被點擊當下該席的 targetUid 為準，絕不附帶 seatIdx 避免換人時開到別人。 */
export function buildLobbySeatProfileTarget(room: LobbyRoomProfileRef | null | undefined, seatIdx: 0 | 1): ProfileLookupTarget | null {
  const rc = String(room?.roomId ?? '').trim();
  const seat = room?.seats?.[seatIdx];
  const uid = String(seat?.uid ?? '').trim();
  if (!rc || !uid) return null;
  const fb = String(seat?.name ?? '').trim();
  return { roomCode: rc, targetUid: uid, ...(fb ? { fallbackNick: fb } : {}) };
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
