#!/usr/bin/env node
/**
 * v6.539 守衛（站長 2026-10-12 第 5 項選項 A：雙方戰鬥寶可夢同時昏厥 ⇒ 依官方由下一個回合的玩家先放、另一方等待）：
 *   官方 Q&A：PTCG_RULES L410（寶可夢檢查）「從下一個回合的玩家開始放置。」、L893（火焰嚎叫）、L1671（咒詛炸彈）「對方玩家先放置」。
 *   ATK      招式讓雙方同時昏厥：自己先送被退回；對手送完才輪到自己；補位視窗、AI、伺服器 currentActorSeat 都一致
 *   CHECKUP  寶可夢檢查中雙方同時昏厥：下一個回合的玩家先放
 *   ONE_SIDE／NO_BENCH 正對照（不排序）
 * 【H】BASE（v6.538）：ATK、CHECKUP 紅；正對照兩版綠。
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
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.538。
const BASE_SHA = '99010a78';
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
const ID = { filler: '19178', W: byName('基本【水】能量'), tauros: withAttack('肯泰羅', '群起瞄準'), sandslash: withAbility('穿山王', '反擊針') };
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);
const atkIdx = (id, n) => pool.get(id).attacks.findIndex((a) => a.name === n);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6539-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nexport { getAIAction } from '${p('src/lib/game/ai')}';\nexport * as MS from '${p('src/lib/game/modal-slots')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// 伺服器 currentActorSeat：從補丁原文用大括號配對抽出來實跑（不在守衛裡抄一份）
function serverActorSeat(patchSrc) {
  const i = patchSrc.indexOf('function currentActorSeat(gs) {');
  if (i < 0) return null;
  let d = 0, j = patchSrc.indexOf('{', i);
  for (; j < patchSrc.length; j++) { if (patchSrc[j] === '{') d++; else if (patchSrc[j] === '}') { d--; if (d === 0) break; } }
  return new Function(patchSrc.slice(i, j + 1) + '\nreturn currentActorSeat;')();
}

function scenarios(M, patchSrc) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const mk = ({ a0, b0 = [], a1, b1 = [] }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b1, active: a1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const drive = (s, pick) => { let g = 0; while (s.pendingSelection && s.phase === 'playing' && g++ < 8) { const ps = s.pendingSelection;
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: pick(ps), actorIdx: ps.actorIdx ?? 0, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); } return s; };
  const take = (s) => { for (const i of [0, 1]) if ((s.pendingPrizes?.[i] ?? 0) > 0) s = act(s, { type: 'TAKE_PRIZES', count: s.pendingPrizes[i], playerIdx: i }); return s; };
  const heads = (f) => { const o = Math.random; Math.random = () => 0; try { return f(); } finally { Math.random = o; } };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // defMine：線上對戰時「替防守方補位」只有防守方自己是 true；本機雙人兩邊都是 true
  const seats = (s, my, defMine) => M.MS.promoteModalSeats({ phase: s.phase, players: s.players, hasPendingSelection: !!s.pendingSelection,
    defenderIdx: (1 - s.activePlayerIndex), myIdx: my, defenderTurnMine: defMine, isSpectator: false, activePlayerIndex: s.activePlayerIndex });
  const actor = patchSrc ? serverActorSeat(patchSrc) : null;

  // 招式：肯泰羅｜群起瞄準打倒戰鬥場穿山王，反擊針同時打昏肯泰羅（雙方都有備戰、獎賞 6/6）⇒ 雙方都要補位
  const both = () => heads(() => {
    const ta = inst(ID.tauros, { energyAttached: many(ID.W, 2), damage: Number(pool.get(ID.tauros).hp) - 30 });
    const ss = inst(ID.sandslash, { damage: Number(pool.get(ID.sandslash).hp) - 50 });
    const b0 = inst(ID.filler), b1 = inst(ID.filler);
    let s = act(mk({ a0: ta, b0: [b0], a1: ss, b1: [b1] }), { type: 'ATTACK', attackIndex: atkIdx(ID.tauros, '群起瞄準'), actorIdx: 0 });
    s = take(drive(s, () => [ss.iid]));
    return { s, b0, b1 };
  });
  T('ATK', () => { const { s, b0, b1 } = both();
    const pre = { a0: s.players[0].active, a1: s.players[1].active, ap: s.activePlayerIndex };
    const s1 = act(s, { type: 'SEND_NEW_ACTIVE', iid: b0.iid, senderIdx: 0 });      // 這回合的玩家先送 ⇒ 應被退回
    const s2 = act(s1, { type: 'SEND_NEW_ACTIVE', iid: b1.iid, senderIdx: 1 });     // 下一個回合的玩家
    const s3 = act(s2, { type: 'SEND_NEW_ACTIVE', iid: b0.iid, senderIdx: 0 });     // 對手放完才輪到自己
    return { bothEmpty: pre.a0 === null && pre.a1 === null, ap: pre.ap, p0First: s1.players[0].active?.iid ?? null,
      p1: s2.players[1].active?.iid === b1.iid, p0After: s3.players[0].active?.iid === b0.iid,
      seatsP0: seats(s, 0, false), seatsP1: seats(s, 1, true), seatsLocal: seats(s, 0, true),
      alertP0: M.MS.promoteAlerts({ phase: s.phase, players: s.players, hasPendingSelection: false, defenderIdx: 1, myIdx: 0, oppIdx: 1,
        defenderTurnMine: false, isMyTurn: true, turnPhase: s.turnPhase, activePlayerIndex: s.activePlayerIndex }), ai0: M.getAIAction(s, pool, 0)?.type ?? null, ai1: M.getAIAction(s, pool, 1)?.type ?? null,
      server: actor ? actor(s) : 'n/a' }; });
  // 寶可夢檢查：雙方同時昏厥（盤面直接構造：檢查後等補位，endTurnContinueAfterKO＝結束回合的 P1）⇒ 下一個回合的玩家（P0）先放
  T('CHECKUP', () => { const b0 = inst(ID.filler), b1 = inst(ID.filler);
    const s = { ...mk({ a0: null, b0: [b0], a1: null, b1: [b1] }), activePlayerIndex: 1, turnPhase: 'end', endTurnContinueAfterKO: 1 };
    const s1 = act(s, { type: 'SEND_NEW_ACTIVE', iid: b1.iid, senderIdx: 1 });
    const s2 = act(s1, { type: 'SEND_NEW_ACTIVE', iid: b0.iid, senderIdx: 0 });
    const s3 = act(s2, { type: 'SEND_NEW_ACTIVE', iid: b1.iid, senderIdx: 1 });
    return { p1First: s1.players[1].active?.iid ?? null, p0: s2.players[0].active?.iid === b0.iid, p1After: s3.players[1].active?.iid === b1.iid,
      server: actor ? actor(s) : 'n/a' }; });
  // 正對照：只有一方要補位 ⇒ 不排序，照常可以送（也不影響伺服器判定）
  T('ONE_SIDE', () => { const b1 = inst(ID.filler);
    const s = mk({ a0: inst(ID.filler), b0: [inst(ID.filler)], a1: null, b1: [b1] });
    const s1 = act(s, { type: 'SEND_NEW_ACTIVE', iid: b1.iid, senderIdx: 1 });
    return { ok: s1.players[1].active?.iid === b1.iid, wait: M.MS.promoteWaitSeat ? M.MS.promoteWaitSeat({ phase: s.phase, players: s.players, activePlayerIndex: 0 }) : 'n/a', server: actor ? actor(s) : 'n/a' }; });
  // 正對照：雙方戰鬥場都空、但這回合的玩家沒有備戰 ⇒ 不排序（勝負交給終局管線）
  T('NO_BENCH', () => { const b1 = inst(ID.filler);
    const s = mk({ a0: null, b0: [], a1: null, b1: [b1] });
    return { wait: M.MS.promoteWaitSeat ? M.MS.promoteWaitSeat({ phase: s.phase, players: s.players, activePlayerIndex: 0 }) : null }; });
  return out;
}

const judge = (r) => ({
  ATK: !!r.ATK && r.ATK.bothEmpty && r.ATK.ap === 0 && r.ATK.p0First === null && r.ATK.p1 && r.ATK.p0After
    && JSON.stringify(r.ATK.seatsP0) === '[]' && JSON.stringify(r.ATK.seatsP1) === '[1]' && JSON.stringify(r.ATK.seatsLocal) === '[1]' && r.ATK.alertP0?.mine === false && r.ATK.alertP0?.waitSeat === 1 && r.ATK.ai0 !== 'SEND_NEW_ACTIVE' && r.ATK.ai1 === 'SEND_NEW_ACTIVE' && r.ATK.server === 1,
  CHECKUP: !!r.CHECKUP && r.CHECKUP.p1First === null && r.CHECKUP.p0 && r.CHECKUP.p1After && r.CHECKUP.server === 0,
  ONE_SIDE: !!r.ONE_SIDE && r.ONE_SIDE.ok && (r.ONE_SIDE.wait === null || r.ONE_SIDE.wait === 'n/a') && r.ONE_SIDE.server === 1,
  NO_BENCH: !!r.NO_BENCH && r.NO_BENCH.wait === null,
});
const LABEL = {
  ATK: '★★★ 招式讓雙方戰鬥寶可夢同時昏厥 ⇒ 對手（下一個回合的玩家）先放，自己先送會被退回；視窗、AI、伺服器判定一致（L893）',
  CHECKUP: '★★★ 寶可夢檢查中雙方同時昏厥 ⇒ 下一個回合的玩家先放（L410）',
  ONE_SIDE: '★ 正對照：只有一方要補位 ⇒ 照常送出',
  NO_BENCH: '★ 正對照：等待方沒有備戰 ⇒ 不排序',
};
const NEW = ['ATK', 'CHECKUP'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM, readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8')), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6539b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src", "oracle-admin/server_admin_patch.js"], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM, readFileSync(join(tmp, 'oracle-admin/server_admin_patch.js'), 'utf8')), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.538：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.538：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6539 H', '需要 v6.538 commit');

console.log(`\n=== v6.539 雙方同時昏厥的補位順序：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
