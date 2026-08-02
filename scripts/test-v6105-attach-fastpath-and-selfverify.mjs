/**
 * v6.105 守衛（Fable 覆核後補）：附能的兩類共通缺陷
 *
 * ① **fast-path 與 picker path 的副作用必須一致**
 *    很多附能卡有「合法目標只有 1 隻 → 直接附，不彈 UI」的捷徑。捷徑只能省掉「選誰」，
 *    **不能省掉副作用**。阿響的鳳王ex｜金色火焰 的 1 隻捷徑原本漏了 `fireOnHandEnergyAttached`
 *    與 `applyMagearnaHandAttachHeal` ——「備戰 1 隻」與「備戰 ≥2 隻」行為不一致。
 *
 * ② **resolver 一律自驗 client 送來的目標 iid**
 *    引擎的中央 sanitize 只對 deck-search 生效，其餘型別是原封放行的（`engine.ts` sanitizeSelectedIids）。
 *    resolver 若不自驗，改造過的 client 就能把能量附到卡面沒允許的位置。本版修兩處：
 *      ・鳴依的勉勵：卡面「自己的 1 隻【2階進化】寶可夢」→ 補 validIids ＋ Stage2 重驗
 *      ・樂呵呵之吻：卡面「1 隻**備戰**寶可夢」→ 目標查找不得含戰鬥位
 *    （同 v6.009 的原則：resolver 用 client selectedIids 做副作用前必自驗。）
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x7-s.js'), E = join(ROOT, '.x7-e.ts'), O = join(ROOT, '.x7-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { ABILITY_EFFECTS, RESOLVERS, ATTACK_POST } from './src/lib/game/effects/_shared';\n" +
  "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const ok = (n, f) => { try { f(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '→', e.message); fail++; } };
const byName = (nm) => { for (const [id, c] of pool) if (c.name === nm && ['H','I','J'].includes(c.regulationMark)) return { id, c }; return null; };
let seq = 0;
const inst = (cardId, extra = {}) => ({ iid: 'i' + (++seq), cardId: String(cardId), damage: 0, energyAttached: [], ...extra });

console.log('① fast-path 與 picker path 的副作用一致（金色火焰）');
ok('金色火焰：備戰只有 1 隻時，從手牌附能仍要觸發麻痺門牙（＋80）', () => {
  const hoOh = byName('阿響的鳳王ex');
  const ayano = byName('阿響的凱羅斯');
  assert.ok(hoOh && ayano, 'static/cards 找不到 阿響的鳳王ex／阿響的凱羅斯');
  const abil = (hoOh.c.abilities ?? []).find((a) => a.name === '金色火焰');
  assert.ok(abil?.effect?.includes('附於備戰區的1隻'), '卡面前提變了，請重讀卡面：' + JSON.stringify(abil));
  const fireE = [...pool.entries()].find(([, c]) => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【火】'))?.[0];
  assert.ok(fireE, '找不到基本【火】能量');

  // 備戰恰 1 隻「阿響的」寶可夢，且身上有麻痺門牙待觸發旗標
  const target = inst(ayano.id, { paralyzeFangPending: true });
  const energy = inst(fireE);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'P1', active: inst(hoOh.id), bench: [target], hand: [energy], deck: [inst(ayano.id)], discard: [], prizes: [] },
      { name: 'P2', active: inst(ayano.id), bench: [], hand: [], deck: [inst(ayano.id)], discard: [], prizes: [] },
    ],
  };
  const fn = mod.ABILITY_EFFECTS.get('阿響的鳳王ex|0');
  assert.ok(fn, '找不到 金色火焰 的特性實作');
  const s1 = fn(st, 0, pool, st.players[0].active);
  assert.strictEqual(s1.pendingSelection?.effectKey, 'gold-flame-pick-energy', '應先開手牌選能量');
  const s2 = mod.RESOLVERS.get('gold-flame-pick-energy')(s1, 0, [energy.iid], s1.pendingSelection.params, pool);

  const after = s2.players[0].bench[0];
  assert.strictEqual(after.energyAttached.length, 1, '能量應附到那隻備戰');
  // ⭐ 關鍵：fast-path 也要觸發麻痺門牙
  assert.strictEqual(after.damage, 80,
    'fast-path 漏掉 fireOnHandEnergyAttached —— 備戰 1 隻與 ≥2 隻行為不一致');
});

console.log('② resolver 自驗 client 送來的目標（公平性）');
ok('鳴依的勉勵：把能量指定給非【2階進化】的寶可夢 → 拒絕附加', () => {
  const card = byName('鳴依的勉勵');
  assert.ok(card, '找不到 鳴依的勉勵');
  assert.ok(card.c.rulesText.includes('自己的1隻【2階進化】寶可夢'), '卡面前提變了：' + card.c.rulesText);
  const anyE = [...pool.entries()].find(([, c]) => c.supertype === 'Energy' && c.subtype === 'Basic')?.[0];
  const basic = [...pool.entries()].find(([, c]) => c.supertype === 'Pokemon' && c.stage === 'Basic')?.[0];
  const stage2 = [...pool.entries()].find(([, c]) => c.supertype === 'Pokemon' && c.stage === 'Stage2')?.[0];
  assert.ok(anyE && basic && stage2, '卡池取樣失敗');
  const e1 = inst(anyE), notStage2 = inst(basic), legit = inst(stage2);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'P1', active: notStage2, bench: [legit], hand: [], deck: [], discard: [e1], prizes: [] },
      { name: 'P2', active: inst(basic), bench: [], hand: [], deck: [inst(basic)], discard: [], prizes: [] },
    ],
  };
  const r = mod.RESOLVERS.get('naruei-encourage-commit');
  assert.ok(r, '找不到 naruei-encourage-commit resolver');
  // client 謊報：把目標指到非 Stage2 的戰鬥位
  const out = r(st, 0, [notStage2.iid], { energyIids: [e1.iid], validIids: [legit.iid] }, pool);
  assert.strictEqual(out.players[0].active.energyAttached.length, 0, '非法目標不該拿到能量');
  assert.strictEqual(out.players[0].discard.length, 1, '能量應留在棄牌區');
});

ok('樂呵呵之吻：把能量指定給戰鬥位 → 拒絕（卡面限「1隻備戰」）', () => {
  const kissy = [...pool.values()].find((c) => c.name === '迷唇娃' && (c.attacks ?? []).some((a) => a.name === '樂呵呵之吻'));
  assert.ok(kissy, '找不到 迷唇娃｜樂呵呵之吻');
  const eff = (kissy.attacks ?? []).find((a) => a.name === '樂呵呵之吻').effect ?? '';
  assert.ok(eff.includes('附於1隻備戰寶可夢'), '卡面前提變了：' + eff);
  const psyE = [...pool.entries()].find(([, c]) => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【超】'))?.[0];
  const basic = [...pool.entries()].find(([, c]) => c.supertype === 'Pokemon' && c.stage === 'Basic')?.[0];
  const e1 = inst(psyE), activeInst = inst(basic), benchInst = inst(basic);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'P1', active: activeInst, bench: [benchInst], hand: [], deck: [], discard: [e1], prizes: [] },
      { name: 'P2', active: inst(basic), bench: [], hand: [], deck: [inst(basic)], discard: [], prizes: [] },
    ],
  };
  const r = mod.RESOLVERS.get('kissy-attach-all-to-target');
  assert.ok(r, '找不到 kissy-attach-all-to-target resolver');
  const out = r(st, 0, [activeInst.iid], { energyIids: [e1.iid] }, pool);
  assert.strictEqual(out.players[0].active.energyAttached.length, 0, '戰鬥位不該拿到能量');
  assert.strictEqual(out.players[0].discard.length, 1, '能量應留在棄牌區');
  // 正對照：指定備戰是合法的
  const good = r(st, 0, [benchInst.iid], { energyIids: [e1.iid] }, pool);
  assert.strictEqual(good.players[0].bench[0].energyAttached.length, 1, '指定備戰應該成功（別把合法路徑也擋掉）');
});

console.log(`\n=== v6.105 fast-path 一致性 + resolver 自驗：PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
