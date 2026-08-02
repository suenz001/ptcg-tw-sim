/**
 * v6.105 守衛：「特性消除」場地卡的作用範圍必須**逐字對齊卡面**
 *
 * 起因：玩家回報「火箭隊的監視塔 gate 了 N的索羅亞克ex 的特性『交易』」。
 * 實測後**引擎是對的**，真正會擋的是另一張場地卡：
 *   ・火箭隊的監視塔（I 標）：「雙方場上所有【無】寶可夢的特性全部消除。」
 *     → N的索羅亞克ex 是【惡】屬性 ⇒ **不該**被擋。
 *   ・傳說的熔岩洞（J 標，M6）：「雙方場上所有進化寶可夢的特性全部消除。」
 *     → N的索羅亞克ex 是 Stage1（進化）⇒ **應該**被擋（正確行為）。
 * 兩張都是「特性消除」場地卡，玩家很容易看混。本守衛把兩邊的範圍都釘住，
 * 免得日後有人為了「修這個誤報」去放寬／收緊其中一張，反而弄出真 bug。
 *
 * ⭐ 同 v6.028 的教訓：免疫／消除類效果的範圍要逐字對齊卡面動詞與對象，禁用 kind 一刀切。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6-s.js'), E = join(ROOT, '.x6-e.ts'), O = join(ROOT, '.x6-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { getUsableAbilities } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
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
const inst = (cardId) => ({ iid: 'i' + (++seq), cardId: String(cardId), damage: 0, energyAttached: [] });
const basics = [];
for (const [id, c] of pool) { if (c.supertype === 'Pokemon' && c.stage === 'Basic') basics.push(id); if (basics.length >= 2) break; }

/** 建一個「自己戰鬥位放 holder、場地卡為 stadiumId」的盤面，回傳可用特性名稱。 */
function usableAbilityNames(holderId, stadiumId) {
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    activeStadium: stadiumId ? { cardId: String(stadiumId), ownerIdx: 0 } : null,
    players: [
      { name: 'P1', active: inst(holderId), bench: [], hand: [inst(basics[0])], deck: [inst(basics[0]), inst(basics[0])], discard: [], prizes: [] },
      { name: 'P2', active: inst(basics[0]), bench: [], hand: [], deck: [inst(basics[0])], discard: [], prizes: [] },
    ],
  };
  return mod.getUsableAbilities(st, pool).map((a) => a.abilityName);
}

console.log('① 卡面前提（變了就要重讀卡面，不可直接改斷言）');
const tower = byName('火箭隊的監視塔');
const lava = byName('傳說的熔岩洞');
const zoro = byName('N的索羅亞克ex');
ok('火箭隊的監視塔卡面＝只消除【無】寶可夢的特性', () => {
  assert.ok(tower, '找不到 火箭隊的監視塔');
  assert.strictEqual(tower.c.rulesText, '雙方場上所有【無】寶可夢的特性全部消除。');
});
ok('傳說的熔岩洞卡面＝只消除**進化**寶可夢的特性', () => {
  assert.ok(lava, '找不到 傳說的熔岩洞');
  assert.strictEqual(lava.c.rulesText, '雙方場上所有進化寶可夢的特性全部消除。');
});
ok('N的索羅亞克ex＝【惡】屬性 + Stage1（進化）', () => {
  assert.ok(zoro, '找不到 N的索羅亞克ex');
  assert.strictEqual(zoro.c.pokemonType, 'Darkness');
  assert.strictEqual(zoro.c.stage, 'Stage1');
  assert.ok((zoro.c.abilities ?? []).some((a) => a.name === '交易'), '應有特性「交易」');
});

console.log('② 行為端：兩張場地卡的範圍');
ok('無場地卡 → 交易可用（基準線）', () => {
  assert.deepStrictEqual(usableAbilityNames(zoro.id, null), ['交易']);
});
ok('⭐ 火箭隊的監視塔在場 → 交易**仍可用**（惡屬性不在【無】的範圍內）', () => {
  assert.deepStrictEqual(usableAbilityNames(zoro.id, tower.id), ['交易'],
    '監視塔只擋【無】寶可夢，擋到【惡】就是範圍過寬');
});
ok('⭐ 傳說的熔岩洞在場 → 交易被消除（Stage1 是進化寶可夢，這是正確行為）', () => {
  assert.deepStrictEqual(usableAbilityNames(zoro.id, lava.id), [],
    '熔岩洞消除進化寶可夢的特性，漏擋就是範圍過窄');
});

console.log('③ 反向對照：找一隻【無】屬性的基礎寶可夢特性持有者');
{
  let colorlessBasic = null;
  for (const [id, c] of pool) {
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    if (c.supertype !== 'Pokemon' || c.pokemonType !== 'Colorless' || c.stage !== 'Basic') continue;
    if ((c.abilities ?? []).length === 0) continue;
    if (usableAbilityNames(id, null).length === 0) continue;   // 特性要真的能在這個空盤面用
    colorlessBasic = { id, c };
    break;
  }
  ok('【無】基礎寶可夢：監視塔擋、熔岩洞不擋（兩張的範圍互不重疊）', () => {
    assert.ok(colorlessBasic, '卡池找不到可用的【無】基礎特性持有者（守衛不做軟跳過）');
    const nm = colorlessBasic.c.name;
    assert.deepStrictEqual(usableAbilityNames(colorlessBasic.id, tower.id), [], `${nm}：監視塔應該擋【無】`);
    assert.ok(usableAbilityNames(colorlessBasic.id, lava.id).length > 0, `${nm}：是基礎寶可夢，熔岩洞不該擋`);
  });
}

console.log(`\n=== v6.105 特性消除範圍：PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
