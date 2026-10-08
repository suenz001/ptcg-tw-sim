// ⭐v6.515 守衛：戰鬥場空著時，必須先派出新的戰鬥寶可夢，才能做其他事
//
// 玩家回報：「對方能將戰鬥場的土龍節節逃跑抽出後，先在備戰區下夢幻＆填能，然後才推怪」。
// 土龍節節｜逃跑抽出（SV5K 9827，台灣官方卡面）：「在自己的回合時可使用1次。從自己的牌庫抽出3張卡。
//   然後，將這隻寶可夢與附加的卡，全部放回自己的牌庫並重洗。」⇒ 在戰鬥場使用時戰鬥場會空出來。
// 根因：engine 只在取獎賞、選擇視窗時擋其他動作；「自己回合中戰鬥場空著」只靠 UI 彈出補位視窗，引擎不擋。
//
//   A1  逃跑抽出後（戰鬥場空、備戰有寶可夢）：打基礎寶可夢、附能量、用訓練家、撤退、攻擊、結束回合、用特性 ⇒ 全部 no-op
//   A2  派出新的戰鬥寶可夢之後，打基礎寶可夢、附能量照常可以（正對照：閘會放行）
//   A3  戰鬥場有寶可夢時一切照舊（零回歸）
//   A4  只看輪到行動的那一方：對手戰鬥場空著時，我方動作不受影響（範圍）
//   A5  備戰區沒有寶可夢時不擋（交給終局管線）
//   A6  AI：戰鬥場空著時第一個動作就是派出新的戰鬥寶可夢
//   H   HEAD-FAIL：同一批情境餵 BASE（v6.514）的 engine，A1 必紅（逐條列出）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.514。
const BASE_SHA = 'da231909';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

