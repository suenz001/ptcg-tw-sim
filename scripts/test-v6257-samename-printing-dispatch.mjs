// ══════════════════════════════════════════════════════════════════════════════
// v6.257 守衛 — 「同名不同印刷、但卡面內容不同」維度
//
// 站長回報（2026-08-28，逐字）：
//   「勒克貓 版本為 MC · 245/742 似乎有跟 M3 · 026/080 · J 版本一樣的特性 鬥志戰吼，
//     可以在登場的回合馬上進化 … 依據 MC · 245/742 版本的卡片內容，並沒有特性，
//     只有招式為「咬緊」。」
//
// 查證（static/cards 台灣官方卡面，特性讀 abilities[].effect）：
//   ・勒克貓 id=18003【M3 026/080・J】abilities=[{name:'鬥志戰吼', effect:'若對手的戰鬥
//       寶可夢為「寶可夢【ex】」，則這隻寶可夢就算在自己的最初回合或者剛使出的回合，也可進化。'}]
//   ・勒克貓 id=16716【MC 245/742・H】abilities=null，attacks=[{name:'咬緊', …}]
//   ・勒克貓 id=10454【SV6 040/101・H】abilities=null，attacks=[{name:'咬緊', …}]
//
// 根因：engine.ts 兩處（EVOLVE handler + getEvolvableTargets UI 鏡射）都寫
//   `card.name === '勒克貓'`，**完全沒有問這張印刷有沒有那個特性**。
//
// 全站 audit 又抓出同型第二例：
//   ・堅果啞鈴 id=18481【M4 061/083・J】abilities=[{name:'整人擊落', …}]
//   ・堅果啞鈴 id=13421【SV11W 064/086・I】abilities=null（只有招式）
//   ・堅果啞鈴 id=13837【SV11W 145/086・I】abilities=null
//   `_shared.ts triggerOakeyeMillIfApplicable` 只比對卡名 ⇒ 後兩張從牌庫被丟棄時
//   也會把對手牌庫頂 8 張丟掉。
//
// 收斂（不是「在勒克貓那裡加個 if」）：
//   ・場上   → v6.196 中央閘 hasEffectiveAbilityByInst（驗印著 + 問是否被消除）
//   ・非場上 → v6.257 新增中央述詞 cardPrintsAbility（純卡面；牌庫/棄牌區/手牌）
//   ・進化時序豁免（提升進化 / 刺激進化 / 鬥志戰吼）三項收斂成**單一 producer**
//     engine.ts getEvolveTimingBypass，EVOLVE handler 與 UI 端共用（兩端不可能再分岔）。
//
// ⚠ 本檔的靜態 lint（Check ①）配有**正對照**（合成違規樣本必須被抓到）與**下限斷言**
//   （掃描器自身壞掉時要紅，不是靜默全綠）—— 見 sectionLint()。
// ══════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6257-s.js'), E = join(ROOT, '.v6257-e.ts'), O = join(ROOT, '.v6257-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction, getEvolvableTargets, getEvolveTimingBypass } from './src/lib/game/engine';\n"
  + "export { cardPrintsAbility, triggerOakeyeMillIfApplicable } from './src/lib/game/effects/_shared';\n"
  + "export { ABILITY_EFFECTS, ABILITY_EFFECTS_BY_NAME } from './src/lib/game/effects/_shared';\n"
  + "export { ATTACK_POST } from './src/lib/game/effects/_shared';\n"
  + "import './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

