#!/usr/bin/env node
/**
 * v6.548 守衛（站長 2026-10-12 第 7 項「應該可以選順序」）：急進開關／希嘉娜的信賴換下有「回到備戰區時」特性的寶可夢 ⇒
 *   兩種順序結果不同時（返回重載＋手牌有基本【水】能量）由持有人選擇；結果相同（全能變身、手牌沒水能量）不問。
 * 【H】BASE（v6.547）：NEW 紅、正對照綠。
 */
import { extractBaseArchive, linkBaseModules } from './lib/base-archive.mjs';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.547。
const BASE_SHA = '87b6c996';
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
const ID = { filler: '19178', W: byName('基本【水】能量'), F: byName('基本【火】能量'), reload: '14040', hug: '10449', hugEx: '10450', cart: '11275', sig: '19619' };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6548-'));
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
  const mk = (p0 = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: [inst(ID.hugEx), ...many(ID.F, 20)], discard: [], prizes: many(ID.F, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p0 },
        { ...s.players[1], hand: [], deck: many(ID.F, 20), discard: [], prizes: many(ID.F, 6), bench: [inst(ID.filler)], active: inst(ID.filler) },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: 0, senderIdx: 0, pendingToken: s.pendingSelection.token });
  const key = (s) => s.pendingSelection?.effectKey ?? null;
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // 換下 holderCid（身上 e0 張水能量），手牌 wHand 張基本水能量；回傳打出訓練家、選完換入那一隻之後的盤面
  const start = (trainer, holderCid, e0, wHand) => {
    const h = inst(holderCid, { energyAttached: many(ID.W, e0) }); const b = inst(ID.filler); const t = inst(trainer);
    let s = act(mk({ active: h, bench: [b], hand: [t, ...many(ID.W, wHand)] }), { type: 'PLAY_TRAINER', iid: t.iid, actorIdx: 0 });
    s = res(s, [b.iid]);
    return { s, h, b };
  };
  const onActive = (s) => s.players[0].active?.energyAttached.length ?? -1;
  // ── 急進開關 × 返回重載
  T('RUSH_ASK', () => { const { s } = start(ID.cart, ID.reload, 1, 2); return { key: key(s), opts: (s.pendingSelection?.params?.options ?? []).map((o) => o.id) }; });
  T('RUSH_ABILITY_FIRST', () => {
    let { s } = start(ID.cart, ID.reload, 1, 2); if (key(s) !== 'rush-switch-order') return { key: key(s) };
    s = res(s, ['ability-first']); const k1 = key(s);
    if (k1 === 'clamperl-bombard-attach') s = res(s, s.pendingSelection.params.validIids.slice(0, 2));
    const k2 = key(s), max = s.pendingSelection?.maxCount;
    if (k2 === 'rush-switch-energy-transfer') { const from = s.players[0].bench.find((c) => c.iid === s.pendingSelection.params.targetIid); s = res(s, from.energyAttached.map((e) => e.iid)); }
    return { k1, k2, max, active: onActive(s), hand: s.players[0].hand.length, after: key(s) };
  });
  T('RUSH_TRAINER_FIRST', () => {
    let { s } = start(ID.cart, ID.reload, 1, 2); if (key(s) !== 'rush-switch-order') return { key: key(s) };
    s = res(s, ['trainer-first']); const k1 = key(s), max = s.pendingSelection?.maxCount;
    if (k1 === 'rush-switch-energy-transfer') { const from = s.players[0].bench.find((c) => c.iid === s.pendingSelection.params.targetIid); s = res(s, from.energyAttached.map((e) => e.iid)); }
    return { k1, max, active: onActive(s), after: key(s) };
  });
  T('RUSH_ABILITY_ZERO', () => {   // 換下時身上沒有能量、先用特性但一張都不附 ⇒ 改附視窗不開（重算後沒有能量）、回合照常
    let { s } = start(ID.cart, ID.reload, 0, 2); if (key(s) !== 'rush-switch-order') return { key: key(s) };
    s = res(s, ['ability-first']); if (key(s) === 'clamperl-bombard-attach') s = res(s, []);
    return { after: key(s), active: onActive(s) };
  });
  T('RUSH_ZERO_THEN_ATTACH', () => {   // 換下時身上沒有能量、先用特性附 2 張 ⇒ 仍要開改附視窗（上限 2）
    let { s } = start(ID.cart, ID.reload, 0, 2); if (key(s) !== 'rush-switch-order') return { key: key(s) };
    s = res(s, ['ability-first']); if (key(s) === 'clamperl-bombard-attach') s = res(s, s.pendingSelection.params.validIids.slice(0, 2));
    return { k2: key(s), max: s.pendingSelection?.maxCount };
  });
  // ── 希嘉娜的信賴 × 返回重載：先用特性 ⇒ 改附 1 個能量的候選含剛附上的 2 張
  T('SIG_ABILITY_FIRST', () => {
    let { s } = start(ID.sig, ID.reload, 1, 2); if (key(s) !== 'm6-sigana-order') return { key: key(s) };
    s = res(s, ['ability-first']); if (key(s) === 'clamperl-bombard-attach') s = res(s, s.pendingSelection.params.validIids.slice(0, 2));
    return { k2: key(s), valid: (s.pendingSelection?.params?.validIids ?? []).length };
  });
  // 正對照（敏感度規則）：手牌沒有基本【水】能量 ⇒ 兩種順序結果相同 ⇒ 不問、照舊先改附能量
  T('NO_WATER', () => { const { s } = start(ID.cart, ID.reload, 1, 0); return { key: key(s) }; });
  // 正對照：全能變身兩種順序結果相同 ⇒ 不問
  T('HUG_NOASK', () => { const { s } = start(ID.cart, ID.hug, 1, 2); return { key: key(s) }; });
  return out;
}

