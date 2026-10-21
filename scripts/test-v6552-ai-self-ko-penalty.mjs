#!/usr/bin/env node
/**
 * v6.552 守衛（v6.551 審查 P3-1）：AI 試打時，自己的寶可夢被這一擊連帶打倒（受傷反擊、自傷）⇒ 對手拿到的獎賞要扣分。
 * 【H】BASE（v6.551）：NEW 紅、正對照綠。
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
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.551。
const BASE_SHA = 'ca337e75';
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
const ID = { filler: '19178', G: byName('基本【草】能量'), deerling: '13364', leafeon: '16508', punk: byName('龐克頭盔'),
  dark: [...pool.values()].find((c) => c.supertype === 'Pokemon' && !c.evolvesFrom && (c.types || [c.pokemonType]).includes('Darkness') && Number(c.hp) >= 200 && HIJ(c))?.id };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(String(v))).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6552-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nexport { evaluateAttack } from '${p('src/lib/game/ai-eval')}';\nexport { getAIAction } from '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const board = (atkCid, atkDmg, attackIndex, oppPrizes = 6) => {
    const s0 = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    const st = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s0.players[0], hand: [], deck: many(ID.G, 10), discard: [], prizes: many(ID.G, 6), bench: [inst(ID.filler)], active: inst(atkCid, { damage: atkDmg, energyAttached: many(ID.G, 2) }) },
        { ...s0.players[1], hand: [], deck: many(ID.G, 10), discard: [], prizes: many(ID.G, oppPrizes), bench: [inst(ID.filler), inst(ID.filler)], active: inst(ID.dark, { toolAttached: inst(ID.punk) }) },
      ] };
    const ev = M.evaluateAttack(st, 0, attackIndex, pool);
    return { given: ev.prizesGiven ?? null, score: Math.round(ev.score) };
  };
  const hp = (cid) => Number(pool.get(String(cid)).hp);
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // 停在對手視窗的路徑：萌芽鹿｜推倒，身上剩 30 HP ⇒ 龐克頭盔 40 打倒自己
  T('PUSH_LETHAL', () => ({ lethal: board(ID.deerling, hp(ID.deerling) - 30, 0), safe: board(ID.deerling, 0, 0) }));
  // 同步路徑：葉伊布｜日光束，身上剩 30 HP
  T('BEAM_LETHAL', () => ({ lethal: board(ID.leafeon, hp(ID.leafeon) - 30, 1), safe: board(ID.leafeon, 0, 1) }));
  // 審查 P2-1：決策層（getAIAction）。萌芽鹿剩 30 HP、3 草能：推倒（停在對手視窗、印刷估值）與日光束都會被龐克頭盔打倒自己
  const decide = (benchN) => {
    const s0 = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    const st = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s0.players[0], hand: [], deck: many(ID.G, 10), discard: [], prizes: many(ID.G, 6), bench: many(ID.filler, benchN), active: inst(ID.deerling, { damage: hp(ID.deerling) - 30, energyAttached: many(ID.G, 3) }) },
        { ...s0.players[1], hand: [], deck: many(ID.G, 10), discard: [], prizes: many(ID.G, 6), bench: [inst(ID.filler), inst(ID.filler)], active: inst(ID.dark, { toolAttached: inst(ID.punk) }) },
      ] };
    return M.getAIAction(st, pool, 0);
  };
  // 沒有備戰 ⇒ 兩招都會直接輸 ⇒ 不出招
  T('AI_ALL_LOSE_NO_ATTACK', () => { const a = decide(0); return { type: a?.type ?? null, idx: a?.attackIndex ?? null }; });
  // 有備戰 ⇒ 推倒（只送 1 張、打不倒對手）不如日光束（1 換 1）
  T('AI_PREFERS_TRADE', () => { const a = decide(1); return { type: a?.type ?? null, idx: a?.attackIndex ?? null }; });
  // 對手只剩 1 張獎賞 ⇒ 這一擊等於直接輸 ⇒ 排到最後（-1e12）
  T('LOSE', () => board(ID.leafeon, hp(ID.leafeon) - 30, 1, 1));
  return out;
}

const judge = (r) => ({
  PUSH_LETHAL: !!r.PUSH_LETHAL?.lethal && r.PUSH_LETHAL.lethal.given === 1 && r.PUSH_LETHAL.lethal.score < 0 && r.PUSH_LETHAL.lethal.score < r.PUSH_LETHAL.safe.score,
  BEAM_LETHAL: !!r.BEAM_LETHAL?.lethal && r.BEAM_LETHAL.lethal.given === 1 && r.BEAM_LETHAL.lethal.score < 0 && r.BEAM_LETHAL.lethal.score < r.BEAM_LETHAL.safe.score,
  AI_ALL_LOSE_NO_ATTACK: !!r.AI_ALL_LOSE_NO_ATTACK && r.AI_ALL_LOSE_NO_ATTACK.type !== 'ATTACK' && r.AI_ALL_LOSE_NO_ATTACK.type !== null,
  AI_PREFERS_TRADE: !!r.AI_PREFERS_TRADE && r.AI_PREFERS_TRADE.type === 'ATTACK' && r.AI_PREFERS_TRADE.idx === 1,
  LOSE: !!r.LOSE && r.LOSE.score <= -1e11,
  SAFE_ZERO: !!r.PUSH_LETHAL?.safe && (r.PUSH_LETHAL.safe.given ?? 0) === 0 && r.PUSH_LETHAL.safe.score > 0 && (r.BEAM_LETHAL.safe.given ?? 0) === 0 && r.BEAM_LETHAL.safe.score > 0,
});
const LABEL = {
  PUSH_LETHAL: '★★★ 推倒（停在對手視窗）被龐克頭盔反擊打倒自己 ⇒ 對手拿 1 張獎賞、分數為負且低於不致死的情況',
  BEAM_LETHAL: '★★★ 日光束（同步結算）被龐克頭盔反擊打倒自己 ⇒ 同上',
  AI_ALL_LOSE_NO_ATTACK: '★★★ 決策層：沒有備戰、每一招都會讓自己被反擊打倒而輸 ⇒ 不出招（審查 P2-1）',
  AI_PREFERS_TRADE: '★ 正對照（決策層）：有備戰時不選「停在對手視窗、只送獎賞」的推倒，改選 1 換 1 的日光束（審查 P2-1）',
  LOSE: '★★★ 對手只剩 1 張獎賞、這一擊讓自己被打倒 ⇒ 等於直接輸，分數排到最後',
  SAFE_ZERO: '★ 正對照：不致死 ⇒ 不扣獎賞分、分數為正',
};
const NEW = ['PUSH_LETHAL', 'BEAM_LETHAL', 'LOSE', 'AI_ALL_LOSE_NO_ATTACK'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6552b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src", "scripts", "static/cards"], tmp);
    linkBaseModules(ROOT, tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.551：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.551：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6552 H', '需要 v6.551 commit');

console.log(`\n=== v6.552 AI 自己被打倒的扣分：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
