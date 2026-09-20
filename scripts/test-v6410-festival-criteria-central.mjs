// v6.410 守衛：「祭典樂舞首擊」與「祭典會場」的判準**收斂成一份**（IRON_RULES Rule 38）。
//
// 【問題】收斂前站內有兩份首擊判定：
//   ① `engine.ts` 的 `_isFestivalDanceFirstAttack`
//   ② `effects.ts` 的 `_isFestivalDanceFirstAttackLocal`
//      —— 註解自承「engine 那份的本地複製（effects.ts 不能 import engine）」，
//         而且 v6.202 還得**人工同步**兩邊（一起補上「特性此刻有沒有被消除」）。
//   加上「祭典會場」這個場地名的比對有**三份**（engine 的 hasFestivalVenue、
//   engine 首擊判定裡的 inline、effects 本地版裡的 inline）。
//   ⇒ 安慰劑型態 11：針對其中一份寫的守衛，突變另一份不會翻紅。
//
// 【收斂】判準下沉到新的 leaf `src/lib/game/festival.ts`
//   （只 import types 與 defense ⇒ engine／effects 兩邊都能 import、無循環依賴）。
//
// 【本守衛守什麼】
//   【A】HEAD-FAIL 哨兵：BASE 上 `festival.ts` 根本不存在 ⇒ 每一條各自誠實翻紅（Rule 41）。
//   【B】行為端：四個呼叫點（engine 1 處＋effects 3 處）在首擊時**都不消耗**旗標，
//        非首擊時**都消耗** —— 每一條都配「差分輸入」（有會場 vs 無會場），
//        不是恆真式（Rule 39）。
//   【C】Rule 38 靜態：engine.ts / effects.ts 不得再長出第二份判定或第二處場地名比對。
//   【D】反安慰劑：直呼中央述詞，四項條件**各缺一項**都必須回 false、全中才 true
//        ⇒ 證明四項都真的在被讀（不是恆真）。
//   【E】列管：「自身能量付出**早於**主傷害」的招式集合（主傷害在 ATTACK_POST／resolver
//        才造成的那一族）—— 行為端枚舉 ＋ 白名單 ＋ 每一支的**安全性行為證明**。
//        這一段守的不是「現在有 bug」（實測影響為 0），而是**日後別讓它變成有 bug**。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x410-s.js'), E = join(ROOT, '.x410-e.ts'), O = join(ROOT, '.x410-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
// ⚠⚠ Rule 41（HEAD-FAIL 不可以整支 throw）：`festival.ts` 在 BASE 上**不存在**，
//   直接寫進 entry 會讓 esbuild bundle 失敗 ⇒ 整支守衛爆掉、後面幾十條永遠跑不到。
//   ⇒ 檔案存在才加進 entry；不存在時 `FEST` 是 undefined，由下方哨兵讓**每一條各自**翻紅。
const FEST_PATH = join(ROOT, 'src/lib/game/festival.ts');
const FEST_EXISTS = existsSync(FEST_PATH);
writeFileSync(E, "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\n"
  + "export { applyAction } from './src/lib/game/engine';\n"
  + "export { fieldPokemonHasType } from './src/lib/game/effects';\n"   // ⭐ E3 用「**有效**屬性」中央述詞，不是印刷屬性
  + (FEST_EXISTS ? "export * as FEST from './src/lib/game/festival';\n" : '')
  + "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const M = await import(pathToFileURL(O).href);
const { applyAction, ATTACK_PRE } = M;
const MISSING = Symbol('festival.ts 不存在（BASE）');
/** Rule 41 哨兵：缺席的述詞回 MISSING，讓每一條各自誠實翻紅，而不是整支 throw。 */
const FN = (n) => (typeof M?.FEST?.[n] === 'function' ? M.FEST[n] : () => MISSING);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
const cards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (!c || c.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark || '')) cards.push(c);
  }
}
// ⭐ 一律動態挑卡（不 pin 任何卡 id：pin 死 id 的守衛換印刷就靜默失效）
const withAbility = (ab) => cards.find((c) => (c.abilities || []).some((a) => a.name === ab));
const namedCard = (n, pred = () => true) => cards.find((c) => c.name === n && pred(c));
const FESTIVAL_VENUE = cards.find((c) => c.name === '祭典會場' && c.subtype === 'Stadium');
// 祭典樂舞持有者：挑「有一招純數值傷害、傷害夠大」的那一張（旗標差分才看得出來）
const DANCER = cards.find((c) => (c.abilities || []).some((a) => a.name === '祭典樂舞')
  && (c.attacks || []).some((a) => Number(a.damage) >= 50));
const NIGHT_WING = withAbility('暗夜羽擊');
const TARGET = cards.find((c) => c.supertype === 'Pokemon' && Number(c.hp) >= 300
  && !(c.abilities || []).length && !c.name.includes('超級'));
assert.ok(FESTIVAL_VENUE && DANCER && NIGHT_WING && TARGET, '測試用卡沒挑齊（卡池變了？）');
const DANCER_ATK = (DANCER.attacks || []).findIndex((a) => Number(a.damage) >= 50);
const DANCER_DMG = Number(DANCER.attacks[DANCER_ATK].damage);

let n = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const anyEnergy = () => {
  const en = cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic');
  return { iid: 'e' + (++n), cardId: String(en.id), damage: 0, energyAttached: [] };
};

let pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };

