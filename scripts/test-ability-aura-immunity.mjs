// 守衛：「持續型 aura 特性」把對手寶可夢的費用 +1 時，要過**特性**效果免疫（v6.047）。
//
// Wilson 裁定（官方規則庫查無此條明文，故由 Wilson 拍板）：
//   化隱卡面逐字是「這隻寶可夢不會受到對手的招式**與特性**的效果的影響」→ aura 也是特性的效果，
//   所以要擋。相關卡（皆查證自 static/cards 台灣官方中文卡面）：
//     阿利多斯｜大網（SV5a, H）        「只要這隻寶可夢在場上，對手的戰鬥場的【進化】寶可夢【撤退】所需的能量增加1個。」
//     超級水晶燈火靈ex｜咒縛火焰(M5,J) 「只要這隻寶可夢在場上，對手的戰鬥寶可夢【撤退】所需的能量增加1個。」
//     陳舊的根狀化石｜原始根（SV7, H） 「只要這隻寶可夢在戰鬥場上，對手的【基礎】寶可夢使用招式所需的能量增加1個【無】能量。」
//
// ⭐**反向同樣重要**：【薄霧能量】卡面只寫「不會受到對手的寶可夢使用**招式**的效果的影響」，
//   **不該**擋特性 aura。官方 Q&A 佐證同一方向（PTCG RULES §薄霧能量）：
//     Q: 上個對手回合對手的帝牙海獅使出「凍結獠牙」，下個自己的回合把「薄霧能量」附加給
//        1 張能量都沒有的太樂巴戈斯，可以使用「稜鏡充能」嗎？   A: 不可以。
//   → 薄霧能量擋不住這類「改變費用／可否行動」的持續效果。本檔把兩個方向都釘住，
//     避免日後有人「順手」把 kind 從 ability-effect 改成 attack-effect 而悄悄改變裁定。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-au-s.js'), E = join(ROOT, '.x-au-e.ts'), O = join(ROOT, '.x-au-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { canAffordAttack, computeActiveRetreatCostFor } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { canAffordAttack, computeActiveRetreatCostFor } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

const ARIADOS = '10252';   // 阿利多斯（大網）
const LAMP = '19180';      // 超級水晶燈火靈ex（咒縛火焰）
const ROOT_FOSSIL = '10985'; // 陳舊的根狀化石（原始根）
const MATCHA = '19150';    // 來悲粗茶：化隱、Stage1（進化）、base 撤退 1
const SMOLIV = '19149';    // 斯魔茶：化隱、基礎、base 撤退 0、招式「無聲加害」cost【無】
const JYNX = '19174';      // 迷唇姐：無免疫、基礎、base 撤退 1
const DRAGAPULT = '17019'; // 多龍巴魯托ex：無免疫、Stage2（進化）、招式[0] cost【無】
const MIST = '12462';      // 薄霧能量
const PSY = '14128';       // 基本【超】能量

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkP = (name, active, bench = []) => ({ name, active, bench, hand: [], deck: [inst(JYNX)], discard: [], prizes: [inst(JYNX)] });
const mk = (p0, p1) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], winner: null, players: [p0, p1] });

/** 對手場上放 1 隻 aura 持有者時，我方戰鬥位的撤退費。 */
const retreatWith = (auraId, defenderInst) =>
  computeActiveRetreatCostFor(mk(mkP('P1', inst(auraId), []), mkP('P2', defenderInst, [inst(JYNX)])), 1, pool);
const retreatWithout = (defenderInst) =>
  computeActiveRetreatCostFor(mk(mkP('P1', inst(JYNX), []), mkP('P2', defenderInst, [inst(JYNX)])), 1, pool);

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：三張 aura 卡與兩張化隱卡的卡面文字沒變', () => {
  const txt = (id, ab) => (pool.get(id)?.abilities ?? []).find((a) => a.name === ab)?.effect ?? '';
  assert.ok(txt(ARIADOS, '大網').includes('【撤退】所需的能量增加1個'), '大網');
  assert.ok(txt(LAMP, '咒縛火焰').includes('【撤退】所需的能量增加1個'), '咒縛火焰');
  assert.ok(txt(ROOT_FOSSIL, '原始根').includes('使用招式所需的能量增加1個'), '原始根');
  for (const id of [MATCHA, SMOLIV]) {
    assert.ok((pool.get(id)?.abilities ?? []).some((a) => a.name === '化隱'), `${id} 應有化隱`);
  }
});

T('⭐⭐阿利多斯｜大網 對「化隱」進化寶可夢無效（Wilson 裁定：特性效果，化隱免疫）', () => {
  const before = retreatWithout(inst(MATCHA));
  const after = retreatWith(ARIADOS, inst(MATCHA));
  assert.equal(after, before, `化隱寶可夢撤退費被 aura 加了（${before} → ${after}）`);
});

