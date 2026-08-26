/**
 * v6.233 「預估傷害」——**唯一**的計算入口（手機直式與桌機兩套 UI 共用這一份）。
 *
 * ## 為什麼是「乾跑」而不是「另外抽一份公式」
 * 傷害計算牽涉弱點／抵抗力／四十幾種加減傷來源／特性消除／道具／場地卡，
 * 而且整段是寫在 `engine.ts` 的 ATTACK handler **裡面**
 * （`composeFormula` 在 L5807，是那個 handler 內的區域閉包，不是可重用的函式）。
 * 再寫第二份必然與實戰漂移，而玩家會照著錯的數字下決定 —— **那比沒有預估更糟**。
 * ⇒ 本檔**不做任何傷害計算**：深複製盤面 → 用**真實的 `applyAction`** 打那一招 →
 *   讀引擎自己寫下的 `lastDealtDamage` 與傷害公式字串 → 丟掉那份盤面。
 *   零新計算邏輯 ⇒ 不可能漂移（因為它就是實戰用的那段程式碼）。
 *
 * ## 深複製是硬性要求
 * `handlePlaying`（engine.ts L3166）只做**淺複製**
 * （`const players = [...state.players]; const attacker = {...players[aIdx]};`）
 * ⇒ 內層的 `CardInstance` 是**共用參照**，任何就地修改都會污染真正的盤面。
 * 所以一律 `structuredClone`，並由守衛 `test-v6233-damage-estimate.mjs` 用深比對
 * 釘死「預估跑完後原本的 GameState 逐位元組不變」。
 *
 * ## 擲幣：不動實戰路徑
 * 全站擲幣都收斂在 `flipCoinsWithLog`，判定式是 `Math.random() < 0.5`。
 * 乾跑期間把 `Math.random` 換成一支**帶狀 PRNG**：heads 模式回 `[0, 0.5)`、
 * tails 模式回 `[0.5, 1)` ⇒ 等於「全正面 / 全反面」，**但仍是變動的亂數**
 * （若直接回固定值，`Math.random().toString(36).slice(2,10)` 會產生相同 iid、
 *  洗牌也會退化成常數）。`try/finally` 一定還原 —— 同 `ai-eval.ts`／`optimistic.ts`
 * 的既有先例；實戰路徑一行都沒動。
 *
 * ## 「擲硬幣直到出現反面」不可以給範圍
 * 全正面跑出來的是「連續 20~30 次正面」的理論值（實作端有上限保護），
 * 機率百萬分之一，顯示出來是誤導。
 * 偵測**不靠卡名清單、也不靠卡面 regex**，而是行為端：
 *   **全正面與全反面的擲幣次數不同 ⇒ 次數本身取決於擲幣結果 ⇒ 無上限**。
 * （卡面 `直到出現反面` 的 regex 只在守衛裡當交叉驗證，見 IRON_RULES Rule 25。）
 *
 * ## ⚠ 不得洩漏隱藏資訊
 * 預估在瀏覽器端跑、用的是玩家自己那一份 GameState —— 但那份盤面**含有玩家不該知道的
 * 東西**（雙方牌庫順序、獎賞卡、對手手牌）。若某一招的傷害取決於這些，把數字顯示出來
 * 就等於作弊（實例：呆呆王｜耀閃挑戰 的傷害取決於自己牌庫頂那一張）。
 * ⇒ 再跑一次「把隱藏區順序反轉」的乾跑，只要結果不同就一律降級成「依未知牌序而定」。
 */
import type { GameState } from './types';
import type { Card } from '$lib/cards/types';
import { applyAction } from './engine';

/** 傷害公式中的一項。label 一律沿用**引擎自己寫的字串**（例：`弱點` / `屬性相剋`），不另行翻譯。 */
export type EstimateTerm = { sign: string; value: number; label: string };

