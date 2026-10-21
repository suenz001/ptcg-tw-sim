#!/usr/bin/env node
/**
 * v6.541 守衛（站長 2026-10-12 第 6 項「依官方 QA」）：
 *   SURF_*    PTCG_RULES L1844 衝浪手 × 海豚俠｜全能變身 由持有者選順序（先抽會把牌庫頂的海豚俠ex 抽進手牌）
 *   RELOAD_FIXED L2459 衝浪手 × 鋼炮臂蝦｜返回重載 官方固定先抽 ⇒ 不問順序（正對照）
 *   CART／HISUIAN 急進開關、希嘉娜的信賴 換位後還要選能量 ⇒ 原本前後比對看不到換位、永遠不問回備戰特性（audit 找到的真 bug）
 *   RETREAT_NO_REASK 撤退後 inline 詢問選「不使用」⇒ 不重問（正對照）
 * 【H】BASE（v6.540）：SURF_ASK、SURF_ABILITY_FIRST、SURF_DRAW_FIRST、CART、HISUIAN 紅；其餘兩版綠。
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.540。
const BASE_SHA = '6de7ac5a';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const HIJ = (c) => 'HIJ'.includes(c.regulationMark || '?');
const byName = (n) => { for (const c of pool.values()) if (c.name === n && HIJ(c)) return String(c.id); return null; };
const withAttack = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.attacks || []).some((x) => x.name === a)) return String(c.id); return null; };
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const EN = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼', Colorless: '水' };
const ID = { filler: '19178', W: byName('基本【水】能量'), hug: '10449', hugEx: '10450', reload: '14040', surfer: '11091', switchCart: '11275', hisuian: '19619' };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6541-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nexport { getAIAction } from '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const mk = ({ a0, b0, hand0 = [], deck0 }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [], supporterPlayedThisTurn: false, retreatedThisTurn: false,
      players: [
        { ...s.players[0], hand: hand0, deck: deck0 ?? many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler) },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: 0, senderIdx: 0, pendingToken: s.pendingSelection.token });
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  const key = (s) => s.pendingSelection?.effectKey ?? null;

  // 衝浪手換下海豚俠，牌庫頂是海豚俠ex（先抽就會把它抽進手牌）
  const surferBoard = () => { const h = inst(ID.hug, { energyAttached: many(ID.W, 1) }); const b = inst(ID.filler); const c = inst(ID.surfer);
    const ex = inst(ID.hugEx); return { s: mk({ a0: h, b0: [b], hand0: [c], deck0: [ex, ...many(ID.W, 8)] }), h, b, c, ex }; };
  T('SURF_ASK', () => { const { s: s0, b, c } = surferBoard();
    let s = act(s0, { type: 'PLAY_TRAINER', iid: c.iid, actorIdx: 0 }); s = res(s, [b.iid]);
    return { key: key(s), opts: (s.pendingSelection?.params?.options ?? []).map((o) => o.id), hand: s.players[0].hand.length }; });
  T('SURF_ABILITY_FIRST', () => { const { s: s0, b, c, h, ex } = surferBoard();
    let s = act(s0, { type: 'PLAY_TRAINER', iid: c.iid, actorIdx: 0 }); s = res(s, [b.iid]);
    if (key(s) !== 'surfer-order') return { key: key(s) };
    s = res(s, ['ability-first']);
    const k2 = key(s); if (k2 === 'hugin-allmight-swap') s = res(s, [ex.iid]);
    const benchCard = pool.get(s.players[0].bench.find((x) => x.iid === h.iid)?.cardId)?.name;
    return { k2, benchCard, hand: s.players[0].hand.length, exInHand: s.players[0].hand.some((x) => x.cardId === ID.hugEx), after: key(s) }; });
  // 先用全能變身、但不選海豚俠ex ⇒ 特性已經用掉，抽完之後不可以再問一次
  T('SURF_ABILITY_NONE', () => { const { s: s0, b, c } = surferBoard();
    let s = act(s0, { type: 'PLAY_TRAINER', iid: c.iid, actorIdx: 0 }); s = res(s, [b.iid]);
    if (key(s) !== 'surfer-order') return { key: key(s) };
    s = res(s, ['ability-first']); if (key(s) === 'hugin-allmight-swap') s = res(s, []);
    return { after: key(s), hand: s.players[0].hand.length }; });
  T('SURF_DRAW_FIRST', () => { const { s: s0, b, c, h } = surferBoard();
    let s = act(s0, { type: 'PLAY_TRAINER', iid: c.iid, actorIdx: 0 }); s = res(s, [b.iid]);
    if (key(s) !== 'surfer-order') return { key: key(s) };
    s = res(s, ['draw-first']);
    const k2 = key(s); const hand = s.players[0].hand.length; const exInHand = s.players[0].hand.some((x) => x.cardId === ID.hugEx);
    if (k2 === 'resolve-retreat-to-bench-ability-prompt') s = res(s, ['no']);
    return { k2, hand, exInHand, after: key(s), benchCard: pool.get(s.players[0].bench.find((x) => x.iid === h.iid)?.cardId)?.name }; });
  // 鋼炮臂蝦｜返回重載：官方固定先抽（L2459）⇒ 不問順序，抽完後照常問要不要用
  T('RELOAD_FIXED', () => { const r = inst(ID.reload); const b = inst(ID.filler); const c = inst(ID.surfer);
    let s = act(mk({ a0: r, b0: [b], hand0: [c] }), { type: 'PLAY_TRAINER', iid: c.iid, actorIdx: 0 }); s = res(s, [b.iid]);
    return { key: key(s), hand: s.players[0].hand.length }; });
  // 急進開關／希嘉娜的信賴：換位後還要選能量 ⇒ 選完之後要問全能變身（原本永遠不問）
  const cart = (cid, pickAll) => { const h = inst(ID.hug, { energyAttached: many(ID.W, 2) }); const b = inst(ID.filler); const c = inst(cid);
    let s = act(mk({ a0: h, b0: [b], hand0: [c] }), { type: 'PLAY_TRAINER', iid: c.iid, actorIdx: 0 });
    const keys = [key(s)];
    let g = 0;
    while (s.pendingSelection && s.pendingSelection.effectKey !== 'resolve-retreat-to-bench-ability-prompt' && g++ < 5) {
      const ps = s.pendingSelection;
      const valid = ps.params?.validIids ?? [];
      const ids = ps.type === 'bench-choose' ? [b.iid] : (pickAll ? valid.slice(0, ps.maxCount ?? 1) : valid.slice(0, Math.max(ps.minCount ?? 0, 0)));
      s = res(s, ids.length ? ids : (ps.minCount ? valid.slice(0, ps.minCount) : []));
      keys.push(key(s));
    }
    return { keys, asked: key(s) === 'resolve-retreat-to-bench-ability-prompt', onBench: s.players[0].bench.some((x) => x.iid === h.iid) }; };
  T('CART', () => cart(ID.switchCart, true));
  T('HISUIAN', () => cart(ID.hisuian, true));
  // 撤退：inline 詢問選「不使用」⇒ 不可以再問一次（v6.541 跨動作記錄不能造成重問）
  T('RETREAT_NO_REASK', () => { const h = inst(ID.hug, { energyAttached: many(ID.W, 2) }); const b = inst(ID.filler);
    let s = act(mk({ a0: h, b0: [b] }), { type: 'RETREAT', newActiveIid: b.iid });
    // 撤退費用要選能量時先付（選前 N 個）
    let g = 0; while (s.pendingSelection && s.pendingSelection.effectKey !== 'resolve-retreat-to-bench-ability-prompt' && g++ < 3) {
      const ps = s.pendingSelection; s = res(s, (ps.params?.validIids ?? h.energyAttached.map((e) => e.iid)).slice(0, Math.max(1, ps.minCount ?? 1))); }
    const k1 = key(s); if (k1 === 'resolve-retreat-to-bench-ability-prompt') s = res(s, ['no']);
    return { k1, after: key(s), swapped: s.players[0].active?.iid === b.iid }; });
  return out;
}

const judge = (r) => ({
  SURF_ASK: !!r.SURF_ASK && r.SURF_ASK.key === 'surfer-order' && JSON.stringify(r.SURF_ASK.opts) === '["draw-first","ability-first"]' && r.SURF_ASK.hand === 0,
  SURF_ABILITY_FIRST: !!r.SURF_ABILITY_FIRST && r.SURF_ABILITY_FIRST.k2 === 'hugin-allmight-swap' && r.SURF_ABILITY_FIRST.benchCard === '海豚俠ex' && r.SURF_ABILITY_FIRST.hand === 5 && !r.SURF_ABILITY_FIRST.exInHand && r.SURF_ABILITY_FIRST.after === null,
  SURF_DRAW_FIRST: !!r.SURF_DRAW_FIRST && r.SURF_DRAW_FIRST.k2 === 'resolve-retreat-to-bench-ability-prompt' && r.SURF_DRAW_FIRST.hand === 5 && r.SURF_DRAW_FIRST.exInHand && r.SURF_DRAW_FIRST.after === null && r.SURF_DRAW_FIRST.benchCard === '海豚俠',
  SURF_ABILITY_NONE: !!r.SURF_ABILITY_NONE && r.SURF_ABILITY_NONE.after === null && r.SURF_ABILITY_NONE.hand === 5,
  RELOAD_FIXED: !!r.RELOAD_FIXED && r.RELOAD_FIXED.key === 'resolve-retreat-to-bench-ability-prompt' && r.RELOAD_FIXED.hand === 5,
  CART: !!r.CART && r.CART.asked && r.CART.onBench,
  HISUIAN: !!r.HISUIAN && r.HISUIAN.asked && r.HISUIAN.onBench,
  RETREAT_NO_REASK: !!r.RETREAT_NO_REASK && r.RETREAT_NO_REASK.k1 === 'resolve-retreat-to-bench-ability-prompt' && r.RETREAT_NO_REASK.after === null && r.RETREAT_NO_REASK.swapped,
});
const LABEL = {
  SURF_ASK: '★★★ 衝浪手換下海豚俠 ⇒ 由持有者選「先抽／先全能變身」（L1844），選之前還沒抽牌',
  SURF_ABILITY_FIRST: '★★★ 選先用全能變身 ⇒ 牌庫頂的海豚俠ex 換上來、之後才抽到 5 張',
  SURF_DRAW_FIRST: '★★ 選先抽 ⇒ 抽到 5 張（海豚俠ex 進手牌）、再問要不要用全能變身',
  SURF_ABILITY_NONE: '★★ 先用全能變身但不選 ⇒ 特性已用掉、抽完 5 張後不再問',
  RELOAD_FIXED: '★ 正對照：返回重載官方固定先抽（L2459）⇒ 不問順序、抽完照常問要不要用',
  CART: '★★★ 急進開關換下海豚俠、選完能量後 ⇒ 會問全能變身（原本永遠不問）',
  HISUIAN: '★★★ 希嘉娜的信賴 同上',
  RETREAT_NO_REASK: '★ 正對照：撤退後的詢問選「不使用」⇒ 不會再問一次',
};
const NEW = ['SURF_ASK', 'SURF_ABILITY_FIRST', 'SURF_ABILITY_NONE', 'SURF_DRAW_FIRST', 'CART', 'HISUIAN'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6541b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src"], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.540：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.540：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6541 H', '需要 v6.540 commit');

console.log(`\n=== v6.541 回備戰特性：衝浪手順序與換位後詢問：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
