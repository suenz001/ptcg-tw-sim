// ⭐v6.583 牌組公布欄：投稿附加「這副牌的對戰紀錄」（站長 2026-10-17）。
//
// 伺服器 v1.70（伺服器補丁的 v170-deck-post-replays 區塊）是唯一的判準：
//   ・錦標賽回放：只存 matchId；附加時伺服器驗證「是自己打的、已結束、登記牌組與投稿完全相同」。
//   ・一般對戰復盤：上傳瀏覽器裡的復盤檔（gzip 原始位元組）；伺服器只收線上對戰、自己重新遮蔽（replay-share.ts）、
//     檢查看得到的卡都在投稿牌組裡，並把對手名字改成「對手」（站長裁定）。vs AI／本機雙人不開放。
//   ・移除：投稿者本人或 admin（軟刪）。
// 這支只做：網址組裝、回應正規化（舊伺服器沒有哨兵 dprApi ⇒ 整區不顯示）、本機復盤清單的預先篩選（伺服器還會再擋一次）。

export const DPR_API = '/api/deck-posts-replays';

/** 投稿 id／附件 id／matchId 的格式白名單（只拿來組網址；不合法一律當沒有） */
const ID_RE = /^[A-Za-z0-9_:.\-]{1,120}$/;
export function safeId(v: unknown): string | null {
  return typeof v === 'string' && ID_RE.test(v) ? v : null;
}

export type DprKind = 'tournament' | 'casual';
export interface DprItem {
  id: string;
  kind: DprKind;
  matchId: string | null;
  label: string;
  result: 'win' | 'lose' | 'draw';
  turns: number | null;
  createdAt: number;
  canRemove: boolean;
}
export interface DprList { items: DprItem[]; canAttach: boolean; isAdmin: boolean }
export interface DprCandidate {
  matchId: string;
  eventName: string;
  round: number | null;
  result: 'win' | 'lose' | 'draw';
  turns: number | null;
  at: number;
  sameDeck: boolean;
  attached: boolean;
}

function asResult(v: unknown): 'win' | 'lose' | 'draw' { return v === 'win' || v === 'lose' ? v : 'draw'; }
function asNum(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

/** 清單回應 → 正規化；沒有哨兵（舊伺服器）回 null ⇒ 畫面整區不顯示 */
export function parseDprList(j: unknown): DprList | null {
  const o = j as { dprApi?: unknown; items?: unknown; canAttach?: unknown; isAdmin?: unknown } | null;
  if (!o || o.dprApi !== 1) return null;
  const items: DprItem[] = [];
  for (const x of (Array.isArray(o.items) ? o.items : []) as Array<Record<string, unknown>>) {
    const id = safeId(x?.id);
    if (!id || (x.kind !== 'tournament' && x.kind !== 'casual')) continue;
    const matchId = x.kind === 'tournament' ? safeId(x.matchId) : null;
    if (x.kind === 'tournament' && !matchId) continue;
    items.push({ id, kind: x.kind, matchId, label: typeof x.label === 'string' ? x.label : '', result: asResult(x.result),
      turns: asNum(x.turns), createdAt: asNum(x.createdAt) ?? 0, canRemove: x.canRemove === true });
  }
  return { items, canAttach: o.canAttach === true, isAdmin: o.isAdmin === true };
}

export function parseDprCandidates(j: unknown): DprCandidate[] | null {
  const o = j as { dprApi?: unknown; matches?: unknown } | null;
  if (!o || o.dprApi !== 1) return null;
  const out: DprCandidate[] = [];
  for (const x of (Array.isArray(o.matches) ? o.matches : []) as Array<Record<string, unknown>>) {
    const matchId = safeId(x?.matchId);
    if (!matchId) continue;
    out.push({ matchId, eventName: typeof x.eventName === 'string' ? x.eventName : '', round: asNum(x.round), result: asResult(x.result),
      turns: asNum(x.turns), at: asNum(x.at) ?? 0, sameDeck: x.sameDeck === true, attached: x.attached === true });
  }
  return out;
}

/** 觀看網址：錦標賽走既有 ?treplay=；一般對戰走 ?dpreplay=。都帶 dpfrom＝投稿 id，離開回放時回到這篇投稿。 */
export function dprWatchUrl(base: string, item: Pick<DprItem, 'id' | 'kind' | 'matchId'>, postId: string): string | null {
  const pid = safeId(postId);
  const tail = pid ? '&dpfrom=' + encodeURIComponent(pid) : '';
  if (item.kind === 'tournament') { const m = safeId(item.matchId); return m ? `${base}/game?treplay=${encodeURIComponent(m)}${tail}` : null; }
  const id = safeId(item.id);
  return id ? `${base}/game?dpreplay=${encodeURIComponent(id)}${tail}` : null;
}

export function dprFileUrl(id: string): string | null {
  const s = safeId(id);
  return s ? `${DPR_API}/file?id=${encodeURIComponent(s)}` : null;
}

export function dprResultText(r: 'win' | 'lose' | 'draw'): string {
  return r === 'win' ? '勝' : r === 'lose' ? '敗' : '平手／雙敗';
}

/** 本機復盤清單的預先篩選（伺服器還會再擋一次）：只有線上對戰（vs AI／本機雙人不開放） */
export function isAttachableLocalReplay(meta: { kind?: unknown; viewerSeat?: unknown } | null | undefined): boolean {
  // 伺服器會重新遮蔽（不信檔案自報的旗標）⇒ 攤開版的線上復盤也可以附加，上傳後一樣看不到對手手牌
  return !!meta && meta.kind === 'online' && (meta.viewerSeat === 0 || meta.viewerSeat === 1);
}

/** 從回放頁的網址讀「從哪一篇投稿來的」（離開回放時回去） */
export function dpFromOfSearch(search: string): string | null {
  try { return safeId(new URLSearchParams(search).get('dpfrom')); } catch { return null; }
}
export function dpReplayIdOfSearch(search: string): string | null {
  try { return safeId(new URLSearchParams(search).get('dpreplay')); } catch { return null; }
}
