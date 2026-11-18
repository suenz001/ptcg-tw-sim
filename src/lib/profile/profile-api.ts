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
  | 'flame_flare'
  | 'emerald_leaf'
  | 'cyber_neon';

export interface AvatarFrameSpec {
  id: AvatarFrameId;
  name: string;
  badge: string;
  stops: readonly [string, string, string, string];
  glow: string;
  innerBorder: string;
}

/**
 * 可隨時擴充的特殊頭像外框圖鑑表（目前僅限 Admin 後台指派，玩家端唯讀展示）。
 */
export const AVATAR_FRAMES: readonly AvatarFrameSpec[] = [
  { id: 'admin_gold', name: '👑 皇家輝金框', badge: '👑', stops: ['#fff3a8', '#ffd24c', '#c98a14', '#ffe885'], glow: 'rgba(255, 210, 76, 0.62)', innerBorder: '#473004' },
  { id: 'champion_master', name: '🏆 殿堂大師框', badge: '🏆', stops: ['#f5d77f', '#a66bff', '#5b2bc4', '#ffd86b'], glow: 'rgba(166, 107, 255, 0.58)', innerBorder: '#26114d' },
  { id: 'sponsor_diamond', name: '💎 星鑽極光框', badge: '💎', stops: ['#e8fbff', '#5ee7ff', '#3b9eff', '#bdf6ff'], glow: 'rgba(94, 231, 255, 0.58)', innerBorder: '#0a2f4d' },
  { id: 'flame_flare', name: '🔥 烈焰傳說框', badge: '🔥', stops: ['#ffe27a', '#ff7b29', '#d92626', '#ffae42'], glow: 'rgba(255, 104, 43, 0.58)', innerBorder: '#4a1008' },
  { id: 'emerald_leaf', name: '🌿 森林翡翠框', badge: '🌿', stops: ['#d9ffdf', '#44d67c', '#147a42', '#ffd978'], glow: 'rgba(68, 214, 124, 0.54)', innerBorder: '#0b331d' },
  { id: 'cyber_neon', name: '⚡ 雷霆電光框', badge: '⚡', stops: ['#fff066', '#00e5ff', '#2962ff', '#ffe54c'], glow: 'rgba(0, 229, 255, 0.56)', innerBorder: '#0a1e4a' },
] as const;

const AVATAR_FRAME_MAP = new Map<string, AvatarFrameSpec>(AVATAR_FRAMES.map((f) => [f.id, f]));

export function clampAvatarFrame(raw: unknown): AvatarFrameId | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return AVATAR_FRAME_MAP.has(id) ? (id as AvatarFrameId) : null;
}

export function getAvatarFrameSpec(raw: unknown): AvatarFrameSpec | null {
  const id = clampAvatarFrame(raw);
  return id ? (AVATAR_FRAME_MAP.get(id) ?? null) : null;
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

function defaultLoadCorsImage(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: HTMLImageElement | null) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => done(null), 6000);
    const img = new Image();
    img.crossOrigin = 'anonymous';
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
  const AV_CX = PAD_X + AV_R;
  const AV_CY = BANNER_H + 16;
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

  const headBottom = Math.max(AV_CY + AV_R + 12, BANNER_H + 114);
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
    pills.push({ text: `⚔️ 總勝 ${card.totalWins} 勝`, bg: 'rgba(11, 20, 15, 0.68)', border: 'rgba(130, 224, 166, 0.48)', fg: '#b8f5cb' });
  }
  if (card.showOfficialCrowns !== false && card.champOfficial > 0) {
    pills.push({ text: `🏛️ 網站賽 ${card.champOfficial} 冠`, bg: 'rgba(11, 20, 15, 0.68)', border: 'rgba(255, 211, 90, 0.45)', fg: '#ffe28a' });
  }
  if (card.showCommunityCrowns !== false && card.champCommunity > 0) {
    pills.push({ text: `🎖️ 社群賽 ${card.champCommunity} 冠`, bg: 'rgba(11, 20, 15, 0.68)', border: 'rgba(143, 220, 192, 0.45)', fg: '#9ae8cb' });
  }
  ctx.font = `bold 21px ${FONT}`;
  ctx.textBaseline = 'middle';
  let px = W - 26;
  const maxBadgeLeft = AV_CX + AV_R + 18;
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

  // 圓形頭像（與 AvatarCircle 一致幾何 + 可選特殊外框）
  const frameSpec = getAvatarFrameSpec(card.avatarFrame);
  const crop = clampAvatarCrop(card.avatar);
  const avImg = crop ? await resolveAvatarCanvasImg(crop.cardId, opts?.loadImage ?? defaultLoadCorsImage) : null;

  ctx.save();
  if (frameSpec) {
    ctx.shadowColor = frameSpec.glow;
    ctx.shadowBlur = 18;
    const fg = ctx.createLinearGradient(AV_CX - AV_R, AV_CY - AV_R, AV_CX + AV_R, AV_CY + AV_R);
    fg.addColorStop(0, frameSpec.stops[0]);
    fg.addColorStop(0.35, frameSpec.stops[1]);
    fg.addColorStop(0.7, frameSpec.stops[2]);
    fg.addColorStop(1, frameSpec.stops[3]);
    ctx.beginPath();
    ctx.arc(AV_CX, AV_CY, AV_R + 7, 0, Math.PI * 2);
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(AV_CX, AV_CY, AV_R + 1, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = frameSpec.innerBorder;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(AV_CX, AV_CY, AV_R + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#0f2419';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(106, 184, 122, 0.55)';
    ctx.stroke();
  }
  ctx.restore();

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
    const initial = (String(card.nick || '玩').trim()[0] || '玩').toUpperCase();
    ctx.fillStyle = '#e6f5ea';
    ctx.font = `bold 62px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, AV_CX, AV_CY + 2);
  }
  ctx.restore();

  if (frameSpec) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(AV_CX + AV_R * 0.72, AV_CY - AV_R * 0.72, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#101d15';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = frameSpec.stops[1];
    ctx.stroke();
    ctx.font = `18px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(frameSpec.badge, AV_CX + AV_R * 0.72, AV_CY - AV_R * 0.72 + 1);
    ctx.restore();
  }

  // 暱稱與認證標籤
  const idX = AV_CX + AV_R + 24;
  ctx.fillStyle = '#eef7f0';
  ctx.font = `bold 34px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(fitCanvasEllipsis(ctx, card.nick || '玩家', W - PAD_X - idX), idX, BANNER_H + 16);

  let badgeX = idX;
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
    badgeX += gw + 10;
  }
  if (frameSpec) {
    const fTxt = frameSpec.name;
    ctx.font = `bold 19px ${FONT}`;
    const fw = ctx.measureText(fTxt).width + 24;
    if (badgeX + fw <= W - PAD_X) {
      drawRoundedRectPath(ctx, badgeX, badgeY, fw, 34, 17);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = frameSpec.stops[1];
      ctx.stroke();
      ctx.fillStyle = '#f8f2d0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fTxt, badgeX + fw / 2, badgeY + 18);
    }
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
): Promise<{ ok: boolean; filename: string; error?: string }> {
  const safeNick = (card.nick || 'player').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) || 'player';
  const filename = `ptcg-名片-${safeNick}.png`;
  try {
    const canvas = await renderProfileCardToCanvas(card);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
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