export type DamageEstimate =
  /** 這一招不造成傷害（純效果） ⇒ 不顯示 */
  | { kind: 'none' }
  /** 乾跑跑不出結論（引擎沒受理／深複製失敗） ⇒ 不顯示 */
  | { kind: 'unknown' }
  /** 會先跳選擇視窗，或取決於玩家看不到的牌序 ⇒ 顯示文字，**絕不顯示成 0** */
  | { kind: 'depends'; why: 'selection' | 'hidden' }
  | { kind: 'exact'; value: number; formula: string; terms: EstimateTerm[] }
  /** 有隨機成分：下界＝全反面實跑值、上界＝全正面實跑值。`coin` 代表這個隨機來自擲硬幣 */
  | { kind: 'range'; min: number; max: number; coin: boolean; formula: string; terms: EstimateTerm[] }
  /** 「擲硬幣直到出現反面」型：只有下界，上界無上限 */
  | { kind: 'open'; min: number; formula: string; terms: EstimateTerm[] };

type CoinMode = 'heads' | 'tails';

type RunOut =
  | { ok: false }
  | { ok: true; dmg: number; flips: number; pending: boolean; formula: string; terms: EstimateTerm[]; logAdded: number };

/**
 * ⚠⚠ 固定結果的**預算**。超過就改回相反的那一面。
 *
 * 為什麼一定要有：`怪顎龍｜亂暴` 的實作是 `while (true) { 擲1次; if (反面) break; }`
 * **沒有次數上限**（同族的 flipUntilTails / coinUntilTailsMultiplyPre 都有 20~30 的上限，
 * 只有它沒有）。真實對局靠 `Math.random` 收斂，但乾跑把硬幣**固定成全正面**時
 * 這個迴圈永遠不會結束 —— 瀏覽器分頁會直接卡死。
 * ⇒ 固定結果只維持前 `COIN_BUDGET` 次抽樣，之後翻面，保證任何迴圈都會終止。
 *
 * 256 的取法：合法的擲幣次數最多就是實作端的上限 30；Fisher-Yates 洗一副 60 張牌
 * 會吃掉 59 次抽樣 —— 256 足夠讓「洗好幾次牌 ＋ 擲滿上限」都還在預算內。
 */
const COIN_BUDGET = 256;

/**
 * 帶狀 PRNG（mulberry32 再映射到半區間）。
 * `heads` → `[0, 0.5)`（`Math.random() < 0.5` 恆為 true ＝ 正面）
 * `tails` → `[0.5, 1)`（恆為 false ＝ 反面）
 * 超過 `COIN_BUDGET` 次之後改吐相反那一面（見上方說明）。
 */
function bandedRandom(mode: CoinMode): () => number {
  let s = 0x9e3779b9 | 0;
  let used = 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0,1)
    const heads = mode === 'heads' ? used++ < COIN_BUDGET : used++ >= COIN_BUDGET;
    return heads ? u * 0.5 : 0.5 + u * 0.5;
  };
}

/**
 * 反轉「玩家不該知道內容／順序」的區域：雙方牌庫、雙方獎賞卡、**對手**手牌。
 * 自己的手牌與雙方場上是公開資訊，不動。
 * ⚠ 只動順序（不換卡），所以「牌庫裡還有幾張能量」這種**玩家推得出來**的資訊不會被誤判。
 */
function permuteHiddenZones(s: GameState, viewerIdx: 0 | 1): void {
  for (let i = 0; i < 2; i++) {
    const p = s.players?.[i];
    if (!p) continue;
    if (Array.isArray(p.deck)) p.deck.reverse();
    if (Array.isArray(p.prizes)) p.prizes.reverse();
    if (i !== viewerIdx && Array.isArray(p.hand)) p.hand.reverse();
  }
}

/** 從新增的 log 取出最後一段引擎寫的傷害公式（`【100(基礎) ×2(弱點) = 200】`）。 */
function pickFormula(messages: string[]): string {
  let out = '';
  for (const m of messages) {
    const hit = /【([^】]+)】/.exec(m);
    if (hit) out = hit[1];
  }
  return out;
}

