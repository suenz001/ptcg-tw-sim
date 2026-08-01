/**
 * v6.090 傳說競技場「左右各是一張卡片」的持久身分
 *
 * ⭐ Wilson 裁定（2026-08-01）：
 *   「那3張傳說的場地卡 應該分別視為左、右各為一張卡片，
 *     但唯獨要同時一左一右才能使用、放到場上」
 *
 * 改動核心：左右不再是「渲染時數同 cardId 的出現序」（洗牌後會跳動），
 *   而是 CardInstance 上的持久屬性 `stadiumHalf`（建牌組時指派）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v90-s.js'), E = join(ROOT, '.v90-e.ts'), O = join(ROOT, '.v90-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { twoCardStadiumHalfIndex, canPlayTwoCardStadium, findTwoCardStadiumPair,\n" +
  "  assignTwoCardStadiumHalves, toBareCard, isTwoCardStadiumName } from './src/lib/game/effects/_shared';\n" +
  "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n, pred) => { for (const [, c] of pool) { if (c.name === n && ['H','I','J'].includes(c.regulationMark) && (!pred || pred(c))) return c; } return null; };

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  FAIL:', l); } };

const trench = byName('傳說的海溝');
const lava = byName('傳說的熔岩洞');
ok(!!trench && !!lava, '前置：找得到傳說的海溝／熔岩洞');

// ── 1) 建牌組時指派持久身分，且左右交錯 ───────────────────────
{
  const insts = [
    { iid: 'a', cardId: String(trench.id) },
    { iid: 'b', cardId: String(trench.id) },
    { iid: 'c', cardId: String(trench.id) },
    { iid: 'd', cardId: String(trench.id) },
    { iid: 'x', cardId: String(lava.id) },
    { iid: 'y', cardId: String(lava.id) },
  ];
  const out = mod.assignTwoCardStadiumHalves(insts, pool);
  ok(out.map(c => c.stadiumHalf).join(',') === '0,1,0,1,0,1',
    '⭐ 依牌組內編號交錯指派左右（每個 cardId 各自從左開始）');
  // 冪等
  const again = mod.assignTwoCardStadiumHalves(out, pool);
  ok(again.every((c, i) => c.stadiumHalf === out[i].stadiumHalf), '重複呼叫不改變已指派的身分（冪等）');
  // 非兩張合一的卡不受影響
  const other = mod.assignTwoCardStadiumHalves([{ iid: 'z', cardId: String(byName('傷藥').id) }], pool);
  ok(other[0].stadiumHalf === undefined, '一般卡不會被加上 stadiumHalf');
}

// ── 2) 顯示用的左右判定：優先讀持久身分，順序打亂也不會跳 ─────
{
  const l = { iid: 'L', cardId: String(trench.id), stadiumHalf: 0 };
  const r = { iid: 'R', cardId: String(trench.id), stadiumHalf: 1 };
  ok(mod.twoCardStadiumHalfIndex([l, r], 'L', pool) === 0, '持久身分：L 是左半');
  ok(mod.twoCardStadiumHalfIndex([l, r], 'R', pool) === 1, '持久身分：R 是右半');
  // ⭐ 關鍵：陣列順序顛倒（＝洗牌／抽牌後）左右仍然不變
  ok(mod.twoCardStadiumHalfIndex([r, l], 'L', pool) === 0, '⭐ 順序顛倒後 L 仍是左半（舊的 index 判準會變成右半）');
  ok(mod.twoCardStadiumHalfIndex([r, l], 'R', pool) === 1, '⭐ 順序顛倒後 R 仍是右半');
  // fail-open：沒有身分的舊局，回退成出現序
  const o1 = { iid: 'O1', cardId: String(trench.id) }, o2 = { iid: 'O2', cardId: String(trench.id) };
  ok(mod.twoCardStadiumHalfIndex([o1, o2], 'O2', pool) === 1, 'fail-open：舊局無身分時回退成出現序');
}

// ── 3) 可打出判定：必須一左一右 ───────────────────────────────
{
  const cid = String(trench.id);
  const twoLeft = [{ iid: '1', cardId: cid, stadiumHalf: 0 }, { iid: '2', cardId: cid, stadiumHalf: 0 }];
  ok(mod.canPlayTwoCardStadium(twoLeft, cid) === false, '⭐ 手上兩張都是左半 → 不可打出');
  const twoRight = [{ iid: '1', cardId: cid, stadiumHalf: 1 }, { iid: '2', cardId: cid, stadiumHalf: 1 }];
  ok(mod.canPlayTwoCardStadium(twoRight, cid) === false, '⭐ 手上兩張都是右半 → 不可打出');
  const pair = [{ iid: '1', cardId: cid, stadiumHalf: 1 }, { iid: '2', cardId: cid, stadiumHalf: 0 }];
  ok(mod.canPlayTwoCardStadium(pair, cid) === true, '一左一右 → 可打出（順序不拘）');
  ok(mod.canPlayTwoCardStadium([{ iid: '1', cardId: cid, stadiumHalf: 0 }], cid) === false, '只有一張 → 不可打出');
  // 三張：兩左一右也算湊得到一組
  const three = [{ iid: '1', cardId: cid, stadiumHalf: 0 }, { iid: '2', cardId: cid, stadiumHalf: 0 }, { iid: '3', cardId: cid, stadiumHalf: 1 }];
  ok(mod.canPlayTwoCardStadium(three, cid) === true, '兩左一右 → 湊得到一組，可打出');
  const p = mod.findTwoCardStadiumPair(three, cid);
  ok(p && p.left.stadiumHalf === 0 && p.right.stadiumHalf === 1, '配對回傳的確實是一左一右');
  // fail-open：舊局（完全沒有身分）沿用「有 2 張就能打」
  const legacy = [{ iid: '1', cardId: cid }, { iid: '2', cardId: cid }];
  ok(mod.canPlayTwoCardStadium(legacy, cid) === true, 'fail-open：舊局 2 張仍可打出（不讓舊局突然卡住）');
}

// ── 4) toBareCard 必須保留身分（同 fossilOnField 的教訓）──────
{
  const bare = mod.toBareCard({ iid: 'B', cardId: String(trench.id), damage: 30, energyAttached: [{}], stadiumHalf: 1 });
  ok(bare.stadiumHalf === 1, '⭐ toBareCard 保留 stadiumHalf（回牌庫／棄牌區再回手不失去身分）');
  ok(bare.damage === 0 && bare.energyAttached.length === 0, 'toBareCard 仍有正常裸化（正對照）');
  const bare2 = mod.toBareCard({ iid: 'C', cardId: String(byName('傷藥').id), damage: 0, energyAttached: [] });
  ok(!('stadiumHalf' in bare2), '一般卡裸化後不會憑空多出 stadiumHalf 欄位');
}

// ── 5) 端到端：createGame 建出來的牌組帶著身分 ────────────────
{
  const basic = (() => { for (const [, c] of pool) { if (c.supertype === 'Pokemon' && !c.evolvesFrom && ['H','I','J'].includes(c.regulationMark)) return c; } return null; })();
  const energy = byName('基本【火】能量');
  const spec = (name) => ({ name, entries: [
    { cardId: String(basic.id), count: 20 },
    { cardId: String(energy.id), count: 36 },
    { cardId: String(trench.id), count: 4 },
  ] });
  const g = mod.createGame(spec('P1'), spec('P2'), pool, { firstPlayerOverride: 0, forceLegacyOpening: true });
  for (const idx of [0, 1]) {
    const all = [...g.players[idx].deck, ...g.players[idx].hand, ...g.players[idx].prizes];
    const halves = all.filter(c => c.cardId === String(trench.id)).map(c => c.stadiumHalf).sort();
    ok(halves.length === 4, `P${idx + 1} 場地卡 4 張都在盤面上`);
    ok(halves.filter(h => h === 0).length === 2 && halves.filter(h => h === 1).length === 2,
      `⭐ P${idx + 1} 洗牌／發牌後仍是 2 左 2 右（身分沒有因為洗牌而消失或重算）`);
  }
}

console.log(`v6090 傳說競技場左右持久身分：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
