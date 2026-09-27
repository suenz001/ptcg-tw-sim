/**
 * AI 場面評估 —— 以「引擎試打」為唯一權威（v6.039）。
 *
 * 【為什麼不讓 AI 自己算傷害】
 * 一次攻擊的實際傷害牽涉：弱點×2、抵抗力、道具減傷（渾厚鱗片等）、被動特性、
 * 完全免疫、太晶、擲幣免傷、放置指示物 vs 造成傷害的區別……這些散落在 engine.ts
 * 與數百張卡效果裡。AI 若自己重算一份公式，就變成「同一條規則有兩份實作」——
 * 那正是本專案反覆踩過的坑（改了一邊忘了另一邊，且不會有任何錯誤訊息）。
 * 直接把盤面複製一份、用引擎真的打一次，看到的就是玩家會看到的結果。
 *
 * 【⚠隨機序列必須隔離】
 * applyAction 內部可能擲幣（Math.random）。若不隔離，AI 每「思考」一次就偷走一段
 * 真實對局的隨機序列 —— 表面上看不出來，但會讓固定種子的測試無法重現，也讓
 * 「AI 想得多寡」影響到牌堆與擲幣結果。模擬期間換上獨立 PRNG，結束**一定**還原。
 *
 * 【這不是上帝視角】
 * 只用公開資訊：雙方場上的寶可夢、附加的能量與道具、傷害指示物、競技場。
 * **不讀**任何一方的手牌與牌庫內容 —— 那是 v5.963／v6.021 一路守下來的界線，
 * 把它固化進 AI 等於植入作弊知識。
 */
import type { Card } from '$lib/cards/types';
import type { GameState, CardInstance, GameAction } from './types';
import { knownDeckTopIids, recordKnownDeckTop } from './deck-top-known';   // ⭐v6.429
import { applyAction, getAvailableAttacks, getEffectiveHP } from './engine';

/** 一次試打的結果。dealt 只在「沒擊倒」時有意義（擊倒時傷害多寡不重要）。 */
export interface AttackOutcome {
  /** 引擎有沒有接受這個動作（被拒代表這招當下不能用） */
  ok: boolean;
  /** 對手戰鬥位是否被擊倒 */
  ko: boolean;
  /** 對對手戰鬥位造成的傷害增量 */
  dealt: number;
  /** 打完後是否還停在待選擇（估值可信度較低） */
  unresolved: boolean;
}

const DEAD: AttackOutcome = { ok: false, ko: false, dealt: 0, unresolved: false };

/**
 * 模擬期間隔離 Math.random。
 * ⚠務必用 try/finally 還原 —— 中途 throw 而沒還原的話，整場對局的隨機來源就被
 *   換成這裡的固定 PRNG，症狀是「洗牌怪怪的」而幾乎不可能被聯想到 AI 評估。
 */
