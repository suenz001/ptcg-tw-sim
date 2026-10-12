#!/usr/bin/env node
/**
 * v6.545 守衛（小問題批次第 1 項：零之大空洞的處理順序）：
 *   零之大空洞：雙方都要丟 ⇒ 持有人先丟（卡面）；超過上限時先丟備戰、再處理昏厥（L552／L1725／L1850 類推）。
 * 【H】BASE（v6.544）：NEW 紅、正對照綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.544。
const BASE_SHA = '393123ef';
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
const ST2 = [...pool.values()].find((c) => c.stage === 'Stage2' && HIJ(c) && c.supertype === 'Pokemon' && c.hp && !(c.abilities || []).length);
const ID = { filler: '19178', W: byName('基本【水】能量'), voidSt: '14844', grav: byName('引力山岳'), tera: '14805', cape: '17158',
  mega: byName('百萬噸吹風機'), psy: byName('基本【超】能量'), st2: ST2 && String(ST2.id) };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6545-'));
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
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // ── 零之大空洞：卡面「若雙方都要丟棄，則這張卡的持有人先丟棄」（P2 持有，P1 打引力山岳換掉）
  T('VOID_HOLDER_FIRST', () => {
    let s = mk({ hand: [inst(ID.grav)], active: inst(ID.tera), bench: many(ID.filler, 8) }, { active: inst(ID.tera), bench: many(ID.filler, 8) }, { activeStadium: inst(ID.voidSt), activeStadiumOwnerIdx: 1 });
    s = act(s, { type: 'PLAY_TRAINER', iid: s.players[0].hand[0].iid });
    const first = s.pendingSelection?.actorIdx ?? null;
    if (key(s) === 'enforce-bench-limit') s = res(s, s.players[first].bench.slice(0, 3).map((c) => c.iid), first);
    return { first, second: s.pendingSelection?.actorIdx ?? null, k: key(s) };
  });
  // 正對照：P1 自己持有 ⇒ P1 先丟（與舊近似值相同）
  T('VOID_HOLDER_SELF', () => {
    let s = mk({ hand: [inst(ID.grav)], active: inst(ID.tera), bench: many(ID.filler, 8) }, { active: inst(ID.tera), bench: many(ID.filler, 8) }, { activeStadium: inst(ID.voidSt), activeStadiumOwnerIdx: 0 });
    s = act(s, { type: 'PLAY_TRAINER', iid: s.players[0].hand[0].iid });
    return { first: s.pendingSelection?.actorIdx ?? null };
  });
  // 類推 L552／L1725／L1850：引力山岳換掉零之大空洞、同時讓 P2 備戰的 2 階 HP 歸 0 ⇒ 先丟備戰（可以丟那隻）、丟掉的不昏厥、不送獎賞
  T('VOID_DISCARD_BEFORE_KO', () => {
    const st2 = inst(ID.st2, { damage: ST2.hp - 20 });
    let s = mk({ hand: [inst(ID.grav)] }, { bench: [st2, inst(ID.tera), ...many(ID.filler, 6)] }, { activeStadium: inst(ID.voidSt), activeStadiumOwnerIdx: 1 });
    s = act(s, { type: 'PLAY_TRAINER', iid: s.players[0].hand[0].iid });
    const k1 = key(s), prizesBefore = s.players[0].prizes.length + (s.pendingPrizes?.[0] ?? 0) * 0;
    const pend = s.pendingPrizes ? s.pendingPrizes[0] : 0;
    if (k1 === 'enforce-bench-limit') s = res(s, [st2.iid, ...s.players[1].bench.filter((b) => b.iid !== st2.iid && b.cardId === ID.filler).slice(0, 2).map((c) => c.iid)], 1);
    return { k1, pendBefore: pend, prizes: s.players[0].prizes.length, pendAfter: s.pendingPrizes ? s.pendingPrizes[0] : 0, bench: s.players[1].bench.length, st2Gone: !s.players[1].bench.some((b) => b.iid === st2.iid) };
  });
  // 正對照：沒有超過上限 ⇒ 引力山岳讓 2 階歸 0 照常立刻昏厥（不延後）
  T('NO_VOID_KO_NOW', () => {
    const st2 = inst(ID.st2, { damage: ST2.hp - 20 });
    let s = mk({ hand: [inst(ID.grav)] }, { bench: [st2, ...many(ID.filler, 3)] });
    s = act(s, { type: 'PLAY_TRAINER', iid: s.players[0].hand[0].iid });
    return { st2Gone: !s.players[1].bench.some((b) => b.iid === st2.iid), pend: (s.pendingPrizes?.[0] ?? 0) + (6 - s.players[0].prizes.length) };
  });
  return out;
}

const judge = (r) => ({
  VOID_HOLDER_FIRST: !!r.VOID_HOLDER_FIRST && r.VOID_HOLDER_FIRST.first === 1 && r.VOID_HOLDER_FIRST.second === 0,
  VOID_HOLDER_SELF: !!r.VOID_HOLDER_SELF && r.VOID_HOLDER_SELF.first === 0,
  VOID_DISCARD_BEFORE_KO: !!r.VOID_DISCARD_BEFORE_KO && r.VOID_DISCARD_BEFORE_KO.k1 === 'enforce-bench-limit' && r.VOID_DISCARD_BEFORE_KO.st2Gone
    && r.VOID_DISCARD_BEFORE_KO.prizes === 6 && r.VOID_DISCARD_BEFORE_KO.pendAfter === 0 && r.VOID_DISCARD_BEFORE_KO.pendBefore === 0 && r.VOID_DISCARD_BEFORE_KO.bench === 5,
  NO_VOID_KO_NOW: !!r.NO_VOID_KO_NOW && r.NO_VOID_KO_NOW.st2Gone && r.NO_VOID_KO_NOW.pend > 0,
});
const LABEL = {
  VOID_HOLDER_FIRST: '★★★ 零之大空洞（P2 持有）被 P1 換掉、雙方都要丟 ⇒ 持有人 P2 先丟、P1 後丟（卡面）',
  VOID_HOLDER_SELF: '★ 正對照：P1 自己持有 ⇒ P1 先丟',
  VOID_DISCARD_BEFORE_KO: '★★★ 換掉零之大空洞同時讓備戰 2 階歸 0 ⇒ 先開丟備戰視窗；丟掉那隻 ⇒ 不昏厥、不送獎賞（L552／L1725／L1850 類推）',
  NO_VOID_KO_NOW: '★ 正對照：備戰沒有超過上限 ⇒ 照常立刻昏厥、送獎賞（不延後）',
};
const NEW = ['VOID_HOLDER_FIRST', 'VOID_DISCARD_BEFORE_KO'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6545b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.544：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.544：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6545 H', '需要 v6.544 commit');

console.log(`\n=== v6.545 零之大空洞的處理順序：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
