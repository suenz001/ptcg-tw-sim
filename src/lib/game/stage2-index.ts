/**
 * ⭐⭐⭐ v6.213 「這張卡是不是 2 階進化」的 **per-pool 索引**（純效能，行為零變更）。
 *
 * ── 為什麼要有這支 ──────────────────────────────────────────────────────────
 * 全站原本有 **7 份**「對整個卡池線性掃描」的 2 階判定（v6.213 第二輪審查逐檔掃出來的，
 * 不是憑印象寫的數字）：
 *   ・engine.ts `isStage2PokemonCard`
 *   ・draw_supporters.ts `isStage2PokemonCardLocal`（鳴依的勉勵）
 *   ・v3001_g3_wave3.ts `isStage2`（海兔獸｜黏著束縛）
 *   ・effects.ts ×3：勾魂眼｜動怒爪 regPre、神奇糖果的 regG 與 reg
 *   ・v3070_deferred_wave_d.ts `oppHasStage2`（**判準與前六份不同**，見下）
 * 每一份都是「掃整個卡池，迴圈內每張卡再跑一次名稱比對」。
 * 卡池 4935 張 ⇒ 每呼叫一次就是 4935 次字串處理；而「海兔獸｜黏著束縛」的
 * 特性消除閘每個 action 平均會呼叫 1.42 次 ⇒ 實測佔 engine+AI 總時間 52.7%。
 *
 * ⚠ 這支**只換資料結構、不換判準**：
 *   ・`isStage2ByEvoVariant` 逐字等價於 `sameEvoName(c.name, card.evolvesFrom)` 版本
 *     （engine / draw_supporters / effects.ts 那四份）；
 *   ・`isStage2ByPlainEx`    逐字等價於 v3001 那份「只 strip 尾綴 ex + trim」的簡化版；
 *   ・`isStage2ByExactName`  逐字等價於 v3070 那份「名稱**逐字**相等、而且**不檢查 supertype**」。
 *   三者**刻意不合併**：它們的比對規則本來就各不相同（第一份還會 strip「超級」前綴，
 *   第三份連 supertype 都不看），合併就是行為變更，那不是這一版要做的事
 *   （要不要統一是站長的裁定，不是效能改動該做的事）。
 *   守衛 scripts/test-v6213-stage2-index-memo.mjs 對**全卡池每一張**做逐字差分。
 *
 * ── 快取鍵 ────────────────────────────────────────────────────────────────
 * ⚠⚠ pool **會換**：錦標賽 bundle 載全卡池、對戰頁只按牌組載子集（v6.118 起），
 *   同一個 process 內同時存在多份 pool 是常態。所以：
 *   ①快取掛在 **pool 物件本身**（WeakMap，key 就是那個 Map 實例）
 *     ⇒ 不同 pool 各有各的索引，**不可能互相污染**；pool 被回收時索引一起走。
 *   ②同一個 Map 實例**被塞進新卡**也要能自癒（ensurePoolForStateIds 就是這樣長大的）
 *     ⇒ 索引記下建立當下的 `pool.size`，對不上就整份重建。
 *   ⚠ size 相同但內容被就地替換（同一個 key 換成另一張卡）偵測不到 —— 但全站
 *     沒有任何一處會這樣做（pool 只會 `set` 新 id），且原本的線性掃描版本
 *     在同一次 action 內也不會重讀，語義風險為零。
 *
 * ⚠ 本檔是 **leaf**：除了 `import type` 之外不 import 任何模組
 *   ⇒ 不可能參與循環 import（v6.078 的教訓：循環 import 下模組層級 const 會 TDZ）。
 */
import type { Card } from '$lib/cards/types';

/**
 * 「同進化階變體」的名稱正規化 —— `sameEvoName()` 內原本那支 local `normalize` 的
 * **唯一來源**（v5.307 站長規則：超級XXXex / XXXex / XXX 視為同一階）。
 * ⚠ strip 順序固定：先尾綴 `ex`，再前綴「超級」。改順序會改變判定結果。
 */
export function normalizeEvoVariantName(s: string): string {
  let r = s;
  if (r.endsWith('ex')) r = r.slice(0, -2);
  if (r.startsWith('超級')) r = r.slice(2);
  return r;
}

/**
 * v3001_g3_wave3.ts 那份「簡化版 sameEvoName」的正規化：只 strip 尾綴 `ex` 再 trim。
 * ⚠ 與 `normalizeEvoVariantName` **不同**（沒有「超級」前綴那一段），這是原碼就有的差異，
 *   本版刻意保留 —— 見檔頭說明。
 */