async function bundleFrom(srcRoot, tag) {
  const S = join(srcRoot, `.x-v6515${tag}-s.js`), E = join(srcRoot, `.x-v6515${tag}-e.ts`), O = join(srcRoot, `.x-v6515${tag}-o.mjs`);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E, "export * as ENG from './src/lib/game/engine';\nexport { getAIAction } from './src/lib/game/ai';\nimport './src/lib/game/effects';");
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { $lib: join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'error', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href + '?t=' + tag);
  } finally { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } }
}

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const C = { dudun: '9827', snorlax: '17038', fire: '17216', tablet: '17133' };
for (const [k, id] of Object.entries(C)) if (!pool.get(id)) throw new Error(`找不到 ${k} ${id}（卡池變了？）`);
// 卡面前提（變了就要重新查證）
const runAway = (pool.get(C.dudun).abilities || []).find((a) => a.name === '逃跑抽出');
if (!runAway || !/從自己的牌庫抽出3張卡。然後，將這隻寶可夢與附加的卡，全部放回自己的牌庫並重洗/.test(runAway.effect)) throw new Error('土龍節節｜逃跑抽出卡面變了');
if (pool.get(C.snorlax).stage !== 'Basic' && pool.get(C.snorlax).subtype !== 'Basic' && pool.get(C.snorlax).evolvesFrom) throw new Error('卡比獸不是基礎寶可夢？');

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'p' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const fill = (n, cid = C.tablet) => Array.from({ length: n }, () => inst(cid));
function mk(ENG, { active, bench = [], hand = [], oppActive = undefined, oppBench = undefined }) {
  const s = ENG.createGame({ name: 'P1', entries: [{ cardId: C.snorlax, count: 1 }] }, { name: 'P2', entries: [{ cardId: C.snorlax, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null, activeStadium: null, stadiumUsedThisTurn: [false, false],
    players: [
      { ...s.players[0], hand, deck: fill(12), discard: [], prizes: fill(6, C.snorlax), active, bench, energyAttachedThisTurn: false, supporterPlayedThisTurn: false },
      { ...s.players[1], hand: [], deck: fill(20, C.snorlax), discard: [], prizes: fill(6, C.snorlax),
        active: oppActive === undefined ? inst(C.snorlax) : oppActive, bench: oppBench ?? [inst(C.snorlax)] }] };
}
const same = (a, b) => JSON.stringify(a.players) === JSON.stringify(b.players) && a.activePlayerIndex === b.activePlayerIndex && a.turn === b.turn;

/** 跑全部情境，回傳 { 名稱: boolean }（每條各自判定，舊版缺東西也不整支 throw） */
function scenarios(M) {
  const ENG = M.ENG, r = {};
  const T = (k, f) => { try { r[k] = !!f(); } catch (e) { r[k] = false; r[k + ':err'] = String(e.message).slice(0, 80); } };
  // 逃跑抽出後的盤面
  const benchMon = inst(C.snorlax), handMon = inst(C.snorlax), handEn = inst(C.fire);
  const dud = inst(C.dudun, [inst(C.fire)]);
  let st = mk(ENG, { active: dud, bench: [benchMon], hand: [handMon, handEn] });
  const after = ENG.applyAction(st, { type: 'USE_ABILITY', iid: dud.iid, abilityIndex: 0 }, pool);
  T('pre', () => after.players[0].active === null && after.players[0].bench.length === 1 && after.players[0].hand.length === 5);
  const tries = {
    PLAY_BASIC: { type: 'PLAY_BASIC', iid: handMon.iid },
    ATTACH_ENERGY: { type: 'ATTACH_ENERGY', energyIid: handEn.iid, targetIid: benchMon.iid },
    END_TURN: { type: 'END_TURN' },
    RETREAT: { type: 'RETREAT', newActiveIid: benchMon.iid },
    ATTACK: { type: 'ATTACK', attackIndex: 0 },
    USE_ABILITY: { type: 'USE_ABILITY', iid: benchMon.iid, abilityIndex: 0 },
  };
  for (const [k, a] of Object.entries(tries)) T('A1:' + k, () => same(ENG.applyAction(after, a, pool), after));
  // A2：派出之後放行
  T('A2', () => {
    const p = ENG.applyAction(after, { type: 'SEND_NEW_ACTIVE', iid: benchMon.iid, senderIdx: 0 }, pool);
    if (p.players[0].active?.iid !== benchMon.iid) return false;
    const b = ENG.applyAction(p, { type: 'PLAY_BASIC', iid: handMon.iid }, pool);
    const e = ENG.applyAction(b, { type: 'ATTACH_ENERGY', energyIid: handEn.iid, targetIid: handMon.iid }, pool);
    return b.players[0].bench.some((c) => c.iid === handMon.iid) && e.players[0].bench.find((c) => c.iid === handMon.iid)?.energyAttached?.length === 1;
  });
  // A3：戰鬥場有寶可夢 ⇒ 照舊
  T('A3', () => {
    const h = inst(C.snorlax), s3 = mk(ENG, { active: inst(C.snorlax), bench: [inst(C.snorlax)], hand: [h] });
    return ENG.applyAction(s3, { type: 'PLAY_BASIC', iid: h.iid }, pool).players[0].bench.some((c) => c.iid === h.iid);
  });
  // A4：對手戰鬥場空著 ⇒ 我方動作不受影響
  T('A4', () => {
    const h = inst(C.snorlax), s4 = mk(ENG, { active: inst(C.snorlax), bench: [], hand: [h], oppActive: null, oppBench: [inst(C.snorlax)] });
    return ENG.applyAction(s4, { type: 'PLAY_BASIC', iid: h.iid }, pool).players[0].bench.some((c) => c.iid === h.iid);
  });
  // A5：備戰區沒有寶可夢 ⇒ 不擋（附能量到…沒有對象；用「打出基礎寶可夢」：舊行為是放進備戰）
  T('A5', () => {
    const h = inst(C.snorlax), s5 = mk(ENG, { active: null, bench: [], hand: [h] });
    const o = ENG.applyAction(s5, { type: 'PLAY_BASIC', iid: h.iid }, pool);
    return !same(o, s5);
  });
  // A6：AI 第一個動作是補位
  T('A6', () => { const a = M.getAIAction(after, pool, 0); return a?.type === 'SEND_NEW_ACTIVE' && a.iid === benchMon.iid; });
  return r;
}

console.log('【A】現行 engine');
const CUR = scenarios(await bundleFrom(ROOT, 'cur'));
ok('[前提] 逃跑抽出後戰鬥場空、備戰 1 隻、抽了 3 張', CUR.pre, CUR['pre:err']);
for (const k of ['PLAY_BASIC', 'ATTACH_ENERGY', 'END_TURN', 'RETREAT', 'ATTACK', 'USE_ABILITY'])
  ok(`★★★[A1] 戰鬥場空著時 ${k} 被擋（盤面不變）`, CUR['A1:' + k], CUR['A1:' + k + ':err']);
ok('★★★[A2] 派出新的戰鬥寶可夢之後，打基礎寶可夢、附能量照常', CUR.A2, CUR['A2:err']);
ok('★★[A3] 戰鬥場有寶可夢時照舊（零回歸）', CUR.A3, CUR['A3:err']);
ok('★★[A4] 對手戰鬥場空著時，我方動作不受影響', CUR.A4, CUR['A4:err']);
ok('★[A5] 備戰區沒有寶可夢時不擋', CUR.A5, CUR['A5:err']);
ok('★★[A6] AI：戰鬥場空著時第一個動作是派出新的戰鬥寶可夢', CUR.A6, CUR['A6:err']);

// S1：例外清單要含「解完既有選擇視窗」與「取獎賞」——行為端難以構造（自 KO＋搜牌視窗同時存在），用靜態鎖：
//   拿掉 RESOLVE_SELECTION ⇒ 戰鬥場空又有選擇視窗時兩個閘互擋，畫面鎖死（ai.ts v2.335 註解記載過這種情形）。
{
  const E = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const blk = (E.match(/\/\/ >>> v6515-promote-first[\s\S]*?\/\/ <<< v6515-promote-first/) || [''])[0].replace(/\/\/[^\n]*/g, '');
  ok('★★[S1] 閘的例外含 SEND_NEW_ACTIVE、RESOLVE_SELECTION、TAKE_PRIZES（解選擇視窗與取獎賞不可被擋）',
    ["action.type !== 'SEND_NEW_ACTIVE'", "action.type !== 'RESOLVE_SELECTION'", "action.type !== 'TAKE_PRIZES'"].every((x) => blk.includes(x)) && blk.length > 100);
}
console.log('\n【H】HEAD-FAIL：BASE（v6.514）的 engine');
let hasBase = false;
try { execSync(`git -C "${ROOT}" cat-file -e ${BASE_SHA}^{commit}`, { stdio: 'ignore' }); hasBase = true; } catch { /* 淺複製 */ }
if (!hasBase) console.log('  SHALLOW-SKIP H（沒有 BASE commit）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6515-'));
  try {
    execSync(`git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`);
    const B = scenarios(await bundleFrom(tmp, 'base'));
    const red = ['PLAY_BASIC', 'ATTACH_ENERGY'].filter((k) => !B['A1:' + k]);
    console.log('    BASE 上紅的：' + Object.keys(B).filter((k) => !k.includes(':err') && !B[k]).join('、'));
    ok('★★★[H1] BASE 上「戰鬥場空著時打基礎寶可夢、附能量」都沒被擋（＝玩家回報的情形）', red.length === 2 && B.pre === true, JSON.stringify(B));
    ok('[H2] BASE 上的正對照照常成立（A2／A3／A4，證明情境本身沒寫錯）', B.A2 && B.A3 && B.A4, JSON.stringify(B));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log(`\n=== v6.515 戰鬥場空著先補位：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