// ══════════════════════════════════════════════════════════════════════════════
// 【A】HEAD-FAIL 哨兵 —— BASE 上 festival.ts 不存在 ⇒ 這三條各自翻紅
// ══════════════════════════════════════════════════════════════════════════════
T('A1. 中央述詞 isFestivalDanceFirstAttack 存在（BASE 上不存在 ⇒ HEAD-FAIL）', () => {
  assert.ok(typeof M?.FEST?.isFestivalDanceFirstAttack === 'function', 'festival.ts 沒有 export isFestivalDanceFirstAttack');
});
T('A2. 中央述詞 hasFestivalVenue 存在（BASE 上不存在 ⇒ HEAD-FAIL）', () => {
  assert.ok(typeof M?.FEST?.hasFestivalVenue === 'function', 'festival.ts 沒有 export hasFestivalVenue');
});
T('A3. 中央述詞 hasFestivalDanceActive 存在（BASE 上不存在 ⇒ HEAD-FAIL）', () => {
  assert.ok(typeof M?.FEST?.hasFestivalDanceActive === 'function', 'festival.ts 沒有 export hasFestivalDanceActive');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【B】行為端：四個呼叫點的「首擊不消耗／非首擊消耗」
//   ⚠ 每一條都跑**兩次**（有會場 vs 無會場）並比對**差異**：
//     只斷言「有會場時旗標還在」是恆真式的溫床（旗標本來就可能沒被讀到）；
//     配上「無會場時旗標不見了」才證明那條消耗路徑真的會走（Rule 39）。
// ══════════════════════════════════════════════════════════════════════════════
const BASIC_EN = cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic');
assert.ok(BASIC_EN, '找不到基本能量卡');
const en1 = () => ({ iid: 'e' + (++n), cardId: String(BASIC_EN.id), damage: 0, energyAttached: [] });
const ETYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
const TYPE_KANJI = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const basicOf = (t) => cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic'
  && (c.energyType === t || (c.name || '').includes(TYPE_KANJI[t])));
const enOf = (t) => { const e = basicOf(t) || BASIC_EN; return { iid: 'e' + (++n), cardId: String(e.id), damage: 0, energyAttached: [] }; };

// ⭐⭐ 審查者（獨立審查）抓到的守衛盲區：原本 34 條**全部只測 aIdx=0**
//   ⇒「把玩家索引寫死成 0」這種退化（後手玩家的祭典樂舞第一拳會把旗標吃掉、
//     第二拳被當成第一拳）全站 38 支相關守衛都不會翻紅。
//   ⇒ mkState 加 `atkIdx`，B／D 兩段各補鏡像條（Rule 39：餵「讀 vs 不讀會不同」的輸入）。
function mkState({ venue, bonus, penalty, defReduce, defCardId, atkIdx = 0 }) {
  const cost = DANCER.attacks[DANCER_ATK].cost || [];
  const a = inst(DANCER.id, cost.map(() => en1()));
  if (bonus) a.damageBonusThisTurn = bonus;
  if (penalty) a.nextOwnAttackPenalty = penalty;
  const d = inst(defCardId ?? TARGET.id);
  if (defReduce) d.damageReduceNextHit = defReduce;
  const deck = () => [inst(TARGET.id), inst(TARGET.id), inst(TARGET.id), inst(TARGET.id), inst(TARGET.id)];
  const atkP = { name: 'ATK', active: a, bench: [inst(TARGET.id)], hand: [], deck: deck(), discard: [], prizes: [] };
  const defP = { name: 'DEF', active: d, bench: [inst(TARGET.id)], hand: [], deck: deck(), discard: [], prizes: [] };
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: atkIdx, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null,
    activeStadium: venue ? { iid: 'sd' + (++n), cardId: String(FESTIVAL_VENUE.id), damage: 0, energyAttached: [] } : null,
    players: atkIdx === 0 ? [atkP, defP] : [defP, atkP],
  };
}
/** 旗標陣列：只把攻擊方那一側設成 true（鏡像條用）。 */
const sideFlag = (atkIdx) => (atkIdx === 0 ? [true, false] : [false, true]);
const attack = (st) => { const o = applyAction(st, { type: 'ATTACK', attackIndex: DANCER_ATK }, pool); return o?.state ?? o; };

T('B1. 【effects 中央 helper／回合加傷】有祭典會場＝首擊 ⇒ damageBonusThisTurn 不消耗', () => {
  const s = attack(mkState({ venue: true, bonus: 50 }));
  assert.strictEqual(s.players[0].active?.damageBonusThisTurn, 50, '首擊把回合加傷旗標吃掉了');
});
T('B1b.【差分】沒有祭典會場 ⇒ 同一個旗標必須被消耗（證明 B1 不是恆真）', () => {
  const s = attack(mkState({ venue: false, bonus: 50 }));
  assert.strictEqual(s.players[0].active?.damageBonusThisTurn, undefined, '沒有會場時旗標竟然還在 ⇒ 消耗路徑根本沒走，B1 是恆真式');
});
T('B2. 【effects 中央 helper／受招削傷】有祭典會場＝首擊 ⇒ nextOwnAttackPenalty 不消耗', () => {
  const s = attack(mkState({ venue: true, penalty: 20 }));
  assert.strictEqual(s.players[0].active?.nextOwnAttackPenalty, 20, '首擊把受招削傷旗標吃掉了');
});
T('B2b.【差分】沒有祭典會場 ⇒ 受招削傷旗標必須被消耗', () => {
  const s = attack(mkState({ venue: false, penalty: 20 }));
  assert.strictEqual(s.players[0].active?.nextOwnAttackPenalty, undefined, '沒有會場時旗標竟然還在 ⇒ B2 是恆真式');
});
T('B3. 【engine 主管線／防守方下次被擊減傷】有祭典會場＝首擊 ⇒ damageReduceNextHit 不消耗', () => {
  const s = attack(mkState({ venue: true, defReduce: 20 }));
  assert.strictEqual(s.players[1].active?.damageReduceNextHit, 20, '首擊把防守方的「鐵羽毛」類減傷吃掉了');
});
T('B3b.【差分】沒有祭典會場 ⇒ 防守方減傷旗標必須被消耗', () => {
  const s = attack(mkState({ venue: false, defReduce: 20 }));
  assert.strictEqual(s.players[1].active?.damageReduceNextHit, undefined, '沒有會場時旗標竟然還在 ⇒ B3 是恆真式');
});
T('B4. 特性被消除（對手戰鬥場是振翼髮｜暗夜羽擊）⇒ 即使有會場也**不是**首擊 ⇒ 旗標消耗', () => {
  const s = attack(mkState({ venue: true, bonus: 50, defCardId: NIGHT_WING.id }));
  assert.strictEqual(s.players[0].active?.damageBonusThisTurn, undefined,
    '祭典樂舞被暗夜羽擊消除了，首擊判定卻仍然成立（v6.202 修的那個洞回來了）');
});
T('B5. 本回合已用過祭典樂舞（festivalDanceUsedThisTurn）⇒ 不是首擊 ⇒ 旗標消耗', () => {
  const st = { ...mkState({ venue: true, bonus: 50 }), festivalDanceUsedThisTurn: [true, false] };
  const s = attack(st);
  assert.strictEqual(s.players[0].active?.damageBonusThisTurn, undefined, 'used 旗標沒有被讀到');
});
T('B6. 第二次招式已用過（festivalDanceSecondAttackUsed）⇒ 不是首擊 ⇒ 旗標消耗', () => {
  const st = { ...mkState({ venue: true, bonus: 50 }), festivalDanceSecondAttackUsed: [true, false] };
  const s = attack(st);
  assert.strictEqual(s.players[0].active?.damageBonusThisTurn, undefined, 'secondAttackUsed 旗標沒有被讀到');
});