// ── 卡池（live H/I/J）────────────────────────────────────────────────────────
const CARDS_DIR = join(ROOT, 'static/cards');
const LIVE = new Set(JSON.parse(readFileSync(join(CARDS_DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
const hij = [];
for (const f of readdirSync(CARDS_DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !LIVE.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(CARDS_DIR, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark)) hij.push(c);
  }
}

let pass = 0;
const fails = [];
function check(label, fn) {
  try { fn(); pass++; console.log(`  ✅ ${label}`); }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;   // ⚠ 非斷言錯誤照丟（禁無差別 try/catch）
    fails.push(`${label} — ${e.message}`); console.log(`  ❌ ${label} — ${e.message}`);
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────
const LUXIO_M3 = '18003';   // 勒克貓 M3 026/080 J — 有「鬥志戰吼」
const LUXIO_MC = '16716';   // 勒克貓 MC 245/742 H — 無特性（站長回報的那一張）
const LUXIO_SV6 = '10454';  // 勒克貓 SV6 040/101 H — 無特性
const LUXRAY = '18004';     // 倫琴貓 M3 027/080 J（Stage2，evolvesFrom 勒克貓）
const MAGMA_CAVE = '19623'; // 傳說的熔岩洞 M6 075/076 J —「雙方場上所有進化寶可夢的特性全部消除。」
const EEVEE_PUSH = '11650'; // 伊布 SV8a 125/187 H — 有「提升進化」
const EEVEE_PLAIN = '17035';// 伊布 MC 564/742 H — 無特性（同名不同印刷正對照）
const LEAFEON = '10253';    // 葉伊布 SV5a 006/066 H（evolvesFrom 伊布）
const SHELLINK_A = '13036'; // 小嘴蝸 SV11W 008/086 I — 有「刺激進化」
const SHELLINK_B = '12951'; // 蓋蓋蟲 SV11B 009/086 I — 有「刺激進化」
const SHELLINK_A0 = '12470';// 小嘴蝸 SV9 008/100 I — 無特性（正對照）
const SHELLINK_B0 = '12469';// 蓋蓋蟲 SV9 007/100 I — 無特性
const AGILE_BUG = '13366';  // 敏捷蟲 SV11W 009/086 I（evolvesFrom 小嘴蝸）
const OAK_J = '18481';      // 堅果啞鈴 M4 061/083 J — 有「整人擊落」
const OAK_SV = '13421';     // 堅果啞鈴 SV11W 064/086 I — 無特性
const ROCKRUFF = '13996';   // 花岩怪 M1L 039/063 I —「崩山」丟對手牌庫頂 1 張
const DARK_ENERGY = '17214';// 基本【惡】能量

// fixture 自驗（測到的卡面必須真的長這樣，否則測試本身失去意義）
function ab(id) { return (pool.get(id)?.abilities ?? []).map(a => a.name); }
assert.deepStrictEqual(ab(LUXIO_M3), ['鬥志戰吼'], 'fixture 壞了：M3 勒克貓應有鬥志戰吼');
assert.deepStrictEqual(ab(LUXIO_MC), [], 'fixture 壞了：MC 勒克貓不該有任何特性');
assert.deepStrictEqual(ab(LUXIO_SV6), [], 'fixture 壞了：SV6 勒克貓不該有任何特性');
assert.deepStrictEqual(ab(OAK_J), ['整人擊落'], 'fixture 壞了：M4 堅果啞鈴應有整人擊落');
assert.deepStrictEqual(ab(OAK_SV), [], 'fixture 壞了：SV11W 堅果啞鈴不該有特性');
assert.deepStrictEqual(ab(EEVEE_PUSH), ['提升進化'], 'fixture 壞了：SV8a 伊布應有提升進化');
assert.deepStrictEqual(ab(EEVEE_PLAIN), [], 'fixture 壞了：MC 伊布不該有特性');

const EX_CARD = hij.find(c => c.supertype === 'Pokemon' && c.subtype === 'ex');
const NONEX = hij.find(c => c.supertype === 'Pokemon' && c.subtype !== 'ex'
  && !String(c.name).endsWith('ex') && c.stage === 'Basic');
assert.ok(EX_CARD && NONEX, 'fixture 壞了：找不到 ex / 非 ex 基礎寶可夢');

function inst(iid, cardId, extra = {}) {
  return { iid, cardId: String(cardId), damage: 0, energyAttached: [], extraTools: [], ...extra };
}
function baseState(over = {}) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    setupDone: [true, true], activeStadium: null,
    players: [
      { name: 'P1', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [] },
      { name: 'P2', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [] },
    ],
    ...over,
  };
}
/** 勒克貓場景：base 這回合剛進化過（evolvedThisTurn）⇒ 一般規則不可再進化 */
function luxioScene(luxioId, { oppEx = true, stadium = null, blocked = true } = {}) {
  const st = baseState({ activeStadium: stadium ? inst('st1', stadium) : null });
  st.players[0].active = inst('a1', luxioId, blocked ? { evolvedThisTurn: true } : {});
  st.players[0].hand = [inst('h1', LUXRAY)];
  st.players[1].active = inst('b1', oppEx ? EX_CARD.id : NONEX.id);
  return st;
}
function evolveWorks(st, expectId = LUXRAY) {
  const after = mod.applyAction(st, { type: 'EVOLVE', fromIid: 'a1', toIid: 'h1' }, pool);
  return after.players[0].active?.cardId === String(expectId);
}
function uiOffers(st) {
  return mod.getEvolvableTargets(st, pool).some(t => t.fromIid === 'a1' && t.toIids.includes('h1'));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('── A. 勒克貓｜鬥志戰吼：同名不同印刷（行為端，完整 applyAction）─────────');
check('A1 MC 245/742（無特性）剛進化過 ⇒ 不可再進化（EVOLVE handler）', () => {
  assert.strictEqual(evolveWorks(luxioScene(LUXIO_MC)), false, 'MC 勒克貓不該拿到鬥志戰吼');
});
check('A2 MC 245/742（無特性）剛進化過 ⇒ UI 不亮進化（getEvolvableTargets）', () => {
  assert.strictEqual(uiOffers(luxioScene(LUXIO_MC)), false, 'UI 端不該提供進化選項');
});
check('A3 SV6 040/101（無特性）剛進化過 ⇒ 不可再進化', () => {
  assert.strictEqual(evolveWorks(luxioScene(LUXIO_SV6)), false, 'SV6 勒克貓不該拿到鬥志戰吼');
});
check('A4 SV6 040/101（無特性）剛進化過 ⇒ UI 不亮進化', () => {
  assert.strictEqual(uiOffers(luxioScene(LUXIO_SV6)), false, 'UI 端不該提供進化選項');
});
check('A5【正對照】M3 026/080（有鬥志戰吼）剛進化過 ⇒ 仍可進化', () => {
  assert.strictEqual(evolveWorks(luxioScene(LUXIO_M3)), true, 'M3 勒克貓必須維持可進化');
});
check('A6【正對照】M3 026/080 ⇒ UI 必須亮進化', () => {
  assert.strictEqual(uiOffers(luxioScene(LUXIO_M3)), true, 'UI 端必須提供進化選項');
});
check('A7【正對照】M3 026/080 但對手戰鬥場不是 ex ⇒ 不可進化（卡面條件）', () => {
  assert.strictEqual(evolveWorks(luxioScene(LUXIO_M3, { oppEx: false })), false, '卡面條件不成立時不該 bypass');
});
check('A8 M3 026/080 +【傳說的熔岩洞】(進化寶可夢特性全消) ⇒ 鬥志戰吼失效，不可進化', () => {
  assert.strictEqual(evolveWorks(luxioScene(LUXIO_M3, { stadium: MAGMA_CAVE })), false,
    '特性被消除時不該 bypass（舊碼只比對卡名，消除打不到）');
});
check('A9【誤殺防線】三張勒克貓在「一般時序」（未剛進化）都能正常進化', () => {
  for (const [lbl, id] of [['M3', LUXIO_M3], ['MC', LUXIO_MC], ['SV6', LUXIO_SV6]]) {
    assert.strictEqual(evolveWorks(luxioScene(id, { blocked: false })), true, `${lbl} 一般進化被誤殺`);
    assert.strictEqual(uiOffers(luxioScene(id, { blocked: false })), true, `${lbl} UI 一般進化被誤殺`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('── B. 提升進化 / 刺激進化：同名不同印刷的正對照（行為必須完全不變）─────');
function eeveeScene(eeveeId) {
  const st = baseState();
  st.players[0].active = inst('a1', eeveeId, { justPlaced: true });
  st.players[0].hand = [inst('h1', LEAFEON)];
  st.players[1].active = inst('b1', NONEX.id);
  return st;
}
check('B1【正對照】伊布 SV8a 125（有提升進化）剛使出 ⇒ 仍可進化', () => {
  assert.strictEqual(evolveWorks(eeveeScene(EEVEE_PUSH), LEAFEON), true, '提升進化被誤殺');
  assert.strictEqual(uiOffers(eeveeScene(EEVEE_PUSH)), true, '提升進化 UI 被誤殺');
});
check('B2【正對照】伊布 MC 564/742（無特性）剛使出 ⇒ 不可進化（同名不同印刷本來就該擋）', () => {
  assert.strictEqual(evolveWorks(eeveeScene(EEVEE_PLAIN), LEAFEON), false, '無特性的伊布不該 bypass');
  assert.strictEqual(uiOffers(eeveeScene(EEVEE_PLAIN)), false, '無特性的伊布 UI 不該亮');
});
check('B5【正對照】伊布 SV8a 125 在**備戰區**剛使出 ⇒ 不可進化（卡面：只要這隻寶可夢在戰鬥場上）', () => {
  const st = baseState();
  st.players[0].active = inst('x1', NONEX.id);
  st.players[0].bench = [inst('a1', EEVEE_PUSH, { justPlaced: true })];
  st.players[0].hand = [inst('h1', LEAFEON)];
  st.players[1].active = inst('b1', NONEX.id);
  const after = mod.applyAction(st, { type: 'EVOLVE', fromIid: 'a1', toIid: 'h1' }, pool);
  assert.strictEqual(after.players[0].bench[0]?.cardId, EEVEE_PUSH, '提升進化不該在備戰區生效');
  assert.strictEqual(mod.getEvolvableTargets(st, pool).some(t => t.fromIid === 'a1'), false,
    '備戰區的提升進化 UI 不該亮');
});

// ⚠ 刻意走行為端（applyAction / getEvolvableTargets），**不呼叫新 API** ——
//   這樣把 engine.ts 還原成 BASE blob 做 HEAD-FAIL 時，本段不會因為
//   「新函式還不存在」而 crash，可以逐條各自紅（Rule：各項各自紅，不是單一 crash）。
function shellinkScene(baseId, partnerId) {
  const st = baseState();
  st.players[0].active = inst('a1', baseId, { justPlaced: true });
  st.players[0].bench = [inst('p1', partnerId)];
  st.players[0].hand = [inst('h1', AGILE_BUG)];
  st.players[1].active = inst('b1', NONEX.id);
  return st;
}
check('B3【正對照】小嘴蝸 SV11W（有刺激進化）+ 蓋蓋蟲 ⇒ 剛使出仍可進化', () => {
  assert.strictEqual(evolveWorks(shellinkScene(SHELLINK_A, SHELLINK_B), AGILE_BUG), true, '刺激進化被誤殺');
  assert.strictEqual(uiOffers(shellinkScene(SHELLINK_A, SHELLINK_B)), true, '刺激進化 UI 被誤殺');
});
check('B4【正對照】小嘴蝸 SV9 008（無特性）+ 蓋蓋蟲 ⇒ 剛使出不可進化', () => {
  assert.strictEqual(evolveWorks(shellinkScene(SHELLINK_A0, SHELLINK_B0), AGILE_BUG), false, '無特性的小嘴蝸不該 bypass');
  assert.strictEqual(uiOffers(shellinkScene(SHELLINK_A0, SHELLINK_B0)), false, '無特性的小嘴蝸 UI 不該亮');
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('── C. 堅果啞鈴｜整人擊落：同名不同印刷（完整 ATTACK 流程）───────────────');
function oakScene(oakId) {
  const st = baseState({ activePlayerIndex: 1 });
  // p1（攻擊方）用花岩怪｜崩山 丟 p0 牌庫頂 1 張
  st.players[1].active = inst('b1', ROCKRUFF, { energyAttached: [inst('e1', DARK_ENERGY)] });
  st.players[1].deck = Array.from({ length: 20 }, (_, i) => inst(`d1${i}`, NONEX.id));
  st.players[0].active = inst('a1', NONEX.id);
  st.players[0].deck = [inst('oak', oakId), ...Array.from({ length: 10 }, (_, i) => inst(`d0${i}`, NONEX.id))];
  return st;
}
function attackerDeckAfterMill(oakId) {
  const st = oakScene(oakId);
  const before = st.players[1].deck.length;
  const after = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 1 }, pool);
  return { before, after: after.players[1].deck.length, victimDeck: after.players[0].deck.length };
}
check('C1【正對照】堅果啞鈴 M4 061/083（有整人擊落）被 mill ⇒ 攻擊方牌庫 -8', () => {
  const r = attackerDeckAfterMill(OAK_J);
  assert.strictEqual(r.victimDeck, 10, '崩山應丟受害方牌庫頂 1 張');
  assert.strictEqual(r.before - r.after, 8, `整人擊落必須丟攻擊方牌庫頂 8 張（實際 ${r.before - r.after}）`);
});
check('C2 堅果啞鈴 SV11W 064/086（無特性）被 mill ⇒ 攻擊方牌庫不變', () => {
  const r = attackerDeckAfterMill(OAK_SV);
  assert.strictEqual(r.victimDeck, 10, '崩山應丟受害方牌庫頂 1 張');
  assert.strictEqual(r.before - r.after, 0, `無特性的印刷不該觸發整人擊落（實際 -${r.before - r.after}）`);
});
check('C3 中央述詞 cardPrintsAbility 對三張堅果啞鈴的判定', () => {
  // ⚠ 先斷言函式存在 —— HEAD-FAIL 時要紅在這條斷言，而不是丟 TypeError 中斷整份測試
  assert.strictEqual(typeof mod.cardPrintsAbility, 'function', '中央述詞 cardPrintsAbility 不存在');
  assert.strictEqual(mod.cardPrintsAbility(pool.get(OAK_J), '整人擊落'), true);
  assert.strictEqual(mod.cardPrintsAbility(pool.get(OAK_SV), '整人擊落'), false);
  assert.strictEqual(mod.cardPrintsAbility(pool.get('13837'), '整人擊落'), false);
  assert.strictEqual(mod.cardPrintsAbility(pool.get(OAK_J), '不存在的特性'), false);
  assert.strictEqual(mod.cardPrintsAbility(null, '整人擊落'), false);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('── D. 全站掃描：特性 registry 的同名不同印刷碰撞 ─────────────────────────');
check('D1 getAbilityFn 的 by-index fallback 不會把 A 印刷的特性派給 B 印刷', () => {
  const byName = new Map();
  for (const c of hij) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  let groups = 0; const bad = [];
  for (const [nm, lst] of byName) {
    if (lst.length < 2) continue;
    const maxAb = Math.max(...lst.map(c => (c.abilities || []).length));
    for (let i = 0; i < maxAb; i++) {
      const names = new Set(lst.map(c => (c.abilities || [])[i]?.name).filter(Boolean));
      if (names.size < 2) continue;      // 同 index 特性名一致 ⇒ by-index 註冊不會混
      groups++;
      // 同一個 (卡名, index) 底下有 ≥2 種特性名 ⇒ 一旦有 by-index 註冊就必然錯派
      if (mod.ABILITY_EFFECTS.has(`${nm}|${i}`)) bad.push(`${nm}|${i} → ${[...names].join('/')}`);
    }
  }
  // ⚠ 下限斷言：掃描器壞掉（例如 abilities 欄位改名）時要紅，不是靜默全綠
  assert.ok(groups >= 8, `掃描器下限失敗：同名同 index 異特性只掃到 ${groups} 組（預期 ≥8）`);
  assert.deepStrictEqual(bad, [], `by-index 註冊撞同名異特性：${bad.join(', ')}`);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('── E. lint：用卡名決定特性行為時必須驗證「這張印刷真的印著」──────────────');
/** 掃描器本體（同時給正式掃描與正對照樣本使用） */
const VERIFY_TOKENS = /hasEffectiveAbilityByInst|_v6196HasEffAbilByInst|isAbilityHolderEffective|cardPrintsAbility|abilities|hasAbilityOnActive|hpAbilityEffective|getEvolveTimingBypass|regAByName|ABILITY_EFFECTS_BY_NAME/;
const NAME_EQ = /(?:\bname\b|\bName\b)\s*(?:===|!==)\s*['"`]([^'"`]+)['"`]|['"`]([^'"`]+)['"`]\s*(?:===|!==)\s*\w*[nN]ame\b/g;
function scanSource(text, riskySet) {
  const hits = [];      // 所有「拿高風險卡名做相等比對」的位置
  const viol = [];      // 其中沒有伴隨特性驗證的
  let s = text.replace(/[​-‍﻿]/g, '');                       // 剝零寬（v6.117 教訓）
  s = s.replace(/\/\*[\s\S]*?\*\//g, m => '\n'.repeat((m.match(/\n/g) || []).length)); // 剝區塊註解但保行號
  const lines = s.split('\n');
  // ⚠⚠ 視窗**必須**用剝掉註解後的碼 —— 突變測試 M7 抓到的守衛缺陷：
  //   只要註解裡提到 hasEffectiveAbilityByInst / cardPrintsAbility，違規碼就會被
  //   誤判成「有伴隨驗證」⇒ 註解就能讓整條 lint 失效（安慰劑）。
  const code = lines.map(l => (/^\s*\/\//.test(l) ? '' : l.split('//')[0]));
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\/\//.test(lines[i])) continue;
    const ln = code[i];
    NAME_EQ.lastIndex = 0;
    let m;
    while ((m = NAME_EQ.exec(ln)) !== null) {
      const nm = m[1] || m[2];
      if (!riskySet.has(nm)) continue;
      hits.push({ line: i + 1, name: nm, src: ln.trim() });
      const win = code.slice(Math.max(0, i - 8), i + 9).join('\n');
      if (!VERIFY_TOKENS.test(win)) viol.push({ line: i + 1, name: nm, src: ln.trim() });
    }
  }
  return { hits, viol };
}
// 高風險卡名 = live H/I/J 中「同名多印刷、且特性名集合不一致」的卡名
const RISKY = new Set();
{
  const byName = new Map();
  for (const c of hij) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  for (const [nm, lst] of byName) {
    if (lst.length < 2) continue;
    const sigs = new Set(lst.map(c => (c.abilities || []).map(a => a.name).sort().join('/')));
    if (sigs.size > 1) RISKY.add(nm);
  }
}
// ⚠ 白名單：逐條查證過「卡面本身就是以卡名為條件」或「dispatch 已由 abilities 驅動」。
//   以 **原始碼片段**（不是行號）比對，程式一改動就失效 ⇒ 不會變成永久免死金牌。
const ALLOW = [
  // 電氣球（Tool）卡面：「附有這張卡的『皮卡丘ex』…」— 條件本來就是卡名，與特性無關。
  "if (attCard.name !== '皮卡丘ex') return 0;",
  // regA('大力鱷',0) 內的 trigger-source fallback；按鈕是否出現已由 card.abilities 決定。
  ": allPokes.find(c => pool.get(c.cardId)?.name === '大力鱷');",
  // PASSIVE_ATTACK_BONUS 的 key 是**特性名**（'憤怒穴' / '大將'），engine 迭代
  // 場上卡的 abilities 才 dispatch ⇒ 沒印該特性的印刷根本不會呼叫到；卡名 gate 是額外保險。
  "if (att.name !== '棄世猴') return 0;",
  "if (att.name !== '仆斬將軍') return 0;",
  // 願增猿ex｜鬆口氣 卡面：「若自己的場上有『桃歹郎ex』」— 條件是卡名。
  "return c?.name === '桃歹郎ex' || (c?.name === '桃歹郎' && c?.subtype === 'ex');",
  // 爆炸頭水牛｜捲牆 卡面：「只要這隻寶可夢**與自己的其他「爆炸頭水牛」**在場上…」——
  //   partner 的條件是**卡名**（卡面沒有要求 partner 也帶特性），所以
  //   SV8 087/106（abilities=null）確實算數量。持有者那一端的 gate 在同函式下方
  //   （`card.abilities?.some(a => a.name === '捲牆')` + isAbilityHolderEffective）。
  "const buffaloByName = all.filter(c => pool.get(c.cardId)?.name === '爆炸頭水牛').length;",
];
check('E1【正對照】掃描器餵違規樣本必須抓得到（否則它只是安慰劑）', () => {
  const victim = [...RISKY][0];
  assert.ok(victim, '找不到高風險卡名，掃描器前提壞了');
  const sample = `const x = pool.get(c.cardId)?.name === '${victim}';\nreturn x ? 1 : 0;\n`;
  const r = scanSource(sample, RISKY);
  assert.strictEqual(r.hits.length, 1, '合成樣本沒被 NAME_EQ 抓到');
  assert.strictEqual(r.viol.length, 1, '合成違規樣本沒被判成違規 ⇒ 掃描器是安慰劑');
  // 反向：加上中央述詞後必須不再違規
  const fixed = `const x = cardPrintsAbility(pool.get(c.cardId), '某特性') && pool.get(c.cardId)?.name === '${victim}';\n`;
  assert.strictEqual(scanSource(fixed, RISKY).viol.length, 0, '加了中央述詞卻仍被判違規 ⇒ 誤報');
});
check('E2 全站掃描：沒有「用卡名決定特性行為卻不驗證印刷」的地方', () => {
  const files = [];
  (function walk(p) {
    for (const e of readdirSync(p)) {
      if (e === 'node_modules' || e === '.git') continue;
      const q = join(p, e);
      if (statSync(q).isDirectory()) walk(q);
      else if (/\.(ts|svelte)$/.test(e)) files.push(q);
    }
  })(join(ROOT, 'src'));
  assert.ok(files.length >= 100, `掃描器下限失敗：只找到 ${files.length} 個原始檔`);
  assert.ok(RISKY.size >= 50, `掃描器下限失敗：高風險卡名只有 ${RISKY.size} 個（預期 ≥50）`);
  let totalHits = 0; const viols = [];
  for (const p of files) {
    const r = scanSource(readFileSync(p, 'utf8'), RISKY);
    totalHits += r.hits.length;
    for (const v of r.viol) {
      if (ALLOW.some(a => v.src.includes(a))) continue;
      viols.push(`${relative(ROOT, p).replace(/\\/g, '/')}:${v.line} [${v.name}] ${v.src.slice(0, 120)}`);
    }
  }
  assert.ok(totalHits >= 20, `掃描器下限失敗：只掃到 ${totalHits} 個卡名相等比對（預期 ≥20）`);
  assert.deepStrictEqual(viols, [], `\n  ${viols.join('\n  ')}\n`);
});
check('E3 白名單不得有死條目（程式改過就要回來重判）', () => {
  const all = [];
  (function walk(p) {
    for (const e of readdirSync(p)) {
      if (e === 'node_modules' || e === '.git') continue;
      const q = join(p, e);
      if (statSync(q).isDirectory()) walk(q);
      else if (/\.(ts|svelte)$/.test(e)) all.push(readFileSync(q, 'utf8'));
    }
  })(join(ROOT, 'src'));
  const blob = all.join('\n');
  const dead = ALLOW.filter(a => !blob.includes(a));
  assert.deepStrictEqual(dead, [], `白名單死條目：${dead.join(' | ')}`);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('── F. 進化時序豁免：單一 producer（兩端不可能再分岔）──────────────────────');
check('F1 engine.ts 中「提升進化」「鬥志戰吼」只出現在 getEvolveTimingBypass 內', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => '\n'.repeat((m.match(/\n/g) || []).length));
  const lines = src.split('\n');
  const start = lines.findIndex(l => l.includes('export function getEvolveTimingBypass'));
  assert.ok(start > 0, '找不到 getEvolveTimingBypass ⇒ 中央 producer 不見了');
  const end = lines.findIndex((l, i) => i > start && /^\}/.test(l));
  assert.ok(end > start && end - start < 40, `producer 函式界線異常（${start}→${end}）⇒ anchor 失效`);
  for (const key of ['提升進化', '鬥志戰吼']) {
    const at = [];
    lines.forEach((l, i) => { if (!/^\s*\/\//.test(l) && l.split('//')[0].includes(`'${key}'`)) at.push(i); });
    assert.ok(at.length >= 1, `engine.ts 找不到 '${key}' ⇒ 掃描器 anchor 失效`);
    const outside = at.filter(i => i < start || i > end);
    assert.deepStrictEqual(outside.map(i => i + 1), [],
      `'${key}' 在 getEvolveTimingBypass 之外還有 ${outside.length} 處（行 ${outside.map(i => i + 1).join(',')}）`);
  }
});
check('F2 getEvolvableTargets 與 EVOLVE handler 都經由 getEvolveTimingBypass', () => {
  // ⚠ 必須剝掉註解才檢查 —— 註解裡會逐字引用舊碼（否則這條永遠紅）
  const src = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.split('//')[0]).join('\n');
  const calls = (src.match(/getEvolveTimingBypass\(/g) || []).length;
  assert.ok(calls >= 3, `getEvolveTimingBypass 呼叫點只有 ${calls}（定義 1 + 兩端各 1 ⇒ 至少 3）`);
  assert.ok(!/\.name === '勒克貓'/.test(src), 'engine.ts 仍有 name === 勒克貓 的手刻判定');
});
check('F3 兩端結果一致（行為端交叉驗證，非字串比對）', () => {
  for (const id of [LUXIO_M3, LUXIO_MC, LUXIO_SV6]) {
    for (const oppEx of [true, false]) {
      const st = luxioScene(id, { oppEx });
      assert.strictEqual(uiOffers(st), evolveWorks(st),
        `印刷 ${id} oppEx=${oppEx}：UI 與 handler 判定分岔`);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${fails.length === 0 ? '✅' : '❌'} v6.257 同名不同印刷 dispatch 守衛：${pass} PASS / ${fails.length} FAIL`);
if (fails.length) { for (const f of fails) console.error('  - ' + f); process.exit(1); }
