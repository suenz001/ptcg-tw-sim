/**
 * v6.260 守衛 — 「KO 之後該觸發什麼」依【昏厥原因 × 位置】對齊卡面（備戰 KO 缺口修補）
 *
 * 真因（BASE e9157fe2）三類：
 *  (1) fireDefenderOnKO 開頭 `if (!isActive) return` 一刀切 —— 但 桃歹郎｜最後鎖鏈 與
 *      希望護身符 卡面**沒有**「在戰鬥場」⇒ 備戰被狙擊 KO 也應觸發（對照組 沙之羽擊／
 *      光子纜線／炸裂針／沉重接力棒 卡面都有「在戰鬥場」⇒ 維持只在戰鬥場）。
 *  (2) 四條傷害 KO 路徑（hitBenchAll／bench-hit-N／snipe-60-ex／olive-oil-distribute）
 *      完全沒呼叫 fireDefenderOnKO 與 applyPreventKOToVictim ⇒ 潛者捕捉／防 KO 家族
 *      （倖存鍛鍊器/勤奮之心/結實/堅忍之軀/不朽身軀，卡面皆無「在戰鬥場」）整批漏。
 *  (3) 效果 KO 被當傷害 KO：applyDamageToAllOpp（痛楚記憶等「放置指示物」）以
 *      koByAttackDamage=true 結算 ⇒ 鬆口氣/豪華斗篷等獎賞修正與 TOOL_ON_KO 誤觸發；
 *      fireDefenderOnKO ① TOOL_ON_KO 段沒 gate koByAttackDamage ⇒ 效果 KO 誤開護身符 picker。
 *
 * 多 picker 併發：由既有 pendingChainQueue（v4.933）＋ pendingToken（v6.175）排隊，非新機制。
 * ⚠ 只捕捉 assert.AssertionError，其餘照丟。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.k60-s.js'), E = join(ROOT, '.k60-e.ts'), O = join(ROOT, '.k60-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction } from './src/lib/game/engine';\n" +
  "export { RESOLVERS } from './src/lib/game/effects/_shared';\n" +
  "export { dealAttackDamageToTarget, hitBenchAllForCard, applyDamageToAllOpp,\n" +
  "         fireDefenderOnKO, applyPreventKOToVictim,\n" +
  "         PASSIVE_ON_KO, PASSIVE_ON_KO_BENCH_ALSO, PASSIVE_KO_RETALIATION,\n" +
  "         TOOL_ON_KO, TOOL_PREVENT_KO, PASSIVE_PREVENT_KO } from './src/lib/game/effects';\n" +
  "export { TOOL_ON_KO_BENCH_ALSO, TOOL_ON_KO_MIRRORED_FROM_DAMAGED } from './src/lib/game/effects/cards/tools';\n" +
  "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map(); const allCards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id != null) { pool.set(String(c.id), c); allCards.push(c); }
  }
}

let pass = 0; const fails = [];
const T = (label, fn) => {
  try { fn(); pass++; console.log('  ✅ ' + label); }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;
    fails.push(label + ' — ' + e.message);
    console.log('  ❌ ' + label + '\n      ' + e.message);
  }
};

// 卡片 id（static/cards 逐一查證）
const MOMO = '14775';        // 桃歹郎(M2a,I) HP80 最後鎖鏈（卡面無「在戰鬥場」）
const HOPE = '11278';        // 希望護身符(SV8,H)（卡面無「在戰鬥場」）
const SURV = '10306';        // 倖存鍛鍊器(SV5a,H)（卡面無「在戰鬥場」）
const PIKA = '14704';        // 皮卡丘ex(M2a,H) HP200 勤奮之心（滿血防KO，卡面無「在戰鬥場」）
const HAWL = '14754';        // 超級摔角鷹人ex(M2a,I) HP250 堅忍之軀（擲幣防KO）
const DFLY = '14432';        // 沙漠蜻蜓(M-P-I,I) HP150 沙之羽擊（卡面**有**「在戰鬥場」）
const MILT = '19235';        // 密勒頓(M-P-J,J) HP120 光子纜線（卡面**有**「在戰鬥場」）
const CACT = '12468';        // 沙鈴仙人掌(SV9,I) HP110 炸裂針（卡面**有**「在戰鬥場」）
const BATON = '9907';        // 沉重接力棒(SV5M,H)（卡面**有**「在戰鬥場」）
const MOAT = '19237';        // 護城龍(M-P-J,J) HP160 撤退費4（接力棒對照用）
const RELI = '12774';        // 獵斑魚(SV10,I) HP110 潛者捕捉（戰鬥場或備戰皆觸發）
const WEN = '10619';         // 願增猿ex(SV6a,H) HP210 鬆口氣（卡面無「在戰鬥場」→ v6.259 已中央化）
const MEX = '10621';         // 桃歹郎ex(SV6a,H)
const EMOL = '10456';        // 電飛鼠(SV6,H) 天空波：雙方所有備戰各10
const WATER = '18519';       // 基本【水】能量
const ELEC = '18520';        // 基本【雷】能量
const TOWER = '15970';       // 阻礙之塔(M2a)
const ROCK = '13741';        // 岩殿居蟹(SV11B,I) HP150 結實（滿血防KO，非太晶）

let IID = 0;
const inst = (cardId, over = {}) => ({ iid: 'i' + (++IID), cardId: String(cardId), damage: 0, energyAttached: [], ...over });
const filler = () => inst(PIKA);
const mk = (p0over = {}, p1over = {}, over = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: inst(PIKA), bench: [], hand: [], deck: [filler(), filler()], discard: [], prizes: [filler(), filler(), filler()], ...p0over },
    { name: 'B', active: inst(PIKA), bench: [filler()], hand: [], deck: [filler(), filler(), filler(), filler()], discard: [], prizes: [filler(), filler(), filler()], ...p1over },
  ], ...over,
});
const pickers = (s) => [...(s.pendingSelection ? [s.pendingSelection] : []), ...(s.pendingChainQueue ?? [])];
const logCount = (s, kw) => s.log.filter(l => (l.message ?? '').includes(kw)).length;

console.log('── A 組：備戰被對手招式傷害 KO ⇒ 卡面無「在戰鬥場」的效果應觸發 ──');

T('A1 中央狙擊 KO 備戰桃歹郎 → 最後鎖鏈開 picker（恰好 1 次）', () => {
  const momo = inst(MOMO, { damage: 70 });
  let s = mk({}, { bench: [momo, filler()] });
  s = mod.dealAttackDamageToTarget(s, 0, momo.iid, 60, pool, { kind: 'attack-damage', label: '狙擊' });
  const ps = pickers(s);
  assert.strictEqual(ps.length, 1, 'picker 數應=1，實得 ' + ps.length);
  assert.strictEqual(ps[0].effectKey, 'search-to-hand-reshuffle');
  assert.strictEqual(ps[0].actorIdx, 1, 'picker 應由被 KO 方(B)來選');
  assert.strictEqual(logCount(s, '最後鎖鏈'), 1, '「最後鎖鏈」log 恰好 1 次');
});

T('A2 hitBenchAll 一次 KO 兩隻桃歹郎 → 兩個 picker 依序排隊（各恰好 1 次）', () => {
  const m1 = inst(MOMO, { damage: 70 }), m2 = inst(MOMO, { damage: 70 });
  let s = mk({}, { bench: [m1, m2, filler()] });
  s = mod.hitBenchAllForCard(s, 0, 1, 10, pool, '天空波');
  const ps = pickers(s);
  assert.strictEqual(ps.length, 2, 'picker 數應=2，實得 ' + ps.length);
  assert.ok(ps.every(p => p.effectKey === 'search-to-hand-reshuffle'));
  assert.strictEqual(logCount(s, '最後鎖鏈'), 2, '兩隻各觸發恰好 1 次');
});

T('A3 bench-hit-N KO 桃歹郎(附希望護身符) → 護身符+最後鎖鏈共 2 個 picker', () => {
  const v = inst(MOMO, { damage: 10, toolAttached: inst(HOPE) });
  let s = mk({}, { bench: [v, filler()] });
  s = mod.RESOLVERS.get('bench-hit-N')(s, 0, [v.iid], { amount: 130, attackLabel: '激流水泵' }, pool);
  assert.strictEqual(pickers(s).length, 2, 'picker 應=2');
  assert.strictEqual(logCount(s, '希望護身符'), 1);
  assert.strictEqual(logCount(s, '最後鎖鏈'), 1);
});

T('A4 snipe-60-ex KO 備戰桃歹郎 → 最後鎖鏈觸發', () => {
  const v = inst(MOMO, { damage: 70 });
  let s = mk({}, { bench: [v, filler()] });
  s = mod.RESOLVERS.get('snipe-60-ex')(s, 0, [v.iid], {}, pool);
  assert.strictEqual(pickers(s).length, 1);
  assert.strictEqual(logCount(s, '最後鎖鏈'), 1);
});

T('A5 olive-oil-distribute KO 戰鬥場桃歹郎(附護身符) → 2 個 picker（本 resolver 原連戰鬥位都漏）', () => {
  const v = inst(MOMO, { damage: 0, toolAttached: inst(HOPE) });
  let s = mk({}, { active: v, bench: [filler()] });
  s = mod.RESOLVERS.get('olive-oil-distribute')(s, 0, Array(4).fill(v.iid),
    { totalCounters: 4, placedCounters: 0, counterDamage: 20, label: '油之機關槍' }, pool);
  assert.strictEqual(pickers(s).length, 2, 'picker 應=2（護身符+最後鎖鏈）');
  assert.strictEqual(logCount(s, '希望護身符'), 1);
  assert.strictEqual(logCount(s, '最後鎖鏈'), 1);
});

T('A6 hitBenchAll KO 備戰獵斑魚(附基本水) → 潛者捕捉排入 _diverCatchQueue', () => {
  const w = inst(WATER);
  const r = inst(RELI, { damage: 100, energyAttached: [w] });
  let s = mk({}, { bench: [r, filler()] });
  s = mod.hitBenchAllForCard(s, 0, 1, 10, pool, '天空波');
  assert.strictEqual((s._diverCatchQueue ?? []).length, 1, '_diverCatchQueue 應=1');
  assert.strictEqual(s._diverCatchQueue[0].heldEnergy.length, 1);
});

T('A7 端到端 applyAction：天空波雙 KO → token 蓋章 → RESOLVE_SELECTION 逐一解完', () => {
  const m1 = inst(MOMO, { damage: 70 }), m2 = inst(MOMO, { damage: 70 });
  const atk = inst(EMOL, { energyAttached: [inst(ELEC)] });
  let s = mk({ active: atk }, { bench: [m1, m2, filler()] });
  s = mod.applyAction(s, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  assert.ok(s.pendingSelection, '第一個 picker 應浮上');
  assert.strictEqual(typeof s.pendingSelection.token, 'number', 'picker 應有 pendingToken');
  const t1 = s.pendingSelection.token;
  assert.strictEqual((s.pendingChainQueue ?? []).length, 1, '第二個 picker 應在佇列');
  const pick1 = s.players[1].deck[0].iid;
  s = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [pick1], pendingToken: t1 }, pool);
  assert.ok(s.pendingSelection, '第二個 picker 應 pop 出來');
  assert.notStrictEqual(s.pendingSelection.token, t1, '第二個 picker 的 token 應不同');
  const pick2 = s.players[1].deck[0].iid;
  s = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [pick2], pendingToken: s.pendingSelection.token }, pool);
  assert.ok(!s.pendingSelection, '兩個 picker 都解完');
  assert.strictEqual((s.pendingChainQueue ?? []).length, 0);
  assert.strictEqual(s.players[1].hand.length, 2, '被 KO 方兩次各拿 1 張入手');
});

T('A8 倖存鍛鍊器：備戰滿血被 bench-hit-N 130 → 防 KO 留 HP10、道具進棄牌', () => {
  const tool = inst(SURV);
  const v = inst(MOMO, { damage: 0, toolAttached: tool });
  let s = mk({}, { bench: [v, filler()] });
  s = mod.RESOLVERS.get('bench-hit-N')(s, 0, [v.iid], { amount: 130, attackLabel: '激流水泵' }, pool);
  const kept = s.players[1].bench.find(x => x.iid === v.iid);
  assert.ok(kept, '應留在備戰');
  assert.strictEqual(kept.damage, 70, 'HP80 留 10 ⇒ damage=70');
  assert.ok(s.players[1].discard.some(x => x.iid === tool.iid), '倖存鍛鍊器應進棄牌');
});

T('A9 結實：備戰滿血岩殿居蟹(HP150,非太晶) 被油之機關槍 160 → 防 KO 留 HP10', () => {
  // ⚠ 勤奮之心持有者皮卡丘ex(M2a)是太晶 ⇒ 備戰本來就免疫招式傷害（另有守衛），
  //   這裡用同義的被動防 KO「結實」（岩殿居蟹 SV11B 13741）驗備戰防 KO 路徑。
  const v = inst(ROCK, { damage: 0 });
  let s = mk({}, { bench: [v, filler()] });
  s = mod.RESOLVERS.get('olive-oil-distribute')(s, 0, Array(8).fill(v.iid),
    { totalCounters: 8, placedCounters: 0, counterDamage: 20, label: '油之機關槍' }, pool);
  const kept = s.players[1].bench.find(x => x.iid === v.iid);
  assert.ok(kept, '應留在備戰');
  assert.strictEqual(kept.damage, 140, 'HP150 留 10 ⇒ damage=140');
});

T('A10 堅忍之軀：備戰被 KO 級傷害 → 正面防（反面照 KO）', () => {
  const orig = Math.random;
  try {
    Math.random = () => 0.1;   // 正面
    const v1 = inst(HAWL, { damage: 130 });
    let s1 = mk({}, { bench: [v1, filler()] });
    s1 = mod.RESOLVERS.get('bench-hit-N')(s1, 0, [v1.iid], { amount: 130, attackLabel: '激流' }, pool);
    assert.ok(s1.players[1].bench.some(x => x.iid === v1.iid), '正面應防 KO');
    Math.random = () => 0.9;   // 反面
    const v2 = inst(HAWL, { damage: 130 });
    let s2 = mk({}, { bench: [v2, filler()] });
    s2 = mod.RESOLVERS.get('bench-hit-N')(s2, 0, [v2.iid], { amount: 130, attackLabel: '激流' }, pool);
    assert.ok(!s2.players[1].bench.some(x => x.iid === v2.iid), '反面應照 KO');
  } finally { Math.random = orig; }
});

console.log('── B 組：正對照（不可變的行為）──');

T('B1 戰鬥場桃歹郎(附護身符)被中央狙擊 KO → 2 個 picker（既有行為不變）', () => {
  const momo = inst(MOMO, { damage: 70, toolAttached: inst(HOPE) });
  let s = mk({}, { active: momo, bench: [filler()] });
  s = mod.dealAttackDamageToTarget(s, 0, momo.iid, 60, pool, { kind: 'attack-damage', label: '狙擊' });
  assert.strictEqual(pickers(s).length, 2);
  assert.strictEqual(logCount(s, '希望護身符'), 1);
  assert.strictEqual(logCount(s, '最後鎖鏈'), 1);
});

T('B2a 沙之羽擊（卡面有「在戰鬥場」）：備戰沙漠蜻蜓被狙擊 KO → 不觸發（對手牌庫不動）', () => {
  const v = inst(DFLY, { damage: 140 });
  let s = mk({}, { bench: [v, filler()] });
  const deckBefore = s.players[0].deck.length;
  s = mod.dealAttackDamageToTarget(s, 0, v.iid, 60, pool, { kind: 'attack-damage', label: '狙擊' });
  assert.strictEqual(logCount(s, '沙之羽擊'), 0);
  assert.strictEqual(s.players[0].deck.length, deckBefore, '攻擊方牌庫不得被丟');
});

T('B2b 光子纜線（卡面有「在戰鬥場」）：備戰密勒頓(附基本雷)被狙擊 KO → 不觸發', () => {
  const v = inst(MILT, { damage: 110, energyAttached: [inst(ELEC)] });
  let s = mk({}, { bench: [v, filler()] });
  s = mod.dealAttackDamageToTarget(s, 0, v.iid, 60, pool, { kind: 'attack-damage', label: '狙擊' });
  assert.strictEqual(logCount(s, '光子纜線'), 0);
  assert.strictEqual(pickers(s).length, 0);
});

T('B2c 炸裂針（卡面有「在戰鬥場」）：備戰沙鈴仙人掌被狙擊 KO → 攻擊方不吃 6 個指示物', () => {
  const v = inst(CACT, { damage: 100 });
  let s = mk({}, { bench: [v, filler()] });
  const atkDmgBefore = s.players[0].active.damage;
  s = mod.dealAttackDamageToTarget(s, 0, v.iid, 60, pool, { kind: 'attack-damage', label: '狙擊' });
  assert.strictEqual(logCount(s, '炸裂針'), 0);
  assert.strictEqual(s.players[0].active.damage, atkDmgBefore);
});

T('B2d 沉重接力棒（卡面有「在戰鬥場」）：備戰護城龍(撤退4,附能量)被狙擊 KO → 不觸發', () => {
  const v = inst(MOAT, { damage: 150, energyAttached: [inst(WATER), inst(WATER)], toolAttached: inst(BATON) });
  let s = mk({}, { bench: [v, filler()] });
  s = mod.dealAttackDamageToTarget(s, 0, v.iid, 60, pool, { kind: 'attack-damage', label: '狙擊' });
  assert.strictEqual(logCount(s, '沉重接力棒'), 0);
  assert.strictEqual(pickers(s).length, 0);
});

T('B3 戰鬥場沙鈴仙人掌被狙擊 KO → 炸裂針照舊觸發（+60）', () => {
  const v = inst(CACT, { damage: 100 });
  let s = mk({}, { active: v, bench: [filler()] });
  const atkDmgBefore = s.players[0].active.damage;
  s = mod.dealAttackDamageToTarget(s, 0, v.iid, 60, pool, { kind: 'attack-damage', label: '狙擊' });
  assert.strictEqual(logCount(s, '炸裂針'), 1);
  assert.strictEqual(s.players[0].active.damage, atkDmgBefore + 60);
});

T('B4 鬆口氣（獎賞維度，卡面無「在戰鬥場」）：hitBenchAll KO 備戰願增猿ex(場上有桃歹郎ex) → 獎賞 2-1=1', () => {
  const v = inst(WEN, { damage: 200 });
  let s = mk({}, { bench: [v, inst(MEX), filler()] });
  const prizesBefore = s.players[0].prizes.length;
  const handBefore = s.players[0].hand.length;
  s = mod.hitBenchAllForCard(s, 0, 1, 10, pool, '天空波');
  assert.strictEqual(logCount(s, '鬆口氣'), 1);
  const gained = (prizesBefore - s.players[0].prizes.length);
  assert.strictEqual(gained, 1, 'ex=2 經鬆口氣 -1 ⇒ 恰拿 1 張，實得 ' + gained);
});

T('B5 自傷不觸發：hitBenchAll 打「自己」備戰 KO 自家桃歹郎 → 無 picker（卡面「對手的」）', () => {
  const m1 = inst(MOMO, { damage: 70 });
  let s = mk({ bench: [m1, filler()] }, {});
  s = mod.hitBenchAllForCard(s, 0, 0, 10, pool, '地震');
  assert.strictEqual(pickers(s).length, 0);
  assert.strictEqual(logCount(s, '最後鎖鏈'), 0);
});

T('B6 阻礙之塔：備戰 KO 時道具(護身符)失效、特性(最後鎖鏈)照觸發', () => {
  const v = inst(MOMO, { damage: 70, toolAttached: inst(HOPE) });
  let s = mk({}, { bench: [v, filler()] }, { activeStadium: inst(TOWER) });
  s = mod.dealAttackDamageToTarget(s, 0, v.iid, 60, pool, { kind: 'attack-damage', label: '狙擊' });
  assert.strictEqual(logCount(s, '希望護身符'), 0, '阻礙之塔 ⇒ 道具不觸發');
  assert.strictEqual(logCount(s, '最後鎖鏈'), 1, '特性不受阻礙之塔影響');
});

console.log('── C 組：效果 KO（非傷害）一律不觸發 ──');

T('C1 效果 KO（放指示物）備戰桃歹郎 → 不觸發', () => {
  const momo = inst(MOMO, { damage: 70 });
  let s = mk({}, { bench: [momo, filler()] });
  s = mod.dealAttackDamageToTarget(s, 0, momo.iid, 60, pool, { kind: 'attack-effect', label: '指示物' });
  assert.strictEqual(pickers(s).length, 0);
});

T('C2 效果 KO 戰鬥場桃歹郎(附護身符) → 道具/特性皆不觸發（BASE 誤開 picker）', () => {
  const momo = inst(MOMO, { damage: 70, toolAttached: inst(HOPE) });
  let s = mk({}, { active: momo, bench: [filler()] });
  s = mod.dealAttackDamageToTarget(s, 0, momo.iid, 60, pool, { kind: 'attack-effect', label: '指示物' });
  assert.strictEqual(pickers(s).length, 0, '效果 KO 不得開任何 on-KO picker');
});

T('C3 痛楚記憶(applyDamageToAllOpp) KO 願增猿ex(場上有桃歹郎ex) → 鬆口氣不套、獎賞照 2 張', () => {
  const w = inst(WEN, { damage: 190 });
  let s = mk({}, { active: w, bench: [inst(MEX), filler()] });
  const prizesBefore = s.players[0].prizes.length;
  s = mod.applyDamageToAllOpp(s, 0, pool, 20, false, '痛楚記憶');
  assert.strictEqual(logCount(s, '鬆口氣'), 0, '效果 KO 不套鬆口氣');
  assert.strictEqual(prizesBefore - s.players[0].prizes.length, 2, 'ex 效果 KO 應照拿 2 張');
});

T('C4 痛楚記憶 KO 戰鬥場帶護身符 → 不開 picker（BASE 誤開）', () => {
  const momo = inst(MOMO, { damage: 70, toolAttached: inst(HOPE) });
  let s = mk({}, { active: momo, bench: [filler()] });
  s = mod.applyDamageToAllOpp(s, 0, pool, 20, false, '痛楚記憶');
  assert.strictEqual(pickers(s).length, 0);
});

console.log('── D 組：宣告集合 ↔ 卡面「在戰鬥場」雙向守衛（掃描器含下限＋正對照）──');

T('D1 TOOL_ON_KO 全成員：BENCH_ALSO ⟺ 卡面無「在戰鬥場」', () => {
  const toolNames = [...mod.TOOL_ON_KO.keys()];
  assert.ok(toolNames.length >= 8, 'TOOL_ON_KO 至少 8 個成員（掃描器下限），實得 ' + toolNames.length);
  for (const name of toolNames) {
    // 部分鏡射道具（凸凸頭盔）live 版是 G 標 ⇒ 卡面檢查退回任意 live 印刷（文字相同）
    const card = allCards.find(c => c.name === name && 'HIJ'.includes(c.regulationMark ?? ''))
      ?? allCards.find(c => c.name === name);
    assert.ok(card, `找不到 live 卡面：${name}`);
    const text = (card.rulesText ?? '').replace(/[​-‍﻿]/g, '');
    const hasActiveOnly = text.includes('在戰鬥場');
    const declaredBenchAlso = mod.TOOL_ON_KO_BENCH_ALSO.has(name);
    assert.strictEqual(declaredBenchAlso, !hasActiveOnly,
      `${name}: 卡面${hasActiveOnly ? '有' : '無'}「在戰鬥場」但 BENCH_ALSO=${declaredBenchAlso}`);
  }
  // 正對照：判準本身抓得到「在戰鬥場」字樣
  assert.ok('附有這張卡的寶可夢在戰鬥場受到'.includes('在戰鬥場'), '正對照');
});

T('D2 PASSIVE_ON_KO＋PASSIVE_KO_RETALIATION 全成員：BENCH_ALSO ⟺ 卡面無「在戰鬥場」', () => {
  const abNames = [...new Set([...mod.PASSIVE_ON_KO.keys(), ...mod.PASSIVE_KO_RETALIATION.keys()])];
  assert.ok(abNames.length >= 4, '至少 4 個成員（下限），實得 ' + abNames.length);
  for (const name of abNames) {
    const card = allCards.find(c => (c.abilities ?? []).some(a => a.name === name) && 'HIJ'.includes(c.regulationMark ?? ''));
    assert.ok(card, `找不到 live H/I/J 卡面：${name}`);
    const ab = card.abilities.find(a => a.name === name);
    const text = (ab.effect ?? '').replace(/[​-‍﻿]/g, '');
    const hasActiveOnly = text.includes('在戰鬥場');
    const declaredBenchAlso = mod.PASSIVE_ON_KO_BENCH_ALSO.has(name);
    assert.strictEqual(declaredBenchAlso, !hasActiveOnly,
      `${name}: 卡面${hasActiveOnly ? '有' : '無'}「在戰鬥場」但 BENCH_ALSO=${declaredBenchAlso}`);
  }
});

T('D3 防 KO 家族全成員：卡面必須無「在戰鬥場」（有的話備戰補觸發就是過度觸發）', () => {
  const names = [...mod.TOOL_PREVENT_KO.keys()];
  const abNames = [...mod.PASSIVE_PREVENT_KO.keys()];
  assert.ok(names.length + abNames.length >= 5, '防 KO 家族至少 5 個（下限）');
  for (const name of names) {
    const card = allCards.find(c => c.name === name && 'HIJ'.includes(c.regulationMark ?? ''));
    assert.ok(card, `找不到卡面：${name}`);
    assert.ok(!(card.rulesText ?? '').includes('在戰鬥場'), `${name} 卡面有「在戰鬥場」，備戰觸發需重審`);
  }
  for (const name of abNames) {
    const card = allCards.find(c => (c.abilities ?? []).some(a => a.name === name) && 'HIJ'.includes(c.regulationMark ?? ''));
    assert.ok(card, `找不到卡面：${name}`);
    const ab = card.abilities.find(a => a.name === name);
    assert.ok(!(ab.effect ?? '').includes('在戰鬥場'), `${name} 卡面有「在戰鬥場」，備戰觸發需重審`);
  }
});

T('D4 靜態守衛：傷害 KO 且會移除寶可夢的路徑必須接 fireDefenderOnKO（掃描器含下限）', () => {
  // 錨點法：在 effects.ts / mega_decks.ts 找「koPrizesAdjusted(」呼叫點（剝註解），
  //   第 7 參數含 false ⇒ 效果 KO（免）；否則為傷害 KO ⇒ 其後 80 行內必須出現 fireDefenderOnKO。
  //   例外（附行為端證明）：engine.ts 主管線（inline TOOL_ON_KO/PASSIVE_ON_KO 迴圈，B1/B3 已驗）。
  const files = ['src/lib/game/effects.ts', 'src/lib/game/effects/cards/mega_decks.ts'];
  let scanned = 0; const misses = [];
  for (const f of files) {
    const raw = readFileSync(join(ROOT, f), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    let idx = 0;
    while ((idx = src.indexOf('koPrizesAdjusted(', idx)) !== -1) {
      const callStart = idx; idx += 1;
      if (src.slice(callStart - 20, callStart).includes('function ')) continue;  // 定義本身
      // 抓整個呼叫的引數（括號配對）
      let depth = 0, end = callStart;
      for (let i = src.indexOf('(', callStart); i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      const args = src.slice(callStart, end + 1);
      scanned++;
      if (/,\s*false\s*\)$/.test(args)) continue;               // 效果 KO：不需觸發
      const after = src.slice(end, end + 4000);
      if (!after.includes('fireDefenderOnKO')) misses.push(f + ' @' + args.slice(0, 60));
    }
  }
  assert.ok(scanned >= 10, `掃描器下限：呼叫點應 ≥10，實掃 ${scanned}（掃描器壞了？）`);
  assert.strictEqual(misses.length, 0, '傷害 KO 路徑漏接 fireDefenderOnKO：\n' + misses.join('\n'));
});

T('D5 正對照：D4 的掃描器抓得到違規樣本', () => {
  // 餵一段「傷害 KO 卻沒接 fireDefenderOnKO」的假碼，確認判準會標紅
  const fake = 'const _ko = koPrizesAdjusted(s, x, c, a, d, pool); s = _ko.state; return s; '.padEnd(5000, ' ');
  const callStart = fake.indexOf('koPrizesAdjusted(');
  let depth = 0, end = callStart;
  for (let i = fake.indexOf('(', callStart); i < fake.length; i++) {
    if (fake[i] === '(') depth++;
    else if (fake[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  const args = fake.slice(callStart, end + 1);
  assert.ok(!/,\s*false\s*\)$/.test(args), '樣本應被視為傷害 KO');
  assert.ok(!fake.slice(end, end + 4000).includes('fireDefenderOnKO'), '樣本應被標為漏接');
});

console.log(`\n=== v6260 bench-ko-onko: ${pass} PASS, ${fails.length} FAIL ===`);
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
