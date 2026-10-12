#!/usr/bin/env node
/**
 * v6.547 守衛（站長 2026-10-12 裁定第 3、11、12 項）：
 *   3. 特性被消除的寶可夢不受冰冷之帳（v6.049 起已正確；本守衛補齊初始化／暗夜羽擊／熔岩洞三種來源的行為釘）。
 *   11. 借來的高電壓壓制，所需能量＝印刷費用（中央 printedAttackCostCount）。
 *   12. 手持循環扇改附的候選排除使用招式的那一隻（中央 cycleFanTargetIids）。
 * 【H】BASE（v6.546）：第 12 項兩條紅；第 3、11 項是「現況已符合裁定」的行為釘（兩版都綠）。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.546。
const BASE_SHA = '5484adbb';
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
const ID = { filler: '19178', W: byName('基本【水】能量'), L: byName('基本【雷】能量'), PSY: byName('基本【超】能量'),
  frost: '10447', ironthorns: '16753', flutter: '16826', bouffalant: '13103', latios: '14070', baxcalibur: '11212', lava: '19623',
  kasi: '14094', fan: '10509', big: '14425', elec: '16708' };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6547-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, getAvailableAttacks, attackEnergySurplus } from '${p('src/lib/game/engine')}';\nexport { evaluateSelectionFilter, isKnownSelectionFilter } from '${p('src/lib/game/selection-filter')}';\nexport { RESOLVERS, ATTACK_PRE } from '${p('src/lib/game/effects/_shared')}';\nexport * as SH from '${p('src/lib/game/effects/_shared')}';\nexport { getAIAction } from '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = (p0 = {}, p1 = {}, top = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 20), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 20), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p1 },
      ], ...top };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids, who) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: who ?? s.pendingSelection.actorIdx, senderIdx: who ?? s.pendingSelection.actorIdx ?? 0, pendingToken: s.pendingSelection.token });
  const key = (s) => s.pendingSelection?.effectKey ?? null;
  const dmgOf = (s, iid) => [...s.players[0].bench, ...s.players[1].bench, s.players[0].active, s.players[1].active].find((c) => c && c.iid === iid)?.damage ?? -1;
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // ── 第 3 項（站長要求確認）：特性被消除的寶可夢不是「擁有特性的寶可夢」⇒ 冰冷之帳不放指示物
  //   官方 Q&A（綠寶石風暴）夢歌仙人掌｜懲罰尖刺 × 傳說的熔岩洞：「特性會全部消失，因此不能視為『擁有特性的寶可夢』計算」
  T('FROST_INIT', () => {   // 初始化：擁有規則的寶可夢（未來除外）特性全部消除
    const bf = inst(ID.bouffalant), lt = inst(ID.latios);
    const s = act(mk({ bench: [inst(ID.frost), bf, lt] }, { active: inst(ID.ironthorns) }), { type: 'END_TURN' });
    return { bf: dmgOf(s, bf.iid), lt: dmgOf(s, lt.iid) };
  });
  T('FROST_DARKWING', () => {   // 暗夜羽擊：對手的戰鬥寶可夢特性全部消除
    const lt = inst(ID.latios), bx = inst(ID.baxcalibur);
    const s = act(mk({ active: lt, bench: [inst(ID.frost), bx] }, { active: inst(ID.flutter) }), { type: 'END_TURN' });
    return { lt: dmgOf(s, lt.iid), bx: dmgOf(s, bx.iid) };
  });
  T('FROST_LAVA', () => {   // 傳說的熔岩洞：進化寶可夢特性全部消除 ⇒ 雪妖女（1 階）自己的冰冷之帳也消除
    const lt = inst(ID.latios);
    const s = act(mk({ bench: [inst(ID.frost), lt] }, {}, { activeStadium: inst(ID.lava), activeStadiumOwnerIdx: 1 }), { type: 'END_TURN' });
    return { lt: dmgOf(s, lt.iid) };
  });
  // ── 第 12 項（站長裁定排除）：手持循環扇不能改附回「使用招式的寶可夢」自己
  const fan = (extraBench) => {
    const k = inst(ID.kasi, { energyAttached: many(ID.PSY, 2) }), b1 = inst(ID.filler);
    let s = act(mk({ active: k, bench: [b1, ...extraBench] }, { active: inst(ID.big, { toolAttached: inst(ID.fan) }) }), { type: 'ATTACK', attackIndex: 0 });
    const seen = []; let g = 0;
    while (s.pendingSelection && g++ < 6) {
      const ps = s.pendingSelection; seen.push({ key: ps.effectKey, valid: ps.params?.validIids ?? null });
      if (ps.effectKey === 'cycle-fan-step1-pick-energy') s = res(s, [ps.params.options[0].id], ps.actorIdx);
      else if (ps.effectKey === 'cycle-fan-step2-place-energy') s = res(s, [ps.params.validIids[0]], ps.actorIdx);
      else { const v = ps.params?.validIids ?? s.players[ps.actorIdx].bench.map((b) => b.iid); s = res(s, [v.find((x) => x === b1.iid) ?? v[0]], ps.actorIdx); }
    }
    return { kIid: k.iid, seen, kEnergy: [s.players[0].active, ...s.players[0].bench].find((c) => c && c.iid === k.iid)?.energyAttached.length };
  };
  T('FAN_ONLY_SOURCE', () => fan([]));
  // resolver 自保（中央閘之外的第二層）：直接呼叫 step1／step2 resolver
  T('FAN_RESOLVERS', () => {
    const k = inst(ID.kasi, { energyAttached: many(ID.PSY, 2) }), b1 = inst(ID.filler);
    const s0 = mk({ active: b1, bench: [k] }, { active: inst(ID.big, { toolAttached: inst(ID.fan) }) });
    const s1 = M.RESOLVERS.get('cycle-fan-step1-pick-energy')(s0, 1, [k.energyAttached[0].iid], { attackerIid: k.iid }, pool);
    const e1 = s1.players[0].bench.find((c) => c.iid === k.iid).energyAttached.length;
    const s2 = M.RESOLVERS.get('cycle-fan-step2-place-energy')(s0, 1, [k.iid], { energy: inst(ID.PSY), attackerIid: k.iid }, pool);
    const e2 = s2.players[0].bench.find((c) => c.iid === k.iid).energyAttached.length;
    return { e1, step1Pending: s1.pendingSelection?.effectKey ?? null, e2 };
  });
  T('FAN_OTHER', () => { const b2 = inst(ID.filler); const r = fan([b2]); return { ...r, b2: b2.iid }; });
  // ── 第 11 項（站長裁定）：借來的高電壓壓制，所需能量＝印刷費用（雷雷無＝3），不套用使用者身上的費用增減
  T('BORROW_COST', () => {
    const pre = M.ATTACK_PRE.get('電擊魔獸ex|高電壓壓制');
    const copier = (k) => inst(ID.filler, { energyAttached: many(ID.L, k), attackCostIncreaseColorlessThisTurn: 1 });
    const d = (k) => pre(mk({ active: copier(k) }), 0, pool, {}).damage;
    return { d5: d(5), d4: d(4) };
  });
  // 中央查印刷費用：呼叫端給的 fallback 不再是依據（故意給 99）⇒ 仍是 3（雷雷無）
  T('PRINTED_COST', () => ({ need: M.attackEnergySurplus(mk({ active: inst(ID.filler, { energyAttached: many(ID.L, 5) }) }), 0, '高電壓壓制', pool, 99).need }));
  return out;
}

const judge = (r) => ({
  FROST_INIT: !!r.FROST_INIT && r.FROST_INIT.bf === 0 && r.FROST_INIT.lt === 10,
  FROST_DARKWING: !!r.FROST_DARKWING && r.FROST_DARKWING.lt === 0 && r.FROST_DARKWING.bx === 10,
  FROST_LAVA: !!r.FROST_LAVA && r.FROST_LAVA.lt === 0,
  FAN_ONLY_SOURCE: !!r.FAN_ONLY_SOURCE && !r.FAN_ONLY_SOURCE.seen.some((x) => x.key?.startsWith('cycle-fan')) && r.FAN_ONLY_SOURCE.kEnergy === 2,
  FAN_RESOLVERS: !!r.FAN_RESOLVERS && r.FAN_RESOLVERS.e1 === 2 && r.FAN_RESOLVERS.step1Pending === null && r.FAN_RESOLVERS.e2 === 2,
  FAN_OTHER: !!r.FAN_OTHER && r.FAN_OTHER.seen.some((x) => x.key === 'cycle-fan-step2-place-energy' && JSON.stringify(x.valid) === JSON.stringify([r.FAN_OTHER.b2])) && r.FAN_OTHER.kEnergy === 1,
  BORROW_COST: !!r.BORROW_COST && r.BORROW_COST.d5 === 280 && r.BORROW_COST.d4 === 180,
  PRINTED_COST: !!r.PRINTED_COST && r.PRINTED_COST.need === 3,
});
const LABEL = {
  FROST_INIT: '★★ 第 3 項確認：初始化消除特性的寶可夢ex 不受冰冷之帳；非規則寶可夢照常（官方 Q&A「不能視為擁有特性的寶可夢」）',
  FROST_DARKWING: '★★ 第 3 項確認：暗夜羽擊消除特性的戰鬥寶可夢不受冰冷之帳；備戰照常',
  FROST_LAVA: '★★ 第 3 項確認：傳說的熔岩洞消除雪妖女（1 階）自己的特性 ⇒ 冰冷之帳不生效',
  FAN_ONLY_SOURCE: '★★★ 第 12 項：使用招式的寶可夢換到備戰、備戰只剩它 ⇒ 手持循環扇沒有可改附的目標，不發動、能量不動',
  FAN_RESOLVERS: '★★★ 第 12 項 resolver 自保：step1 沒有其他備戰 ⇒ 不拿走能量；step2 送使用招式的那一隻 ⇒ 不改附',
  FAN_OTHER: '★★★ 第 12 項：有其他備戰 ⇒ 改附的候選不含使用招式的那一隻',
  BORROW_COST: '★★ 第 11 項：借來的高電壓壓制所需能量＝印刷費用 3（不套用使用者的費用增減；5 個 ⇒ +100、4 個 ⇒ 不加）',
  PRINTED_COST: '★★★ 第 11 項：借招的所需能量由卡片資料中央查出（呼叫端 fallback 不再是依據）',
};
const NEW = ['FAN_ONLY_SOURCE', 'FAN_RESOLVERS', 'FAN_OTHER', 'PRINTED_COST'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6547b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src scripts static/cards | tar -x -C "${tmp}" && ln -s "${join(ROOT, 'node_modules')}" "${tmp}/node_modules"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.546：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.546：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6547 H', '需要 v6.546 commit');

console.log(`\n=== v6.547 站長裁定第 3／11／12 項：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
