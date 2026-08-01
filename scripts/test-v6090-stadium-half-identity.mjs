/**
 * v6.090 傳說競技場「左右各是一張卡片」的持久身分
 *
 * ⭐ Wilson 裁定（2026-08-01）：
 *   「那3張傳說的場地卡 應該分別視為左、右各為一張卡片，
 *     但唯獨要同時一左一右才能使用、放到場上」
 *
 * 改動核心：左右不再是「渲染時數同 cardId 的出現序」（洗牌後會跳動）。
 *
 * ⚠ v6.093 起左右已經是**兩張不同的卡（不同 cardId、官方編號 071/072…）**，判定優先看 cardId。
 *   本檔已改成：新模型用左右兩個 cardId 斷言；`stadiumHalf` 的部分保留為 **legacy 相容性測試**
 *   —— 拆卡之前建立、還在進行中的對局不可以突然壞掉。
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

const trench = byName('傳說的海溝', c => c.collectorNumber === '071/076');   // 左半
const trenchR = byName('傳說的海溝', c => c.collectorNumber === '072/076');  // 右半（v6.093 新增）
const lava = byName('傳說的熔岩洞');
ok(!!trench && !!trenchR && !!lava, '前置：找得到傳說的海溝左右兩張／熔岩洞');
ok(!!trench && !!trenchR && trench.id !== trenchR.id && trench.name === trenchR.name,
  '⭐ v6.093：左右是兩個不同的 cardId、但卡名相同（讓效果 hook 與同名 4 張規則自動正確）');

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
  const l = { iid: 'L', cardId: String(trench.id) };
  const r = { iid: 'R', cardId: String(trenchR.id) };
  ok(mod.twoCardStadiumHalfIndex([l, r], 'L', pool) === 0, '⭐ v6.093：071 那張就是左半（由 cardId 判定）');
  ok(mod.twoCardStadiumHalfIndex([l, r], 'R', pool) === 1, '⭐ v6.093：072 那張就是右半');
  // ⭐ 關鍵：陣列順序顛倒（＝洗牌／抽牌後）左右仍然不變
  ok(mod.twoCardStadiumHalfIndex([r, l], 'L', pool) === 0, '⭐ 順序顛倒後 L 仍是左半（舊的 index 判準會變成右半）');
  ok(mod.twoCardStadiumHalfIndex([r, l], 'R', pool) === 1, '⭐ 順序顛倒後 R 仍是右半');
  // legacy：拆卡前的對局是「同 cardId ＋ stadiumHalf」，仍要判得出來
  const g1 = { iid: 'G1', cardId: String(lava.id), stadiumHalf: 0 };
  const g2 = { iid: 'G2', cardId: String(lava.id), stadiumHalf: 1 };
  ok(mod.twoCardStadiumHalfIndex([g2, g1], 'G1', pool) === 0, 'legacy：拆卡前對局的左半仍判得出來');
  // fail-open：沒有身分的舊局，回退成出現序
  // ⚠ v6.093 起「同 cardId 兩張」一定是左半兩張 → 兩者都判成左半才是對的（不再回退成出現序）
  const o1 = { iid: 'O1', cardId: String(trench.id) }, o2 = { iid: 'O2', cardId: String(trench.id) };
  ok(mod.twoCardStadiumHalfIndex([o1, o2], 'O2', pool) === 0, '⭐ v6.093：兩張 071 都是左半（不再按出現序猜）');
}

// ── 3) 可打出判定：必須一左一右 ───────────────────────────────
{
  const cid = String(trench.id);
  const cidR = String(trenchR.id);
  const twoLeft = [{ iid: '1', cardId: cid }, { iid: '2', cardId: cid }];
  ok(mod.canPlayTwoCardStadium(twoLeft, cid) === false, '⭐ 手上兩張都是左半（071 兩張）→ 不可打出');
  const twoRight = [{ iid: '1', cardId: cidR }, { iid: '2', cardId: cidR }];
  ok(mod.canPlayTwoCardStadium(twoRight, cidR) === false, '⭐ 手上兩張都是右半（072 兩張）→ 不可打出');
  const pair = [{ iid: '1', cardId: cidR }, { iid: '2', cardId: cid }];
  ok(mod.canPlayTwoCardStadium(pair, cid) === true, '一左一右 → 可打出（從左半按）');
  ok(mod.canPlayTwoCardStadium(pair, cidR) === true, '一左一右 → 可打出（從右半按也一樣）');
  ok(mod.canPlayTwoCardStadium([{ iid: '1', cardId: cid }], cid) === false, '只有一張 → 不可打出');
  const p = mod.findTwoCardStadiumPair(pair, cid);
  ok(p && p.left.cardId === cid && p.right.cardId === cidR, '⭐ 配對回傳的 left/right 對應到正確的那張卡');
  const p2 = mod.findTwoCardStadiumPair(pair, cidR);
  ok(p2 && p2.left.cardId === cid && p2.right.cardId === cidR, '從右半配對時 left/right 不會顛倒');
  // legacy：拆卡前的對局（同 cardId ＋ stadiumHalf）仍要能打出，否則進行中的對局會卡住
  const legacy = [{ iid: '1', cardId: String(lava.id), stadiumHalf: 0 }, { iid: '2', cardId: String(lava.id), stadiumHalf: 1 }];
  ok(mod.canPlayTwoCardStadium(legacy, String(lava.id)) === true,
    '⭐ legacy：拆卡前建立的對局（同卡兩張＋stadiumHalf）仍可打出，不讓進行中的對局卡住');
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
    { cardId: String(trench.id), count: 2 },
    { cardId: String(trenchR.id), count: 2 },
  ] });
  const g = mod.createGame(spec('P1'), spec('P2'), pool, { firstPlayerOverride: 0, forceLegacyOpening: true });
  for (const idx of [0, 1]) {
    const all = [...g.players[idx].deck, ...g.players[idx].hand, ...g.players[idx].prizes];
    const lefts = all.filter(c => c.cardId === String(trench.id)).length;
    const rights = all.filter(c => c.cardId === String(trenchR.id)).length;
    ok(lefts + rights === 4, `P${idx + 1} 場地卡 4 張都在盤面上`);
    ok(lefts === 2 && rights === 2,
      `⭐ P${idx + 1} 洗牌／發牌後仍是 2 左 2 右（左右各是獨立的卡，洗牌不會改變）`);
  }
}

console.log(`v6090 傳說競技場左右持久身分：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