T('阿利多斯｜大網 對一般進化寶可夢仍 +1（證明 aura 本身沒被改壞）', () => {
  const before = retreatWithout(inst(DRAGAPULT));
  const after = retreatWith(ARIADOS, inst(DRAGAPULT));
  assert.equal(after, before + 1, `一般進化寶可夢應 +1，實得 ${before} → ${after}`);
});

T('⭐⭐超級水晶燈火靈ex｜咒縛火焰 對「化隱」無效', () => {
  const before = retreatWithout(inst(SMOLIV));
  const after = retreatWith(LAMP, inst(SMOLIV));
  assert.equal(after, before, `化隱寶可夢撤退費被 aura 加了（${before} → ${after}）`);
});

T('超級水晶燈火靈ex｜咒縛火焰 對一般寶可夢仍 +1', () => {
  const before = retreatWithout(inst(JYNX));
  const after = retreatWith(LAMP, inst(JYNX));
  assert.equal(after, before + 1, `一般寶可夢應 +1，實得 ${before} → ${after}`);
});

T('⭐⭐【薄霧能量】不可擋 aura（卡面只寫「招式的效果」，這是特性的效果）', () => {
  const before = retreatWithout(inst(JYNX, [en(MIST)]));
  const after = retreatWith(LAMP, inst(JYNX, [en(MIST)]));
  assert.equal(after, before + 1,
    '附薄霧能量的寶可夢撤退費仍應被 aura +1 —— 薄霧能量卡面只免疫「對手的寶可夢使用招式的效果」，'
    + '把 gate 的 kind 寫成 attack-effect 就會在這裡誤擋（官方 Q&A 同方向：附薄霧仍被凍結獠牙鎖招）');
});

// ⚠判準用 canAffordAttack 而不是「applyAction 後 state 有沒有變」：
//   實測 applyAction 即使因能量不足打不出招式，回傳的仍是**新的 state 物件**（流程前段已寫過 log
//   等欄位），用 `after === st` 判斷會恆為「打得出來」——第一版就是這樣寫，導致化隱那條在
//   修正前的 HEAD 也 PASS（假綠）。付不付得出招式費用，直接問 canAffordAttack 最準。
T('⭐⭐陳舊的根狀化石｜原始根 對「化隱」基礎寶可夢無效（招式費不 +1）', () => {
  const fossil = inst(ROOT_FOSSIL, [], { fossilOnField: true });
  const atk = inst(SMOLIV, [en(PSY)]);   // 斯魔茶：化隱、基礎、招式 cost 只要 1 個【無】
  const st = mk(mkP('P1', atk, [inst(JYNX)]), mkP('P2', fossil, [inst(JYNX)]));
  const cost = pool.get(SMOLIV).attacks[0].cost;
  assert.equal(canAffordAttack(atk, cost, pool, st, 0, pool.get(SMOLIV).attacks[0].name), true,
    '化隱寶可夢應付得出招式費用（原始根的 +1【無】不該套用）');
});

T('陳舊的根狀化石｜原始根 對一般基礎寶可夢仍 +1（1 個能量付不出）', () => {
  const fossil = inst(ROOT_FOSSIL, [], { fossilOnField: true });
  const atk = inst(JYNX, [en(PSY)]);     // 迷唇姐｜強烈之吻 cost=【超】1 個
  const st = mk(mkP('P1', atk, [inst(JYNX)]), mkP('P2', fossil, [inst(JYNX)]));
  const cost = pool.get(JYNX).attacks[0].cost;
  assert.equal(canAffordAttack(atk, cost, pool, st, 0, pool.get(JYNX).attacks[0].name), false,
    '一般基礎寶可夢應因原始根 +1【無】而付不出招式費用（需 2 個，只給 1 個）');
});

T('對照：場上沒有陳舊的根狀化石時，同一隻一般寶可夢付得出費用', () => {
  const atk = inst(JYNX, [en(PSY)]);
  const st = mk(mkP('P1', atk, [inst(JYNX)]), mkP('P2', inst(JYNX), [inst(JYNX)]));
  assert.equal(canAffordAttack(atk, pool.get(JYNX).attacks[0].cost, pool, st, 0, '強烈之吻'), true,
    '沒有原始根時 1 個【超】能量就夠 —— 否則上一條的 false 可能是別的原因造成的');
});

T('⭐自己場上的特性給自己減撤退費不受此 gate 影響（只 gate 跨方 aura）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const i = src.indexOf('function applyAbilityRetreatMod');
  assert.ok(i > 0);
  const body = src.slice(i, i + 3000);
  assert.ok(/ownerIdx !== retreatingOwnerIdx/.test(body),
    'aura gate 必須限定「持有者與被影響者不同側」，否則會把自己給自己的減費也擋掉');
  assert.ok(/'ability-effect'/.test(body),
    "gate 的 kind 必須是 'ability-effect'（寫成 attack-effect 會讓薄霧能量誤擋 aura）");
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
