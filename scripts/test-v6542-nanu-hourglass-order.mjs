#!/usr/bin/env node
/**
 * v6.542 守衛（站長 2026-10-12 第 6 項「依官方 QA」＋PTCG_RULES L2013：納莉 × 力之沙漏 由力之沙漏的持有人選執行順序）：
 *   ASK／NANU_FIRST／HOUR_FIRST 結果不同（手牌有基本能量）⇒ 回合結束開 modal-choice，兩種順序各自正確結算、回合正常結束
 *   NO_BASIC_IN_HAND／NO_NANU 正對照：兩種順序選項相同或沒有納莉 ⇒ 照舊先力之沙漏
 * 【H】BASE（v6.541）：ASK、NANU_FIRST、HOUR_FIRST 紅；正對照兩版綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.541。
const BASE_SHA = '0677386e';
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
const ID = { filler: '19178', W: byName('基本【水】能量'), F: byName('基本【火】能量'), hour: '17154', trainer: byName('寶可夢交替') };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6542-'));
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
  const mk = ({ hand0, discard0 = [], nanu = true, poison = false }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    const a0 = inst(ID.filler, { toolAttached: inst(ID.hour), ...(poison ? { status: 'poisoned' } : {}) });
    return { st: { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: hand0, deck: many(ID.W, 10), discard: discard0, prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: a0, ...(nanu ? { nanuDiscardAtTurnEnd: true } : {}) },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler) },
      ] }, a0 };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: 0, senderIdx: 0, pendingToken: s.pendingSelection.token });
  const key = (s) => s.pendingSelection?.effectKey ?? null;
  const finish = (s) => { let g = 0; while (s.activePlayerIndex === 0 && s.phase === 'playing' && g++ < 6) {
      if (s.pendingSelection) { const ps = s.pendingSelection; s = res(s, ps.effectKey === 'brailliant-attach' ? (s.players[0].discard.filter((c) => pool.get(c.cardId)?.subtype === 'Basic' && pool.get(c.cardId)?.supertype === 'Energy').slice(0, 1).map((c) => c.iid)) : []); }
      else s = act(s, { type: 'END_TURN' }); } return s; };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // 納莉這回合會丟牌（手牌 5 張含 2 張基本能量），棄牌區沒有基本能量
  const hand5 = () => [inst(ID.F), inst(ID.F), inst(ID.trainer), inst(ID.trainer), inst(ID.trainer)];
  T('ASK', () => { const { st } = mk({ hand0: hand5() }); const s = act(st, { type: 'END_TURN' });
    return { key: key(s), opts: (s.pendingSelection?.params?.options ?? []).map((o) => o.id), ai: s.pendingSelection ? M.getAIAction(s, pool, 0)?.selectedIids?.[0] ?? null : null }; });
  T('NANU_FIRST', () => { const { st, a0 } = mk({ hand0: hand5(), poison: true }); let s = act(st, { type: 'END_TURN' });
    if (key(s) !== 'nanu-hourglass-order') return { key: key(s) };
    s = res(s, ['nanu-first']); const k2 = key(s); s = finish(s);
    return { k2, energy: (s.players[0].active?.energyAttached ?? []).length, hand: s.players[0].hand.length, ap: s.activePlayerIndex, nanuLeft: !!s.players[0].nanuDiscardAtTurnEnd, dmg: s.players[0].active?.damage ?? -1 }; });
  T('HOUR_FIRST', () => { const { st } = mk({ hand0: hand5() }); let s = act(st, { type: 'END_TURN' });
    if (key(s) !== 'nanu-hourglass-order') return { key: key(s) };
    s = res(s, ['hourglass-first']); const k2 = key(s); s = finish(s);
    return { k2, energy: (s.players[0].active?.energyAttached ?? []).length, hand: s.players[0].hand.length, discardE: s.players[0].discard.filter((c) => c.cardId === ID.F).length, ap: s.activePlayerIndex }; });
  // 正對照：手牌沒有基本能量 ⇒ 兩種順序選項相同 ⇒ 不問、照舊先開力之沙漏
  T('NO_BASIC_IN_HAND', () => { const { st } = mk({ hand0: many(ID.trainer, 5), discard0: [inst(ID.W)] }); const s = act(st, { type: 'END_TURN' }); return { key: key(s) }; });
  // 正對照：沒有納莉 ⇒ 照舊
  T('NO_NANU', () => { const { st } = mk({ hand0: hand5(), discard0: [inst(ID.W)], nanu: false }); const s = act(st, { type: 'END_TURN' }); return { key: key(s) }; });
  return out;
}

const judge = (r) => ({
  ASK: !!r.ASK && r.ASK.key === 'nanu-hourglass-order' && JSON.stringify(r.ASK.opts) === '["nanu-first","hourglass-first"]' && r.ASK.ai === 'nanu-first',
  NANU_FIRST: !!r.NANU_FIRST && r.NANU_FIRST.k2 === 'brailliant-attach' && r.NANU_FIRST.energy === 1 && r.NANU_FIRST.hand === 0 && r.NANU_FIRST.ap === 1 && !r.NANU_FIRST.nanuLeft && r.NANU_FIRST.dmg === 10,
  HOUR_FIRST: !!r.HOUR_FIRST && r.HOUR_FIRST.k2 === null && r.HOUR_FIRST.energy === 0 && r.HOUR_FIRST.hand === 0 && r.HOUR_FIRST.discardE === 2 && r.HOUR_FIRST.ap === 1,
  NO_BASIC_IN_HAND: !!r.NO_BASIC_IN_HAND && r.NO_BASIC_IN_HAND.key === 'brailliant-attach',
  NO_NANU: !!r.NO_NANU && r.NO_NANU.key === 'brailliant-attach',
});
const LABEL = {
  ASK: '★★★ 納莉這回合會丟牌、手牌有基本能量、附力之沙漏 ⇒ 回合結束時由持有人選順序（L2013）；AI 選先納莉',
  NANU_FIRST: '★★★ 先納莉 ⇒ 手牌丟光、力之沙漏從棄牌區附上剛丟的能量、回合正常結束（不重複丟牌；中毒只結算一次 = 暫停 END_TURN 必帶 endTurnSkipCheckup）',
  HOUR_FIRST: '★★ 先力之沙漏 ⇒ 棄牌區沒有基本能量可附、之後納莉照常丟牌、回合結束',
  NO_BASIC_IN_HAND: '★ 正對照：手牌沒有基本能量 ⇒ 不問、照舊先力之沙漏',
  NO_NANU: '★ 正對照：沒有納莉 ⇒ 照舊',
};
const NEW = ['ASK', 'NANU_FIRST', 'HOUR_FIRST'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6542b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.541：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.541：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6542 H', '需要 v6.541 commit');

console.log(`\n=== v6.542 納莉 × 力之沙漏 的處理順序：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
