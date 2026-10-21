#!/usr/bin/env node
/**
 * v6.544 守衛（小問題批次第 2、6 項：離開戰鬥場才消除的效果）：
 *   破空焰ex｜烈火爆進「離開戰鬥場前無法使用」⇒ 再下一個自己回合仍鎖（引擎＋UI）；換下再換回可用（L1518）。
 *   密勒頓｜防護代碼「離開戰鬥場則這個效果消除」⇒ 換下再換回效果不復活。
 * 【H】BASE（v6.543）：SKY_LATER、MIR_SWAP_BACK 紅；正對照綠。
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
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.543。
const BASE_SHA = 'd4e1bed4';
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
const ID = { filler: '19178', W: byName('基本【水】能量'), FIRE: byName('基本【火】能量'), L: byName('基本【雷】能量'), sw: byName('寶可夢交替'),
  sky: '16622', big: '14425', mir: '11224', boss: '19630', prime: '14142' };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6544-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, getAvailableAttacks } from '${p('src/lib/game/engine')}';\nexport { evaluateSelectionFilter, isKnownSelectionFilter } from '${p('src/lib/game/selection-filter')}';\nexport { RESOLVERS } from '${p('src/lib/game/effects/_shared')}';\nexport { getAIAction } from '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = (p0 = {}, p1 = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 20), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 20), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids, who) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: who ?? s.pendingSelection.actorIdx, senderIdx: who ?? s.pendingSelection.actorIdx ?? 0, pendingToken: s.pendingSelection.token });
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // ── 破空焰ex｜烈火爆進「這隻寶可夢離開戰鬥場前無法使用『烈火爆進』」
  const atkIdx = pool.get(ID.sky).attacks.findIndex((a) => a.name === '烈火爆進');
  const heal = (s) => { const pl = [...s.players]; pl[1] = { ...pl[1], active: { ...pl[1].active, damage: 0 } }; return { ...s, players: pl }; };
  const endBoth = (s) => heal(act(act(s, { type: 'END_TURN' }), { type: 'END_TURN' }));
  const can = (s) => { const before = s.players[1].active.damage; const nx = act(s, { type: 'ATTACK', attackIndex: atkIdx });
    return { engine: nx !== s && (nx.players[1].active?.damage ?? 0) > before, ui: M.getAvailableAttacks(s, pool).includes(atkIdx) }; };
  const skyStart = (extra = {}) => { let s = mk({ active: inst(ID.sky, { energyAttached: many(ID.FIRE, 3) }), ...extra }, { active: inst(ID.big) });
    return heal(act(s, { type: 'ATTACK', attackIndex: atkIdx })); };
  T('SKY_NEXT', () => can(endBoth(skyStart())));
  // 審查 P3-1：使用時的對戰紀錄寫「離開戰鬥場前」（不是「下回合」）
  T('SKY_LOG', () => { const s = skyStart(); const m = s.log.map((l) => l.message ?? ''); return { ok: m.some((x) => x.includes('離開戰鬥場前無法再使用「烈火爆進」')), old: m.some((x) => x.includes('下回合無法再使用「烈火爆進」')) }; });
  T('SKY_LATER', () => can(endBoth(endBoth(skyStart()))));
  T('SKY_SWAP_BACK', () => {   // L1518：寶可夢交替換下、撤退換回 ⇒ 可以用
    let t = endBoth(skyStart({ bench: [inst(ID.filler, { energyAttached: many(ID.FIRE, 2) })], hand: [inst(ID.sw)] }));
    t = act(t, { type: 'PLAY_TRAINER', iid: t.players[0].hand.find((c) => c.cardId === ID.sw).iid });
    if (t.pendingSelection) t = res(t, [t.players[0].bench[0].iid], 0);
    const back = t.players[0].bench.find((b) => b.cardId === ID.sky);
    t = act(t, { type: 'RETREAT', newActiveIid: back.iid });
    return { active: t.players[0].active?.cardId === ID.sky, ...can(t) };
  });
  // ── 密勒頓｜防護代碼「若這隻寶可夢離開戰鬥場，則這個效果消除」
  const mirRun = (swap) => {
    const mir = inst(ID.mir, { energyAttached: many(ID.L, 2) });
    let s = mk({ active: mir, bench: [inst(ID.filler)] }, { active: inst(ID.big, { energyAttached: many(ID.FIRE, 2) }), bench: [inst(ID.big, { energyAttached: many(ID.FIRE, 2) })], hand: [inst(ID.boss), inst(ID.prime)] });
    s = act(s, { type: 'ATTACK', attackIndex: 0 });
    s = act(s, { type: 'END_TURN' });
    const shield0 = s.players[0].futureShieldThisTurn === mir.iid;
    if (swap) {
      s = act(s, { type: 'PLAY_TRAINER', iid: s.players[1].hand.find((c) => c.cardId === ID.boss).iid });
      if (s.pendingSelection) s = res(s, [s.players[0].bench.find((b) => b.cardId === ID.filler).iid], 1);
      s = act(s, { type: 'PLAY_TRAINER', iid: s.players[1].hand.find((c) => c.cardId === ID.prime).iid });
      let g = 0; while (s.pendingSelection && g++ < 4) { const ps = s.pendingSelection; const cand = ps.sourcePlayerIdx === 0 ? s.players[0].bench.filter((b) => b.cardId === ID.mir) : s.players[1].bench; s = res(s, [cand[0].iid], ps.actorIdx); }
    }
    const back = s.players[0].active?.cardId === ID.mir;
    const before = s.players[0].active.damage;
    const s2 = act(s, { type: 'ATTACK', attackIndex: 0 });
    return { shield0, back, dmg: (s2.players[0].active?.damage ?? 9999) - before };
  };
  T('MIR_STAY', () => mirRun(false));
  T('MIR_SWAP_BACK', () => mirRun(true));
  return out;
}

const judge = (r) => ({
  SKY_NEXT: !!r.SKY_NEXT && r.SKY_NEXT.engine === false && r.SKY_NEXT.ui === false,
  SKY_LOG: !!r.SKY_LOG && r.SKY_LOG.ok && !r.SKY_LOG.old,
  SKY_LATER: !!r.SKY_LATER && r.SKY_LATER.engine === false && r.SKY_LATER.ui === false,
  SKY_SWAP_BACK: !!r.SKY_SWAP_BACK && r.SKY_SWAP_BACK.active && r.SKY_SWAP_BACK.engine === true && r.SKY_SWAP_BACK.ui === true,
  MIR_STAY: !!r.MIR_STAY && r.MIR_STAY.shield0 && r.MIR_STAY.dmg === 0,
  MIR_SWAP_BACK: !!r.MIR_SWAP_BACK && r.MIR_SWAP_BACK.shield0 && r.MIR_SWAP_BACK.back && r.MIR_SWAP_BACK.dmg > 0,
});
const LABEL = {
  SKY_NEXT: '★ 正對照：烈火爆進下個自己回合不能用（引擎＋UI）',
  SKY_LOG: '★★ 使用烈火爆進的紀錄寫「離開戰鬥場前無法再使用」（審查 P3-1）',
  SKY_LATER: '★★★ 烈火爆進再下一個自己回合仍在戰鬥場 ⇒ 仍不能用（卡面「離開戰鬥場前」；引擎＋UI 同一個述詞）',
  SKY_SWAP_BACK: '★ 正對照（PTCG_RULES L1518）：寶可夢交替換下、撤退換回 ⇒ 可以用',
  MIR_STAY: '★ 正對照：防護代碼的密勒頓留在戰鬥場 ⇒ 未來寶可夢不受 ex 招式傷害',
  MIR_SWAP_BACK: '★★★ 防護代碼的密勒頓被換下再換回 ⇒ 效果已消除、會受到傷害（卡面「離開戰鬥場則這個效果消除」）',
};
const NEW = ['SKY_LOG', 'SKY_LATER', 'MIR_SWAP_BACK'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6544b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src"], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.543：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.543：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6544 H', '需要 v6.543 commit');

console.log(`\n=== v6.544 離開戰鬥場消除的效果：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