// ══ 鏡像條（攻擊方＝players[1]）══════════════════════════════════════════════
// ⚠ 沒有這一段的話，「把 aIdx 寫死成 0」「讀 players[0]」這類突變全部存活
//   （獨立審查實測：X1／X2／X3 三個突變，全站 38 支相關守衛 0 條翻紅）。
T('B1m.【鏡像】攻擊方是後手（players[1]）時，首擊一樣不消耗回合加傷旗標', () => {
  const s = attack(mkState({ venue: true, bonus: 50, atkIdx: 1 }));
  assert.strictEqual(s.players[1].active?.damageBonusThisTurn, 50,
    '後手的祭典樂舞首擊把旗標吃掉了（判準把玩家索引寫死成 0？）');
});
T('B1mb.【鏡像差分】後手、沒有祭典會場 ⇒ 旗標必須被消耗', () => {
  const s = attack(mkState({ venue: false, bonus: 50, atkIdx: 1 }));
  assert.strictEqual(s.players[1].active?.damageBonusThisTurn, undefined, '鏡像條是恆真式');
});
T('B3m.【鏡像】後手攻擊時，防守方（players[0]）的下次被擊減傷一樣不消耗', () => {
  const s = attack(mkState({ venue: true, defReduce: 20, atkIdx: 1 }));
  assert.strictEqual(s.players[0].active?.damageReduceNextHit, 20, '後手首擊把對手的減傷吃掉了');
});
T('B3mb.【鏡像差分】後手、沒有祭典會場 ⇒ 防守方減傷必須被消耗', () => {
  const s = attack(mkState({ venue: false, defReduce: 20, atkIdx: 1 }));
  assert.strictEqual(s.players[0].active?.damageReduceNextHit, undefined, '鏡像條是恆真式');
});
T('B5m.【鏡像】後手側的 festivalDanceUsedThisTurn 要讀**自己那一格**（不是 [0]）', () => {
  // ⚠ 關鍵差分：只有後手那一格是 true。判準若寫死讀 [0]，這裡會誤判成「還是首擊」⇒ 旗標不消耗 ⇒ 紅。
  const st = { ...mkState({ venue: true, bonus: 50, atkIdx: 1 }), festivalDanceUsedThisTurn: sideFlag(1) };
  const s = attack(st);
  assert.strictEqual(s.players[1].active?.damageBonusThisTurn, undefined,
    'used 旗標讀錯玩家（寫死 [0]？）⇒ 後手第二拳被當成第一拳');
});
T('B6m.【鏡像】後手側的 festivalDanceSecondAttackUsed 要讀**自己那一格**', () => {
  const st = { ...mkState({ venue: true, bonus: 50, atkIdx: 1 }), festivalDanceSecondAttackUsed: sideFlag(1) };
  const s = attack(st);
  assert.strictEqual(s.players[1].active?.damageBonusThisTurn, undefined, 'secondAttackUsed 旗標讀錯玩家');
});
T('B7. 【effects 第 4 個呼叫點／狙擊路徑的防守方減傷】非祭典樂舞攻擊方 ⇒ 減傷必須被消耗', () => {
  // ⚠⚠ 獨立審查抓到的缺口：檔頭自稱「四個呼叫點」，但 B1～B6 只覆蓋 3 個
  //   （engine 主管線 1 ＋ 中央加成 helper 2）。第 4 個在 dealAttackDamageToTarget
  //   （延後／狙擊路徑的 damageReduceNextHit 消耗），把它改成「永不消耗」時，
  //   原本 34 條與其他 38 支相關守衛**全部照樣綠**。
  // ⚠ 反方向（改成「總是消耗」）是**等價突變**：四張祭典樂舞持有者的招式都不走這條路徑
  //   ⇒ 沒有盤面能讓「首擊不消耗」在這一點上被觀測到。如實記錄，不補假條件。
  // ⭐ 動態挑卡：卡面「對手的1隻寶可夢受到 N 點傷害」＝主傷害走延後／狙擊路徑。
  //   逐一試到有一個真的打出傷害為止（不 pin 任何卡 id）。
  const cands = [];
  for (const c of cards) {
    if (c.supertype !== 'Pokemon') continue;
    for (let k = 0; k < (c.attacks || []).length; k++) {
      const a = c.attacks[k];
      if (!ATTACK_PRE.get(`${c.name}|${a.name}`)) continue;
      if (!/對手的1隻寶可夢受到/.test(a.effect || '')) continue;
      cands.push([c, k]);
    }
  }
  assert.ok(cands.length >= 2, `狙擊型候選只有 ${cands.length} 支 —— 掃描器壞了？`);
  let hit = null, tried = [];
  for (const [c, ai] of cands) {
    const es = (c.attacks[ai].cost || []).map((t) => enOf(t));
    for (const t of ETYPES) es.push(enOf(t));      // 多給一些，讓「丟 N 個能量」付得出來
    const d = inst(TARGET.id); d.damageReduceNextHit = 20;
    let st = {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
      isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null,
      players: [
        { name: 'P1', active: inst(c.id, es), bench: [inst(TARGET.id)], hand: [], deck: [inst(TARGET.id), inst(TARGET.id)], discard: [], prizes: [] },
        { name: 'P2', active: d, bench: [inst(TARGET.id)], hand: [], deck: [inst(TARGET.id)], discard: [], prizes: [] },
      ],
    };
    let out = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool);
    st = out?.state ?? out;
    let rounds = 0;
    while (st.pendingSelection && rounds++ < 5) {
      const ps = st.pendingSelection;
      const V = ps.params?.validIids || ps.validIids || [];
      const pick = ps.type === 'opp-poke-choose'
        ? [st.players[1].active?.iid].filter(Boolean)
        : V.slice(0, ps.maxCount ?? 1);
      const o2 = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: pick }, pool);
      st = o2?.state ?? o2;
    }
    tried.push(`${c.name}｜${c.attacks[ai].name}=${st.players[1].active?.damage ?? 'KO'}`);
    if ((st.players[1].active?.damage ?? 0) > 0) { hit = st; break; }
  }
  assert.ok(hit, `沒有一支狙擊型招式打出傷害（盤面沒搭起來）：${tried.slice(0, 6).join('、')}`);
  assert.strictEqual(hit.players[1].active?.damageReduceNextHit, undefined,
    '走狙擊／延後路徑時，防守方的「下次被擊減傷」沒有被消耗（第 4 個呼叫點斷線了）');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【C】Rule 38 靜態：不得再長出第二份判定／第二處場地名比對
