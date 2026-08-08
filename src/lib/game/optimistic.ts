/**
 * v6.137 錦標賽樂觀更新（PR-2 slice 1）— 本地預測的**唯一**判定入口。
 *
 * ## 為什麼需要
 * 錦標賽對戰的每一個動作都要等一次完整的 client→伺服器→client 往返才會更新畫面
 * （`dispatch()` 對 `isTournament` 直接走 `tournamentDispatch`，繞過本機/休閒那條
 *  「先 applyAction 立刻上畫」的路徑）。人一多、往返一長，體感就是「按下去沒反應」。
 *
 * ## 設計原則（Fable 5 審查後定案）
 * 1. **不枚舉「哪些 action 可以預測」，改成執行期試跑。** 逐卡維護清單必然漂移；
 *    改成本地先跑一次 `applyAction`，期間把 `Math.random` 換掉並計數，
 *    **碰到任何隨機就放棄預測**、退回現行行為（等伺服器）。
 *    ⇒ 擲幣招式、洗牌搜尋、混亂撤退、有灼傷/睡眠的回合結束…全部自動被擋，不必列表。
 * 2. **fail-closed**：任何 gate 判斷不出來就不預測。最壞情況＝跟現在完全一樣。
 * 3. **伺服器永遠是權威**：預測只是往返期間的橋接畫面，伺服器回來無條件覆蓋。
 *    ⚠ 呼叫端**絕不可**因為預測而遞增 `tVersion`（那是「伺服器確認過的版本」）。
 * 4. 第一批再加一層白名單（`OPTIMISTIC_ACTION_TYPES`），逐批放行、每批各自附 fixture 守衛。
 *
 * ## monkey-patch Math.random 的安全性
 * 本 repo 已有先例：`ai-eval.ts` 的 `withIsolatedRandom`（引擎試打評估）用同一招。
 * `applyAction` 是同步純函式、JS 單執行緒 ⇒ patch 視窗內不會有別的消費者。
 * 一律 try/finally 還原。
 * ⚠ 前提：引擎的隨機來源必須都是直接呼叫 `Math.random()`，不能有 `const r = Math.random` 別名綁定
 *   （別名會繞過計數器 → 靜默漏抓）。這條由 anti-pattern-lint 與守衛盯著。
 */
import type { GameState, CardInstance } from './types';
import type { Card } from '$lib/cards/types';
import { applyAction } from './engine';

/** 第一批只放 ATTACH_ENERGY：高頻、零隨機、零 pendingSelection、無連鎖、就算回滾也只是一張能量。 */
export const OPTIMISTIC_ACTION_TYPES: ReadonlySet<string> = new Set(['ATTACH_ENERGY']);

export type PredictResult =
  | { ok: true; predicted: GameState }
  | { ok: false; reason: string };

/** 蒐集盤面上所有 instance 的 iid（含場上/手牌/牌庫/棄牌/獎賞與附加物），用於「iid 集合不得改變」gate。 */
function collectIids(s: GameState): Set<string> {
  const out = new Set<string>();
  const addInst = (c: CardInstance | null | undefined): void => {
    if (!c) return;
    out.add(c.iid);
    for (const e of c.energyAttached ?? []) out.add(e.iid);
    if (c.toolAttached) out.add(c.toolAttached.iid);
    for (const t of c.extraTools ?? []) out.add(t.iid);
    for (const v of c.evolvedFromStack ?? []) out.add(v.iid);
  };
  for (const p of s.players ?? []) {
    addInst(p.active);
    for (const b of p.bench ?? []) addInst(b);
    for (const z of [p.hand, p.deck, p.discard, p.prizes]) for (const c of z ?? []) addInst(c);
  }
  if (s.activeStadium) out.add(s.activeStadium.iid);
  return out;
}

const sameSet = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
};

/**
 * 嘗試本地預測一個動作的結果。回 `{ ok:false }` 就照現行流程走（等伺服器）。
 *
 * @param base   目前**伺服器確認過**的盤面
 * @param action 要送出的 action（與送給伺服器的同一個物件）
 * @param pool   卡池
 */