/** 把公式字串拆成 term（純字串解析，不重算任何數字）。 */
export function parseFormulaTerms(formula: string): EstimateTerm[] {
  const out: EstimateTerm[] = [];
  const re = /([×+\-])\s*(\d+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    out.push({ sign: m[1], value: Number(m[2]), label: m[3] });
  }
  return out;
}

/** 跑一次乾跑。**唯一**會呼叫 applyAction 的地方。 */
function runOnce(
  base: GameState,
  attackIndex: number,
  pool: Map<string, Card>,
  mode: CoinMode,
  viewerIdx: 0 | 1,
  permuteHidden: boolean,
): RunOut {
  let work: GameState;
  try {
    // ⚠⚠ 深複製是硬性要求（見檔頭）。structuredClone 失敗就放棄預估，絕不退回淺複製。
    work = structuredClone(base);
  } catch {
    return { ok: false };
  }
  // `lastDealtDamage` 不是每次 ATTACK 開頭清的（engine.ts 只在造成傷害時寫入），
  // 殘留的上一招數值會被誤讀成這一招的傷害 ⇒ 在**丟棄用的複本**上先歸零。
  work.lastDealtDamage = 0;
  if (permuteHidden) permuteHiddenZones(work, viewerIdx);

  const beforeLogLen = (base.log ?? []).length;
  const orig = Math.random;
  let out: GameState;
  try {
    Math.random = bandedRandom(mode);
    out = applyAction(work, { type: 'ATTACK', attackIndex }, pool);
  } catch {
    return { ok: false };
  } finally {
    Math.random = orig; // ⚠ 一定要還原，否則整場對局的隨機源被換掉且極難聯想
  }

  const added = (out.log ?? []).slice(beforeLogLen).map(l => l?.message ?? '');
  const formula = pickFormula(added);
  return {
    ok: true,
    dmg: out.lastDealtDamage ?? 0,
    // flipCoinsWithLog 每擲一次就 append 一筆；ATTACK 開頭會清空 ⇒ 這就是「本招擲了幾次」。
    flips: (out._machineGunLastFlips ?? []).length,
    pending: !!out.pendingSelection,
    formula,
    terms: parseFormulaTerms(formula),
    logAdded: added.length,
  };
}

/**
 * 估一招的傷害。
 *
 * @param base        目前盤面（**不會被修改**）
 * @param attackIndex `getEffectiveAttacks()` 的 index（與送出的 ATTACK action 同一套）
 * @param pool        卡池
 * @param viewerIdx   看畫面的人（＝出招方）；決定哪一份手牌算「隱藏」
 */
export function estimateAttackDamage(
  base: GameState | null | undefined,
  attackIndex: number,
  pool: Map<string, Card>,
  viewerIdx: 0 | 1,
): DamageEstimate {
  if (!base || base.phase !== 'playing' || base.pendingSelection) return { kind: 'unknown' };
  if (!Number.isInteger(attackIndex) || attackIndex < 0) return { kind: 'unknown' };

  const t = runOnce(base, attackIndex, pool, 'tails', viewerIdx, false);
  const h = runOnce(base, attackIndex, pool, 'heads', viewerIdx, false);
  if (!t.ok || !h.ok) return { kind: 'unknown' };
  // 引擎完全沒受理這個 action（例：能量不足直接 return state）⇒ 不顯示，別假裝是 0
  if (t.logAdded === 0 && h.logAdded === 0) return { kind: 'unknown' };

  // ① 擲幣「次數」本身取決於擲幣結果 ⇒ 無上限（「擲硬幣直到出現反面」）。
  //    這一條必須排在最前面：這型的全正面值是連續 20~30 次正面的理論值，當成範圍上界會誤導。
  if (t.flips !== h.flips) {
    return { kind: 'open', min: Math.min(t.dmg, h.dmg), formula: '', terms: h.terms };
  }

  // ② 會跳選擇視窗、而且此刻還沒造成傷害 ⇒ 依選擇而定（**不可顯示成 0**）。
  //    ⚠ 先造成傷害、之後才開 picker 的招式（例：拉普拉斯ex｜水炮迴旋）傷害已經定案，
  //      那種要照常顯示數字，所以這裡要同時看 dmg === 0。
  if ((t.pending && t.dmg === 0) || (h.pending && h.dmg === 0)) return { kind: 'depends', why: 'selection' };

  // ③ 純效果、沒有傷害 ⇒ 不顯示
  if (t.dmg === 0 && h.dmg === 0) return { kind: 'none' };

  // ④ ⚠ 隱藏資訊防護：把隱藏區順序反轉再跑一次，結果變了就代表這個數字是「偷看」來的。
  const t2 = runOnce(base, attackIndex, pool, 'tails', viewerIdx, true);
  const h2 = runOnce(base, attackIndex, pool, 'heads', viewerIdx, true);
  if (!t2.ok || !h2.ok) return { kind: 'depends', why: 'hidden' };
  if (t2.dmg !== t.dmg || h2.dmg !== h.dmg || t2.flips !== t.flips || h2.flips !== h.flips) {
    return { kind: 'depends', why: 'hidden' };
  }

  if (t.dmg === h.dmg) return { kind: 'exact', value: t.dmg, formula: t.formula, terms: t.terms };
  return {
    kind: 'range',
    min: Math.min(t.dmg, h.dmg),
    max: Math.max(t.dmg, h.dmg),
    // 兩次乾跑唯一的差別就是硬幣被固定成全反面／全正面 ⇒ 有擲幣就是擲幣造成的差。
    // 沒擲幣卻有差 ⇒ 來自別的隨機來源（例：隨機丟手牌），文案改用「隨機」。
    coin: h.flips > 0,
    formula: '',
    terms: h.terms,
  };
}

