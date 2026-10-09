// ⭐v6.517 守衛：系統 audit 第二輪（站長：「繼續audit看看系統有沒有其他的問題」）
//
// 【A】被引擎退回的攻擊要「原樣回傳」、不記成一筆動作。
//   根因：ATTACK 一開頭無條件 { ...state, _koDefenderSnapshot: null } 換了新物件，之後所有「不能攻擊」的退回
//   （先攻第一回合、能量不足…）回傳的都不是原物件 ⇒ recordTurnAction 以為攻擊成功，
//   對手回合面板多一筆「攻擊 XX」（實際什麼都沒發生）；其他 20 種被退回的動作都是原樣回傳，只有攻擊例外。
//   A1 先攻第一回合攻擊、A2 能量不足攻擊 ⇒ 原樣回傳、不記錄｜A3 上一擊留下 KO 快照時被退回 ⇒ 仍不記錄｜A4 正常攻擊照記（正對照）
// 【B】核心規則由引擎強制（不是只靠畫面擋；線上／錦標賽的玩家端可以直接送任何動作）—— 零回歸網，BASE 也綠
//   B1 第二張支援者｜B2 一回合第二次附能｜B3 一回合第二次撤退｜B4 先攻第一回合支援者｜B5 本回合剛放的寶可夢進化
//   B6 備戰滿 5 還下寶可夢｜B7 打出對手手牌／自己牌庫的卡｜B8 能量附到對手寶可夢｜B9 用對手寶可夢的特性
//   B10 一回合第二張競技場｜B11 每回合 1 次的特性用過後換位上場不能再用
//   （同一輪另外驗過、沒有問題：60 局 AI 對 AI 零退回動作；傷害減算型 6 招全部正確；其他 9 種被退回動作原樣回傳）
// 【H】HEAD-FAIL：A1～A3 餵 v6.516 必紅
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.516。
const BASE_SHA = '031e238d';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

async function bundleFrom(srcRoot, tag) {
  const S = join(srcRoot, `.x-v6517${tag}-s.js`), E = join(srcRoot, `.x-v6517${tag}-e.ts`), O = join(srcRoot, `.x-v6517${tag}-o.mjs`);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E, "export * as ENG from './src/lib/game/engine';\nimport './src/lib/game/effects';");
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { $lib: join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'error', nodePaths: [join(ROOT, 'node_modules')] });
    return (await import(pathToFileURL(O).href + '?t=' + tag)).ENG;
  } finally { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } }
}
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const SN = '17038', FIRE = '17216', SUP = '13441', MAG = '11214', MAGZ = '11215', ST1 = '11285', ST2 = '11286';
const need = { SN: '卡比獸', SUP: '黑連', MAG: '小磁怪', MAGZ: '三合一磁怪', LIL: '莉佳的蔓藤怪' };
for (const [id, n] of [[SN, need.SN], [SUP, need.SUP], [MAG, need.MAG], [MAGZ, need.MAGZ], ['16485', need.LIL]]) if (pool.get(id)?.name !== n) throw new Error(`${id} 不是 ${n}（卡池變了？）`);
if (pool.get(SUP).subtype !== 'Supporter' || pool.get(MAGZ).evolvesFrom !== '小磁怪' || pool.get(ST1).subtype !== 'Stadium' || pool.get(ST2).subtype !== 'Stadium' || pool.get(ST1).name === pool.get(ST2).name) throw new Error('測試用卡的前提變了');
if (pool.get(SN).attacks[0].cost.length !== 1 || pool.get(SN).attacks[1].cost.length !== 5) throw new Error('卡比獸招式費用變了');

