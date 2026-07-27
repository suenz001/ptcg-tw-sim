/**
 * AI「打法表」（playbook）的載入與存取 —— 批次 4a Foundation。
 *
 * 【這是什麼】
 * 本機對戰的 AI（`getAIAction`）是**同步**函式、而且 100% 跑在瀏覽器裡，
 * 所以它不可能在對戰中呼叫任何模型 API。可行的形式只有一種：
 *   離線分析錦標賽回放 → 產出靜態 JSON（static/ai-playbooks/*.json）
 *   → 對戰開始前先載進模組級變數 → getAIAction 同步讀它。
 * 也就是：**程式碼決定「哪些決策點可調」，JSON 決定「怎麼調」。**
 *
 * 【這一批刻意零消費點】
 * 本模組建立起來後，`ai.ts` 還**不會**使用它 —— 行為與先前完全相同。
 * 這是本專案處理高風險改動的既有做法（見 P1-1 批1 的中央 selection-filter：
 * 先落地零 consumer 的求值器，再分批接線），好處是這一批的回歸風險為零、
 * 且「無表時決策不變」可以被獨立驗證，接線出問題時能立刻分辨是哪一段的錯。
 *
 * 【fail-open 是硬規則】
 * 表載不到、JSON 壞掉、schemaVersion 不合 —— 一律當作「沒有表」，退回通用 AI。
 * 對戰**絕不可**因為一張策略表而掛掉；這張表是「錦上添花」，不是必要相依。
 */
import { base } from '$app/paths';
import { VERSION } from '$lib/version';

/** 目前支援的表結構版本。改格式時 +1，舊檔會被 fail-open 擋掉而不是被誤讀。 */
export const PLAYBOOK_SCHEMA_VERSION = 1;

/** 一條「卡片優先序」規則。why 是強制的 —— 見 test-ai-playbook-contract 的說明。 */
export interface PlaybookCardRule {
  card: string;
  score: number;
  why: string;
  critical?: boolean;
  criticalWhy?: string;
}

/** 暗黑底牌這類「複製招式」的選招優先序。 */
export interface PlaybookAttackRule {
  attack: string;
  from: string;
  damage?: number;
  score: number;
  why: string;
  preferWhen?: string;
  sideEffect?: string;
  sideEffectWhy?: string;
}

export interface Playbook {
  schemaVersion: number;
  archetypeKey: string;
  displayName?: string;
  detect?: { requireAll?: string[]; why?: string };
  setupActive?: { priority?: string[]; avoid?: string[]; why?: string; avoidWhy?: string };
  benchPriority?: PlaybookCardRule[];
  darkCardAttackPriority?: PlaybookAttackRule[];
  rotateAttackerWhenLocked?: { enabled?: boolean; why?: string };
  tradePolicy?: {
    useEveryAvailable?: boolean;
    stopWhenHandCountLte?: number;
    discardPriority?: { card: string; why: string }[];
    neverDiscard?: { card: string; why: string }[];
  };
  energyAttachPriority?: { target: string; untilCount: number; why: string }[];
  tempo?: { preferDevelopUntilTurn?: number };
}

// ── 模組級狀態 ────────────────────────────────────────────────────────────
//   getAIAction 是同步的，所以表必須「對戰開始前就備好」。
let _playbook: Playbook | null = null;
let _inflight: Promise<Playbook | null> | null = null;

/** 目前生效的打法表；沒有就回 null（呼叫端一律要能吃 null）。 */
export function getPlaybook(): Playbook | null {
  return _playbook;
}

/** 直接設定（測試與「離線／已預載」情境用）。傳 null 等同關閉。 */
export function setPlaybook(pb: Playbook | null): void {
  _playbook = isUsablePlaybook(pb) ? pb : null;
}

/** 清空（每局開始前呼叫，避免上一局的表殘留到不同牌組的對戰）。 */
export function clearPlaybook(): void {
  _playbook = null;
  _inflight = null;
}

