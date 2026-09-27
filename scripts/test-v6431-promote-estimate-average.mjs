// ⭐v6.431 守衛：撤退換人的估值（estimateIfPromoted／bestAttackOutcome）改用 evaluateAttack 的 3 次平均
//
// 背景：撤退分支用 estimateIfPromoted 估「把備戰這隻換上去能打出什麼」，舊版底下是 simulateAttack **只試打一次**，
//   擲幣招的結果被單一次擲幣釘死：剛好反面就當成 0（不撤退），剛好正面就當成全中。
//   選招（evaluateAttack）早就是 3 次平均；撤退估值用的是另一把尺（fable 審查 v6.430 C 點名）。
// 新版：bestAttackOutcome 用 evaluateAttack——ko＝過半數會擊倒；dealt＝對手全場傷害平均（擊倒時 Infinity）。
//
// 守的東西：
//   R1  估值真的是平均：阿羅拉 地鼠｜偷襲（30，反面失敗）在不同起點會出現 10／20（單次試打只可能是 0 或 30）
//   R2  行為：免費撤退時，換上去的偷襲「3 次都反面」才不撤退 ⇒ 64 個起點至少 48 次撤退（單次試打約 32 次）
//   R3  零回歸：不擲幣的招估值不變（呆呆王｜超念力 120，每個起點都是 120、不擊倒）
//   R4  擊倒：打得倒時 ko=true、dealt=Infinity（呆呆王｜超念力 對剩 100 HP 的卡比獸）
// ⚠ 語意變更（有意，未另立斷言）：dealt 從「只看戰鬥位傷害增量」變成「對手全場傷害平均」（含備戰；擊倒時剩餘 HP 混入平均），
//   ko 從「單次」變成「過半數」。撤退門檻（ai.ts）的註解已寫明；門檻重新校準另案。
// 卡片事實一律取自 static/cards（台灣官方卡面）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-v6431-s.js'), E = join(ROOT, '.x-v6431-e.ts'), O = join(ROOT, '.x-v6431-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, [
  "export * as ENG from './src/lib/game/engine';",
  "export { getAIAction } from './src/lib/game/ai';",
  "export * as EVAL from './src/lib/game/ai-eval';",
  "import './src/lib/game/effects';",
].join('\n'));
// 每條測試開頭把 ai-eval 的試打亂數種子歸零（與 scripts/lib/ai-sim-harness.mjs 同一招：只在本打包附加，不改 src/）
const seedResetPlugin = { name: 'sim-seed-reset', setup(b) {
  b.onLoad({ filter: /[\\/]ai-eval\.ts$/ }, (args) => {
    const src = readFileSync(args.path, 'utf8');
    const m = /let _simSeed = (0x[0-9a-fA-F]+|\d+);/.exec(src);
    if (!m) throw new Error('ai-eval.ts 找不到 `let _simSeed = …;`（改名了？請更新本守衛）');
    return { contents: src + `\nexport function __testResetSimSeed(k = 0) { _simSeed = (${m[1]} + k * 0x9e3779b9) >>> 0; }\n`, loader: 'ts' };
  });
} };
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', plugins: [seedResetPlugin],
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ENG, getAIAction, EVAL } = await import(pathToFileURL(O).href);
const { createGame } = ENG;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const C = { purrloin: '12145', diglett: '11256', slowking: '10934', snorlax: '17038', psy: '17220', tablet: '17133' };
for (const [k, id] of Object.entries(C)) assert.ok(pool.get(id), `找不到 ${k} ${id}（卡池變了？）`);
// 卡面前提（變了就要重新查證）
const dg = pool.get(C.diglett).attacks;
assert.ok(dg.length === 1 && dg[0].damage === '30' && dg[0].cost.length === 0 && /擲1次硬幣若為反面，則這個招式失敗/.test(dg[0].effect), '阿羅拉 地鼠｜偷襲卡面變了');
const pl = pool.get(C.purrloin);
assert.ok((pl.retreatCost ?? []).length === 0 && pl.attacks.every((a) => a.cost.length > 0), '狃拉：撤退費應為 0、招式都要能量（卡面變了？）');
assert.ok(pool.get(C.slowking).attacks.some((a) => a.name === '超念力' && a.damage === '120' && !a.effect), '呆呆王｜超念力卡面變了');

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'q' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const fill = (n, cid = C.tablet) => Array.from({ length: n }, () => inst(cid));
function mk({ active, bench = [], oppActiveDamage = 0 }) {
  const s = createGame({ name: 'P1', entries: [{ cardId: C.snorlax, count: 1 }] },
    { name: 'P2', entries: [{ cardId: C.snorlax, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null, activeStadium: null, stadiumUsedThisTurn: [false, false],
    players: [
      { ...s.players[0], hand: [], deck: fill(12), discard: [], prizes: fill(6), active, bench, energyAttachedThisTurn: true, supporterPlayedThisTurn: false },
      { ...s.players[1], hand: [], deck: fill(20, C.snorlax), discard: [], prizes: fill(6, C.snorlax),
        active: inst(C.snorlax, [], { damage: oppActiveDamage }), bench: [inst(C.snorlax)] }] };
}

let pass = 0, fail = 0; const failed = [];
const T = (n, f) => { try { EVAL.__testResetSimSeed?.(0); f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n.split(' ')[0]); } };

T('R1 ⭐ 估值真的是平均：偷襲（30，反面失敗）在不同起點會估出 10 或 20（單次試打只可能是 0 或 30）', () => {
  const st = mk({ active: inst(C.purrloin), bench: [inst(C.diglett)] });
  const seen = new Set();
  for (let k = 0; k < 32; k++) {
    EVAL.__testResetSimSeed(k);
    const o = EVAL.estimateIfPromoted(st, 0, st.players[0].bench[0], pool);
    assert.ok(o.ok, '估值失敗');
    seen.add(Math.round(o.dealt));
  }
  assert.ok([...seen].some((v) => v === 10 || v === 20), '只出現 ' + [...seen].sort().join('／') + '（沒有平均）');
  assert.ok([...seen].every((v) => [0, 10, 20, 30].includes(v)), '出現了不可能的值：' + [...seen].join('／'));
});

T('R2 ⭐ 行為：免費撤退（狃拉），換上去的偷襲只有「3 次試打都反面」才不撤退 ⇒ 64 個起點至少 48 次撤退', () => {
  const st = mk({ active: inst(C.purrloin), bench: [inst(C.diglett)] });
  // 前置條件：戰鬥位沒有招可用、撤退費 0（否則走不到撤退分支、門檻也不是 1）
  assert.equal(ENG.getAvailableAttacks(st, pool).length, 0, '前置條件：狃拉沒有能量時不應有招可用');
  let retreat = 0; const other = new Map();
  for (let k = 0; k < 64; k++) {
    EVAL.__testResetSimSeed(k);
    const a = getAIAction(st, pool, 0);
    if (a?.type === 'RETREAT' && a.newActiveIid === st.players[0].bench[0].iid) retreat++;
    else other.set(a?.type, (other.get(a?.type) ?? 0) + 1);
  }
  // 單次試打（舊版）：期望 32 次、標準差 4 ⇒ 48 次以上的機率小於萬分之一；3 次平均（新版）：期望 56 次
  assert.ok(retreat >= 48, `64 個起點只撤退 ${retreat} 次（其餘：${JSON.stringify([...other])}）`);
});

T('R3 零回歸：不擲幣的招估值不變（呆呆王｜超念力 120，每個起點都是 120、不擊倒）', () => {
  const st = mk({ active: inst(C.purrloin), bench: [inst(C.slowking, [inst(C.psy), inst(C.psy), inst(C.psy)])] });
  for (let k = 0; k < 8; k++) {
    EVAL.__testResetSimSeed(k);
    const o = EVAL.estimateIfPromoted(st, 0, st.players[0].bench[0], pool);
    assert.ok(o.ok && !o.ko && o.dealt === 120, JSON.stringify(o));
  }
});

T('R4 擊倒：打得倒時 ko=true、dealt=Infinity（超念力 120 對剩 100 HP 的卡比獸）', () => {
  const st = mk({ active: inst(C.purrloin), bench: [inst(C.slowking, [inst(C.psy), inst(C.psy), inst(C.psy)])], oppActiveDamage: 60 });
  const o = EVAL.estimateIfPromoted(st, 0, st.players[0].bench[0], pool);
  assert.ok(o.ok && o.ko && o.dealt === Infinity, JSON.stringify(o));
});

console.log(`\n=== v6.431 撤退估值取平均：PASS ${pass} / FAIL ${fail} ===`);
if (fail) { console.log('紅的：' + failed.join('、')); process.exit(1); }
