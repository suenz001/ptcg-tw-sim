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
import { loadIndex, loadSet, loadCardSetMap } from '$lib/cards/pool';

export const PROF_NICK_MAX = 16;
export const PROF_BIO_MAX = 100;
export const PROF_MAX_HONORS = 10;
export const PROF_CARD_HW = 1212 / 868;
export const PROF_DEFAULT_CROP = { x: 0.5, y: 0.34, zoom: 1.4 } as const;

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
  pinnedHonors: ProfileHonor[];
  canFriend: boolean;
  friendStatus: FriendRelationStatus;
}

export interface ProfileLiteSummary {
  profileKey: string;
  nick: string;
  avatar: AvatarCrop | null;
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
    },
  };
}

export async function saveMyProfile(
  ctx: ProfileAuthCtx,
  payload: { nick: string; bio: string; avatar: AvatarCrop | null; pinnedHonorIds: string[] },
) {
  const clean = {
    nick: clampProfileNick(payload.nick),
    bio: clampProfileBio(payload.bio),
    avatar: clampAvatarCrop(payload.avatar),
    pinnedHonorIds: [...new Set((payload.pinnedHonorIds || []).map(String).filter(Boolean))].slice(0, PROF_MAX_HONORS),
  };
  const res = await reqJson<{ playerProfileApi: number; ok: boolean; profile: PlayerProfileSelf & { pinnedHonors?: ProfileHonor[] } }>(
    '/api/player-profile/save',
    { method: 'POST', body: clean, ctx },
  );
  if (!res.ok) return res;
  return {
    ok: true as const,
    data: {
      ...res.data.profile,
      avatar: clampAvatarCrop(res.data.profile.avatar),
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
    out[k] = { ...v, avatar: clampAvatarCrop(v.avatar) };
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

export async function loadCardSetLookup(): Promise<Record<string, string>> {
  return loadCardSetMap();
}
