#!/usr/bin/env node
/**
 * v6.535 守衛（v6.534 審查 P2-1／P2-2／P3-1：單一目標狙擊收斂中央、中央 KO 無備戰先取獎、昏厥離場前先結算受傷紀錄）：
 *   LUCARIO 路卡利歐｜波導彈打備戰拖拖蚓ex（附【鋼】×2）⇒ 快掃拳返 +40（原本 wave3a-snipe-bench 手寫傷害、不觸發）
 *   LUC_KO  快掃拳返打昏路卡利歐 ⇒ 中央 koAttackerAfterRetaliation（審查 P3-2）
 *   LUC_KO2 一擊打倒備戰拖拖蚓ex（當場觸發）時快掃拳返打昏路卡利歐 ⇒ 中央結算
 *   LUC_KO3 同上但路卡利歐無備戰、獎賞 6/1 ⇒ 拖拖蚓ex 照常昏厥、P1 取 2 張、P2 取完勝（複審 P3-1：anywhere 路徑結算後的 lift）
 *   BURST   炸裂針打昏攻擊方寫終局 ⇒ 這一下的取獎照常、雙方取完 ⇒ 平手
 *   SHAYMIN 謝米｜精刺奇襲打備戰拖拖蚓ex ⇒ +40（原本 snipe-60-ex 自跑一套、沒有受傷觸發）
 *   TAUROS  肯泰羅｜群起瞄準打戰鬥場的拖拖蚓ex ⇒ +40（原本 raw 加傷害）
 *   LEGK    巨岩墜落打倒穿山王（P1 取完、P1 無備戰）＋反擊針打昏土地雲 ⇒ P2 也取完、P2 可放置 ⇒ P2 勝（官方 L622；原本 P2 沒取獎、判平手）
 *   P31     中央傷害路徑先打 30（延後）再以效果打倒同一隻帶幸運頭盔 ⇒ 離場前先結算 ⇒ 抽 2（原本被吃掉）
 *   CM_*    中央路徑終局矩陣：群起瞄準打倒戰鬥場穿山王、反擊針同時打昏肯泰羅（審查 P1-1：原本反擊寫終局後 helper 早退、防守方昏厥遺失）
 *   HOLDG2  v6.534 HOLD 情境：P1 有備戰、P2 無備戰、6/1 ⇒ 平手、5/0（正對照，v6.420 裁定）
 * 【H】BASE（v6.534）：LUCARIO、LUC_KO、LUC_KO2、LUC_KO3、BURST、SHAYMIN、TAUROS、LEGK、P31、CM_11、CM_10、CM_10_61、CM_00 逐條紅；HOLDG2 兩版綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.534。
const BASE_SHA = '38964609';
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
  W: byName('基本【水】能量'), F: byName('基本【鬥】能量'), M: byName('基本【鋼】能量'), G: byName('基本【草】能量'), filler: '19178',
  lucario: withAttack('路卡利歐', '波導彈'), shaymin: withAttack('謝米', '精刺奇襲'), tauros: withAttack('肯泰羅', '群起瞄準'),
  orth: withAbility('拖拖蚓ex', '快掃拳返'), landorus: withAttack('土地雲', '巨岩墜落'), sandslash: withAbility('穿山王', '反擊針'),
  luck: byName('幸運頭盔'), cact: withAbility('沙鈴仙人掌', '炸裂針'), pawn: withAttack('駒刀小兵', '推倒'), torkoal: withAbility('爆焰龜獸', '甲殼刺'), lux: byName('奢華炸彈'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);
const atkIdx = (id, n) => pool.get(id).attacks.findIndex((a) => a.name === n);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6535-'));
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
  const drive = (s, pick) => { let g = 0; while (s.pendingSelection && s.phase === 'playing' && g++ < 8) { const ps = s.pendingSelection;
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: pick(ps), actorIdx: ps.actorIdx ?? 0, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); } return s; };
  const heads = (f) => { const o = Math.random; Math.random = () => 0; try { return f(); } finally { Math.random = o; } };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  const orthB = () => inst(ID.orth, { energyAttached: many(ID.M, 2) });

  T('LUCARIO', () => { const lu = inst(ID.lucario, { energyAttached: many(ID.F, 3) }); const o = orthB();
    let s = act(mk({ a0: lu, a1: inst(ID.landorus), b1: [o] }), { type: 'ATTACK', attackIndex: atkIdx(ID.lucario, '波導彈'), actorIdx: 0 });
    s = drive(s, (ps) => (ps.params?.validIids ?? []).includes(o.iid) ? [o.iid] : (ps.params?.validIids ?? []).slice(0, 1));
    return { atkDmg: s.players[0].active?.damage, orthDmg: s.players[1].bench.find((c) => c.iid === o.iid)?.damage }; });
  T('LUC_KO', () => { const lu = inst(ID.lucario, { energyAttached: many(ID.F, 3), damage: Number(pool.get(ID.lucario).hp) - 40 }); const o = orthB();
    let s = act(mk({ a0: lu, b0: [inst(ID.filler)], a1: inst(ID.landorus), b1: [o] }), { type: 'ATTACK', attackIndex: atkIdx(ID.lucario, '波導彈'), actorIdx: 0 });
    s = drive(s, (ps) => (ps.params?.validIids ?? []).includes(o.iid) ? [o.iid] : (ps.params?.validIids ?? []).slice(0, 1));
    const L = (s.log || []).map((l) => l.message);
    return { luGone: ![s.players[0].active, ...s.players[0].bench].some((c) => c?.iid === lu.iid), p2Prizes: s.players[1].prizes.length, sys: L.some((x) => /系統擊倒檢查|系統昏厥檢查/.test(x)) }; });
  // LUC_KO2：波導彈一擊打倒備戰拖拖蚓ex（當場觸發）、快掃拳返打昏路卡利歐 ⇒ 中央結算
  T('LUC_KO2', () => { const lu = inst(ID.lucario, { energyAttached: many(ID.F, 3), damage: Number(pool.get(ID.lucario).hp) - 40 });
    const o = inst(ID.orth, { energyAttached: many(ID.M, 2), damage: Number(pool.get(ID.orth).hp) - 60 });
    let s = act(mk({ a0: lu, b0: [inst(ID.filler)], a1: inst(ID.landorus), b1: [o] }), { type: 'ATTACK', attackIndex: atkIdx(ID.lucario, '波導彈'), actorIdx: 0 });
    s = drive(s, (ps) => (ps.params?.validIids ?? []).includes(o.iid) ? [o.iid] : (ps.params?.validIids ?? []).slice(0, 1));
    const L = (s.log || []).map((l) => l.message);
    return { luGone: ![s.players[0].active, ...s.players[0].bench].some((c) => c?.iid === lu.iid), sys: L.some((x) => /系統擊倒檢查|系統昏厥檢查/.test(x)), viaCentral: L.some((x) => x.includes('快掃拳返') && x.includes('昏厥')) || L.some((x) => /快掃拳返：.*昏厥/.test(x))   /* v6.571 用詞 */ }; });
  // LUC_KO3（複審 P3-1）：同 LUC_KO2 但路卡利歐沒有備戰、獎賞 6/1
  //   ⇒ 快掃拳返寫終局後仍要 lift：拖拖蚓ex 照常被擊倒、P1 取 2 張剩 4、P2 取完 ⇒ P2 勝
  T('LUC_KO3', () => { const lu = inst(ID.lucario, { energyAttached: many(ID.F, 3), damage: Number(pool.get(ID.lucario).hp) - 40 });
    const o = inst(ID.orth, { energyAttached: many(ID.M, 2), damage: Number(pool.get(ID.orth).hp) - 60 });
    let s = act(mk({ a0: lu, a1: inst(ID.landorus), b1: [o], prizes0: many(ID.W, 6), prizes1: many(ID.W, 1) }), { type: 'ATTACK', attackIndex: atkIdx(ID.lucario, '波導彈'), actorIdx: 0 });
    s = drive(s, (ps) => (ps.params?.validIids ?? []).includes(o.iid) ? [o.iid] : (ps.params?.validIids ?? []).slice(0, 1));
    return { orthGone: !s.players[1].bench.some((c) => c.iid === o.iid), p1Prizes: s.players[0].prizes.length, p2Prizes: s.players[1].prizes.length, phase: s.phase, winner: s.winner ?? null, isDraw: !!s.isDraw }; });
  // BURST：群起瞄準打倒戰鬥場沙鈴仙人掌（炸裂針 60 打昏肯泰羅）、雙方各剩 1 張、雙方都有備戰 ⇒ 雙方取完 ⇒ 平手（原本炸裂針寫終局後早退、P1 的獎賞被吃掉）
  T('BURST', () => heads(() => { const ta = inst(ID.tauros, { energyAttached: many(ID.W, 2), damage: Number(pool.get(ID.tauros).hp) - 60 });
    const c = inst(ID.cact, { damage: Number(pool.get(ID.cact).hp) - 50 });
    let s = act(mk({ a0: ta, b0: [inst(ID.filler)], a1: c, b1: [inst(ID.filler)], prizes0: many(ID.W, 1), prizes1: many(ID.W, 1) }), { type: 'ATTACK', attackIndex: atkIdx(ID.tauros, '群起瞄準'), actorIdx: 0 });
    s = drive(s, () => [c.iid]);
    return { phase: s.phase, isDraw: !!s.isDraw, pz: s.players[0].prizes.length + '/' + s.players[1].prizes.length }; }));
  T('SHAYMIN', () => { const sh = inst(ID.shaymin, { energyAttached: many(ID.G, 1) }); const o = orthB();
    let s = act(mk({ a0: sh, a1: inst(ID.landorus), b1: [o] }), { type: 'ATTACK', attackIndex: atkIdx(ID.shaymin, '精刺奇襲'), actorIdx: 0 });
    s = drive(s, () => [o.iid]);
    return { atkDmg: s.players[0].active?.damage, orthDmg: s.players[1].bench.find((c) => c.iid === o.iid)?.damage }; });
  T('TAUROS', () => heads(() => { const ta = inst(ID.tauros, { energyAttached: many(ID.W, 2) }); const o = orthB();
    let s = act(mk({ a0: ta, a1: o, b1: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: atkIdx(ID.tauros, '群起瞄準'), actorIdx: 0 });
    s = drive(s, () => [o.iid]);
    return { atkDmg: s.players[0].active?.damage, orthDmg: s.players[1].active?.damage }; }));
  T('LEGK', () => { const ld = inst(ID.landorus, { energyAttached: many(ID.F, 2), damage: Number(pool.get(ID.landorus).hp) - 30 });
    const ss = inst(ID.sandslash, { damage: Number(pool.get(ID.sandslash).hp) - 50 });
    const s = act(mk({ a0: ld, a1: ss, b1: [inst(ID.filler)], prizes0: many(ID.W, 1), prizes1: many(ID.W, 1) }), { type: 'ATTACK', attackIndex: atkIdx(ID.landorus, '巨岩墜落'), actorIdx: 0 });
    return { phase: s.phase, winner: s.winner ?? null, isDraw: !!s.isDraw, p2Prizes: s.players[1].prizes.length }; });
  T('P31', () => { const atk = inst(ID.filler); const d = inst(ID.landorus, { toolAttached: inst(ID.luck) });
    let s = M.dealAttackDamageToTarget(mk({ a0: atk, a1: d, b1: [inst(ID.filler)] }), 0, d.iid, 30, pool, { kind: 'attack-damage', label: 'T1' });
    const q = (s._pendingOnDamaged ?? []).length;
    s = M.dealAttackDamageToTarget(s, 0, d.iid, 200, pool, { kind: 'attack-effect', label: 'T2' });
    return { q, hand: s.players[1].hand.length, gone: s.players[1].active?.iid !== d.iid }; });
  // 中央路徑終局矩陣（審查 P1-1）：肯泰羅｜群起瞄準（1 正面 50）打倒戰鬥場穿山王，反擊針 30 同時打昏肯泰羅
  const cm = (b0n, b1n, p0, p1) => heads(() => {
    const ta = inst(ID.tauros, { energyAttached: many(ID.W, 2), damage: Number(pool.get(ID.tauros).hp) - 30 });
    const ss = inst(ID.sandslash, { damage: Number(pool.get(ID.sandslash).hp) - 50 });
    let s = act(mk({ a0: ta, b0: many(ID.filler, b0n), a1: ss, b1: many(ID.filler, b1n), prizes0: many(ID.W, p0), prizes1: many(ID.W, p1) }),
      { type: 'ATTACK', attackIndex: atkIdx(ID.tauros, '群起瞄準'), actorIdx: 0 });
    s = drive(s, () => [ss.iid]);
    return { phase: s.phase, winner: s.winner ?? null, isDraw: !!s.isDraw, pz: s.players[0].prizes.length + '/' + s.players[1].prizes.length,
      noMonLog: (s.log || []).some((l) => String(l.message).includes('P2 沒有可上場的寶可夢')) };
  });
  T('CM_11', () => cm(1, 1, 1, 1));
  T('CM_10', () => cm(1, 0, 1, 1));
  T('CM_10_61', () => cm(1, 0, 6, 1));
  T('CM_00', () => cm(0, 0, 1, 1));
  T('HOLDG2', () => { const pw = inst(ID.pawn, { energyAttached: [inst(ID.M)] });
    const tk = inst(ID.torkoal, { damage: Number(pool.get(ID.torkoal).hp) - 10, toolAttached: inst(ID.lux) });
    let s = act(mk({ a0: pw, b0: [inst(ID.filler)], a1: tk, prizes0: many(ID.W, 6), prizes1: many(ID.W, 1) }), { type: 'ATTACK', attackIndex: atkIdx(ID.pawn, '推倒'), actorIdx: 0 });
    s = drive(s, (ps) => (ps.params?.validIids ?? []).slice(0, 1));
    return { phase: s.phase, winner: s.winner ?? null, isDraw: !!s.isDraw, p1Prizes: s.players[0].prizes.length, p2Prizes: s.players[1].prizes.length }; });
  return out;
}

