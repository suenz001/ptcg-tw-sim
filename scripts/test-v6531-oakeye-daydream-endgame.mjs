#!/usr/bin/env node
/**
 * v6.531 守衛：
 *   OE  願增猿｜腎上腺腦力：場上有探探鼠（監視之眼）⇒ 特性按鈕不能按、硬送也不吃本回合使用次數（PTCG_RULES L3004，站長 2026-10-11 同意）
 *   OE_ctl 沒有探探鼠 ⇒ 可以按
 *   OE_snow 正對照（站長提醒）：特性沒有被消除——冰冷之帳在寶可夢檢查照樣對願增猿放 1 個
 *   RB  火箭隊的以歐路普｜火箭腦力（類推：同屬「改放傷害指示物」的特性）⇒ 不能按
 *   DK  白日夢：附能後被侵蝕詛咒當場昏厥、要補位 ⇒ 補位完才結束回合（Fable 複審 v6.530）
 *   CB  咒詛炸彈「使用者可放置、對手不可放置、雙方各剩 1 張」⇒ 使用方勝——改由中央出口 centralVerdictDiffersV6531 收回重判（通則）
 * 【H】BASE（v6.530）：OE、RB、DK 逐條紅；正對照兩版綠。
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
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.530。
const BASE_SHA = 'a1965980';
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
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const ID = {
  W: byName('基本【水】能量'), D: byName('基本【惡】能量'), filler: '19178',
  grimm: withAbility('願增猿', '腎上腺腦力'), oak: withAbility('探探鼠', '監視之眼'), froslass: withAbility('雪妖女', '冰冷之帳'),
  gengar: withAbility('耿鬼ex', '侵蝕詛咒'), rocket: withAbility('火箭隊的以歐路普', '火箭腦力'), dusclops: withAbility('彷徨夜靈', '咒詛炸彈'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6531-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, getUsableAbilities } from '${p('src/lib/game/engine')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = ({ a0, b0 = [], a1, b1 = [], hand0 = [], prizes0, prizes1 }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: hand0, deck: many(ID.W, 10), discard: [], prizes: prizes0 ?? many(ID.W, 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: prizes1 ?? many(ID.W, 6), bench: b1, active: a1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const listed = (s, iid) => (M.getUsableAbilities(s, pool) || []).some((u) => u.iid === iid);
  const res = (s, pick) => { let g = 0; while (s.pendingSelection && g++ < 6) { const ps = s.pendingSelection;
    const sel = pick ? pick(ps, s) : (ps.type === 'modal-choice' ? ['yes'] : (ps.params?.validIids ?? []).slice(0, Math.max(1, ps.minCount || 0)));
    s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: sel, actorIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); }
    return s; };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  const grimmBoard = (withOak) => { const g = inst(ID.grimm, { energyAttached: many(ID.D, 1), damage: 30 });
    return { g, s: mk({ a0: g, a1: inst(ID.filler), b1: withOak ? [inst(ID.oak)] : [] }) }; };
  T('OE', () => { const { g, s } = grimmBoard(true);
    const t = act(s, { type: 'USE_ABILITY', iid: g.iid, abilityIndex: 0 });
    const u = t.players[0].active;
    return { listed: listed(s, g.iid), consumed: !!(u.abilityUsedThisTurn || (t.players[0].abilityNamesUsedThisTurn || []).includes?.('腎上腺腦力')), pending: !!t.pendingSelection }; });
  T('OE_ctl', () => { const { g, s } = grimmBoard(false); return { listed: listed(s, g.iid) }; });
  T('OE_snow', () => { const g = inst(ID.grimm, { energyAttached: many(ID.D, 1) });
    let s = mk({ a0: g, a1: inst(ID.filler), b1: [inst(ID.oak), inst(ID.froslass)] });
    s = act(s, { type: 'END_TURN' });
    const gg = s.players[0].active; return { dmg: gg?.damage }; });
  T('RB', () => { const r = inst(ID.rocket); const s = mk({ a0: r, b0: [inst(ID.filler)], a1: inst(ID.filler), b1: [inst(ID.oak)] });
    return { listed: listed(s, r.iid) }; });
  T('DK', () => { const hp = Number(pool.get(ID.filler).hp);
    const a = inst(ID.filler, { damage: hp - 10, endTurnOnOppAttachEnergyThisTurn: true }), sub = inst(ID.filler), w = inst(ID.W);
    let s = mk({ a0: a, b0: [sub], hand0: [w], a1: inst(ID.gengar) });
    s = act(s, { type: 'ATTACH_ENERGY', energyIid: w.iid, targetIid: a.iid });
    // 侵蝕詛咒放 2 個 ⇒ 昏厥；對手取獎、我方補位
    let g = 0;
    while (g++ < 6 && s.phase === 'playing') {
      if (s.pendingSelection) { s = res(s); continue; }
      if (!s.players[0].active && s.players[0].bench.length) { s = act(s, { type: 'SEND_NEW_ACTIVE', iid: s.players[0].bench[0].iid, senderIdx: 0 }); continue; }
      break;
    }
    return { koed: !s.players[0].active || s.players[0].active.iid !== a.iid, turnEnded: s.activePlayerIndex === 1 }; });
  T('CB', () => { const d = inst(ID.dusclops); const vh = Number(pool.get(ID.filler).hp);
    const victim = inst(ID.filler, { damage: Math.max(0, vh - 50) });
    let s = mk({ a0: d, b0: [inst(ID.filler)], a1: victim, prizes0: many(ID.W, 1), prizes1: many(ID.W, 1) });
    s = res(act(s, { type: 'USE_ABILITY', iid: d.iid, abilityIndex: 0 }), () => [victim.iid]);
    return { phase: s.phase, winner: s.winner ?? null }; });
  return out;
}

const judge = (r) => ({
  OE: !!r.OE && r.OE.listed === false && r.OE.consumed === false && r.OE.pending === false,
  OE_ctl: !!r.OE_ctl && r.OE_ctl.listed === true,
  OE_snow: !!r.OE_snow && r.OE_snow.dmg === 10,
  RB: !!r.RB && r.RB.listed === false,
  DK: !!r.DK && r.DK.koed === true && r.DK.turnEnded === true,
  CB: !!r.CB && r.CB.phase === 'game-over' && r.CB.winner === 0,
});
const LABEL = {
  OE: '★★★ 腎上腺腦力 × 監視之眼：按鈕不能按、硬送也不吃使用次數（L3004，站長裁定）',
  OE_ctl: '★ 正對照：沒有探探鼠 ⇒ 可以按',
  OE_snow: '★★ 正對照（站長提醒）：特性沒有被消除——冰冷之帳照樣放 1 個',
  RB: '★★ 火箭腦力 × 監視之眼（類推）：不能按',
  DK: '★★ 白日夢：附能後被侵蝕詛咒昏厥 ⇒ 補位後回合結束',
  CB: '★★ 咒詛炸彈：使用方可放置、對手不可 ⇒ 使用方勝（中央出口通則）',
};
const NEW = ['OE', 'RB', 'DK'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6531b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src"], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.530：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.530：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6531 H', '需要 v6.530 commit');

console.log(`\n=== v6.531 監視之眼／白日夢補位／終局通則：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
