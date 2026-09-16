#!/usr/bin/env node
/**
 * v6.397 守衛：「自身傷害指示物 × k」收斂到中央 selfCountersMultiplyPre（Rule 38）。
 *
 * 收斂前站上有**四份手刻**、**兩種 log 措辭**，算的卻是同一條卡面：
 *   「造成這隻寶可夢身上放置的傷害指示物的數量×N點傷害。」（static/cards 逐張查證）
 *     ・醜醜魚｜抓狂 n*10（無 log）／厄鬼椪 火灶面具ex｜憤怒之窯 n*20（無 log）
 *     ・鐵炮魚｜抓狂（log 措辭 A）／石居蟹｜抓狂（log 措辭 B）
 *
 * ⚠⚠ 靶的選法（ptcg-guard-quality 的坑，我在寫這一版時真的踩到）：
 *   拿隨便一隻當靶會對不上 —— 水打火是弱點 ×2，30 會變成 60。
 *   這裡**自動挑一隻對出招者屬性中立**（弱點≠攻擊屬性、抵抗力≠攻擊屬性）的高血靶，
 *   並用 B1 反安慰劑證明「挑靶機制真的有在避開弱點」（弱點靶必須真的 ×2）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const S = join(ROOT, '.x-397g-s.js'), E = join(ROOT, '.x-397g-e.ts'), O = join(ROOT, '.x-397g-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* 忽略 */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\n"
  + "export { getBasicEnergyType } from './src/lib/game/selection-filter';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, ATTACK_PRE, getBasicEnergyType } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS ' + n); pass++; } catch (e) { console.log('  FAIL ' + n + ' :: ' + e.message); fail++; } };

/**
 * 依屬性挑基本能量。
 * ⚠ 現役基本能量卡的 `pokemonType` 大多是 **null** ⇒ 一定要走中央述詞 getBasicEnergyType
 *   （它有卡名 fallback），自己寫一份一定會挑錯 ⇒ 招式打不出來、傷害 0。
 * ⚠ cost 裡的【無】(Colorless) 任何能量都能付 ⇒ 用第一張基本能量即可。
 */
const energyByType = new Map();
let anyEnergyId = null;
for (const [id, c] of pool) {
  if (c?.supertype !== 'Energy' || c?.subtype !== 'Basic') continue;
  if (anyEnergyId === null) anyEnergyId = id;
  const t = getBasicEnergyType(c);
  if (t && !energyByType.has(t)) energyByType.set(t, id);
}
const energyIdFor = (costType) => energyByType.get(costType) ?? anyEnergyId;

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });

/**
 * 挑一隻高血靶。wantWeakTo=false 要**對 atkType 中立**（避開弱點與抵抗力）；true 則反過來挑弱點靶。
 * ⚠⚠ 必須排除**有特性**的寶可夢 —— 被動減傷／免疫型特性會把傷害整個吃掉
 *   （第一版沒排除，水系的兩張打出 0 傷害，看起來像收斂壞掉，其實是靶的問題）。
 * ⚠ 也排除有 rulesText 的（化石等特殊載體）。
 */
function pickTarget(atkType, wantWeakTo) {
  for (const [id, c] of pool) {
    if (c?.supertype !== 'Pokemon' || (c.hp ?? 0) < 300) continue;
    if ((c.abilities ?? []).length > 0) continue;   // 特性可能減傷／免疫
    if (c.rulesText) continue;                      // 化石等特殊載體
    const w = c.weakness?.type, r = c.resistance?.type;
    if (wantWeakTo) { if (w === atkType) return id; continue; }
    if (w === atkType || r === atkType) continue;
    return id;
  }
  return null;
}
const tName = (id) => (pool.get(String(id))?.name ?? '?') + '#' + id;

/** 讓 cid 這張卡身上放 counters 個指示物後用 attackName，回傳 { dealt, logs }。 */
function hit(cid, attackName, counters, targetId) {
  const card = pool.get(cid);
  const ai = (card.attacks ?? []).findIndex((a) => a.name === attackName);
  assert.ok(ai >= 0, cid + ' 找不到招式 ' + attackName);
  const cost = card.attacks[ai].cost ?? [];
  const s0 = createGame({ name: 'P1', entries: [{ cardId: targetId, count: 1 }] },
                        { name: 'P2', entries: [{ cardId: targetId, count: 1 }] }, pool);
  const en = (t) => ({ iid: 'e' + (++nn), cardId: String(energyIdFor(t)), damage: 0, energyAttached: [] });
  const me = inst(cid, cost.map((t) => en(t)), { damage: counters * 10 });
  const st = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    players: [
      { ...s0.players[0], hand: [], deck: [inst(targetId)], discard: [], prizes: Array.from({ length: 6 }, () => inst(targetId)),
        active: me, bench: [], energyAttachedThisTurn: true },
      { ...s0.players[1], hand: [], deck: [inst(targetId)], discard: [], prizes: Array.from({ length: 6 }, () => inst(targetId)),
        active: inst(targetId), bench: [] }] };
  const after = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool);
  assert.ok(after && after !== st, attackName + ' 沒有被引擎接受（cost／前提不成立）');
  // ⚠ 哨兵：招式沒被接受時引擎可能回一個只改了 log 的 state ⇒ 用「對手真的有被結算」再確認一次
  assert.ok(after.players[1].active, attackName + ' 打完之後對手戰鬥位不見了（靶被秒殺，換一張血更厚的）');
  return { dealt: after.players[1].active?.damage ?? -1,
    logs: (after.log ?? []).map((l) => String(l?.message ?? l?.text ?? l)) };
}