let _simSeed = 0x9e3779b9;
export function withIsolatedRandom<T>(fn: () => T): T {
  const orig = Math.random;
  let a = (_simSeed = (_simSeed + 0x6d2b79f5) >>> 0);
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

/** 深拷貝盤面。引擎多數 handler 是 immutable，但有就地改 shallow copy 的路徑，一律拷貝才安全。 */
export function cloneState(state: GameState): GameState {
  try {
    return typeof structuredClone === 'function'
      ? structuredClone(state)
      : (JSON.parse(JSON.stringify(state)) as GameState);
  } catch {
    return JSON.parse(JSON.stringify(state)) as GameState;
  }
}

/**
 * ⭐⭐**資訊紅線的中央防線**：模擬前把雙方牌庫洗亂。
 *
 * 現役有 111 個招式會抽牌或查看牌庫（「從自己的牌庫抽出N張」「查看自己的牌庫上方9張」…）。
 * 試打時引擎會**真的翻牌庫**，所以只要估值讀到任何受此影響的結果，AI 就等於偷看了
 * 自己牌庫的順序 —— 這是本站一路守下來的紅線（v5.963／v6.021），而且**不可見**：
 * 不會有錯誤訊息，只會讓 AI 在某些卡上莫名地強。
 *
 * 洗亂之後，模擬在資訊論上等價於一次合法的隨機採樣（牌庫順序本來就不可知），
 * 即使估值端日後寫錯、讀了依賴牌庫的欄位，也讀不到真實順序。
 * ⚠這是**中央**防線：所有模擬入口都必須經過它，不要在個別估值函式裡各自防。
 * ⚠洗亂只在複本上做，絕不碰真實對局的 state。
 */
export function shuffleHiddenZonesForSim(st: GameState, keepKnownFor?: 0 | 1): GameState {
  // ⭐v6.429 行動方**自己擺到牌庫頂、合法知道**的那幾張（暗碼迷的解讀／夜間學院）保留在原位，
  //   只打亂它們以下的部分；對手的牌庫一律整副打亂（AI 不可以知道對手擺了什麼）。
  //   驗證與「牌庫一被動過就作廢」都在 deck-top-known.ts。
  // ⭐v6.430（fable 審查 D）看不到的區域**合在一起**重新發牌，而不是只洗牌庫：
  //   - 對手的手牌：行動方看不到內容，只知道張數。舊版試打盤面裡對手手牌是真的 ⇒ 依對手手牌內容而定的招
  //     （粉碎脈衝、叼去藏、能量吸管…）試打結果等於偷看了對手手牌；批次 C 把「效果有沒有發生」納入出招決策後更明顯。
  //   - 蓋著的獎賞卡（雙方）：連自己都不知道是哪幾張。
  //   ⇒ 每一方「牌庫（已知牌庫頂以下）＋蓋著的獎賞卡＋（非行動方的）手牌」合成一疊洗亂，再依原張數發回原位置；
  //     正面朝上的獎賞卡與行動方自己的手牌不動。這在資訊上等價於一次合法的隨機採樣。
  //   ⚠ keepKnownFor 沒給（不知道行動方）時，雙方手牌都當成看不到。
  const keep = keepKnownFor === 0 || keepKnownFor === 1 ? knownDeckTopIids(st, keepKnownFor) : [];
  st.players.forEach((p, pi) => {
    const k = pi === keepKnownFor ? keep.length : 0;
    type Slot = { zone: 'deck' | 'hand' | 'prizes'; i: number };
    const slots: Slot[] = [];
    for (let i = k; i < p.deck.length; i++) slots.push({ zone: 'deck', i });
    p.prizes.forEach((c, i) => { if (!(c as { faceUp?: boolean }).faceUp) slots.push({ zone: 'prizes', i }); });
    if (pi !== keepKnownFor) p.hand.forEach((_c, i) => slots.push({ zone: 'hand', i }));
    const cards = slots.map((sl) => p[sl.zone][sl.i]);
    // Fisher-Yates；此處的 Math.random 已被 withIsolatedRandom 換成隔離 PRNG
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    // 正面朝上的獎賞卡不在 slots 裡，所以發來發去的都是蓋著的卡，不必處理 faceUp
    slots.forEach((sl, n) => { p[sl.zone][sl.i] = cards[n]; });
  });
  // 假想盤面的牌庫下半段已經打亂 ⇒ 重新記一次，巢狀試算（換人估值 → 試打）才看得到同一份已知牌庫頂
  return keep.length && (keepKnownFor === 0 || keepKnownFor === 1) ? recordKnownDeckTop(st, keepKnownFor, keep) : st;
}

// ── ⭐v6.429 試打時把「自己的選擇視窗」接著解完（批次 B1）────────────────────────
// 舊版：試打的招式一開選擇視窗（選對手 1 隻打、選要借的招…）就停在那裡 ⇒ unresolved ⇒ 退回印刷傷害估值，
//   傷害欄是空字串的招（吉雉雞ex｜殘酷箭、呆呆王｜耀閃挑戰借來的三重冰霜…）一律被估成 0 分。
// 新版：行動方自己的選擇視窗交給 AI 平常用的同一個選擇器（autoResolveSelection）解完，再讀盤面差。
//   ⚠ 選擇器由 ai.ts 在載入時註冊（這裡不能 import ai.ts：模組循環相依，見 estimateIfPromoted 的說明）。
//   ⚠ 只解行動方自己的視窗；對手要做的選擇一律不代答（維持 unresolved）。巢狀呼叫不再往下解（防遞迴）。
type SimSelectionResolver = (state: GameState, pool: Map<string, Card>) => GameAction | null;
let _simResolver: SimSelectionResolver | null = null;
let _simResolveDepth = 0;
/** ⭐v6.429 試打時附在 ATTACK 動作上的額外欄位（目前只有借招的選擇：呆呆王｜耀閃挑戰借哪一招）。 */
export type AttackActionExtra = { copyAttackChoice?: { pokeIid: string; attackIndex: number } };
export function setSimSelectionResolver(fn: SimSelectionResolver | null): void { _simResolver = fn; }
function resolveOwnPendingsInSim(st0: GameState, actorIdx: 0 | 1, pool: Map<string, Card>): GameState {
  if (!_simResolver || _simResolveDepth > 0) return st0;
  _simResolveDepth++;
  try {
    let st = st0;
    for (let i = 0; i < 8 && st.pendingSelection && st.pendingSelection.actorIdx === actorIdx && st.phase !== 'game-over'; i++) {
      const act = _simResolver(st, pool);
      if (!act || act.type !== 'RESOLVE_SELECTION') break;
      const nx = applyAction(st, act, pool);
      if (!nx || nx === st) break;
      st = nx;
    }
    return st;
  } catch {
    return st0;
  } finally {
    _simResolveDepth--;
  }
}

/**
 * 試打一招，回傳結果。**永不 throw**（估值失敗一律當作「不能用」，讓 AI 走原路徑）。
 */
export function simulateAttack(
  state: GameState,
  actorIdx: 0 | 1,
  attackIndex: number,
  pool: Map<string, Card>,
): AttackOutcome {
  try {
    const oppIdx = (1 - actorIdx) as 0 | 1;
    const before = state.players[oppIdx].active;
    if (!before) return DEAD;
    return withIsolatedRandom(() => {
      // ⚠⚠ 引擎的行動方一律讀 `state.activePlayerIndex`（handlePlaying 的第一行），
      //   action 物件裡**沒有**任何欄位可以指定 —— 所以呼叫端傳進來的 actorIdx
      //   必須落到假想盤面上，這個參數才名副其實（estimateIfPromoted 早就這樣做了）。
      //   目前兩個呼叫點傳的都等於盤面上的 activePlayerIndex，這一行是等價的；
      //   但少了它，日後有人想模擬「對手下回合能對我做什麼」就會靜默模擬錯人。
      const sim = shuffleHiddenZonesForSim(cloneState(state), actorIdx);
      sim.activePlayerIndex = actorIdx;
      const after0 = applyAction(sim, { type: 'ATTACK', attackIndex }, pool);
      if (!after0 || after0 === state) return DEAD;
      const after = resolveOwnPendingsInSim(after0, actorIdx, pool);
      const now = after.players[oppIdx].active;
      // 擊倒判定用 iid：被擊倒後戰鬥位會變空或換上別隻，兩種都算擊倒
      const ko = !now || now.iid !== before.iid;
      return {
        ok: true,
        ko,
        dealt: ko ? Infinity : Math.max(0, (now.damage ?? 0) - (before.damage ?? 0)),
        unresolved: !!after.pendingSelection,
      };
    });
  } catch {
    return DEAD;   // fail-open：評估掛掉不可以影響對戰
  }
}

/**
 * 這方目前所有可用招式裡，試打結果最好的一個。沒有可用招式回 null。
 *
 * ⭐v6.431（AI 對戰強化：撤退估值）改用 evaluateAttack（試打 3 次取平均）當量尺，與選招同一把尺：
 *   舊版用 simulateAttack **只試打一次**，擲幣招（雙重衝擊、偷襲…）的結果被單一次擲幣釘死——
 *   剛好反面就當成 0、剛好正面就當成全中，撤退換人的判斷跟著擲幣走。
 *   現在：ko ＝ 過半數試打會擊倒；dealt ＝ 對手全場傷害的平均（oppDamage，擊倒時為 Infinity）。
 *   ⚠ 取最佳的規則不變（先比擊倒、再比傷害），只換量尺。
 */
export function bestAttackOutcome(
  state: GameState,
  actorIdx: 0 | 1,
  pool: Map<string, Card>,
): { attackIndex: number; outcome: AttackOutcome } | null {
  let best: { attackIndex: number; outcome: AttackOutcome } | null = null;
  try {
    for (const idx of getAvailableAttacks(state, pool)) {
      const ev = evaluateAttack(state, actorIdx, idx, pool);
      if (!ev.ok) continue;
      const o: AttackOutcome = { ok: true, ko: ev.ko, dealt: ev.ko ? Infinity : ev.oppDamage, unresolved: ev.unresolved };
      if (!best || (o.ko && !best.outcome.ko) || (o.ko === best.outcome.ko && o.dealt > best.outcome.dealt)) {
        best = { attackIndex: idx, outcome: o };
      }
    }
  } catch {
    return null;
  }
  return best;
}

/**
 * 估「把備戰的這隻換到戰鬥位的話，它能打出什麼」。
 *
 * ⚠這是**估計**不是精確模擬：這裡直接把假想盤面的 active 換成候選，並沒有真的走一次
 *   RETREAT（真的走會丟掉撤退費能量、清狀態、設 movedToActiveThisTurn，而且多屬性能量
 *   還會開 picker —— 在這裡解 picker 需要回頭呼叫 ai.ts，會造成模組循環相依，
 *   那是 v5.985 module-init TDZ 事故的成因）。
 *   丟掉的是**原 active** 身上的能量，不影響候選自己的能量，所以用於「換誰上場比較好」
 *   的排序足夠準；不要拿它當「撤退後的精確盤面」用。
 */
export function estimateIfPromoted(
  state: GameState,
  myIdx: 0 | 1,
  candidate: CardInstance,
  pool: Map<string, Card>,
): AttackOutcome {
  try {
    const hypo = withIsolatedRandom(() => shuffleHiddenZonesForSim(cloneState(state), myIdx));
    const me = hypo.players[myIdx];
    const bIdx = me.bench.findIndex((b) => b.iid === candidate.iid);
    if (bIdx < 0) return DEAD;
    const old = me.active;
    me.active = me.bench[bIdx];
    me.bench = me.bench.filter((_, i) => i !== bIdx);
    if (old) me.bench.push(old);
    hypo.activePlayerIndex = myIdx;
    const best = bestAttackOutcome(hypo, myIdx, pool);
    return best ? best.outcome : DEAD;
  } catch {
    return DEAD;
  }
}

// ── 選招評估（批次 4d）─────────────────────────────────────────────────────
/**
 * 一次攻擊的完整評估。所有欄位都是**引擎試打後的盤面差**，不是我解讀卡面得來的：
 * 這一擊讓我拿到幾張獎賞、對手全場多受多少傷、我自己付出什麼代價。
 * 好處是不需要判斷「這張是不是 ex」（獎賞數 ex=2／Mega ex=3／一擊多殺全自動涵蓋），
 * 也不需要讀懂招式敘述裡的副作用文字。
 */
export interface AttackEval extends AttackOutcome {
  /** 這一擊讓我方新增幾張待取獎賞（pendingPrizes 差） */
  prizes: number;
  /** 對手全場（戰鬥位＋備戰）傷害增量 */
  oppDamage: number;
  /** 我方戰鬥位少了幾個能量（丟能量型招式的代價） */
  selfEnergyLost: number;
  /** 我方戰鬥位自身增加的傷害（反衝傷害） */
  selfDamage: number;
  /** 這一擊是否直接贏得對局 */
  gameWon: boolean;
  /** 綜合分數（越大越好） */
  score: number;
  /**
   * ⭐v6.430（批次 C）傷害與獎賞以外，盤面有變化的欄位（各次試打取聯集）。
   *   例：對手戰鬥寶可夢被附加狀態、下回合受傷減少、雙方手牌／牌庫／棄牌區變動、能量移動…
   *   空陣列＝這一擊除了傷害之外什麼都沒改變。判準見 attackBoardChangeKeys。
   */
  sideEffectKeys: string[];
  /** ⭐v6.430 試打過程有沒有用到亂數（擲硬幣、洗牌）。有的話 3 次試打的平均不能代表「一定打不動」。 */
  usedRandom: boolean;
}

const DEAD_EVAL: AttackEval = {
  ...DEAD, prizes: 0, oppDamage: 0, selfEnergyLost: 0, selfDamage: 0, gameWon: false, score: -Infinity,
  sideEffectKeys: [], usedRandom: false,
};

// ── ⭐v6.430（AI 對戰強化 批次 C）「打不動」判定 ─────────────────────────────────
/**
 * 每次攻擊都一定會變、本身不代表任何效果的欄位（引擎的招式簿記）。
 * ⚠ 每一條都要說得出「為什麼一定會變、為什麼不是效果」；判錯的後果是把有效果的招當成「打不動」而不出招。
 *   反方向（漏排除簿記欄位）的後果只是「照舊出招」＝ v6.429 的行為，所以有疑慮一律**不要**加進來。
 */
const BOARD_SKIP_TOP = new Set([
  'players',                   // 逐玩家／逐隻另外比
  'log',                       // 對戰紀錄
  'turnPhase',                 // 攻擊後一律進入回合結束階段
  'pendingSelection',          // 另由 unresolved 判斷
  'pendingPrizes',             // 另由 prizes 判斷
  'lastDealtDamage',           // 本次招式傷害的簿記（傷害另由 oppDamage 判斷）
  'attackDamageToDefActive',   // 同上
  'attackNamesUsedThisTurn',   // v6.428 遊戲層級招式紀錄（每次攻擊都寫）
  'coinFlippedThisAttack',     // 擲幣簿記（擲幣另由 usedRandom 判斷）
  '_koDefenderSnapshot',       // 擊倒結算用的暫存
  '_attackerActiveBonusDone',  // 攻擊方加成是否已結算的暫存
  '_pendingSeq',               // 選擇視窗的發號機（v6.175；開過視窗就會前進，視窗本身的效果另由其他欄位判斷）
  // ⚠ 刻意**不**排除 ancientAttackedIidsThisTurn：古代寶可夢「使出了招式」這件事下回合會被其他卡讀到（輪番狂攻），
  //   零傷害也可能有價值；attackNamesUsedThisTurn 則只會造成自己的冷卻（不出招只會更好），所以排除。
]);
/** 玩家物件：場上寶可夢逐隻另外比；currentTurnActions 是「對手回合面板」的顯示紀錄。 */
const BOARD_SKIP_PLAYER = new Set(['active', 'bench', 'currentTurnActions']);
/** 寶可夢實體：攻擊蓋章（每次攻擊都寫）。damage 不排除（對手的另由 oppDamage、自己的反衝也算一種盤面變化）。 */
const BOARD_SKIP_INST = new Set(['attackUsedThisTurn']);

/** 盤面指紋（只取判定需要的部分；key → 字串）。 */
function boardFingerprint(st: GameState): Map<string, string> {
  const m = new Map<string, string>();
  const put = (k: string, v: unknown) => m.set(k, JSON.stringify(v ?? null));
  for (const k of Object.keys(st)) if (!BOARD_SKIP_TOP.has(k)) put('state.' + k, (st as unknown as Record<string, unknown>)[k]);
  st.players.forEach((p, pi) => {
    const pr = p as unknown as Record<string, unknown>;
    for (const k of Object.keys(pr)) {
      if (BOARD_SKIP_PLAYER.has(k)) continue;
      const v = pr[k];
      // 區域（手牌／牌庫／棄牌區／獎賞卡…）只比 iid 序列：張數或順序變了都算
      if (Array.isArray(v)) put(`p${pi}.${k}`, v.map((c) => (c && typeof c === 'object' && 'iid' in c ? (c as { iid: string }).iid : c)));
      else put(`p${pi}.${k}`, v);
    }
    put(`p${pi}.activeIid`, p.active?.iid ?? null);
    put(`p${pi}.benchIids`, p.bench.map((c) => c.iid));
    for (const c of [p.active, ...p.bench]) {
      if (!c) continue;
      const cr = c as unknown as Record<string, unknown>;
      for (const k of Object.keys(cr)) if (!BOARD_SKIP_INST.has(k)) put(`p${pi}.${c.iid}.${k}`, cr[k]);
    }
  });
  return m;
}

/**
 * ⭐v6.430 試打前後，盤面在「傷害與獎賞」以外有變化的欄位（排序過的 key 清單）。
 *   實體欄位的 key 會把 iid 換成「戰鬥位／備戰」，方便統計與閱讀。
 */
export function attackBoardChangeKeys(before: GameState, after: GameState): string[] {
  const a = boardFingerprint(before), b = boardFingerprint(after);
  const out = new Set<string>();
  const label = (k: string, st: GameState) => {
    const m = /^p([01])\.([^.]+)\.(.+)$/.exec(k);
    if (!m) return k;
    const p = st.players[Number(m[1])];
    if (p.active?.iid === m[2]) return `p${m[1]}.戰鬥位.${m[3]}`;
    if (p.bench.some((c) => c.iid === m[2])) return `p${m[1]}.備戰.${m[3]}`;
    return k;
  };
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    // 欄位不存在與值為 undefined／null 視為相同（引擎在每次攻擊開頭會把暫存欄位重設成 undefined）
    if ((a.get(k) ?? 'null') !== (b.get(k) ?? 'null')) out.add(label(k, a.has(k) ? before : after));
  }
  return [...out].sort();
}