/**
 * 結構檢查。**刻意寬鬆**：只擋「會讓消費端當掉或誤讀」的情況
 * （不是物件、版本不符、缺 archetypeKey），其餘欄位缺了就當作那個決策點沒有建議。
 * ⚠這裡不做「規則內容合不合理」的檢查 —— 那是離線守衛
 * （scripts/test-ai-playbook-contract.mjs，會逐字核對卡名與招式名）的職責。
 * 執行期做那種檢查既慢又沒有卡面資料可比對。
 */
export function isUsablePlaybook(pb: unknown): pb is Playbook {
  if (!pb || typeof pb !== 'object') return false;
  const p = pb as Partial<Playbook>;
  if (p.schemaVersion !== PLAYBOOK_SCHEMA_VERSION) return false;
  if (typeof p.archetypeKey !== 'string' || !p.archetypeKey) return false;
  return true;
}

/**
 * 這副牌是否適用此表：`detect.requireAll` 列的卡名必須**全部**出現在牌組裡。
 * ⚠比對用**卡名**不是 cardId —— 同名重印極多，用 cardId 每出一版新印刷就會靜默失準
 * （與 admin 牌組原型規則同一個判斷，Wilson 已拍板過）。
 */
export function playbookApplies(pb: Playbook | null, deckCardNames: Iterable<string>): boolean {
  if (!pb) return false;
  const need = pb.detect?.requireAll;
  if (!need || need.length === 0) return false;   // 沒有判定條件 → 不主動套用
  const have = deckCardNames instanceof Set ? deckCardNames : new Set(deckCardNames);
  return need.every((n) => have.has(n));
}

/**
 * 載入指定的打法表。**永不 throw**：任何失敗都回 null 並讓 AI 退回通用邏輯。
 * @param key      檔名（不含 .json），例：'n-zoroark-ex'
 * @param fetchFn  可注入，測試用
 */
export async function loadPlaybook(
  key: string,
  fetchFn: typeof fetch = fetch,
): Promise<Playbook | null> {
  if (_playbook && _playbook.archetypeKey === key) return _playbook;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      // 帶版本參數繞過邊緣快取（與 pool.ts 的卡包載入同一套做法）
      const res = await fetchFn(`${base}/ai-playbooks/${key}.json?v=${VERSION}`);
      if (!res.ok) return null;
      const raw: unknown = await res.json();
      if (!isUsablePlaybook(raw)) return null;
      _playbook = raw;
      return raw;
    } catch {
      return null;   // ⚠fail-open：網路失敗／JSON 壞掉都只是「沒有表」，不是錯誤
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

// ── 查詢 helper（給 ai.ts 之後接線用；本批次尚無 consumer）──────────────
/** 備戰優先序分數；表裡沒列到的卡回 0（＝交給通用邏輯排）。 */
export function benchScoreOf(pb: Playbook | null, cardName: string): number {
  if (!pb?.benchPriority) return 0;
  for (const r of pb.benchPriority) if (r.card === cardName) return r.score;
  return 0;
}

/** 複製型招式的選招分數；沒列到回 0。 */
export function copyAttackScoreOf(pb: Playbook | null, fromCard: string, attackName: string): number {
  if (!pb?.darkCardAttackPriority) return 0;
  for (const r of pb.darkCardAttackPriority) {
    if (r.from === fromCard && r.attack === attackName) return r.score;
  }
  return 0;
}

/** 這張卡是否被標為「交易時絕不丟棄」。 */
export function isNeverDiscard(pb: Playbook | null, cardName: string): boolean {
  return !!pb?.tradePolicy?.neverDiscard?.some((r) => r.card === cardName);
}

/** 交易丟棄的偏好順序（數字越小越優先丟）；沒列到回 Infinity（＝最後才丟）。 */
export function discardRankOf(pb: Playbook | null, cardName: string): number {
  const list = pb?.tradePolicy?.discardPriority;
  if (!list) return Infinity;
  const i = list.findIndex((r) => r.card === cardName);
  return i < 0 ? Infinity : i;
}