//   ⚠ 一律**先剝註解**（安慰劑型態 6：註解裡提到字面就能讓 lint 放行／誤報）。
//   ⚠ 否定型守衛一定配**正對照**（餵違規樣本，判準必須抓得到）。
// ══════════════════════════════════════════════════════════════════════════════
const srcOf = (rel) => stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, rel), 'utf8')), rel);
const ENGINE = srcOf('src/lib/game/engine.ts');
const EFFECTS = srcOf('src/lib/game/effects.ts');
const FESTIVAL = FEST_EXISTS ? srcOf('src/lib/game/festival.ts') : '';
/** 「祭典會場」的**比對式**（不是 log 文案）：=== / !== 兩種寫法都算。 */
const venueCompareCount = (src) => (src.match(/[!=]==\s*['"`]祭典會場['"`]/g) || []).length;

T('C0.【正對照】場地名比對的判準真的抓得到違規樣本（防空真）', () => {
  assert.strictEqual(venueCompareCount("const x = sd?.name === '祭典會場';"), 1, '=== 寫法沒抓到');
  assert.strictEqual(venueCompareCount("if (c?.name !== '祭典會場') return false;"), 1, '!== 寫法沒抓到');
  assert.strictEqual(venueCompareCount('const s = "祭典會場：開始";'), 0, 'log 文案被誤判成比對式');
});
T('C1. engine.ts 不得再有「祭典會場」的比對式（已收斂到 festival.ts）', () => {
  assert.strictEqual(venueCompareCount(ENGINE), 0, 'engine.ts 又出現場地名比對 ⇒ 判準變兩份');
});
T('C2. effects.ts 不得再有「祭典會場」的比對式', () => {
  assert.strictEqual(venueCompareCount(EFFECTS), 0, 'effects.ts 又出現場地名比對 ⇒ 判準變兩份');
});
T('C3. 場地名只寫在 festival.ts 的**常數宣告**裡（不是散在各處的字面比對）', () => {
  assert.ok(FEST_EXISTS, 'festival.ts 不存在');
  assert.strictEqual((FESTIVAL.match(/FESTIVAL_VENUE_STADIUM\s*=\s*['\"`]祭典會場['\"`]/g) || []).length, 1,
    '中央常數宣告不見了');
  assert.strictEqual(venueCompareCount(FESTIVAL), 0, '中央檔自己又寫了字面比對（應該用常數）');
});
T('C3b. 全站 src/lib/game/**.ts 的「祭典會場」比對式總數＝0（語義型掃描，不只盯兩支大檔）', () => {
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const fp = join(d, e.name);
    if (e.isDirectory()) walk(fp); else if (e.name.endsWith('.ts')) files.push(fp);
  } };
  walk(join(ROOT, 'src/lib/game'));
  assert.ok(files.length >= 30, '只掃到 ' + files.length + ' 支 .ts —— 掃描器壞了？');
  const bad = [];
  for (const fp of files) {
    const cnt = venueCompareCount(stripCommentsBlankChecked(normEol(readFileSync(fp, 'utf8')), fp));
    if (cnt > 0) bad.push(fp.slice(ROOT.length) + ' ×' + cnt);
  }
  assert.deepStrictEqual(bad, [], '還有地方自己比對場地名：' + bad.join('、'));
});
T('C4. effects.ts 不得再讀 festivalDanceSecondAttackUsed（首擊判定的簽章欄位）', () => {
  assert.ok(!EFFECTS.includes('festivalDanceSecondAttackUsed'),
    'effects.ts 又出現首擊判定的簽章欄位 ⇒ 本地複製回來了');
});
T('C5. engine.ts 只剩「狀態機」在讀簽章欄位，不得再組出第四項判定', () => {
  // engine 的祭典樂舞**狀態機**（開窗／中斷／第 2 次 pending）本來就會讀這兩個欄位，
  // 那不是首擊判定。判準：engine 裡不得同時出現「簽章欄位」與「場地名比對」——
  // 首擊判定的形狀正是這兩者同框（C1 已經釘住場地名比對＝0）。
  assert.ok(ENGINE.includes('festivalDanceSecondAttackUsed'), '狀態機不見了？掃描器可能壞了');
  assert.strictEqual(venueCompareCount(ENGINE), 0, '（同 C1）');
});
T('C6. festival.ts 不得 import engine.ts／effects.ts（leaf 契約：防循環依賴）', () => {
  assert.ok(FEST_EXISTS, 'festival.ts 不存在');
  assert.ok(!/from\s+['"`]\.\/engine['"`]/.test(FESTIVAL), 'festival.ts import 了 engine ⇒ 循環依賴');
  assert.ok(!/from\s+['"`]\.\/effects['"`]/.test(FESTIVAL), 'festival.ts import 了 effects ⇒ 循環依賴');
});
T('C7. engine.ts 與 effects.ts 都必須 import 中央判準（接線斷言）', () => {
  assert.ok(/from\s+['"`]\.\/festival['"`]/.test(ENGINE), 'engine.ts 沒有接上中央判準');
  assert.ok(/from\s+['"`]\.\/festival['"`]/.test(EFFECTS), 'effects.ts 沒有接上中央判準');
});

T('C8. 不得有模組在 module top-level 讀 festival 的 export（良性循環 → TDZ 爆炸的唯一途徑）', () => {
  // ⚠ 獨立審查指出：festival.ts 不是真 leaf —— defense.ts 本身 value-import './effects'
  //   ⇒ 存在傳遞式循環。目前良性（export 全是函式、只在函式體內求值）。
  //   唯一會讓它變成 TDZ 爆炸的寫法，就是有人在**檔案最外層**直接讀它的 export。
  // ⚠ 卡檔 `lopunny_serperior_flareon_festival.ts` 也 endsWith('festival.ts')！
  //   拿它當「中央檔」的判準 ⇒ 那支 importer 會被静默排除（掃描器漏掃）。
  const isCentralFile = (fp) => fp.replace(/\\/g, '/').endsWith('/game/festival.ts');
  const NAMES = ['FESTIVAL_VENUE_STADIUM', 'FESTIVAL_DANCE_ABILITY', 'hasFestivalVenue',
    'hasFestivalDanceActive', 'isFestivalDanceFirstAttack'];
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const fp = join(d, e.name);
    if (e.isDirectory()) walk(fp); else if (e.name.endsWith('.ts')) files.push(fp);
  } };
  walk(join(ROOT, 'src/lib/game'));
  const importers = [];
  const bad = [];
  for (const fp of files) {
    const raw = stripCommentsBlankChecked(normEol(readFileSync(fp, 'utf8')), fp);
    if (!/from\s+['"`][^'"`]*\/festival['"`]/.test(raw) && !isCentralFile(fp)) continue;
    if (!isCentralFile(fp)) importers.push(fp.slice(ROOT.length));
    for (const line of raw.split('\n')) {
      if (/^\s/.test(line) || !line.trim()) continue;              // 有縮排 ⇒ 在某個區塊裡面
      if (/^(import|export (type|interface)|\/)/.test(line)) continue;
      if (isCentralFile(fp)) continue;   // 中央檔自己宣告常數是合法的
      if (/^(export )?(async )?function |^(export )?(const|let|var) \w+ = (\(|async|function)/.test(line)) continue;
      if (NAMES.some((nm) => new RegExp('\\b' + nm + '\\b').test(line))) bad.push(fp.slice(ROOT.length) + ': ' + line.trim().slice(0, 80));
    }
  }
  assert.ok(importers.length >= 3, `只有 ${importers.length} 個模組 import 了中央判準（下限 3）—— 掃描器壞了，或接線掉了`);
  assert.deepStrictEqual(bad, [], 'module top-level 讀了 festival 的 export ⇒ 循環會變成 TDZ 爆炸：' + bad.join('、'));
});
T('C9. 全站不得再有「abilities.some(name === 祭典樂舞)」這種就地判定（Rule 38）', () => {
  // ⭐ 本版把最後兩處（engine 的衝衝鼓 gate、啪咚猴卡檔的衝衝鼓效果本體）也收掉了。
  // ⚠ 例外：engine 祭典樂舞狀態機裡那一段 isAbilityNullifiedByPassive 是**冗餘的縱深防禦**
  //   （註解自承），它不是「判準第二份」，判準只抓 `abilities...some(... === '祭典樂舞')` 的形狀。
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const fp = join(d, e.name);
    if (e.isDirectory()) walk(fp); else if (e.name.endsWith('.ts')) files.push(fp);
  } };
  walk(join(ROOT, 'src/lib/game'));
  assert.ok(files.length >= 30, '掃描器壞了？只掃到 ' + files.length + ' 支');
  const RE = /abilities[\s\S]{0,40}some\([\s\S]{0,60}===\s*['"`]祭典樂舞['"`]/;
  // 正對照（防空真）
  assert.ok(RE.test("const x = card?.abilities?.some(a => a.name === '祭典樂舞');"), '判準抓不到違規樣本');
  const bad = [];
  for (const fp of files) {
    const raw = stripCommentsBlankChecked(normEol(readFileSync(fp, 'utf8')), fp);
    if (RE.test(raw)) bad.push(fp.slice(ROOT.length));
  }
  assert.deepStrictEqual(bad, [], '還有地方自己就地判「有沒有祭典樂舞特性」：' + bad.join('、'));
});

// ══════════════════════════════════════════════════════════════════════════════
// 【D】反安慰劑：直呼中央述詞，四項條件**各缺一項**都必須回 false
//   ⚠ Rule 39：要證明「某個條件還在被讀」，就得餵一個「讀它 vs 不讀它答案不同」的輸入。
//   ⚠ 自檢呼叫的是**與正式斷言同一個函式**（不是再抄一份判準）——否則自檢恆綠。
// ══════════════════════════════════════════════════════════════════════════════
const isFirst = FN('isFestivalDanceFirstAttack');
const hasVenue = FN('hasFestivalVenue');
const hasDance = FN('hasFestivalDanceActive');
const D_BASE = mkState({ venue: true, bonus: 50 });
T('D1. 四項條件全中 ⇒ true（沒有這一條，下面五條全是空真）', () => {
  assert.strictEqual(isFirst(D_BASE, 0, pool), true, '全中卻不是首擊（或 festival.ts 不存在）');
});
T('D2. 缺【祭典會場】⇒ false', () => {
  assert.strictEqual(isFirst({ ...D_BASE, activeStadium: null }, 0, pool), false);
});
T('D3. 缺【生效中的祭典樂舞特性】（攻擊方換成沒有該特性的卡）⇒ false', () => {
  const st = JSON.parse(JSON.stringify(D_BASE));
  st.players[0].active.cardId = String(TARGET.id);
  assert.strictEqual(isFirst(st, 0, pool), false);
});
T('D4. 缺【本回合還沒 used】⇒ false', () => {
  assert.strictEqual(isFirst({ ...D_BASE, festivalDanceUsedThisTurn: [true, false] }, 0, pool), false);
});
T('D5. 缺【還沒用過第二次】⇒ false', () => {
  assert.strictEqual(isFirst({ ...D_BASE, festivalDanceSecondAttackUsed: [true, false] }, 0, pool), false);
});
T('D6. 攻擊方沒有戰鬥寶可夢 ⇒ false（不得 throw）', () => {
  const st = JSON.parse(JSON.stringify(D_BASE));
  st.players[0].active = null;
  assert.strictEqual(isFirst(st, 0, pool), false);
});
T('D7. hasFestivalVenue 的差分：有會場 true／沒會場 false', () => {
  assert.strictEqual(hasVenue(D_BASE, pool), true);
  assert.strictEqual(hasVenue({ ...D_BASE, activeStadium: null }, pool), false);
});
T('D8. hasFestivalDanceActive 的差分：持有者 true／換成別的卡 false', () => {
  assert.strictEqual(hasDance(D_BASE, 0, pool), true);
  const st = JSON.parse(JSON.stringify(D_BASE));
  st.players[0].active.cardId = String(TARGET.id);
  assert.strictEqual(hasDance(st, 0, pool), false);
});

// ══ D 段鏡像：直呼述詞、攻擊方＝players[1] ════════════════════════════════════
const D_BASE1 = mkState({ venue: true, bonus: 50, atkIdx: 1 });
T('D1m.【鏡像】後手側四項條件全中 ⇒ true', () => {
  assert.strictEqual(isFirst(D_BASE1, 1, pool), true, '後手全中卻不是首擊（判準把索引寫死成 0？）');
});
T('D3m.【鏡像】後手側缺【祭典樂舞特性】⇒ false', () => {
  const st = JSON.parse(JSON.stringify(D_BASE1));
  st.players[1].active.cardId = String(TARGET.id);
  assert.strictEqual(isFirst(st, 1, pool), false, 'hasFestivalDanceActive 讀到 players[0] 了？');
});
T('D4m.【鏡像】只有後手那一格 used=true ⇒ false（讀錯格會回 true）', () => {
  assert.strictEqual(isFirst({ ...D_BASE1, festivalDanceUsedThisTurn: sideFlag(1) }, 1, pool), false);
});
T('D4mb.【鏡像差分】只有先手那一格 used=true ⇒ 後手仍是首擊 true', () => {
  // ⚠ Rule 39：這一條與 D4m 成對，證明「真的在讀 aIdx 那一格」，不是讀固定索引。
  assert.strictEqual(isFirst({ ...D_BASE1, festivalDanceUsedThisTurn: sideFlag(0) }, 1, pool), true);
});
T('D5m.【鏡像】只有後手那一格 secondAttackUsed=true ⇒ false', () => {
  assert.strictEqual(isFirst({ ...D_BASE1, festivalDanceSecondAttackUsed: sideFlag(1) }, 1, pool), false);
});
T('D5mb.【鏡像差分】只有先手那一格 secondAttackUsed=true ⇒ 後手仍是首擊 true', () => {
  assert.strictEqual(isFirst({ ...D_BASE1, festivalDanceSecondAttackUsed: sideFlag(0) }, 1, pool), true);
});
T('D8m.【鏡像】hasFestivalDanceActive(idx=1) 的差分', () => {
  assert.strictEqual(hasDance(D_BASE1, 1, pool), true);
  assert.strictEqual(hasDance(D_BASE1, 0, pool), false, '另一側沒有祭典樂舞卻回 true ⇒ 讀固定索引');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【E】列管：「自身能量付出**早於**主傷害」的那一族（主傷害在 ATTACK_POST／resolver 才造成）
//
// 【背景】v6.407 把「付出自身能量」改成 PRE 只**登記**、engine 在主傷害造成後單點 flush
//   （官方三段順序 ①傷害 → ②招式效果 → ③受傷時的特性／道具）。
//   但有一族招式的**主傷害根本不在 engine 主管線**：PRE 回傳 damage=0，真正的 220／280
//   在 ATTACK_POST 開 picker、由 resolver 才造成 ⇒ 對它們而言 flush 仍然早於主傷害。
//
// 【現況（v6.410 實測）影響為 0】那一族目前 4 支，攻擊方屬性是【火】【無】【鋼】【惡】；
//   中央加成裡會讀「攻擊方自身能量」的只有兩項：伏特【雷】能量（需攻擊方為【雷】屬性）
//   與 夠讚狗｜腎上腺力量（需卡名為夠讚狗）⇒ 這 4 支都不會因為「先付出」而少算傷害。
//
// 【所以本段守的是「別讓它變成有 bug」】
//   ・E1/E2：行為端枚舉，集合必須 ⊆ 白名單 —— 新卡掉進這一族時**立刻翻紅**，逼人處理。
//   ・E3：白名單每一支都附**行為端安全條件**（安慰劑型態 7：白名單條目必須證明為什麼安全）。
//   ・E4：釘住「讀自身能量的加成只有那兩項」—— 這是 E3 那個安全論證的前提，
//        前提變了（新增第三項加成讀能量）而沒人發現的話，E3 就會變成空話。
//   ・E5：正對照 —— 證明這個維度**真的會咬人**（【雷】屬性招式帶伏特能量時確實 +20）。
// ══════════════════════════════════════════════════════════════════════════════
function preProbeState(cardObj) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null,
    players: [
      { name: 'P1', active: inst(cardObj.id, ETYPES.map((t) => enOf(t))), bench: [inst(TARGET.id)], hand: [],
        deck: [inst(TARGET.id), inst(TARGET.id), inst(TARGET.id)], discard: [], prizes: [] },
      { name: 'P2', active: inst(TARGET.id, [enOf('Grass')]), bench: [inst(TARGET.id)], hand: [],
        deck: [inst(TARGET.id)], discard: [], prizes: [] },
    ],
  };
}
let _preTried = 0, _preThrew = 0;
const _queued = [];          // PRE 有登記付出的
const _queuedBeforeDamage = []; // 其中 PRE damage===0（付出早於主傷害）
for (const c of cards) {
  if (c.supertype !== 'Pokemon') continue;
  for (const a of (c.attacks || [])) {
    const fn = ATTACK_PRE.get(`${c.name}|${a.name}`);
    if (!fn) continue;
    _preTried++;
    let r;
    try { r = fn(preProbeState(c), 0, pool, {}); } catch { _preThrew++; continue; }
    const q = r?.state?._attackEnergyPayment;
    if (!q || !(q.items || []).length) continue;
    const rec = { key: `${c.name}｜${a.name}`, type: c.pokemonType, name: c.name };
    _queued.push(rec);
    if (Number(r.damage) === 0) _queuedBeforeDamage.push(rec);
  }
}
const uniq = (arr) => [...new Set(arr)].sort();

T('E1. 掃描器下限：ATTACK_PRE 真的被跑過、而且真的有招式登記了自身能量付出', () => {
  assert.ok(_preTried >= 200, `只跑到 ${_preTried} 支 ATTACK_PRE —— 掃描器壞了？`);
  assert.ok(_queued.length >= 20, `只有 ${_queued.length} 支登記付出（下限 20／實測 29+）—— 掃描器壞了，或中央管線被繞過`);
  assert.ok(_preThrew < _preTried / 2, `有 ${_preThrew}/${_preTried} 支 PRE throw —— 盤面搭壞了，下面的集合不可信`);
});
// ⚠⚠ 【已知的掃描缺口，獨立審查指出】上面的枚舉用 `fn(state, 0, pool, {})` 跑 PRE，
//   所以 **opt-in 型**（走 resolveOptInPayment 且 aiDefault:'skip'：時間爆炸／忍者飛旋／
//   金屬之錘／災難衝擊）在探針裡**永遠不登記** ⇒ 不在 E2 的雷達內。
//   已逐支查証：這幾支的傷害不是在 PRE（>0）就是登記在 POST（災難衝擊，flush 排在傷害之後）
//   ⇒ **現況無漏**；但日後若出现「opt-in skip ＋ 主傷害在 POST」的新卡，這一段會静默漏掉。
//   ⚠ 不在本版補：要驅動 opt-in 必須模擬玩家選擇，那是另一条探針路徑；先記在這裡列管。
T('E2. 「付出早於主傷害」的集合必須 ⊆ 白名單（新卡掉進這一族時翻紅）', () => {
  const WHITELIST = ['超級噴火龍Yex｜炎獄狂爆Y', '超級盔甲鳥ex｜音波拆裂', '烏鴉頭頭｜狙擊羽毛', '雙尾怪手｜雙尾'].sort();
  const got = uniq(_queuedBeforeDamage.map((r) => r.key));
  assert.ok(got.length >= 4, `只掃到 ${got.length} 支（下限 4）—— 掃描器壞了（空集合＝空真，安慰劑型態 4）`);
  assert.deepStrictEqual(got, WHITELIST,
    '這一族變了。新進來的招式：主傷害在 ATTACK_POST／resolver，而自身能量的付出會早於它。\n'
    + '    ⇒ 必須確認「先付出」不會讓它少算傷害（見 E3／E4 的安全條件），確認完才加進白名單。');
});
T('E3. 白名單每一支的**安全條件**：攻擊方不是【雷】**有效**屬性、也不是夠讚狗', () => {
  // ⭐ 安慰劑型態 7：白名單條目必須附「為什麼安全」的證明，不能只寫「應該沒事」。
  //   安全條件＝中央加成裡「會讀攻擊方自身能量」的兩項都套不到它（前提由 E4 釘住）。
  // ⚠⚠ 獨立審查指出：伏特【雷】能量的實際 gate 是 `fieldPokemonHasType(...,'Lightning')`
  //   ——**場上有效屬性**（雙重屬性特性等會改它），不是卡面印刷的 pokemonType。
  //   判準必須與被守的那一份同一支述詞，否則前提會無聲分岔（Rule 38）。
  const fpht = typeof M?.fieldPokemonHasType === 'function' ? M.fieldPokemonHasType : null;
  assert.ok(fpht, '取不到中央述詞 fieldPokemonHasType');
  const bad = [];
  for (const r of _queuedBeforeDamage) {
    const c = cards.find((x) => `${x.name}｜${(x.attacks || [])[0]?.name}` === r.key || x.name === r.name);
    const st = preProbeState(c ?? { id: TARGET.id });
    const isLightning = fpht(st, 0, st.players[0].active, pool, 'Lightning');
    if (isLightning || r.name === '夠讚狗') bad.push(`${r.key}[有效【雷】=${isLightning}]`);
  }
  // 正對照（防空真）：拿一張真的【雷】屬性卡餵同一支述詞，必須回 true
  const zapCard = cards.find((x) => x.supertype === 'Pokemon' && x.pokemonType === 'Lightning' && !(x.abilities || []).length);
  assert.ok(zapCard, '找不到【雷】屬性樣本');
  const zapSt = preProbeState(zapCard);
  assert.strictEqual(fpht(zapSt, 0, zapSt.players[0].active, pool, 'Lightning'), true,
    '正對照失效：述詞對真正的【雷】屬性也回 false ⇒ 上面的「全部安全」是空真');
  assert.deepStrictEqual(uniq(bad), [],
    '這幾支會因為「付出早於主傷害」而**真的少算傷害**（伏特【雷】能量／腎上腺力量讀的是自身能量）：'
    + uniq(bad).join('、'));
});
T('E4. 前提釘樁：中央加成裡「讀攻擊方自身能量」的只有 2 處（伏特【雷】能量／腎上腺力量）', () => {
  const i = EFFECTS.indexOf('export function applyAttackerActiveDamageBonuses(');
  assert.ok(i > 0, '找不到中央加成 helper —— 掃描器壞了');
  const j = EFFECTS.indexOf('\nexport ', i + 10);
  assert.ok(j > i && j - i < 12000, '函式體切片異常（anchor 失效）：' + (j - i));
  const body = EFFECTS.slice(i, j);
  const lines = body.split('\n').filter((L) => /energyAttached|countEnergyTypeHostAware|countEnergy\(|hostEnergyCardsOfType/.test(L));
  assert.strictEqual(lines.length, 2,
    '中央加成裡「讀攻擊方自身能量」的地方不是 2 處（實際 ' + lines.length + '）。\n'
    + '    ⇒ E3 的安全論證前提變了：新增的那一項也可能被「付出早於主傷害」影響，\n'
    + '      請確認它的 gate，再把 E3 的條件補上。\n'
    + '    實際命中：\n      ' + lines.map((L) => L.trim().slice(0, 100)).join('\n      '));
  assert.ok(lines.some((L) => L.includes('伏特【雷】能量')), '第 1 處不是伏特【雷】能量');
  assert.ok(lines.some((L) => L.includes('腎上腺力量')), '第 2 處不是腎上腺力量');
});
T('E5.【正對照】這個維度真的會咬人：【雷】屬性招式帶 1 張伏特【雷】能量 ⇒ 傷害 +20', () => {
  // 沒有這一條，E2/E3 就只是「目前沒人踩到」的空話 —— 要先證明「踩到就會錯」。
  const VOLT = cards.find((c) => c.supertype === 'Energy' && c.name === '伏特【雷】能量');
  assert.ok(VOLT, '找不到伏特【雷】能量');
  // 挑一支【雷】屬性、純數值傷害、且**會付出自身能量**的招式（v6.407 修的那一族）
  const zap = cards.find((c) => c.pokemonType === 'Lightning'
    && (c.attacks || []).some((a) => ATTACK_PRE.get(`${c.name}|${a.name}`) && Number(a.damage) >= 100));
  assert.ok(zap, '找不到【雷】屬性的樣本');
  const ai = (zap.attacks || []).findIndex((a) => ATTACK_PRE.get(`${zap.name}|${a.name}`) && Number(a.damage) >= 100);
  const face = Number(zap.attacks[ai].damage);
  const mk = (withVolt) => {
    const es = (zap.attacks[ai].cost || []).map(() => enOf('Lightning'));
    if (withVolt) es.push({ iid: 'v' + (++n), cardId: String(VOLT.id), damage: 0, energyAttached: [] });
    return {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
      isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null,
      players: [
        { name: 'P1', active: inst(zap.id, es), bench: [inst(TARGET.id)], hand: [],
          deck: [inst(TARGET.id), inst(TARGET.id), inst(TARGET.id)], discard: [], prizes: [] },
        { name: 'P2', active: inst(TARGET.id), bench: [inst(TARGET.id)], hand: [], deck: [inst(TARGET.id)], discard: [], prizes: [] },
      ],
    };
  };
  const go = (st) => { const o = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool); const s = o?.state ?? o; return s.players[1].active?.damage ?? 0; };
  const a0 = go(mk(false)), a1 = go(mk(true));
  assert.ok(a0 >= face, `基準傷害 ${a0} < 卡面 ${face} —— 盤面沒搭起來`);
  assert.strictEqual(a1 - a0, 20, `伏特【雷】能量沒有 +20（${a0} → ${a1}）—— v6.407 修的那件事退化了`);
});

console.log(`\n=== v6410 festival-criteria-central: ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