/**
 * ⭐v6.430（批次 C）這一招是不是「打不動」：引擎接受、沒有待選擇、沒擊倒、沒拿獎賞、對手全場零傷害、
 *   盤面沒有任何其他變化、試打過程也沒用到亂數。**全部**可用招式都是這樣時，AI 不出招（改走撤退換人／結束回合）。
 *   ⚠ 用平均值 oppDamage，不用 dealt（dealt 是最後一次試打的值）。
 *   ⚠ 用到亂數（擲幣／洗牌）一律不算打不動：3 次試打剛好全擲反面時平均也是 0，那不代表打不動。
 */
export function isPointlessAttack(ev: AttackEval | null | undefined): boolean {
  return !!ev && ev.ok && !ev.unresolved && !ev.ko && !ev.gameWon
    && ev.prizes === 0 && ev.oppDamage === 0
    && ev.sideEffectKeys.length === 0 && !ev.usedRandom;
}

/**
 * 這一擊對某方造成的**有效傷害**。
 *
 * ⚠不能只比「場上傷害指示物總和」的前後差 —— 被擊倒的那隻會直接離場，
 *   牠身上的傷害跟著消失，差值反而會塌陷成 0（甚至負數）。第一版就是這樣寫的，
 *   結果「真的擊倒對手」算出來的傷害是 0，分數輸給只是打了 130 但沒擊倒的招，
 *   AI 因此**放棄能擊倒的招**（探針量到漏 KO 20%）。
 *   正確作法：逐隻比對 iid —— 還在場上的算傷害增量，已離場的算牠被打前的剩餘 HP。
 */
