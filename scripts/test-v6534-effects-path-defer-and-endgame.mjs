#!/usr/bin/env node
/**
 * v6.534 守衛（站長 2026-10-12 裁定：受傷反擊整體移到招式效果之後；v6.533 審查 P2-2／P3-7／P3-8）：
 *   EFF   中央傷害路徑（狙擊／選擇視窗型）沒打倒時：只記 _pendingOnDamaged、不當場反擊；之後招式效果把扣殺能量移走 ⇒ 結算時不放
 *   EFF_ctl 扣殺能量沒被移走 ⇒ 結算時照放 20
 *   BENCH 備戰的快掃拳返持有者被狙擊 ⇒ 結算時才反擊（只有不限戰鬥場的反擊）
 *   BENCH_NEG 備戰的穿山王｜反擊針（限戰鬥場）被狙擊 ⇒ 結算時也不反擊（正對照）
 *   LEGDBL 沒有招式效果的招式：雙方同時昏厥、各自取完最後的獎賞 ⇒ 平手（BASE：先取完者勝、對手沒拿到獎賞）
 *   HOLD_D 同上但 P2 在反擊中取完最後的獎賞 ⇒ 視窗解完後判 P2 勝（v6.534 審查 P1-1：曾吊在半空）
 *   SNIPE_KO 中央傷害路徑一擊打倒 ⇒ 受傷觸發照舊當場發生一次（正對照）
 *   HOLD  反擊打昏無備戰的攻擊方、同時受傷觸發的視窗開著 ⇒ 等視窗解完、防守方昏厥結算後再判（雙方都達成 ⇒ 平手）
 * 【H】BASE（v6.533）：EFF、BENCH、LEGDBL、HOLD、HOLD_D 逐條紅；EFF_ctl、BENCH_NEG、SNIPE_KO 兩版綠。
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
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.533。
const BASE_SHA = 'f55b5ab6';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n) => { for (const c of pool.values()) if (c.name === n && 'HIJ'.includes(c.regulationMark || '?')) return String(c.id); return null; };
const special = () => byName('稜鏡能量');
const withAttack = (n, a) => { for (const c of pool.values()) if (c.name === n && 'HIJ'.includes(c.regulationMark || '?') && (c.attacks || []).some((x) => x.name === a)) return String(c.id); return null; };
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && 'HIJ'.includes(c.regulationMark || '?') && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const ID = {
  W: byName('基本【水】能量'), F: byName('基本【鬥】能量'), M: byName('基本【鋼】能量'), filler: '19178',
  smash: byName('扣殺能量'), sandslash: withAbility('穿山王', '反擊針'), quick: (() => { for (const c of pool.values()) if ('HIJ'.includes(c.regulationMark || '?') && (c.abilities || []).some((x) => x.name === '快掃拳返')) return String(c.id); return null; })(),
  landorus: withAttack('土地雲', '巨岩墜落'), pawn: withAttack('駒刀小兵', '推倒'), torkoal: withAbility('爆焰龜獸', '甲殼刺'), lux: byName('奢華炸彈'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);
const atkIdx = (id, n) => pool.get(id).attacks.findIndex((a) => a.name === n);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6534-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nexport * as ENG from '${p('src/lib/game/engine')}';\nexport { dealAttackDamageToTarget } from '${p('src/lib/game/effects')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = ({ a0, b0 = [], a1, b1 = [], prizes0, prizes1 }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: prizes0 ?? many(ID.W, 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: prizes1 ?? many(ID.W, 6), bench: b1, active: a1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const settle = (s) => (typeof M.ENG.settlePendingOnDamaged === 'function' ? M.ENG.settlePendingOnDamaged(s, pool) : s);
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };

  // EFF：中央傷害路徑 30 傷害打附扣殺能量的戰鬥寶可夢（沒打倒）→ 招式效果（手術：模擬）把扣殺能量移到備戰 → 結算
  const eff = (moveAway) => {
    const atk = inst(ID.filler); const sm = inst(ID.smash); const d = inst(ID.landorus, { energyAttached: [sm] }); const db = inst(ID.filler);   // 燭光靈（超）打土地雲：無抵抗力
    let s = M.dealAttackDamageToTarget(mk({ a0: atk, a1: d, b1: [db] }), 0, d.iid, 30, pool, { kind: 'attack-damage', label: 'T' });
    const before = s.players[0].active.damage;
    if (moveAway) s = { ...s, players: [s.players[0], { ...s.players[1], active: { ...s.players[1].active, energyAttached: [] }, bench: [{ ...db, energyAttached: [sm] }] }] };
    s = settle(s);
    return { before, after: s.players[0].active.damage };
  };
  T('EFF', () => eff(true));
  T('EFF_ctl', () => eff(false));
  // BENCH：備戰的快掃拳返持有者被狙擊（沒打倒）⇒ 不當場反擊、結算時才反擊
  T('BENCH', () => {
    const atk = inst(ID.filler); const q = inst(ID.quick, { energyAttached: many(ID.M, 2) });   // 【鋼】2 個 ⇒ 4 個指示物
    let s = M.dealAttackDamageToTarget(mk({ a0: atk, a1: inst(ID.filler), b1: [q] }), 0, q.iid, 10, pool, { kind: 'attack-damage', label: 'T' });
    const before = s.players[0].active.damage;
    s = settle(s);
    return { before, after: s.players[0].active.damage };
  });
  // BENCH_NEG：備戰的穿山王｜反擊針（卡面「在戰鬥場受到…時」）被狙擊 ⇒ 結算時也不反擊
  T('BENCH_NEG', () => {
    const atk = inst(ID.filler); const ss = inst(ID.sandslash);
    let s = M.dealAttackDamageToTarget(mk({ a0: atk, a1: inst(ID.filler), b1: [ss] }), 0, ss.iid, 10, pool, { kind: 'attack-damage', label: 'T' });
    s = settle(s);
    return { after: s.players[0].active.damage };
  });
  // LEGDBL：巨岩墜落（沒有招式效果）打倒穿山王、P1 取完最後 1 張；反擊針 30 打昏土地雲、P2 也取完最後 1 張 ⇒ 平手
  T('LEGDBL', () => {
    const ld = inst(ID.landorus, { energyAttached: many(ID.F, 2), damage: Number(pool.get(ID.landorus).hp) - 30 });
    const ss = inst(ID.sandslash, { damage: Number(pool.get(ID.sandslash).hp) - 50 });
    const s = act(mk({ a0: ld, b0: [inst(ID.filler)], a1: ss, b1: [inst(ID.filler)], prizes0: many(ID.W, 1), prizes1: many(ID.W, 1) }),
      { type: 'ATTACK', attackIndex: atkIdx(ID.landorus, '巨岩墜落'), actorIdx: 0 });
    return { phase: s.phase, winner: s.winner ?? null, isDraw: !!s.isDraw, p2Prizes: s.players[1].prizes.length };
  });
  // HOLD：推倒打倒 10HP 的爆焰龜獸（甲殼刺＋奢華炸彈）；奢華炸彈 +120 打昏無備戰的駒刀小兵；甲殼刺視窗開著 ⇒ 等它解完再判 ⇒ 平手
  T('HOLD', () => {
    const pw = inst(ID.pawn, { energyAttached: [inst(ID.M)] }); const fb = inst(ID.filler);
    const tk = inst(ID.torkoal, { damage: Number(pool.get(ID.torkoal).hp) - 10, toolAttached: inst(ID.lux) });
    let s = act(mk({ a0: pw, a1: tk, b1: [fb], prizes0: many(ID.W, 1), prizes1: many(ID.W, 6) }),
      { type: 'ATTACK', attackIndex: atkIdx(ID.pawn, '推倒'), actorIdx: 0 });
    let guard = 0; const keys = [];
    while (s.pendingSelection && s.phase === 'playing' && guard++ < 6) {
      const ps = s.pendingSelection; keys.push(ps.effectKey);
      const v = ps.params?.validIids ?? [];
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: v.length ? v.slice(0, 1) : (ps.type === 'active-energy-discard' ? [] : [fb.iid]), actorIdx: ps.actorIdx ?? 0, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token });
    }
    return { phase: s.phase, winner: s.winner ?? null, isDraw: !!s.isDraw, p1Prizes: s.players[0].prizes.length, keys };
  });
  // HOLD_D（審查 P1-1）：同 HOLD，但 P1 有備戰、P2 只剩 1 張獎賞 ⇒ 奢華炸彈打昏駒刀小兵時 P2 取完 ⇒ 甲殼刺視窗解完後仍要判 P2 勝（不可吊在半空）
  T('HOLD_D', () => {
    const pw = inst(ID.pawn, { energyAttached: [inst(ID.M)] }); const fb = inst(ID.filler);
    const tk = inst(ID.torkoal, { damage: Number(pool.get(ID.torkoal).hp) - 10, toolAttached: inst(ID.lux) });
    let s = act(mk({ a0: pw, b0: [inst(ID.filler)], a1: tk, b1: [fb], prizes0: many(ID.W, 6), prizes1: many(ID.W, 1) }),
      { type: 'ATTACK', attackIndex: atkIdx(ID.pawn, '推倒'), actorIdx: 0 });
    let guard = 0;
    while (s.pendingSelection && s.phase === 'playing' && guard++ < 6) {
      const ps = s.pendingSelection; const v = ps.params?.validIids ?? [];
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: v.length ? v.slice(0, 1) : (ps.type === 'active-energy-discard' ? [] : [fb.iid]), actorIdx: ps.actorIdx ?? 0, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token });
    }
    return { phase: s.phase, winner: s.winner ?? null, p1Prizes: s.players[0].prizes.length, p2Prizes: s.players[1].prizes.length };
  });
  // SNIPE_KO：中央傷害路徑一擊打倒 ⇒ 受傷觸發照舊當場發生一次（不延後、不漏）
  T('SNIPE_KO', () => {
    const atk = inst(ID.filler); const sm = inst(ID.smash); const d = inst(ID.landorus, { energyAttached: [sm] });
    const s = M.dealAttackDamageToTarget(mk({ a0: atk, a1: d, b1: [inst(ID.filler)] }), 0, d.iid, 300, pool, { kind: 'attack-damage', label: 'T' });
    const s2 = settle(s);
    return { now: s.players[0].active.damage, after: s2.players[0].active.damage, q: (s._pendingOnDamaged ?? []).length };
  });
  return out;
}

const judge = (r) => ({
  EFF: !!r.EFF && r.EFF.before === 0 && r.EFF.after === 0,
  EFF_ctl: !!r.EFF_ctl && r.EFF_ctl.after === 20,
  BENCH: !!r.BENCH && r.BENCH.before === 0 && r.BENCH.after > 0,
  BENCH_NEG: !!r.BENCH_NEG && r.BENCH_NEG.after === 0,
  LEGDBL: !!r.LEGDBL && r.LEGDBL.phase === 'game-over' && r.LEGDBL.isDraw === true && r.LEGDBL.p2Prizes === 0,
  HOLD_D: !!r.HOLD_D && r.HOLD_D.phase === 'game-over' && r.HOLD_D.winner === 1 && r.HOLD_D.p1Prizes === 5 && r.HOLD_D.p2Prizes === 0,
  SNIPE_KO: !!r.SNIPE_KO && r.SNIPE_KO.now === 20 && r.SNIPE_KO.after === 20 && r.SNIPE_KO.q === 0,
  HOLD: !!r.HOLD && r.HOLD.phase === 'game-over' && r.HOLD.isDraw === true && r.HOLD.p1Prizes === 0,
});
const LABEL = {
  EFF: '★★★ 中央傷害路徑沒打倒 ⇒ 不當場反擊；招式效果移走扣殺能量後結算 ⇒ 不放',
  EFF_ctl: '★ 正對照：扣殺能量還在 ⇒ 結算時照放 20',
  BENCH: '★★ 備戰的快掃拳返被狙擊 ⇒ 結算時才反擊',
  BENCH_NEG: '★ 正對照：備戰的反擊針（限戰鬥場）被狙擊 ⇒ 結算時也不反擊',
  LEGDBL: '★★★ 沒有招式效果：雙方同時昏厥、各自取完 ⇒ 平手（v6.533 審查 P2-2）',
  HOLD_D: '★★★ 暫停判定後仍要判：P2 在反擊中取完 ⇒ 視窗解完判 P2 勝（審查 P1-1）',
  SNIPE_KO: '★ 正對照：中央傷害路徑一擊打倒 ⇒ 受傷觸發當場發生一次',
  HOLD: '★★ 受傷觸發視窗開著時先不判 ⇒ 視窗解完才結算 ⇒ 平手（v6.533 審查 P3-7）',
};
const NEW = ['EFF', 'BENCH', 'LEGDBL', 'HOLD', 'HOLD_D'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6534b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src"], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.533：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.533：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6534 H', '需要 v6.533 commit');

console.log(`\n=== v6.534 中央傷害路徑延後／同時昏厥／判定時點：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
