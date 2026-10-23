// ⭐v6.583 牌組公布欄附加「一般對戰復盤」的淨化規則（唯一一份，Rule 38）。
//
// 伺服器（server v1.70）透過引擎 bundle（scripts/build-server-engine.mjs 匯出）逐格呼叫這裡；前端不做第二份。
// 站長裁定：對手名字一律改成「對手」；vs AI／本機雙人不開放。
//
// 審查（Opus 5.5）要求的三件事都在這裡：
//   ① 不相信檔案自報的 meta.revealed：每一格與終局盤面都**重新遮一次**（沿用 replay-record.ts 的 redactStateForSeat ——
//      對手手牌、對手未翻開的獎賞卡、雙方牌庫換成卡背＋不透明 iid，清掉待選視窗與牌庫頂已知順序），
//      對戰紀錄拿掉對手的私有訊息（redactReplayForSeat 同一規則）。
//   ② 對手名字取「所有格子＋終局＋meta」裡對手那一側出現過的名字聯集（不能只信終局那一格）。
//   ③ 訊息裡只替換「名字前後是邊界」的地方（行首／行尾／空白／標點），避免名字是「寶可夢」「ex」「能量」這種常見字時
//      把卡名、說明一起換掉。與投稿者自己同名時不替換那個名字（分不出是誰）。
//   伺服器要能分段處理（每處理幾格就讓出事件迴圈），所以拆成逐格的函式，不是一支大函式。

import { HIDDEN_CARD_ID, REPLAY_FORMAT, REPLAY_FORMAT_VERSION, redactStateForSeat, validateReplayData, type ReplayData } from '$lib/game/replay-record';
import type { GameState } from '$lib/game/types';

export const SHARE_OPP_NAME = '對手';

/** 檔頭檢查：回傳記錄者座位，或錯誤訊息 */
export function shareReplayHeader(obj: unknown): { seat: 0 | 1 } | { error: string } {
  const why = validateReplayData(obj);
  if (why) return { error: why };
  const d = obj as ReplayData;
  if (d.format !== REPLAY_FORMAT || !(d.v >= 1 && d.v <= REPLAY_FORMAT_VERSION)) return { error: '這不是本站的復盤檔（或版本不支援）' };
  const m = d.meta || ({} as ReplayData['meta']);
  if (m.kind === 'tournament') return { error: '錦標賽的復盤檔不能用上傳檔案的方式附加（只開放線上休閒對戰的復盤）' };   // ⭐v6.595 審查 P3-7
  if (m.kind !== 'online') return { error: '只開放附加線上對戰的復盤（vs AI 與本機雙人不開放）' };
  if (m.viewerSeat !== 0 && m.viewerSeat !== 1) return { error: '復盤檔缺少記錄者座位' };
  if (!d.finalState || typeof d.finalState !== 'object' || !Array.isArray((d.finalState as GameState).players)) return { error: '復盤檔內容不完整' };
  return { seat: m.viewerSeat };
}

/** 對手那一側出現過的所有名字（扣掉與投稿者同名的） */
export function shareOpponentNames(d: ReplayData, seat: 0 | 1): string[] {
  const opp = 1 - seat;
  const mine = new Set<string>(), theirs = new Set<string>();
  const take = (st: GameState | null | undefined) => {
    const ps = (st as GameState | null)?.players;
    if (!Array.isArray(ps)) return;
    const a = ps[seat]?.name, b = ps[opp]?.name;
    if (typeof a === 'string' && a) mine.add(a);
    if (typeof b === 'string' && b) theirs.add(b);
  };
  for (const s of d.snapshots) take(s.state);
  take(d.finalState);
  const mm = d.meta as unknown as Record<string, unknown>;
  const mn = mm[seat === 0 ? 'p1name' : 'p2name'], on = mm[opp === 0 ? 'p1name' : 'p2name'];
  if (typeof mn === 'string' && mn) mine.add(mn);
  if (typeof on === 'string' && on) theirs.add(on);
  return [...theirs].filter((n) => !mine.has(n) && n !== SHARE_OPP_NAME).sort((x, y) => y.length - x.length);
}

// ⚠ 不把【】「」『』〈〉《》當邊界：卡名寫法是「基本【超】能量」「【ex】」，對手名字若是「能量」「ex」會把卡名換掉（審查 P3-1 實例）。
//   引擎的 log 裡玩家名字前後是行首／行尾／空白／一般標點。
const BOUNDARY = /[\s　,，.。:：;；!！?？、()（）"'“”‘’\-—~～/|·・…]/;
function isBoundary(ch: string | undefined): boolean { return ch === undefined || ch === '' || BOUNDARY.test(ch); }

/** 只替換前後是邊界的名字（長的名字先換） */
export function replaceNameInText(text: string, names: readonly string[]): string {
  if (typeof text !== 'string' || !text || !names.length) return text;
  let out = text;
  for (const name of names) {
    if (!name) continue;
    let i = 0, res = '';
    while (true) {
      const j = out.indexOf(name, i);
      if (j < 0) { res += out.slice(i); break; }
      const before = j > 0 ? out[j - 1] : undefined, after = out[j + name.length];
      if (isBoundary(before) && isBoundary(after)) { res += out.slice(i, j) + SHARE_OPP_NAME; }
      else { res += out.slice(i, j + name.length); }
      i = j + name.length;
    }
    out = res;
  }
  return out;
}

/** 投稿牌組 → cardId 張數 */
export function shareDeckCounts(entries: ReadonlyArray<{ cardId?: unknown; count?: unknown }> | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries ?? []) {
    const cid = String(e?.cardId ?? ''); const n = Number(e?.count);
    if (!cid || !Number.isFinite(n) || n <= 0) continue;
    m.set(cid, (m.get(cid) ?? 0) + n);
  }
  return m;
}