function oppEffectiveDamage(
  beforeSt: GameState, afterSt: GameState, oppIdx: 0 | 1, pool: Map<string, Card>,
): number {
  const listOf = (st: GameState) => {
    const p = st.players[oppIdx];
    return [...(p.active ? [p.active] : []), ...p.bench];
  };
  const after = new Map(listOf(afterSt).map((c) => [c.iid, c]));
  let total = 0;
  for (const b of listOf(beforeSt)) {
    const a = after.get(b.iid);
    if (a) total += Math.max(0, (a.damage ?? 0) - (b.damage ?? 0));
    else total += Math.max(0, getEffectiveHP(b, pool, beforeSt) - (b.damage ?? 0));   // 被擊倒＝打掉牠的剩餘 HP
  }
  return total;
}

/**
 * ⚠權重全部是**啟發式**（不是卡面規則）。設計原則只有兩條：
 *   ① 獎賞是勝利條件 → 權重必須壓過任何傷害數字。
 *   ② 其餘各項一律取自引擎事實，我只決定它們的相對份量。
 * 特別注意 overkill：不寫死「印刷傷害小的優先」，而是讓「對備戰的額外傷害」與
 * 「丟掉的能量」自己去比 —— 大招若真的有額外收益（例如順便打備戰）就該選它，
 * 若只是白白多丟能量，小招自然勝出。這比我猜哪個好可靠得多。
 */