const judge = (r) => ({
  RUSH_ASK: !!r.RUSH_ASK && r.RUSH_ASK.key === 'rush-switch-order' && JSON.stringify(r.RUSH_ASK.opts) === '["trainer-first","ability-first"]',
  RUSH_ABILITY_FIRST: !!r.RUSH_ABILITY_FIRST && r.RUSH_ABILITY_FIRST.k1 === 'clamperl-bombard-attach' && r.RUSH_ABILITY_FIRST.k2 === 'rush-switch-energy-transfer'
    && r.RUSH_ABILITY_FIRST.max === 3 && r.RUSH_ABILITY_FIRST.active === 3 && r.RUSH_ABILITY_FIRST.hand === 0 && r.RUSH_ABILITY_FIRST.after === null,
  RUSH_TRAINER_FIRST: !!r.RUSH_TRAINER_FIRST && r.RUSH_TRAINER_FIRST.k1 === 'rush-switch-energy-transfer' && r.RUSH_TRAINER_FIRST.max === 1
    && r.RUSH_TRAINER_FIRST.active === 1 && r.RUSH_TRAINER_FIRST.after === 'resolve-retreat-to-bench-ability-prompt',
  RUSH_ABILITY_ZERO: !!r.RUSH_ABILITY_ZERO && r.RUSH_ABILITY_ZERO.after === null && r.RUSH_ABILITY_ZERO.active === 0,
  RUSH_ZERO_THEN_ATTACH: !!r.RUSH_ZERO_THEN_ATTACH && r.RUSH_ZERO_THEN_ATTACH.k2 === 'rush-switch-energy-transfer' && r.RUSH_ZERO_THEN_ATTACH.max === 2,
  SIG_ABILITY_FIRST: !!r.SIG_ABILITY_FIRST && r.SIG_ABILITY_FIRST.k2 === 'm6-sigana-energy' && r.SIG_ABILITY_FIRST.valid === 3,
  NO_WATER: !!r.NO_WATER && r.NO_WATER.key === 'rush-switch-energy-transfer',
  HUG_NOASK: !!r.HUG_NOASK && r.HUG_NOASK.key === 'rush-switch-energy-transfer',
});
const LABEL = {
  RUSH_ASK: '★★★ 急進開關換下鋼炮臂蝦、手牌有基本【水】能量 ⇒ 由持有人選順序（站長裁定第 7 項）',
  RUSH_ABILITY_FIRST: '★★★ 先用返回重載附 2 張 ⇒ 急進開關可以把 3 張一起改附到新的戰鬥寶可夢',
  RUSH_TRAINER_FIRST: '★★ 先改附能量（只有原本 1 張）⇒ 之後照常詢問返回重載',
  RUSH_ABILITY_ZERO: '★★ 先用特性但一張都不附、身上原本沒有能量 ⇒ 改附視窗不開（排隊視窗浮上時重算）',
  RUSH_ZERO_THEN_ATTACH: '★★★ 換下時身上沒有能量、先用返回重載附 2 張 ⇒ 仍開改附視窗（上限 2）',
  SIG_ABILITY_FIRST: '★★★ 希嘉娜的信賴：先用返回重載 ⇒ 改附 1 個能量的候選含剛附上的能量',
  NO_WATER: '★ 正對照（敏感度）：手牌沒有基本【水】能量 ⇒ 結果相同、不問、照舊先改附',
  HUG_NOASK: '★ 正對照（敏感度）：全能變身兩種順序結果相同 ⇒ 不問',
};
const NEW = ['RUSH_ASK', 'RUSH_ABILITY_FIRST', 'RUSH_TRAINER_FIRST', 'RUSH_ABILITY_ZERO', 'RUSH_ZERO_THEN_ATTACH', 'SIG_ABILITY_FIRST'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6548b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src", "scripts", "static/cards"], tmp);
    linkBaseModules(ROOT, tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.547（87b6c996）：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.547（87b6c996）：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6548 H', '需要 v6.547 commit');

console.log(`\n=== v6.548 急進開關／希嘉娜的信賴 × 返回重載 的順序：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
