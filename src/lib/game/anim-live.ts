// ⭐v6.580 對戰動畫「只在當下播放」的唯一判準（站長 2026-10-17）
//
// 站長回報：觀戰進房時，「放置獎賞卡」「開局擲硬幣決定先後攻」的動畫會再播一次；
//   要求「務必確認動畫只會在當下播放，不會有殘留的問題」，取得獎賞、放獎賞、擲硬幣……全部 audit。
//
// 根因（v6.579 全面盤點）：對戰頁的動畫全部是「拿上一份盤面跟這一份比」—— 而「上一份」在頁面剛打開時是空的
//   ⇒ 第一次看到盤面（觀戰進房、重新整理、回到房間、從大廳切進來）就把整局當成「剛發生」：
//   手牌 7 張全部從牌庫飛出來、6 張獎賞卡重新發一次、棄牌區閃一下、洗牌抖一下、
//   玩家重新整理還會把 log 裡所有擲硬幣重播一遍；獎賞卡的發牌動畫更是只要元素一出現就播（切版面也會）。
//
// 判準（全部動畫共用這一份，Rule 38）：
//   ① 這個頁面「第一次看到某一局」＝基準點，只記下來、不播任何動畫；
//      唯一例外是「開局正在進行、而且我自己還沒動過」（openingLive）：玩家自己開局的那一刻，擲硬幣與發牌照常播。
//   ② openingLive 只給**玩家**（觀戰／回放永遠不播開局，沿用 v5.516 站長裁定），
//      而且同一局只播一次（記在 localStorage，重新整理不會再播）。
//   ③ 分頁在背景（看不到畫面）時收到的盤面一律當基準；回到前景後 2 秒內「從網路補進來」的盤面也當基準
//      ⇒ 回來時不會把離開期間的動作一口氣補播。自己剛做的動作（markLocal）不受這 2 秒影響（審查 P2-2）。
//   ④ 盤面清空（離開觀戰、回大廳）＝下一次看到任何一局都重新當成第一次（reset，審查 P1-1：同一頁離開再回到同一局）。
//   ⑤ 伺服器把盤面拉回較舊版本、悔棋回到舊盤面 ⇒ markBaseline：倒退不播「牌飛回手牌、回血數字」（審查 P3-1）。
//   回放：第一次看到＝基準（不播開局），之後逐步導覽照舊（傷害數字等；抽牌飛入仍由 v5.939 另外關掉）。
//
// ⚠ 這裡只決定「要不要播」，不碰盤面、同步、log；所有動畫的資料仍然只來自本來就看得到的盤面。

/** 我方是不是還停在開局、什麼都還沒做（放戰鬥寶可夢／按準備）—— 只有這時候開局動畫才算「當下」 */
export function isOpeningPristineFor(g: any, seat: number): boolean {
  if (!g || g.phase !== 'setup') return false;
  if (seat !== 0 && seat !== 1) return false;
  const me = g.players?.[seat];
  if (!me) return false;
  if (me.active) return false;
  if (Array.isArray(me.bench) && me.bench.length > 0) return false;
  const sd = g.setupDone;
  if (Array.isArray(sd) && sd[seat]) return false;
  return true;
}

/** 已經播過開局動畫的對局 id（localStorage；只留最近 30 局；讀寫失敗一律當沒播過也不記） */
export interface SeenStore { has(id: string): boolean; add(id: string): void }

export function makeLocalSeenStore(key = 'ptcg_anim_opening_seen_v1', max = 30): SeenStore {
  const read = (): string[] => {
    try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
    catch { return []; }
  };
  const mem = new Set<string>();   // localStorage 不能用時（無痕、被擋）至少這個分頁內不重播
  return {
    has(id) { return mem.has(id) || read().includes(id); },
    add(id) {
      mem.add(id);
      try { const a = read().filter((x) => x !== id); a.push(id); localStorage.setItem(key, JSON.stringify(a.slice(-max))); } catch { /* 存不了就算了 */ }
    },
  };
}