const judge = (r) => ({
  LUCARIO: !!r.LUCARIO && r.LUCARIO.orthDmg === 60 && r.LUCARIO.atkDmg === 40,
  LUC_KO: !!r.LUC_KO && r.LUC_KO.luGone && r.LUC_KO.p2Prizes === 5 && !r.LUC_KO.sys,
  LUC_KO2: !!r.LUC_KO2 && r.LUC_KO2.luGone && !r.LUC_KO2.sys,
  LUC_KO3: !!r.LUC_KO3 && r.LUC_KO3.orthGone && r.LUC_KO3.p1Prizes === 4 && r.LUC_KO3.p2Prizes === 0 && r.LUC_KO3.phase === 'game-over' && r.LUC_KO3.winner === 1 && !r.LUC_KO3.isDraw,
  BURST: !!r.BURST && r.BURST.phase === 'game-over' && r.BURST.isDraw && r.BURST.pz === '0/0',
  SHAYMIN: !!r.SHAYMIN && r.SHAYMIN.orthDmg === 60 && r.SHAYMIN.atkDmg === 40,
  TAUROS: !!r.TAUROS && r.TAUROS.orthDmg === 50 && r.TAUROS.atkDmg === 40,
  CM_11: !!r.CM_11 && r.CM_11.phase === 'game-over' && r.CM_11.isDraw && r.CM_11.pz === '0/0',
  CM_10: !!r.CM_10 && r.CM_10.phase === 'game-over' && r.CM_10.winner === 0 && !r.CM_10.isDraw && r.CM_10.pz === '0/0',
  CM_10_61: !!r.CM_10_61 && r.CM_10_61.phase === 'game-over' && r.CM_10_61.isDraw && r.CM_10_61.pz === '5/0' && r.CM_10_61.noMonLog === true,
  CM_00: !!r.CM_00 && r.CM_00.phase === 'game-over' && r.CM_00.isDraw && r.CM_00.pz === '0/0',
  LEGK: !!r.LEGK && r.LEGK.phase === 'game-over' && r.LEGK.winner === 1 && !r.LEGK.isDraw && r.LEGK.p2Prizes === 0,
  P31: !!r.P31 && r.P31.q === 1 && r.P31.gone && r.P31.hand === 2,
  HOLDG2: !!r.HOLDG2 && r.HOLDG2.phase === 'game-over' && r.HOLDG2.isDraw === true && r.HOLDG2.p1Prizes === 5 && r.HOLDG2.p2Prizes === 0,
});
const LABEL = {
  LUCARIO: '★★★ 波導彈打備戰拖拖蚓ex ⇒ 快掃拳返 +40（備戰狙擊走中央）',
  LUC_KO: '★★ 快掃拳返打昏路卡利歐 ⇒ 中央結算（不是系統擊倒檢查；審查 P3-2）',
  LUC_KO2: '★★ 一擊打倒備戰拖拖蚓ex 時快掃拳返打昏路卡利歐 ⇒ 中央結算（審查 P3-2）',
  LUC_KO3: '★★ 同上、路卡利歐無備戰、6/1 ⇒ 拖拖蚓ex 照常昏厥、P1 取 2 張、P2 勝（複審 P3-1）',
  BURST: '★★★ 炸裂針打昏攻擊方寫終局後，這一下的取獎照常 ⇒ 雙方取完 ⇒ 平手（審查 P1-1 第二段）',
  SHAYMIN: '★★★ 精刺奇襲打備戰拖拖蚓ex ⇒ +40（snipe-60-ex 走中央）',
  TAUROS: '★★★ 群起瞄準打戰鬥場拖拖蚓ex ⇒ +40（走中央）',
  LEGK: '★★★ 雙方同時取完、只有 P2 可放置 ⇒ P2 勝（中央 KO 無備戰也先取獎）',
  CM_11: '★★★ 中央路徑雙方同時昏厥、各剩 1 張、雙方都有備戰 ⇒ 平手',
  CM_10: '★★★ 同上但只有 P1 有備戰 ⇒ P1 勝',
  CM_10_61: '★★★ 同上、獎賞 6/1 ⇒ P2 取完但無可放置 ⇒ 平手（v6.420）、5/0',
  CM_00: '★★★ 雙方都沒有備戰、各剩 1 張 ⇒ 平手',
  P31: '★★ 延後的受傷紀錄在昏厥離場前先結算 ⇒ 幸運頭盔抽 2',
  HOLDG2: '★ 正對照：P1 有備戰、P2 無備戰、6/1 ⇒ 平手、5/0',
};
const NEW = ['LUCARIO', 'LUC_KO', 'LUC_KO2', 'LUC_KO3', 'BURST', 'SHAYMIN', 'TAUROS', 'LEGK', 'P31', 'CM_11', 'CM_10', 'CM_10_61', 'CM_00'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6535b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.534：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.534：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6535 H', '需要 v6.534 commit');

console.log(`\n=== v6.535 單一目標狙擊收斂／中央 KO 取獎／離場前結算：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