let nn = 0; const inst = (cid, e = [], x = {}) => ({ iid: 'v17_' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const fill = (n, cid = '17133') => Array.from({ length: n }, () => inst(cid));
function scenarios(ENG) {
  const act = (s, a) => ENG.applyAction(s, a, pool);
  function mk(o = {}) {
    const s = ENG.createGame({ name: 'P1', entries: [{ cardId: SN, count: 1 }] }, { name: 'P2', entries: [{ cardId: SN, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: o.turn ?? 5, isFirstTurn: o.first ?? false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, activeStadium: o.stadium ?? null, stadiumUsedThisTurn: [false, false],
      players: [{ ...s.players[0], hand: o.hand ?? [], deck: fill(12), discard: [], prizes: fill(6, SN), active: o.active ?? inst(SN), bench: o.bench ?? [inst(SN)], energyAttachedThisTurn: false, supporterPlayedThisTurn: false },
        { ...s.players[1], hand: o.oppHand ?? [inst(SN)], deck: fill(20, SN), discard: [], prizes: fill(6, SN), active: o.oppActive ?? inst(SN), bench: o.oppBench ?? [inst(SN)] }] };
  }
  const recs = (st) => (st.players[0].currentTurnActions ?? []).filter((r) => r.type === 'attack').length;
  const R = {};
const T = (k, f) => { try { R[k] = !!f(); } catch (e) { R[k] = false; R[k + ':err'] = String(e.message).slice(0, 80); } };
// A：被退回的攻擊——原樣回傳、不記一筆「攻擊」
T('A1', () => { const s = mk({ first: true, turn: 1, active: inst(SN, [inst(FIRE), inst(FIRE), inst(FIRE), inst(FIRE)]) }); const r = act(s, { type: 'ATTACK', attackIndex: 0 }); return r === s && recs(r) === 0; });
T('A2', () => { const s = mk(); const r = act(s, { type: 'ATTACK', attackIndex: 0 }); return r === s && recs(r) === 0; });
T('A3', () => { const s = { ...mk(), _koDefenderSnapshot: { idx: 1, inst: inst(SN) } }; const r = act(s, { type: 'ATTACK', attackIndex: 0 }); return recs(r) === 0 && r.turn === s.turn && JSON.stringify(r.players) === JSON.stringify(s.players); });
T('A4', () => { const s = mk({ active: inst(SN, [inst(FIRE), inst(FIRE), inst(FIRE), inst(FIRE), inst(FIRE)]) }); const r = act(s, { type: 'ATTACK', attackIndex: 1 }); const mine = r.players[0].currentTurnActions ?? []; const moved = r.turnActionsLog ? JSON.stringify(r.turnActionsLog) : ''; return r !== s && (mine.some((x) => x.type === 'attack') || moved.includes('"attack"') || JSON.stringify(r.players).includes('"type":"attack"')); });
// B：核心規則由引擎強制（零回歸網：BASE 也綠）
const blocked = (s, a) => { const r = act(s, a); return r === s || (JSON.stringify(r.players) === JSON.stringify(s.players) && r.turn === s.turn); };
T('B1', () => { const a = inst(SUP), b = inst(SUP); const s = act(mk({ hand: [a, b] }), { type: 'PLAY_TRAINER', iid: a.iid }); return blocked(s, { type: 'PLAY_TRAINER', iid: b.iid }); });
T('B2', () => { const a = inst(FIRE), b = inst(FIRE); let s = mk({ hand: [a, b] }); s = act(s, { type: 'ATTACH_ENERGY', energyIid: a.iid, targetIid: s.players[0].active.iid }); return blocked(s, { type: 'ATTACH_ENERGY', energyIid: b.iid, targetIid: s.players[0].active.iid }); });
T('B3', () => { const a0 = inst(SN, Array.from({ length: 6 }, () => inst(FIRE))), b = inst(SN, Array.from({ length: 4 }, () => inst(FIRE))); const s = act(mk({ active: a0, bench: [b] }), { type: 'RETREAT', newActiveIid: b.iid }); return blocked(s, { type: 'RETREAT', newActiveIid: a0.iid }); });
T('B4', () => { const a = inst(SUP); return blocked(mk({ first: true, turn: 1, hand: [a] }), { type: 'PLAY_TRAINER', iid: a.iid }); });
T('B5', () => { const m = inst(MAG), z = inst(MAGZ); const s = act(mk({ hand: [m, z] }), { type: 'PLAY_BASIC', iid: m.iid }); return blocked(s, { type: 'EVOLVE', fromIid: m.iid, toIid: z.iid }); });
T('B6', () => { const h = inst(SN); return blocked(mk({ hand: [h], bench: [inst(SN), inst(SN), inst(SN), inst(SN), inst(SN)] }), { type: 'PLAY_BASIC', iid: h.iid }); });
T('B7', () => { const s = mk(); return blocked(s, { type: 'PLAY_BASIC', iid: s.players[1].hand[0].iid }) && blocked(s, { type: 'PLAY_BASIC', iid: s.players[0].deck[0].iid }); });
T('B8', () => { const a = inst(FIRE); const s = mk({ hand: [a] }); return blocked(s, { type: 'ATTACH_ENERGY', energyIid: a.iid, targetIid: s.players[1].active.iid }); });
T('B9', () => { const z = inst(MAGZ); return blocked(mk({ oppActive: z }), { type: 'USE_ABILITY', iid: z.iid, abilityIndex: 0 }); });
T('B10', () => { const a = inst(ST1), b = inst(ST2); const s = act(mk({ hand: [a, b] }), { type: 'PLAY_TRAINER', iid: a.iid }); return s.activeStadium?.iid === a.iid && blocked(s, { type: 'PLAY_TRAINER', iid: b.iid }); });
T('B11', () => { const lil = inst('16485'); let s = mk({ active: inst(SN, Array.from({ length: 6 }, () => inst(FIRE))), bench: [lil] }); s = act(s, { type: 'USE_ABILITY', iid: lil.iid, abilityIndex: 0 }); if (s.pendingSelection) s = act(s, { type: 'RESOLVE_SELECTION', selectedIids: [], senderIdx: 0 }); s = act(s, { type: 'RETREAT', newActiveIid: lil.iid }); return s.players[0].active?.iid === lil.iid && !ENG.getUsableAbilities(s, pool).some((u) => u.iid === lil.iid); });
  return R;
}

console.log('【A】被退回的攻擊');
const CUR = scenarios(await bundleFrom(ROOT, 'cur'));
const E = (k) => CUR[k + ':err'];
ok('★★★[A1] 先攻第一回合攻擊被退回：原樣回傳、不記一筆「攻擊」', CUR.A1, E('A1'));
ok('★★★[A2] 能量不足攻擊被退回：原樣回傳、不記一筆「攻擊」', CUR.A2, E('A2'));
ok('★★[A3] 上一擊留下 KO 快照時被退回的攻擊：仍不記錄', CUR.A3, E('A3'));
ok('★★[A4] 正常攻擊照記（正對照）', CUR.A4, E('A4'));
console.log('\n【B】核心規則由引擎強制（零回歸網）');
const BN = { B1: '第二張支援者', B2: '一回合第二次附能', B3: '一回合第二次撤退', B4: '先攻第一回合支援者', B5: '本回合剛放的寶可夢進化', B6: '備戰滿 5 還下寶可夢',
  B7: '打出對手手牌／自己牌庫的卡', B8: '能量附到對手寶可夢', B9: '用對手寶可夢的特性', B10: '一回合第二張競技場', B11: '每回合 1 次的特性換位上場後不能再用' };
for (const [k, n] of Object.entries(BN)) ok(`★★[${k}] ${n} ⇒ 引擎擋下`, CUR[k], E(k));

console.log('\n【H】HEAD-FAIL：v6.516');
let hasBase = false;
try { execSync(`git -C "${ROOT}" cat-file -e ${BASE_SHA}^{commit}`, { stdio: 'ignore' }); hasBase = true; } catch { /* 淺複製 */ }
if (!hasBase) console.log('  SHALLOW-SKIP H（沒有 BASE commit）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6517-'));
  try {
    execSync(`git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`);
    const B = scenarios(await bundleFrom(tmp, 'base'));
    // ⚠ 出錯（例外）也會讓 A 組為 false ⇒ 必須另外要求「沒有例外」，否則 H1 會假綠
    ok('★★★[H1] v6.516：A1、A2、A3 都紅（被退回的攻擊被記成一筆動作），而且不是因為例外', !B.A1 && !B.A2 && !B.A3 && !B['A1:err'] && !B['A2:err'] && !B['A3:err'], JSON.stringify({ A1: B.A1, A2: B.A2, A3: B.A3, err: B['A1:err'] }));
    ok('[H2] v6.516：A4 與 B 組照常成立（情境本身沒寫錯）', B.A4 && Object.keys(BN).every((k) => B[k]), JSON.stringify(Object.fromEntries(['A4', ...Object.keys(BN)].map((k) => [k, B[k]]))));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`\n=== v6.517 系統 audit 第二輪：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