// 卡面查證自 static/cards：四張的 effect 都是「造成這隻寶可夢身上放置的傷害指示物的數量×N點傷害。」
const CASES = [
  { key: '醜醜魚|抓狂', cid: '10443', atk: '抓狂', per: 10, wantLog: false },
  { key: '鐵炮魚|抓狂', cid: '12481', atk: '抓狂', per: 10, wantLog: true },
  { key: '石居蟹|抓狂', cid: '13740', atk: '抓狂', per: 10, wantLog: true },
];

console.log('【0】前提');
T('F0 ★ 哨兵：四個 key 都在 ATTACK_PRE 裡（改名／漏註冊要立刻發現）', () => {
  for (const k of ['醜醜魚|抓狂', '鐵炮魚|抓狂', '石居蟹|抓狂', '厄鬼椪 火灶面具ex|憤怒之窯']) {
    assert.ok(ATTACK_PRE.has(k), '缺 key：' + k);
  }
});
T('F0b ★ 哨兵：卡面逐張查證（effect 都是「…傷害指示物的數量×N點傷害。」）', () => {
  let n = 0;
  for (const [, c] of pool) {
    for (const a of (c?.attacks ?? [])) {
      if (a?.name === '抓狂') {
        n++;
        assert.strictEqual(a.effect, '造成這隻寶可夢身上放置的傷害指示物的數量×10點傷害。',
          c.name + ' 的抓狂卡面文字變了：' + a.effect);
      }
    }
  }
  assert.ok(n >= 7, '站上「抓狂」的印刷張數應 >= 7，實得 ' + n);
});

console.log('\n【A】⭐⭐⭐ 行為端：傷害 = 自身指示物數 × per');
for (const c of CASES) {
  const atkType = pool.get(c.cid)?.pokemonType;
  const tgt = pickTarget(atkType, false);
  T('A1 ' + c.key + '：3 個指示物 ⇒ ' + (3 * c.per) + ' 傷害（靶對 ' + atkType + ' 中立）', () => {
    assert.ok(tgt, '挑不到中立的靶');
    const { dealt } = hit(c.cid, c.atk, 3, tgt);
    assert.strictEqual(dealt, 3 * c.per, '實得 ' + dealt + '（靶＝' + tName(tgt) + '）');
  });
  T('A1b ' + c.key + '：0 個指示物 ⇒ 0 傷害（邊界）', () => {
    const { dealt } = hit(c.cid, c.atk, 0, tgt);
    assert.strictEqual(dealt, 0, '實得 ' + dealt);
  });
}
T('B1 ★★ 反安慰劑：同一招打**弱點靶**必須變成兩倍（證明上面的靶真的有避開弱點）', () => {
  const c = CASES[0];
  const atkType = pool.get(c.cid)?.pokemonType;
  const weakTgt = pickTarget(atkType, true);
  assert.ok(weakTgt, '卡池裡挑不到弱 ' + atkType + ' 的高血靶');
  const { dealt } = hit(c.cid, c.atk, 3, weakTgt);
  assert.strictEqual(dealt, 3 * c.per * 2,
    '弱點靶應該吃兩倍（' + (3 * c.per * 2) + '），實得 ' + dealt
    + ' —— 若這裡不是兩倍，代表 A1 的「中立」判斷失效，A1 的綠就沒有意義');
});

console.log('\n【C】⭐⭐ 收斂層：四張都走中央 helper，不得再手刻');
T('C1 ⭐⭐ 四個註冊點都是 `selfCountersMultiplyPre(...)` 的一行寫法（沒有人再自己算一次）', () => {
  const files = [
    ['src/lib/game/effects.ts', ['醜醜魚|抓狂', '厄鬼椪 火灶面具ex|憤怒之窯']],
    ['src/lib/game/effects/cards/v2510_i_wave3c_status_self.ts', ['鐵炮魚|抓狂']],
    ['src/lib/game/effects/cards/v2660_i_wave16_misc9.ts', ['石居蟹|抓狂']],
  ];
  for (const [rel, keys] of files) {
    const src = normEol(readFileSync(join(ROOT, rel), 'utf8'));
    for (const k of keys) {
      const re = new RegExp("regPre\\('" + k.replace('|', '\\|') + "', selfCountersMultiplyPre\\(");
      assert.ok(re.test(src), rel + ' 的 ' + k + ' 不是一行式的 selfCountersMultiplyPre 註冊');
    }
  }
  // ★ 正對照：偵測器對人造的手刻寫法必須**不**命中
  assert.ok(!/regPre\('X\|Y', selfCountersMultiplyPre\(/.test("regPre('X|Y', (state, aIdx) => {"), '偵測器恆真');
});
T('C2 ⭐ log：原本沒有 log 的兩張仍然沒有；原本有 log 的兩張走中央格式', () => {
  const noLog = hit('10443', '抓狂', 3, pickTarget(pool.get('10443')?.pokemonType, false));
  assert.ok(!noLog.logs.some((l) => l.includes('抓狂：自身傷害指示物')),
    '醜醜魚原本沒有 log，收斂後不可以多出一條（應傳 { log: false }）');
  const withLog = hit('13740', '抓狂', 3, pickTarget(pool.get('13740')?.pokemonType, false));
  assert.ok(withLog.logs.some((l) => l === '抓狂：自身傷害指示物 3 個 × 10 → 30'),
    '石居蟹應該有中央格式的 log，實得：' + JSON.stringify(withLog.logs.slice(-3)));
});

console.log('\n【D】chain');
T('D1 本守衛已掛進 npm test chain', () => {
  assert.ok(readFileSync(join(ROOT, 'package.json'), 'utf8').includes('test-v6397-self-counters-converge.mjs'));
});

console.log('\n=== v6.397 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);