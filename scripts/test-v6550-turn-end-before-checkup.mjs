#!/usr/bin/env node
/**
 * v6.550 守衛（站長 2026-10-12 第 9 項「要改」；官方 PTCG_RULES L219：「『自己的回合結束』指的是寶可夢檢查前」）：
 *   「回合結束時」的效果（力之沙漏、強烈之吻、浸蝕污泥…）在寶可夢檢查**之前**處理；它們造成的昏厥先結算、補位，再做寶可夢檢查。
 * 【H】BASE（v6.549）：NEW 紅、正對照綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.549。
const BASE_SHA = '29a43c5f';
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
const ID = { filler: '19178', W: byName('基本【水】能量'), hourglass: byName('力之沙漏') };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6550-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const HP = Number(pool.get(ID.filler).hp);
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const mk = (p0 = {}, p1 = {}, top = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [], ...top,
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: s.pendingSelection.actorIdx, senderIdx: s.pendingSelection.actorIdx, pendingToken: s.pendingSelection.token });
  const msgs = (s) => s.log.map((l) => (typeof l === 'string' ? l : l.message ?? '')).join('\n');
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // 浸蝕污泥 × 中毒：先昏厥（獎賞給對手）、停下來補位，寶可夢檢查還沒做（沒有中毒 log）；補完才做檢查、換回合
  T('SLUDGE_BEFORE_CHECKUP', () => {
    const a = inst(ID.filler, { koAtMyNextEndOfTurn: true, status: 'poisoned' }); const b = inst(ID.filler);
    const o = inst(ID.filler, { status: 'poisoned' });   // 對手的戰鬥寶可夢也中毒 ⇒ 補位後的寶可夢檢查要照常扣它 10
    let s = act(mk({ active: a, bench: [b] }, { active: o }), { type: 'END_TURN' });
    const r = { stop: s.endTurnContinueAfterKO ?? null, poisonLogBefore: /中毒/.test(msgs(s)), pr1: s.players[1].prizes.length, turn0: s.activePlayerIndex };
    s = act(s, { type: 'SEND_NEW_ACTIVE', iid: b.iid, playerIndex: 0, actorIdx: 0 });
    return { ...r, after: s.activePlayerIndex, newActiveDmg: s.players[0].active?.damage ?? -1, oppDmg: s.players[1].active?.damage ?? -1 };
  });
  // 強烈之吻 × 中毒：牠在寶可夢檢查前就被丟棄（不是昏厥）⇒ 中毒不會把牠打倒、對手不拿獎賞
  T('KISS_BEFORE_POISON', () => {
    const a = inst(ID.filler, { damage: HP - 10, status: 'poisoned', strongKissDiscardPending: true }); const b = inst(ID.filler);
    let s = act(mk({ active: a, bench: [b] }), { type: 'END_TURN' });
    if (s.endTurnContinueAfterKO === 0) s = act(s, { type: 'SEND_NEW_ACTIVE', iid: b.iid, playerIndex: 0, actorIdx: 0 });
    return { pr1: s.players[1].prizes.length, inDiscard: s.players[0].discard.some((c) => c.iid === a.iid), turn: s.activePlayerIndex };
  });
  // 力之沙漏 × 中毒（剩 10 HP）：回合結束時先問力之沙漏（牠還在戰鬥場），解完重送 END_TURN 照常做寶可夢檢查（中毒打倒）
  const hourglass = () => {
    const a = inst(ID.filler, { damage: HP - 10, status: 'poisoned', toolAttached: inst(ID.hourglass) }); const b = inst(ID.filler);
    const s0 = act(mk({ active: a, bench: [b], discard: [inst(ID.W)] }, {}, { oppAttackKOdMeThisTurn: [0, 1] }), { type: 'END_TURN' });
    return { s0, a, b };
  };
  T('HOURGLASS_FIRST', () => { const { s0 } = hourglass(); return { key: s0.pendingSelection?.effectKey ?? null, poison: /中毒/.test(msgs(s0)) }; });
  T('CHECKUP_AFTER_HOURGLASS', () => {
    let { s0: s, a } = hourglass(); if (s.pendingSelection?.effectKey !== 'brailliant-attach') return { key: s.pendingSelection?.effectKey ?? null };
    s = res(s, s.players[0].discard.filter((c) => c.cardId === ID.W).map((c) => c.iid));
    s = act(s, { type: 'END_TURN' });
    return { aGone: s.players[0].active?.iid !== a.iid, pr1: s.players[1].prizes.length, stop: s.endTurnContinueAfterKO ?? null,
      snap: JSON.stringify(s.oppAttackKOdMeInLastOppTurn ?? null) };
  });
  // 納莉 × 力之沙漏（選先納莉）⇒ 解完重送 END_TURN，寶可夢檢查照常（中毒打倒）
  T('NANU_HOURGLASS_CHECKUP', () => {
    const a = inst(ID.filler, { damage: HP - 10, status: 'poisoned', toolAttached: inst(ID.hourglass) }); const b = inst(ID.filler);
    let s = act(mk({ active: a, bench: [b], hand: many(ID.W, 5), nanuDiscardAtTurnEnd: true }), { type: 'END_TURN' });
    const k0 = s.pendingSelection?.effectKey ?? null; if (k0 !== 'nanu-hourglass-order') return { k0 };
    s = res(s, ['nanu-first']);
    if (s.pendingSelection?.effectKey === 'brailliant-attach') s = res(s, s.pendingSelection.params?.validIids?.slice(0, 1) ?? s.players[0].discard.filter((c) => c.cardId === ID.W).slice(0, 1).map((c) => c.iid));
    s = act(s, { type: 'END_TURN' });
    return { k0, aGone: s.players[0].active?.iid !== a.iid, pr1: s.players[1].prizes.length };
  });
  // 回合結束時效果打倒備戰、對手的獎賞正面朝上（取獎視窗）⇒ 解完重送 END_TURN 時「回合結束時」效果不重跑（力之沙漏不會因為棄牌區多了能量而再問）
  T('NO_REASK_AFTER_PRIZE', () => {
    const a = inst(ID.filler, { toolAttached: inst(ID.hourglass) }); const b = inst(ID.filler, { koAtMyNextEndOfTurn: true, energyAttached: many(ID.W, 1) });
    const p1pr = many(ID.W, 6).map((c, i) => (i === 0 ? { ...c, faceUp: true } : c));
    let s = act(mk({ active: a, bench: [b, inst(ID.filler)] }, { prizes: p1pr }), { type: 'END_TURN' });
    const k0 = s.pendingSelection?.effectKey ?? null; if (k0 !== 'take-prize-choose') return { k0 };
    s = res(s, [s.pendingSelection.params.options[0].id]);
    s = act(s, { type: 'END_TURN' });
    return { k0, k1: s.pendingSelection?.effectKey ?? null, turn: s.activePlayerIndex, pr1: s.players[1].prizes.length };
  });
  // 審查 P3-1：我方回合結束時被浸蝕污泥打倒 ⇒ 算在我方自己的回合（L219），不是「上個對手的回合」
  //   ⇒ 對手回合結束後，我方讀到的「上個對手的回合自己的寶可夢昏厥」計數全為 0
  T('KO_COUNTS_IN_OWN_TURN', () => {
    const a = inst(ID.filler, { koAtMyNextEndOfTurn: true }); const b = inst(ID.filler);
    let s = act(mk({ active: a, bench: [b] }), { type: 'END_TURN' });
    if (s.endTurnContinueAfterKO === 0) s = act(s, { type: 'SEND_NEW_ACTIVE', iid: b.iid, playerIndex: 0, actorIdx: 0 });
    if (s.activePlayerIndex !== 1) return { turn: s.activePlayerIndex };
    s = act({ ...s, turnPhase: 'main' }, { type: 'END_TURN' });
    const keys = Object.keys(s).filter((k) => /InLastOppTurn$/.test(k) && Array.isArray(s[k]));
    return { turn: s.activePlayerIndex, keys: keys.length, mine: keys.map((k) => s[k][0]).reduce((x, y) => x + (y || 0), 0) };
  });
  // 正對照：只有中毒 ⇒ 照常扣 10、換回合
  T('POISON_ONLY', () => { const s = act(mk({ active: inst(ID.filler, { status: 'poisoned' }) }), { type: 'END_TURN' });
    return { dmg: s.players[0].active?.damage ?? -1, turn: s.activePlayerIndex }; });
  return out;
}

const judge = (r) => ({
  SLUDGE_BEFORE_CHECKUP: !!r.SLUDGE_BEFORE_CHECKUP && r.SLUDGE_BEFORE_CHECKUP.stop === 0 && r.SLUDGE_BEFORE_CHECKUP.poisonLogBefore === false
    && r.SLUDGE_BEFORE_CHECKUP.pr1 === 5 && r.SLUDGE_BEFORE_CHECKUP.after === 1 && r.SLUDGE_BEFORE_CHECKUP.newActiveDmg === 0 && r.SLUDGE_BEFORE_CHECKUP.oppDmg === 10,
  KISS_BEFORE_POISON: !!r.KISS_BEFORE_POISON && r.KISS_BEFORE_POISON.pr1 === 6 && r.KISS_BEFORE_POISON.inDiscard === true && r.KISS_BEFORE_POISON.turn === 1,
  HOURGLASS_FIRST: !!r.HOURGLASS_FIRST && r.HOURGLASS_FIRST.key === 'brailliant-attach' && r.HOURGLASS_FIRST.poison === false,
  CHECKUP_AFTER_HOURGLASS: !!r.CHECKUP_AFTER_HOURGLASS && r.CHECKUP_AFTER_HOURGLASS.aGone === true && r.CHECKUP_AFTER_HOURGLASS.pr1 === 5
    && r.CHECKUP_AFTER_HOURGLASS.stop === 0 && r.CHECKUP_AFTER_HOURGLASS.snap === '[0,1]',
  NANU_HOURGLASS_CHECKUP: !!r.NANU_HOURGLASS_CHECKUP && r.NANU_HOURGLASS_CHECKUP.k0 === 'nanu-hourglass-order' && r.NANU_HOURGLASS_CHECKUP.aGone === true && r.NANU_HOURGLASS_CHECKUP.pr1 === 5,
  NO_REASK_AFTER_PRIZE: !!r.NO_REASK_AFTER_PRIZE && r.NO_REASK_AFTER_PRIZE.k0 === 'take-prize-choose' && r.NO_REASK_AFTER_PRIZE.k1 === null
    && r.NO_REASK_AFTER_PRIZE.turn === 1 && r.NO_REASK_AFTER_PRIZE.pr1 === 5,
  KO_COUNTS_IN_OWN_TURN: !!r.KO_COUNTS_IN_OWN_TURN && r.KO_COUNTS_IN_OWN_TURN.turn === 0 && r.KO_COUNTS_IN_OWN_TURN.keys >= 5 && r.KO_COUNTS_IN_OWN_TURN.mine === 0,
  POISON_ONLY: !!r.POISON_ONLY && r.POISON_ONLY.dmg === 10 && r.POISON_ONLY.turn === 1,
});
const LABEL = {
  SLUDGE_BEFORE_CHECKUP: '★★★ 浸蝕污泥在寶可夢檢查前昏厥 ⇒ 先補位（檢查還沒做），補完照常檢查（對手中毒扣 10）、換回合',
  KISS_BEFORE_POISON: '★★★ 強烈之吻在寶可夢檢查前丟棄 ⇒ 中毒來不及打倒牠、對手不拿獎賞',
  HOURGLASS_FIRST: '★★★ 力之沙漏在寶可夢檢查前詢問（中毒剩 10 HP 的戰鬥寶可夢還在）',
  CHECKUP_AFTER_HOURGLASS: '★★★ 力之沙漏解完重送 END_TURN ⇒ 寶可夢檢查照常（中毒打倒、停下補位），回合快照不重跑',
  NANU_HOURGLASS_CHECKUP: '★★★ 納莉 × 力之沙漏的順序視窗解完重送 END_TURN ⇒ 寶可夢檢查照常（中毒打倒）',
  NO_REASK_AFTER_PRIZE: '★★★ 回合結束時效果打倒備戰＋正面朝上獎賞 ⇒ 取完重送 END_TURN 不重跑回合結束時效果、照常換回合',
  KO_COUNTS_IN_OWN_TURN: '★★★ 回合結束時被打倒算在自己的回合 ⇒ 下個自己的回合讀到的「上個對手的回合」昏厥計數為 0（審查 P3-1）',
  POISON_ONLY: '★ 正對照：只有中毒 ⇒ 照常扣 10、換回合',
};
const NEW = ['SLUDGE_BEFORE_CHECKUP', 'KISS_BEFORE_POISON', 'HOURGLASS_FIRST', 'CHECKUP_AFTER_HOURGLASS', 'NANU_HOURGLASS_CHECKUP', 'NO_REASK_AFTER_PRIZE', 'KO_COUNTS_IN_OWN_TURN'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6550b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src scripts static/cards | tar -x -C "${tmp}" && ln -s "${join(ROOT, 'node_modules')}" "${tmp}/node_modules"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.549：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.549：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6550 H', '需要 v6.549 commit');

console.log(`\n=== v6.550 回合結束時的效果在寶可夢檢查之前：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