export interface AnimObserveInput {
  gameId: string;
  /** 這個頁面上一次看到的對局 id（還沒看過任何一局＝null） */
  lastGameId: string | null;
  isSpectatorOrReplay: boolean;
  /** 我方座位（觀戰傳 -1） */
  seat: number;
  pristineForMe: boolean;
  openingAlreadyShown: boolean;
  /** 分頁是否在背景 */
  hidden: boolean;
  /** 回到前景後的安靜期是否還沒過 */
  inQuietWindow: boolean;
}

export interface AnimObserveResult {
  /** 這一份盤面當基準：記下來、不播動畫 */
  baseline: boolean;
  /** 開局動畫（擲硬幣 overlay、發手牌）要播 */
  openingLive: boolean;
}

/** 唯一判準：某一份盤面要不要播動畫（所有動畫 $effect 都問這一支） */
export function decideAnimObservation(i: AnimObserveInput): AnimObserveResult {
  if (i.hidden || i.inQuietWindow) return { baseline: true, openingLive: false };
  const firstSight = i.gameId !== i.lastGameId;
  if (!firstSight) return { baseline: false, openingLive: false };
  const openingLive = !i.isSpectatorOrReplay && (i.seat === 0 || i.seat === 1) && i.pristineForMe && !i.openingAlreadyShown;
  return { baseline: !openingLive, openingLive };
}

/** 每個對戰頁一份的觀察器（帶狀態：上一局 id、回前景時間、每份盤面的判定結果）。 */
export interface AnimObserverCtx { isSpectatorOrReplay: boolean; seat: number }
export interface AnimObserver {
  observe(g: any, ctx: AnimObserverCtx): AnimObserveResult;
  /** 盤面清空（離開觀戰、回大廳、離開房間）⇒ 下一次看到任何一局都當第一次 */
  reset(): void;
  /** 分頁回到前景 */
  onVisible(): void;
  /** 這份盤面是我自己剛做的動作（本機算出來的）⇒ 不受回前景安靜期影響 */
  markLocal(g: any): void;
  /** 這份盤面一律當基準（伺服器拉回較舊盤面、悔棋）*/
  markBaseline(g: any): void;
}
export function createAnimObserver(deps: { seen: SeenStore; now: () => number; isHidden: () => boolean; quietMs?: number }): AnimObserver {
  const quietMs = deps.quietMs ?? 2000;
  let lastGid: string | null = null;
  let visibleAt = -Infinity;
  let memo = new WeakMap<object, AnimObserveResult>();
  const local = new WeakSet<object>();
  const BASE: AnimObserveResult = { baseline: true, openingLive: false };
  return {
    observe(g, ctx) {
      if (!g || typeof g !== 'object') return BASE;
      const hit = memo.get(g);
      if (hit) return hit;
      const gid = String(g.id ?? '');
      const firstSight = gid !== lastGid;
      const seat = ctx.isSpectatorOrReplay ? -1 : ctx.seat;
      const r = decideAnimObservation({
        gameId: gid, lastGameId: lastGid, isSpectatorOrReplay: ctx.isSpectatorOrReplay, seat,
        pristineForMe: isOpeningPristineFor(g, seat),
        openingAlreadyShown: firstSight ? deps.seen.has(gid) : true,   // 只有第一次看到時才讀 localStorage（審查 P3-2）
        hidden: deps.isHidden(),
        inQuietWindow: !local.has(g) && deps.now() - visibleAt < quietMs,
      });
      lastGid = gid;
      if (r.openingLive) deps.seen.add(gid);
      memo.set(g, r);
      return r;
    },
    reset() { lastGid = null; memo = new WeakMap(); },
    onVisible() { visibleAt = deps.now(); },
    markLocal(g) { if (g && typeof g === 'object') local.add(g); },
    markBaseline(g) { if (g && typeof g === 'object') memo.set(g, BASE); },
  };
}