export function tryPredictAction(
  base: GameState | null | undefined,
  action: { type?: string } | null | undefined,
  pool: Map<string, Card>,
  opts?: { allowedTypes?: ReadonlySet<string> },
): PredictResult {
  const allowed = opts?.allowedTypes ?? OPTIMISTIC_ACTION_TYPES;
  if (!base || !action || typeof action.type !== 'string') return { ok: false, reason: 'no-state-or-action' };

  // gate ①（白名單）：逐批放行，每批各自附 fixture 守衛
  if (!allowed.has(action.type)) return { ok: false, reason: 'not-whitelisted:' + action.type };

  // gate ②（階段）：setup 是 CAS 衝突與歷史事故最密集的區段；game-over 一律等伺服器裁定
  if (base.phase !== 'playing') return { ok: false, reason: 'phase:' + String(base.phase) };
  if (base.pendingSelection) return { ok: false, reason: 'pending-open' };

  const beforeIids = collectIids(base);

  // gate ③（引擎 throw）＋ gate ④（碰到任何隨機）
  let rng = 0;
  let predicted: GameState;
  const orig = Math.random;
  try {
    Math.random = () => { rng++; return orig(); };
    predicted = applyAction(base, action as never, pool);
  } catch {
    return { ok: false, reason: 'engine-threw' };   // 例：pool 尚未載入對手卡包
  } finally {
    Math.random = orig;   // ⚠ 一定要還原，否則整場對局的隨機源被換掉且極難聯想
  }
  if (rng > 0) return { ok: false, reason: 'randomness:' + rng };

  // gate ⑤：引擎拒絕（回傳同一個 state 物件）→ 不預測，但呼叫端仍會照送（伺服器權威裁定）
  if (predicted === base) return { ok: false, reason: 'engine-rejected' };

  // gate ⑥：改變階段（進 game-over）一律等伺服器
  if (predicted.phase !== base.phase) return { ok: false, reason: 'phase-changed' };

  // gate ⑦：開/換 pendingSelection 的不預測（picker 被回滾抽走會很難處理）
  if (predicted.pendingSelection) return { ok: false, reason: 'opens-pending' };

  // gate ⑧：**不得換手**。
  //   ⚠ ATTACH_ENERGY 看似單純，但 engine.ts 的 handler 內部有一條「引夢貘人｜白日夢」路徑：
  //   目標身上有 `endTurnOnOppAttachEnergyThisTurn` 時會**直接呼叫 applyAction(END_TURN)**。
  //   若當下 checkup 沒有任何要擲幣的狀態，整條是確定性的 ⇒ rng gate 放行 ⇒
  //   「第一批只放 ATTACH_ENERGY」會實際預測出「換手＋checkup＋對手抽牌」。
  //   同構於伺服器所以不是正確性 bug，但完全違背 slice 1「把爆炸半徑鎖在一張能量」的意圖。
  if (predicted.activePlayerIndex !== base.activePlayerIndex) return { ok: false, reason: 'turn-flipped' };

  // gate ⑨：**待取獎賞不得變動**。
  //   附能過程仍可能間接造成昏厥（例：對手侵蝕詛咒放指示物、白日夢路徑的 checkup 毒傷），
  //   那會動到 pendingPrizes ⇒ 牽涉獎賞與補位，一律讓伺服器裁定。
  {
    const pb = base.pendingPrizes ?? [];
    const pp = predicted.pendingPrizes ?? [];
    if (pb.length !== pp.length || pb.some((v, i) => v !== pp[i])) {
      return { ok: false, reason: 'pending-prizes-changed' };
    }
  }

  // gate ⑩：iid 集合不得改變。
  //   ⚠ 這條擋的是「引擎產了新 iid」（uid()）—— 本地產的 iid 與伺服器產的必然不同，
  //   之後若玩家用預測 iid 送 RESOLVE_SELECTION，會被伺服器 sanitize 清空 → 效果**靜默消失**
  //   （同 v6.129「validIids 死資料」的鏡像）。rng gate 通常已擋掉，但 uid 未必用 Math.random。
  if (!sameSet(beforeIids, collectIids(predicted))) return { ok: false, reason: 'iid-set-changed' };

  return { ok: true, predicted };
}
