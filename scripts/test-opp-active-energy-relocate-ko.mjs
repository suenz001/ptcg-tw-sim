/**
 * 「搬移對手戰鬥位能量到存活處」招式 — 對手戰鬥位被本招式傷害 KO 後仍能搬移（v5.776）
 * 完整漏網集合(7張)：戲法舞步×2 / 反轉之風(已修 v5.769) + 本輪 付諸東流 / 上搗角擊 / 阻礙之翼 / 水流清洗。
 * 官方順序「招式效果先於昏厥結算」；引擎主 KO 已移除對手 active+能量進棄牌 → 由 _koDefenderSnapshot 取回。
 *   驗 HEAD FAIL：未修版 postFn/resolver 讀 opp.active(null) → 早退/不搬移。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.oer-s.js'), E = join(ROOT, '.oer-e.ts'), O = join(ROOT, '.oer-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_POST, applyAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
let STAGE2 = null;
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id != null) pool.set(String(c.id), c); if (!STAGE2 && c?.stage === 'Stage2') STAGE2 = String(c.id); } }

const ENERGY = '14102';   // 基本【草】能量
const POKE = '14086';     // 願增猿（備戰目標）
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(ENERGY));
const RESOLVE = (iids) => ({ type: 'RESOLVE_SELECTION', selectedIids: iids });

function koState(snapEnergy, opts = {}) {
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    _koDefenderSnapshot: { idx: 1, inst: { iid: 'koA', cardId: opts.snapCardId ?? POKE, energyAttached: snapEnergy } },
    players: [
      { name: 'P1', active: inst(POKE, { energyAttached: [] }), bench: [], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
      { name: 'P2', active: null, bench: opts.noBench ? [] : [inst(POKE)], hand: [], deck: [inst(ENERGY)], discard: [...snapEnergy], prizes: prize(6) },
    ] };
}
const ACT = { type: 'ATTACK', discardedEnergyIids: ['yes'] };

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

function testHandReturn(key, label, snapE, opts = {}) {
  const post = ATTACK_POST.get(key);
  assert.ok(post, key + ' postFn 未註冊');
  let st = post(koState(snapE, opts), 0, pool, ACT);
  assert.ok(st.pendingSelection, label + ' KO 後應開 picker（HEAD 為 null/早退）');
  assert.equal(st.pendingSelection.params.fromDiscard, true, 'fromDiscard 應為 true');
  st = applyAction(st, RESOLVE(snapE.map(e => e.iid)), pool);
  assert.equal(st.players[1].hand.length, snapE.length, label + ' 能量應回對手手牌(' + snapE.length + ')');
  assert.ok(!st.players[1].discard.some(c => snapE.some(e => e.iid === c.iid)), label + ' 能量應離開棄牌');
}

T('付諸東流(70) KO→能量棄牌回對手手牌', () => testHandReturn('呆呆王|付諸東流', '付諸東流', [inst(ENERGY), inst(ENERGY)]));
T('水流清洗(20) KO→能量棄牌回對手手牌', () => testHandReturn('章魚桶|水流清洗', '水流清洗', [inst(ENERGY)]));
T('上搗角擊 KO(對手2階) →能量回手', () => {
  assert.ok(STAGE2, '需要一張 live Stage2 卡');
  testHandReturn('帕底亞 肯泰羅|上搗角擊', '上搗角擊', [inst(ENERGY)], { snapCardId: STAGE2 });
});

T('阻礙之翼(30) KO→能量棄牌改附對手備戰', () => {
  const post = ATTACK_POST.get('火箭隊的閃電鳥|阻礙之翼');
  assert.ok(post);
  const snapE = [inst(ENERGY)];
  let st = post(koState(snapE), 0, pool, ACT);
  assert.ok(st.pendingSelection, '阻礙之翼 KO 應開 picker');
  st = applyAction(st, RESOLVE([snapE[0].iid]), pool);
  assert.equal(st.pendingSelection?.effectKey, 'v3140-zapdos-jamming-attach', '應進 bench-choose');
  const benchIid = st.players[1].bench[0].iid;
  st = applyAction(st, RESOLVE([benchIid]), pool);
  assert.equal(st.players[1].bench[0].energyAttached.length, 1, '能量應改附對手備戰');
  assert.ok(!st.players[1].discard.some(c => c.iid === snapE[0].iid), '能量應離開棄牌');
});

console.log('\n搬對手戰鬥位能量到存活處 KO 補網(v5.776):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