const W = { PRIZE: 1000, SELF_ENERGY: 30, SELF_DAMAGE: 0.5, CANT_ATTACK_NEXT: 150 };
/** 一張獎賞卡在評分尺度上的份量。呼叫端做 fallback 估值時要用同一個尺度，否則
 *  「能擊倒」與「傷害高」兩種估值混在一起比會得到亂七八糟的排序。 */
export const PRIZE_SCORE_UNIT = W.PRIZE;

/** 單次試打並回傳完整評估（不平均；平均版見 evaluateAttack）。 */
function evaluateAttackOnce(
  state: GameState,
  actorIdx: 0 | 1,
  attackIndex: number,
  pool: Map<string, Card>,
  actionExtra?: AttackActionExtra,
): AttackEval {
  try {
    const oppIdx = (1 - actorIdx) as 0 | 1;
    const beforeOppActive = state.players[oppIdx].active;
    if (!beforeOppActive) return DEAD_EVAL;
    // ⚠獎賞有**兩條路徑**：沒有正面朝上的獎賞卡時是直接取走（自己的 prizes 堆變短），
    //   只有需要玩家挑的時候才留在 pendingPrizes。第一版只讀 pendingPrizes，實測
    //   「明明擊倒了對手卻算出 prizes=0」，分數因此輸給沒擊倒的招 —— 兩條都要算。
    const beforePending = state.pendingPrizes?.[actorIdx] ?? 0;
    const beforePrizeStack = state.players[actorIdx].prizes.length;
    const beforeSelf = state.players[actorIdx].active;
    const beforeSelfEnergy = beforeSelf?.energyAttached.length ?? 0;
    const beforeSelfDmg = beforeSelf?.damage ?? 0;

    return withIsolatedRandom(() => {
      // ⚠⚠ 引擎的行動方一律讀 `state.activePlayerIndex`（handlePlaying 的第一行），
      //   action 物件裡**沒有**任何欄位可以指定 —— 所以呼叫端傳進來的 actorIdx
      //   必須落到假想盤面上，這個參數才名副其實（estimateIfPromoted 早就這樣做了）。
      //   目前兩個呼叫點傳的都等於盤面上的 activePlayerIndex，這一行是等價的；
      //   但少了它，日後有人想模擬「對手下回合能對我做什麼」就會靜默模擬錯人。
      const sim = shuffleHiddenZonesForSim(cloneState(state), actorIdx);
      sim.activePlayerIndex = actorIdx;
      // ⭐v6.430 試打前的盤面指紋要在 applyAction 之前取（引擎若就地改動 sim，事後就比不出來）
      const simBefore = cloneState(sim);
      // ⭐v6.430 記下試打過程有沒有用到亂數（擲幣／洗牌）：此處的 Math.random 是隔離 PRNG，只包一層計數
      const _rnd = Math.random;
      let _rndCalls = 0;
      Math.random = () => { _rndCalls++; return _rnd(); };
      let after0: GameState;
      let after: GameState;
      try {
        after0 = applyAction(sim, { type: 'ATTACK', attackIndex, ...(actionExtra ?? {}) } as GameAction, pool);
        // ⚠（fable 審查 v6.430 C）這裡比的是外層 state 而不是 sim，所以引擎「原樣退回」的拒絕抓不到、會當成 ok 且盤面零變化。
        //   在批次 C 之下那等於「打不動」⇒ 不送一個一定被拒的 ATTACK，方向是安全的；改成 === sim 反而會讓 AI 送出被拒的動作。
        //   故意保留，改動前請先想清楚這一層。
        if (!after0 || after0 === state) return DEAD_EVAL;
        after = resolveOwnPendingsInSim(after0, actorIdx, pool);
      } finally {
        Math.random = _rnd;
      }

      const gameWon = after.phase === 'game-over' && after.winner === actorIdx;
      const oppNow = after.players[oppIdx].active;
      const ko = !oppNow || oppNow.iid !== beforeOppActive.iid;
      const prizes = Math.max(0, (after.pendingPrizes?.[actorIdx] ?? 0) - beforePending)
        + Math.max(0, beforePrizeStack - after.players[actorIdx].prizes.length);
      const oppDamage = oppEffectiveDamage(state, after, oppIdx, pool);

      const selfNow = after.players[actorIdx].active;
      // 自己被擊倒／換位時能量差沒有意義，記 0 避免誤判成「丟了很多能量」
      const sameSelf = selfNow && beforeSelf && selfNow.iid === beforeSelf.iid;
      const selfEnergyLost = sameSelf
        ? Math.max(0, beforeSelfEnergy - selfNow.energyAttached.length) : 0;
      const selfDamage = sameSelf ? Math.max(0, (selfNow.damage ?? 0) - beforeSelfDmg) : 0;
      // ⚠欄位名一定要查證：正確的是 `cantAttackPending`（攻擊當下設，擁有者下個回合開始時
      //   才 promote 成 cantAttackThisTurn）。我第一版寫成 cantAttackNextTurn／
      //   mustRechargeNextTurn —— 兩個都不存在，TypeScript 不會報錯、值恆為 undefined，
      //   結果是「下回合不能攻擊」這個代價**完全不被計入**而毫無徵兆。守衛已釘死此欄位。
      const cantAttackNext = !!(sameSelf && selfNow.cantAttackPending);

      let score = prizes * W.PRIZE + oppDamage
        - selfEnergyLost * W.SELF_ENERGY
        - selfDamage * W.SELF_DAMAGE
        - (cantAttackNext ? W.CANT_ATTACK_NEXT : 0);
      if (gameWon) score = Number.MAX_SAFE_INTEGER;

      return {
        ok: true, ko, dealt: ko ? Infinity : oppDamage, unresolved: !!after.pendingSelection,
        prizes, oppDamage, selfEnergyLost, selfDamage, gameWon, score,
        sideEffectKeys: attackBoardChangeKeys(simBefore, after), usedRandom: _rndCalls > 0,
      };
    });
  } catch {
    return DEAD_EVAL;   // fail-open
  }
}

