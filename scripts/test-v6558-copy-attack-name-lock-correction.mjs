#!/usr/bin/env node
/**
 * v6.558 守衛（站長 2026-10-13 09:17 更正 v6.553 的裁定，逐字節錄）：
 *   「只有 30週年的夢幻ex特性"記憶螺旋"和這個情況 如果是30周年夢幻ex用特性指定超級勇氣，這樣這回合收到用的招式就叫"超級勇氣" 因此下回合不能使用
 *    但如果是 揮指等借招，因為皮可西是使用招式揮指 … 但下回合，還是能使用揮指，借用 超級勇氣(因為皮可西是使用招式揮指，不是使用超級勇氣)」
 *
 *   A：借招（揮指／欺詐）——借用方身上有「無法使用『X』」的鎖，照樣可以借 X（候選有 X、完整流程真的打出 X 的傷害、對戰紀錄不再說不能借）。
 *   B：夢幻ex｜記憶螺旋——直接使出 X ⇒ 被鎖時不能用（可用招式清單沒有 X、硬送 ATTACK 也不出傷害）；沒鎖時可以（正對照）。
 *   C：夢幻ex 用記憶螺旋使出備戰皮可西的「揮指」借 X ⇒ 使出的是揮指 ⇒ 照樣可以借。
 * 【H】BASE（v6.557，仍有 v6.553 的借用方名稱鎖）：A、C 紅；B 正對照綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.557。
const BASE_SHA = '131fd570';
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
const ID = {
  filler: '19178', W: byName('基本【水】能量'), F: byName('基本【鬥】能量'), P: byName('基本【超】能量'),
  clefable: withAttack('皮可西', '揮指'), lucario: withAttack('超級路卡利歐ex', '超級勇氣'), mew: withAbility('夢幻ex', '記憶螺旋'),
  zoroark: '13416', ursa: '10299',
};
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(String(v))).map(([k]) => k);
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6558-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, getAvailableAttacks, getEffectiveAttacks } from '${p('src/lib/game/engine')}';\n`
    + `export { copyAttackCandidates, copyAttackCooldownNote } from '${p('src/lib/game/copy-attack')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const board = (myActive, oppActive, myBench = [inst(ID.filler)]) => {
    const s0 = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s0.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: myBench, active: myActive },
        { ...s0.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: oppActive },
      ] };
  };
  const logOf = (s) => (s.log || []).map((l) => (typeof l === 'string' ? l : l.message ?? '')).join('\n');
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  const lockVariants = { thisTurn: { blockedAttackNamesThisTurn: ['超級勇氣'] }, untilExit: { blockedAttackNamesUntilExit: ['超級勇氣'] } };

  // A1：皮可西身上有「無法使用超級勇氣」⇒ 揮指的候選仍有超級勇氣，對戰紀錄的說明不提「不能借用同名招式」
  for (const [vk, lock] of Object.entries(lockVariants)) {
    T('A1_' + vk, () => {
      const c = inst(ID.clefable, { energyAttached: many(ID.W, 2), ...lock }); const l = inst(ID.lucario);
      const st = board(c, l);
      const eff = M.getEffectiveAttacks(st, c, pool).map((e) => e.atk.name);
      const avail = M.getAvailableAttacks(st, pool).map((i) => eff[i]);
      return { names: M.copyAttackCandidates('皮可西|揮指', st, 0, pool).map((x) => x.attackName), note: M.copyAttackCooldownNote('皮可西|揮指', st, 0, pool), avail };
    });
  }
  // A2：完整流程——被鎖的皮可西用揮指借超級勇氣 ⇒ 真的造成傷害（對手不再是 0 傷害）
  T('A2', () => {
    const c = inst(ID.clefable, { energyAttached: many(ID.W, 2), blockedAttackNamesThisTurn: ['超級勇氣'] }); const l = inst(ID.lucario);
    const st = board(c, l);
    const a = M.applyAction(st, { type: 'ATTACK', attackIndex: 0, copyAttackChoice: { pokeIid: l.iid, attackIndex: 1 } }, pool);
    const opp = a.players[1].active;
    const ko = !opp || opp.iid !== l.iid;
    return { oppDmg: ko ? 'KO' : opp.damage, log: /超級勇氣/.test(logOf(a)) };
  });
  // A3：索羅亞克｜欺詐（另一張借招）——借用方被鎖「血月」照樣可借（v6.553 原本擋掉的情境）
  T('A3', () => {
    const z = inst(ID.zoroark, { energyAttached: many(ID.W, 3), blockedAttackNamesThisTurn: ['血月'] }); const u = inst(ID.ursa);
    const st = board(z, u);
    return { names: M.copyAttackCandidates('索羅亞克|欺詐', st, 0, pool).map((x) => x.attackName) };
  });

  // A4：兩回合完整流程（審查 P2，站長原話核心「下回合還是能使用揮指，借用超級勇氣」）
  //   第 1 回合揮指借超級勇氣 ⇒ 鎖推到皮可西（不是被借的路卡利歐）；END_TURN 兩次後可用清單仍有揮指，再借一次照樣打出。
  T('A4', () => {
    const lucNoWeak = new Map(pool); { const c = pool.get(ID.lucario); lucNoWeak.set(ID.lucario, { ...c, weakness: undefined, weaknesses: undefined }); }   // 避免 270×2 一擊 KO 打斷兩回合
    const c = inst(ID.clefable, { energyAttached: [inst(ID.P), ...many(ID.W, 2)] }); const l = inst(ID.lucario);
    let s = board(c, l);
    s = M.applyAction(s, { type: 'ATTACK', attackIndex: 0, copyAttackChoice: { pokeIid: l.iid, attackIndex: 1 } }, lucNoWeak);
    const t1 = { oppDmg: s.players[1].active?.damage, clefNext: s.players[0].active?.blockedAttackNamesNextTurn ?? [], lucNext: s.players[1].active?.blockedAttackNamesNextTurn ?? [] };
    s = M.applyAction(s, { type: 'END_TURN' }, lucNoWeak);
    s = M.applyAction(s, { type: 'END_TURN' }, lucNoWeak);
    const back = s.activePlayerIndex === 0;
    s = { ...s, turnPhase: 'main', players: s.players.map((pl, i) => (i === 1 ? { ...pl, active: { ...pl.active, damage: 0 } } : pl)) };
    const eff = M.getEffectiveAttacks(s, s.players[0].active, lucNoWeak).map((e) => e.atk.name);
    const avail = M.getAvailableAttacks(s, lucNoWeak).map((i) => eff[i]);
    const t3lock = s.players[0].active?.blockedAttackNamesThisTurn ?? [];
    const cands = M.copyAttackCandidates('皮可西|揮指', s, 0, lucNoWeak).map((x) => x.attackName);
    const s2 = M.applyAction(s, { type: 'ATTACK', attackIndex: eff.indexOf('揮指'), copyAttackChoice: { pokeIid: s.players[1].active.iid, attackIndex: 1 } }, lucNoWeak);
    return { t1, back, t3lock, avail, cands, t3Dmg: s2.players[1].active?.damage };
  });

  // B：夢幻ex｜記憶螺旋直接使出超級勇氣（備戰有超級路卡利歐ex）
  const mewBoard = (lock) => {
    const m = inst(ID.mew, { energyAttached: many(ID.F, 2), ...lock }); const bl = inst(ID.lucario); const opp = inst(ID.filler);
    const st = board(m, opp, [bl]);
    const eff = M.getEffectiveAttacks(st, m, pool).map((e) => e.atk.name);
    const idx = eff.indexOf('超級勇氣');
    return { st, idx, eff, opp };
  };
  for (const [vk, lock] of Object.entries(lockVariants)) {
    T('B1_' + vk, () => {
      const { st, idx, eff, opp } = mewBoard(lock);
      const avail = M.getAvailableAttacks(st, pool);
      const a = idx >= 0 ? M.applyAction(st, { type: 'ATTACK', attackIndex: idx }, pool) : st;
      const o = a.players[1].active;
      return { idx, eff, availHas: avail.includes(idx), oppDmg: o && o.iid === opp.iid ? o.damage : 'KO' };
    });
  }
  T('B0', () => {   // 正對照：沒有鎖 ⇒ 記憶螺旋可以使出超級勇氣
    const { st, idx, opp } = mewBoard({});
    const avail = M.getAvailableAttacks(st, pool);
    const a = M.applyAction(st, { type: 'ATTACK', attackIndex: idx }, pool);
    const o = a.players[1].active;
    return { idx, availHas: avail.includes(idx), oppDmg: o && o.iid === opp.iid ? o.damage : 'KO' };
  });

  // C：夢幻ex（被鎖超級勇氣）用記憶螺旋使出備戰皮可西的「揮指」⇒ 揮指照樣可以借超級勇氣
  T('C1', () => {
    const m = inst(ID.mew, { energyAttached: many(ID.W, 2), blockedAttackNamesThisTurn: ['超級勇氣'] });
    const st = board(m, inst(ID.lucario), [inst(ID.clefable)]);
    const eff = M.getEffectiveAttacks(st, m, pool).map((e) => e.atk.name);
    const avail = M.getAvailableAttacks(st, pool).map((i) => eff[i]);
    const opp = st.players[1].active;
    const a = M.applyAction(st, { type: 'ATTACK', attackIndex: eff.indexOf('揮指'), copyAttackChoice: { pokeIid: opp.iid, attackIndex: 1 } }, pool);
    const o = a.players[1].active;
    return { hasWave: eff.includes('揮指'), availWave: avail.includes('揮指'), names: M.copyAttackCandidates('皮可西|揮指', st, 0, pool).map((x) => x.attackName),
      oppDmg: o && o.iid === opp.iid ? o.damage : 'KO' };
  });
  return out;
}

const judge = (r) => ({
  A1_thisTurn: !!r.A1_thisTurn?.names && r.A1_thisTurn.names.includes('超級勇氣') && !/不能借用同名招式/.test(r.A1_thisTurn.note) && r.A1_thisTurn.avail.includes('揮指'),
  A1_untilExit: !!r.A1_untilExit?.names && r.A1_untilExit.names.includes('超級勇氣') && !/不能借用同名招式/.test(r.A1_untilExit.note) && r.A1_untilExit.avail.includes('揮指'),
  A4: !!r.A4?.t1 && r.A4.t1.oppDmg >= 270 && r.A4.t1.clefNext.includes('超級勇氣') && !r.A4.t1.lucNext.includes('超級勇氣') && r.A4.back
    && r.A4.t3lock.includes('超級勇氣') && r.A4.avail.includes('揮指') && r.A4.cands.includes('超級勇氣') && r.A4.t3Dmg >= 270,
  A2: !!r.A2 && (r.A2.oppDmg === 'KO' || r.A2.oppDmg >= 270) && r.A2.log === true,
  A3: !!r.A3?.names && r.A3.names.includes('血月'),
  B1_thisTurn: !!r.B1_thisTurn && r.B1_thisTurn.idx >= 0 && r.B1_thisTurn.availHas === false && r.B1_thisTurn.oppDmg === 0,
  B1_untilExit: !!r.B1_untilExit && r.B1_untilExit.idx >= 0 && r.B1_untilExit.availHas === false && r.B1_untilExit.oppDmg === 0,
  B0: !!r.B0 && r.B0.idx >= 0 && r.B0.availHas === true && (r.B0.oppDmg === 'KO' || r.B0.oppDmg >= 270),
  C1: !!r.C1 && r.C1.hasWave === true && r.C1.availWave === true && r.C1.names?.includes('超級勇氣') && (r.C1.oppDmg === 'KO' || r.C1.oppDmg >= 270),
});
const LABEL = {
  A1_thisTurn: '★★★ 皮可西身上有「無法使用超級勇氣」（下個自己回合）⇒ 揮指仍在可用清單、照樣可以借超級勇氣、對戰紀錄不說不能借',
  A1_untilExit: '★★★ 「離開戰鬥場前」型的名稱鎖同樣不擋借招',
  A2: '★★★ 完整流程：被鎖的皮可西用揮指借超級勇氣 ⇒ 真的造成 270（以上）傷害',
  A4: '★★★ 兩回合完整流程：揮指借超級勇氣 ⇒ 鎖在皮可西身上（不在路卡利歐）；下回合可用清單仍有揮指、再借一次照樣 270',
  A3: '★★ 索羅亞克｜欺詐：借用方被鎖「血月」照樣可借（v6.553 擋掉的情境恢復）',
  B1_thisTurn: '★★★ 正對照：夢幻ex｜記憶螺旋直接使出超級勇氣，被鎖時不能用（清單沒有、硬送也不出傷害）',
  B1_untilExit: '★★ 正對照：記憶螺旋 ×「離開戰鬥場前」鎖同樣不能用',
  B0: '★ 正對照：記憶螺旋沒有鎖時可以使出超級勇氣',
  C1: '★★ 夢幻ex 被鎖超級勇氣，用記憶螺旋使出揮指 ⇒ 揮指在可用清單、完整流程借超級勇氣打出 270（使出的是揮指）',
};
const NEW = ['A1_thisTurn', 'A1_untilExit', 'A2', 'A3', 'A4', 'C1'];
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6558b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src static/cards | tar -x -C "${tmp}" && ln -s "${join(ROOT, 'node_modules')}" "${tmp}/node_modules"`]);
    const B = scenarios(await load(tmp)), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.557：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.557：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6558 H', '需要 v6.557 commit');

console.log(`\n=== v6.558 借招不受借用方名稱鎖影響（記憶螺旋除外）：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