/** 一次估完戰鬥寶可夢的所有招式（index 與 `getEffectiveAttacks()` 對齊）。 */
export function estimateAllAttacks(
  base: GameState | null | undefined,
  attackCount: number,
  pool: Map<string, Card>,
  viewerIdx: 0 | 1,
): DamageEstimate[] {
  const out: DamageEstimate[] = [];
  for (let i = 0; i < attackCount; i++) out.push(estimateAttackDamage(base, i, pool, viewerIdx));
  return out;
}

/** 這個預估要不要顯示。 */
export function hasEstimateToShow(e: DamageEstimate | null | undefined): boolean {
  return !!e && e.kind !== 'none' && e.kind !== 'unknown';
}

/**
 * 「為什麼」——把引擎公式裡的**修正項**（弱點／抵抗力／各種加減傷）轉成短標籤。
 * ⚠ label 一律照抄引擎寫的字，不另行翻譯，避免與對戰紀錄裡的用字分家。
 */
export function estimateReasonText(e: DamageEstimate | null | undefined): string {
  if (!e || !('terms' in e)) return '';
  const mods = e.terms.filter(t => t.sign === '×' || t.sign === '+' || t.sign === '-');
  if (mods.length === 0) return '';
  return mods.map(t => `${t.label} ${t.sign}${t.value}`).join('、');
}

/**
 * 一行式文案（手機直式的招式列、桌機 hover 卡片的標題都用這一支）。
 * ⚠ 文案一律用「預估」，不可寫成「實際傷害」——預估用的是玩家自己那份盤面，
 *   若傷害取決於玩家不知道的資訊就會不準（那種情況已被 ④ 降級成「依…而定」）。
 */
export function estimateShortText(e: DamageEstimate | null | undefined): string {
  if (!e) return '';
  switch (e.kind) {
    case 'exact': {
      const why = estimateReasonText(e);
      return why ? `預估 ${e.value}（${why}）` : `預估 ${e.value}`;
    }
    case 'range': {
      const why = estimateReasonText(e);
      const src = e.coin ? '擲幣' : '隨機';
      return why ? `預估 ${e.min}～${e.max}（${src}；${why}）` : `預估 ${e.min}～${e.max}（${src}）`;
    }
    case 'open':
      return `預估 ${e.min}+（擲到反面為止，無上限）`;
    case 'depends':
      return e.why === 'hidden' ? '預估：依未知的牌序而定' : '預估：依選擇而定';
    default:
      return '';
  }
}