/**
 * 評估一招，**試打多次取平均**。
 * ⚠為什麼要多次：擲幣類招式單試一次的結果是隨機的，只打一次會把「正面 200／反面 0」
 *   當成確定值 —— 剛好擲到反面就會永遠低估那一招。取平均才是期望值。
 *   次數少（預設 3）是為了瀏覽器效能；這是估計不是精算，註明於此免得日後誤解。
 */
export function evaluateAttack(
  state: GameState,
  actorIdx: 0 | 1,
  attackIndex: number,
  pool: Map<string, Card>,
  samples = 3,
  actionExtra?: AttackActionExtra,
): AttackEval {
  let acc: AttackEval | null = null;
  let okCount = 0, koCount = 0;
  for (let i = 0; i < samples; i++) {
    const r = evaluateAttackOnce(state, actorIdx, attackIndex, pool, actionExtra);
    if (!r.ok) continue;
    okCount++;
    if (r.ko) koCount++;
    acc = acc
      ? { ...r,
          prizes: acc.prizes + r.prizes, oppDamage: acc.oppDamage + r.oppDamage,
          selfEnergyLost: acc.selfEnergyLost + r.selfEnergyLost, selfDamage: acc.selfDamage + r.selfDamage,
          gameWon: acc.gameWon || r.gameWon,
          score: acc.score === Number.MAX_SAFE_INTEGER || r.score === Number.MAX_SAFE_INTEGER
            ? Number.MAX_SAFE_INTEGER : acc.score + r.score,
          unresolved: acc.unresolved || r.unresolved,
          sideEffectKeys: [...new Set([...acc.sideEffectKeys, ...r.sideEffectKeys])].sort(),
          usedRandom: acc.usedRandom || r.usedRandom }
      : { ...r };
  }
  if (!acc || okCount === 0) return DEAD_EVAL;
  const avg = (n: number) => n / okCount;
  return {
    ...acc,
    ko: koCount * 2 > okCount,          // 過半數會擊倒才算「能擊倒」
    prizes: avg(acc.prizes), oppDamage: avg(acc.oppDamage),
    selfEnergyLost: avg(acc.selfEnergyLost), selfDamage: avg(acc.selfDamage),
    score: acc.score === Number.MAX_SAFE_INTEGER ? acc.score : avg(acc.score),
  };
}