export function normalizePlainExName(s: string): string {
  return s.replace(/ex$/, '').trim();
}

interface Stage2Index {
  /** 建立索引時的 pool.size；對不上就重建（pool 被塞進新卡的自癒） */
  size: number;
  /** `normalizeEvoVariantName(c.name)`，僅收「supertype==='Pokemon' 且有 evolvesFrom 且 name 非空」者 */
  evoVariant: Set<string>;
  /** `normalizePlainExName(c.name ?? '')`，收錄條件同上但**不排除空字串 name**（逐字對齊 v3001 原碼） */
  plainEx: Set<string>;
  /**
   * `c.name`（**完全不正規化**），收錄條件是「有 `evolvesFrom` 且 name 非空」——
   * ⚠ **刻意不檢查 `supertype`**：逐字對齊 v3070 `oppHasStage2` 的原碼
   *   （它只寫 `v.name === card.evolvesFrom && v.evolvesFrom`）。
   */
  exactName: Set<string>;
}

const POOL_INDEX = new WeakMap<Map<string, Card>, Stage2Index>();

/** 索引真的被重建了幾次（守衛用：證明記憶化不是 placebo）。 */
let _buildCount = 0;
export function __stage2IndexBuildCount(): number { return _buildCount; }

function getIndex(pool: Map<string, Card>): Stage2Index {
  const hit = POOL_INDEX.get(pool);
  if (hit && hit.size === pool.size) return hit;
  const evoVariant = new Set<string>();
  const plainEx = new Set<string>();
  const exactName = new Set<string>();
  for (const c of pool.values()) {
    // ⚠ exactName 的收錄條件**不含** supertype（逐字對齊 v3070 原碼），所以在 supertype
    //   那道 continue **之前**先收。
    if (c && c.evolvesFrom && c.name) exactName.add(c.name);
    if (!c || c.supertype !== 'Pokemon' || !c.evolvesFrom) continue;
    // ⚠ 逐字對齊兩份原碼的差異：
    //   engine 版走 sameEvoName(c.name, …)，而 sameEvoName 對 falsy 的 a 直接回 false
    //     ⇒ 空名字的卡**不該**被收進 evoVariant。
    //   v3001 版寫的是 (c.name ?? '')，空名字會參與比對 ⇒ plainEx **要**收進去。
    if (c.name) evoVariant.add(normalizeEvoVariantName(c.name));
    plainEx.add(normalizePlainExName(c.name ?? ''));
  }
  const idx: Stage2Index = { size: pool.size, evoVariant, plainEx, exactName };
  POOL_INDEX.set(pool, idx);
  _buildCount++;
  return idx;
}

/**
 * 2 階進化判定（`sameEvoName` 語義）—— engine.ts / draw_supporters.ts 用的那一版。
 * 規則：這張是寶可夢且有 `evolvesFrom`，而 `evolvesFrom` 指到的那張（同進化階變體比對）
 *       自己也是有 `evolvesFrom` 的寶可夢 ⇒ 進化鏈深度 3。
 */
export function isStage2ByEvoVariant(card: Card | undefined, pool: Map<string, Card>): boolean {
  if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
  return getIndex(pool).evoVariant.has(normalizeEvoVariantName(card.evolvesFrom));
}

/**
 * 2 階進化判定（v3001「簡化版」語義）—— 海兔獸｜黏著束縛的特性消除閘用。
 * ⚠ 與 `isStage2ByEvoVariant` 的差別只在正規化不含「超級」前綴，這是原碼既有差異。
 */
export function isStage2ByPlainEx(card: Card | undefined, pool: Map<string, Card>): boolean {
  if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
  return getIndex(pool).plainEx.has(normalizePlainExName(card.evolvesFrom));
}

/**
 * 「這張卡的 `evolvesFrom` 指到的那張卡，自己也有 `evolvesFrom`」—— **名稱逐字比對**，
 * 而且**不檢查對方的 supertype**。v3070 `oppHasStage2` 的回退判定用的就是這一種。
 * ⚠ 呼叫端自己負責 `card.evolvesFrom` 的存在檢查與 subtype 快速路徑（逐字對齊原碼的順序）。
 */
export function isStage2ByExactName(evolvesFrom: string | undefined, pool: Map<string, Card>): boolean {
  if (!evolvesFrom) return false;
  return getIndex(pool).exactName.has(evolvesFrom);
}
