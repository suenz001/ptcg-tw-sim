/** v5.871 撤退費「增減合併後單一 floor」修正。玩家回報:九尾(retreat1)+氣球(-2),對手 2 隻
 *  超級水晶燈火靈ex(咒縛火焰 對手撤退+1 各),撤不了。官方:增減全套用後<0才歸0＝單一 floor →
 *  max(0,1+2-2)=1。原 max(0,base-reduce)+add=2(浪費氣球超出base的減免)。
 *  另驗:①天空徑線(拉帝亞斯ex 免撤退特性)在新公式後仍 0 費(freeRetreat 最後硬覆蓋不受影響)。
 *      ②超級水晶燈火靈ex|幻影迷宮(130+對手撤退×50)依 central 撤退費,自動吃新公式。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rf-s.js'), E = join(ROOT, '.rf-e.ts'), O = join(ROOT, '.rf-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { computeActiveRetreatCostFor } from './src/lib/game/engine';\nexport { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { computeActiveRetreatCostFor, ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const NINETALES = '13968', BALLOON = '14467', CHANDELURE = '19180', WATER = '18519', LATIAS = '14107' /*拉帝亞斯ex 天空徑線(Basic)*/;
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...e });
const tool = (cid) => ({ iid: 't' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
function mk({ balloon = false, chandelure = 0, gimmick = 0, activeCid = NINETALES, myBenchCids = [WATER] } = {}) {
  const my = inst(activeCid, { toolAttached: balloon ? tool(BALLOON) : undefined, energyAttached: [inst(WATER)], retreatCostIncreaseThisTurn: gimmick });
  const oppBench = Array.from({ length: chandelure }, () => inst(CHANDELURE));
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null,
    players: [
      { name: 'P1', active: my, bench: myBenchCids.map(c => inst(c)), hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
      { name: 'P2', active: inst(WATER), bench: oppBench, hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
    ],
  };
}
const cost = (opts) => computeActiveRetreatCostFor(mk(opts), 0, pool);
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★九尾(1)+氣球(-2)+對手2隻咒縛火焰(+2) → 1(單一floor,非2)', () => assert.strictEqual(cost({ balloon: true, chandelure: 2 }), 1, 'HEAD 誤=2'));
T('九尾(1)+氣球(-2)+對手1隻咒縛火焰(+1) → 0', () => assert.strictEqual(cost({ balloon: true, chandelure: 1 }), 0));
T('九尾(1)+氣球(-2)+無咒縛火焰 → 0', () => assert.strictEqual(cost({ balloon: true, chandelure: 0 }), 0));
T('不回歸:九尾(1)+2隻咒縛火焰(+2)無氣球 → 3', () => assert.strictEqual(cost({ chandelure: 2 }), 3));
T('不回歸:九尾(1) base → 1', () => assert.strictEqual(cost({}), 1));
T('不回歸:九尾(1)+鼓擊(+2) → 3', () => assert.strictEqual(cost({ gimmick: 2 }), 3));
T('九尾(1)+氣球(-2)+3隻咒縛火焰(+3) → 2', () => assert.strictEqual(cost({ balloon: true, chandelure: 3 }), 2));

// ── Wilson 追加①:天空徑線(拉帝亞斯ex Basic active 免撤退特性)在新公式後仍 0 費 ──
T('★天空徑線:拉帝亞斯ex(Basic)active 自帶 + 對手2隻咒縛火焰(+2) → 仍 0(freeRetreat 覆蓋)', () => {
  // 拉帝亞斯ex 在自己戰鬥場(Basic)→ 天空徑線消自己所有基礎撤退;即使對手咒縛火焰+2 也 0
  assert.strictEqual(cost({ activeCid: LATIAS, myBenchCids: [WATER], chandelure: 2, balloon: false }), 0, '天空徑線 freeRetreat 硬覆蓋 → 0(不受 add 影響)');
});

// ── Wilson 追加②:幻影迷宮傷害依新公式(對手九尾+氣球,攻方超級水晶燈火靈ex 咒縛火焰) ──
const phantomMaze = ATTACK_PRE.get('超級水晶燈火靈ex|幻影迷宮');
function mkMaze({ chandelureExtra = 0, oppBalloon = true } = {}) {
  // 攻方(idx0)active=超級水晶燈火靈ex(自帶咒縛火焰+1) + bench chandelureExtra 隻;對手 active=九尾(1)+氣球
  const opp = inst(NINETALES, { toolAttached: oppBalloon ? tool(BALLOON) : undefined, energyAttached: [inst(WATER)] });
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null,
    players: [
      { name: 'ATK', active: inst(CHANDELURE), bench: Array.from({length:chandelureExtra},()=>inst(CHANDELURE)), hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
      { name: 'DEF', active: opp, bench: [inst(WATER)], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
    ],
  };
}
T('★幻影迷宮:對手九尾(1)+氣球(-2),攻方2隻咒縛火焰(+2) → 對手有效撤退1 → 130+50=180(非230)', () => {
  const d = phantomMaze(mkMaze({ chandelureExtra: 1 }), 0, pool).damage; // active chandelure + 1 bench = 2 隻 → +2
  assert.strictEqual(d, 180, `對手撤退 max(0,1+2-2)=1 → 130+50=180(HEAD 誤 max(0,1-2)+2=2 → 230),實際 ${d}`);
});
T('幻影迷宮:對手九尾(1)無氣球,攻方1隻咒縛火焰(+1) → 撤退2 → 130+100=230', () => {
  const d = phantomMaze(mkMaze({ chandelureExtra: 0, oppBalloon: false }), 0, pool).damage;
  assert.strictEqual(d, 230, `對手撤退 1+1=2 → 230,實際 ${d}`);
});

console.log('\n撤退費增減單一floor + 天空徑線/幻影迷宮(v5.871):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