type Inst = { cardId?: string; energyAttached?: Inst[]; toolAttached?: Inst; extraTools?: Inst[]; evolvedFromStack?: Inst[] } | null | undefined;
/** 某一側看得到的卡（卡背不算）的張數表 */
export function shareVisibleCounts(st: GameState, side: 0 | 1): Map<string, number> {
  const out = new Map<string, number>();
  const add = (c: Inst) => { if (c && c.cardId && c.cardId !== HIDDEN_CARD_ID) out.set(String(c.cardId), (out.get(String(c.cardId)) ?? 0) + 1); };
  const inst = (x: Inst) => {
    if (!x) return;
    add(x);
    for (const e of x.energyAttached ?? []) add(e);
    add(x.toolAttached);
    for (const t of x.extraTools ?? []) add(t);
    for (const s of x.evolvedFromStack ?? []) add(s);
  };
  const p = (st?.players as unknown as Array<Record<string, unknown>> | undefined)?.[side];
  if (!p) return out;
  for (const z of ['hand', 'discard', 'lostZone', 'prizes', 'deck']) for (const c of (Array.isArray(p[z]) ? p[z] as Inst[] : [])) add(c);
  inst(p.active as Inst);
  for (const b of (Array.isArray(p.bench) ? p.bench as Inst[] : [])) inst(b);
  const g = st as unknown as { activeStadium?: Inst; activeStadiumPartner?: Inst; activeStadiumOwnerIdx?: number };
  if (g.activeStadium && g.activeStadiumOwnerIdx === side) { add(g.activeStadium); add(g.activeStadiumPartner); }
  return out;
}

/** 一格：重新遮蔽 → 換對手名字 → 檢查投稿者那一側看得到的卡都在牌組裡。回傳新盤面與看得到幾種卡。 */
export function shareSanitizeState(state: GameState, seat: 0 | 1, oppNames: readonly string[], deck: Map<string, number>): { state: GameState; kinds: number } | { error: string } {
  if (!state || typeof state !== 'object' || !Array.isArray(state.players) || state.players.length < 2) return { error: '復盤檔內容損毀' };
  const st = redactStateForSeat(state, seat) as GameState & Record<string, unknown>;
  const opp = 1 - seat;
  const p = st.players[opp] as unknown as Record<string, unknown>;
  if (p) p.name = SHARE_OPP_NAME;
  if (typeof st.winReason === 'string') st.winReason = replaceNameInText(st.winReason, oppNames);
  st.log = [] as unknown as GameState['log'];   // 快照的 log 本來就是空的（播放時從 finalLog 切）；不收外來內容
  for (const k of ['email', 'uid', 'chat', 'messages']) delete st[k];
  const vis = shareVisibleCounts(st, seat);
  for (const [cid, n] of vis) if ((deck.get(cid) ?? 0) < n) return { error: '這場復盤用的牌組跟這篇投稿的牌組不一樣' };
  return { state: st, kinds: vis.size };
}

/** 對戰紀錄：拿掉對手的私有訊息、換對手名字；只留已知欄位 */
export function shareSanitizeLog(log: unknown, seat: 0 | 1, oppNames: readonly string[]): GameState['log'] {
  const opp = 1 - seat;
  const out: Array<Record<string, unknown>> = [];
  for (const e of (Array.isArray(log) ? log : []) as Array<Record<string, unknown>>) {
    if (!e || typeof e !== 'object') continue;
    const x: Record<string, unknown> = { turn: e.turn, playerIndex: e.playerIndex, message: replaceNameInText(String(e.message ?? ''), oppNames) };
    if (e.timestamp != null) x.timestamp = e.timestamp;
    if (typeof e.sourceIid === 'string') x.sourceIid = e.sourceIid;
    if (e.playerIndex !== opp && typeof e.privateMessage === 'string') x.privateMessage = replaceNameInText(e.privateMessage, oppNames);
    out.push(x);
  }
  return out as unknown as GameState['log'];
}

/** meta：對手名字換成「對手」，其他欄位只留需要的 */
export function shareSanitizeMeta(d: ReplayData, seat: 0 | 1, oppNames: readonly string[]): ReplayData['meta'] {
  const m = d.meta as unknown as Record<string, unknown>;
  const opp = 1 - seat;
  const nm = (v: unknown) => (typeof v === 'string' ? v : null);
  const p1 = opp === 0 ? SHARE_OPP_NAME : nm(m.p1name), p2 = opp === 1 ? SHARE_OPP_NAME : nm(m.p2name);
  const w = nm(m.winnerName);
  return {
    kind: 'online', gameId: String(m.gameId ?? '').slice(0, 80), p1name: p1, p2name: p2,
    winnerName: w && oppNames.includes(w) ? SHARE_OPP_NAME : w,
    finalTurn: typeof m.finalTurn === 'number' ? m.finalTurn : null, savedAt: typeof m.savedAt === 'number' ? m.savedAt : 0,
    appVersion: String(m.appVersion ?? '').slice(0, 20), viewerSeat: seat, revealed: false,
  } as ReplayData['meta'];
}
