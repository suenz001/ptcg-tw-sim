#!/usr/bin/env node
/**
 * v6.540 守衛（站長 2026-10-12 第 6 項「依官方 QA」＋PTCG_RULES L2036：瑪機雅娜｜自動治癒 × 耿鬼ex｜侵蝕詛咒 由持有人選處理順序）：
 *   KO_RISK／NO_DMG 手動附能（Q&A 的情境）兩種順序結果不同 ⇒ 開 modal-choice，兩個選項各自結算正確，AI 選持有人有利的
 *   NO_GENGAR／NO_MAG 只有一種效果 ⇒ 不開視窗（零回歸）
 *   AUTO    特性／卡片路徑走唯一入口、不開視窗、自動採持有人有利的順序（設計決定，待站長確認）
 *   另：anti-pattern-lint G2 釘死「從手牌附能的反應只能走 applyHandAttachReactions」。
 * 【H】BASE（v6.539）：KO_RISK、NO_DMG、AUTO 紅（手動附能固定先詛咒、沒有入口函式）；正對照兩版綠。
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
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.539。
const BASE_SHA = 'f147c743';
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
const ID = { filler: '19178', W: byName('基本【水】能量'), M: byName('基本【鋼】能量'), mag: '14780', gengar: '9817' };
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);
if (!missing.length && !(pool.get(ID.mag)?.abilities || []).some((a) => a.name === '自動治癒')) missing.push('mag(自動治癒)');
if (!missing.length && !(pool.get(ID.gengar)?.abilities || []).some((a) => a.name === '侵蝕詛咒')) missing.push('gengar(侵蝕詛咒)');

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6540-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nexport * as W2 from '${p('src/lib/game/effects/cards/v3000_g3_wave2')}';\nexport { getAIAction } from '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = ({ a0, b0 = [inst(ID.filler)], a1, b1 = [inst(ID.filler)], hand0 = [] }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [], energyAttachedThisTurn: false,
      players: [
        { ...s.players[0], hand: hand0, deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b1, active: a1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  const magHere = (s, iid) => { const p = s.players[0]; return p.active?.iid === iid ? p.active : p.bench.find((c) => c.iid === iid) ?? null; };
  // 手動附能給戰鬥場的瑪機雅娜（自動治癒 90），對手場上有耿鬼ex（侵蝕詛咒 +20）
  const manual = (dmg, withGengar = true, withMag = true) => {
    const m = inst(withMag ? ID.mag : ID.filler, { damage: dmg }); const e = inst(ID.M);
    const s0 = mk({ a0: m, hand0: [e], a1: withGengar ? inst(ID.gengar) : inst(ID.filler) });
    const s = act(s0, { type: 'ATTACH_ENERGY', energyIid: e.iid, targetIid: m.iid, actorIdx: 0 });
    const ps = s.pendingSelection;
    const res = (pick) => { const t = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: [pick], actorIdx: 0, senderIdx: 0, pendingToken: ps.token }); const x = magHere(t, m.iid); return x ? x.damage : 'gone'; };
    const ai = ps ? M.getAIAction(s, pool, 0) : null;
    return { key: ps?.effectKey ?? null, opts: (ps?.params?.options ?? []).map((o) => o.id), dmgNow: magHere(s, m.iid)?.damage ?? 'gone',
      heal: ps ? res('heal-first') : null, react: ps ? res('react-first') : null, aiPick: ai?.selectedIids?.[0] ?? null };
  };
  T('KO_RISK', () => manual(80));      // 先詛咒 ⇒ 100 ≥ 90 昏厥；先治癒 ⇒ 0＋20＝20
  T('NO_DMG', () => manual(0));        // 先治癒 ⇒ 0＋20＝20；先詛咒 ⇒ 20−90＝0
  T('NO_GENGAR', () => manual(50, false));   // 只有治癒 ⇒ 不問，50−90＝0
  T('NO_MAG', () => manual(10, true, false)); // 只有詛咒 ⇒ 不問，10＋20＝30
  // 特性／卡片路徑（不問，自動採持有人有利的順序）：直接呼叫唯一入口
  T('AUTO', () => {
    if (!M.W2.applyHandAttachReactions) return 'n/a';
    const m = inst(ID.mag, { damage: 80, energyAttached: [inst(ID.M)] });
    const s = M.W2.applyHandAttachReactions(mk({ a0: m, a1: inst(ID.gengar) }), 0, m.iid, pool, 1);
    const m2 = inst(ID.mag, { damage: 0, energyAttached: [inst(ID.M)] });
    const s2 = M.W2.applyHandAttachReactions(mk({ a0: m2, a1: inst(ID.gengar) }), 0, m2.iid, pool, 1);
    return { koRisk: magHere(s, m.iid)?.damage ?? 'gone', noDmg: magHere(s2, m2.iid)?.damage ?? 'gone', pend: !!(s.pendingSelection || s2.pendingSelection) };
  });
  return out;
}

const judge = (r) => ({
  KO_RISK: !!r.KO_RISK && r.KO_RISK.key === 'hand-attach-order' && r.KO_RISK.dmgNow === 80 && r.KO_RISK.opts[0] === 'heal-first'
    && r.KO_RISK.heal === 20 && r.KO_RISK.react === 'gone' && r.KO_RISK.aiPick === 'heal-first',
  NO_DMG: !!r.NO_DMG && r.NO_DMG.key === 'hand-attach-order' && r.NO_DMG.opts[0] === 'react-first' && r.NO_DMG.heal === 20 && r.NO_DMG.react === 0 && r.NO_DMG.aiPick === 'react-first',
  NO_GENGAR: !!r.NO_GENGAR && r.NO_GENGAR.key === null && r.NO_GENGAR.dmgNow === 0,
  NO_MAG: !!r.NO_MAG && r.NO_MAG.key === null && r.NO_MAG.dmgNow === 30,
  AUTO: !!r.AUTO && r.AUTO.koRisk === 20 && r.AUTO.noDmg === 0 && r.AUTO.pend === false,
});
const LABEL = {
  KO_RISK: '★★★ 手動附能給瑪機雅娜（80）× 侵蝕詛咒 ⇒ 由持有人選順序；先治癒剩 20、先詛咒昏厥；AI 選先治癒（Q&A L2036）',
  NO_DMG: '★★★ 沒受傷時兩種順序也不同（20 vs 0）⇒ 一樣讓持有人選；AI 偏好先詛咒（剩 0）排第一',
  NO_GENGAR: '★ 正對照：只有自動治癒 ⇒ 不開視窗',
  NO_MAG: '★ 正對照：只有侵蝕詛咒 ⇒ 不開視窗、照常 +20',
  AUTO: '★★ 特性／卡片路徑：不開視窗、自動採持有人有利的順序（不昏厥優先，其次傷害少）',
};
const NEW = ['KO_RISK', 'NO_DMG', 'AUTO'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
// AI_WAIT（v6.539 審查 P3-1）：+page.svelte 的 AI 後備 END_TURN 在「雙方同時補位、AI 等對手先放」時不送（原本每 250～500ms 空轉一次）
//   ⚠ 靜態接線（Svelte 頁面行為端跑不到）：只看 [AI fallback] 那一段的條件式；正對照：拿掉條件就抓得到。
{
  const pg = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  const blk = (src) => { const i = src.indexOf("console.warn('[AI fallback] getAIAction returned null in main phase → forcing END_TURN');"); return i < 0 ? '' : src.slice(Math.max(0, i - 600), i); };
  const has = (b) => /promoteWaitSeat\(\{ phase: g\.phase, players: g\.players, activePlayerIndex: g\.activePlayerIndex \}\) === null\)/.test(b);
  ok('★★ AI_WAIT：AI 後備 END_TURN 的條件含「沒有人在等補位」（promoteWaitSeat === null）', has(blk(pg)));
  ok('★ AI_WAIT 正對照：拿掉那一行 ⇒ 判準抓得到', !has(blk(pg.replace(/\n\s*&& promoteWaitSeat\(\{ phase: g\.phase[^\n]*/, ') {'))));
}
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6540b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src"], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.539：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.539：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6540 H', '需要 v6.539 commit');

console.log(`\n=== v6.540 從手牌附能的反應順序：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
