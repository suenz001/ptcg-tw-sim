// ⭐v6.516 守衛：「戰鬥場空著必須先補位」audit（站長：「幫我做audit看看除了土龍節節以外，還有沒有別的地方會發生類似的情況」）
//
// 卡面（static/cards 台灣官方）掃出「不是招式、卻會讓戰鬥場空出來」的效果，逐張用真引擎跑：
//   自己的戰鬥場空：寶可夢旋風回收機（選戰鬥寶可夢）、三合一磁怪｜過度放電、黑夜魔靈｜咒詛炸彈（自己在戰鬥場）、丟棄戰鬥場的化石
//     ⇒ v6.515 的閘已擋（O1～O4 鎖住，免得以後退化）
//   對手的戰鬥場空（新發現）：我方在自己回合用特性放傷害指示物打倒對手戰鬥寶可夢（黑夜魔靈｜咒詛炸彈、超級甲賀忍蛙ex｜必殺手裡劍）
//     ⇒ v6.515 只看行動方，取完獎賞後對手還沒補位，我方能繼續下寶可夢、附能量，甚至攻擊空的戰鬥場（P1～P2，BASE 實測紅）
//   P3 對手在我方回合補位（senderIdx=1）照常可以，補完我方照常行動（正對照：不會兩邊互等卡死）
//   P4 AI：對手戰鬥場空著時不出動作（等補位）；自己戰鬥場空著時先補位
//   凱西｜瞬間移動者：效果本身就要選備戰上場（不會空著），K1 鎖住。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.515。
const BASE_SHA = '1443a172';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

async function bundleFrom(srcRoot, tag) {
  const S = join(srcRoot, `.x-v6516${tag}-s.js`), E = join(srcRoot, `.x-v6516${tag}-e.ts`), O = join(srcRoot, `.x-v6516${tag}-o.mjs`);
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
const C = { snorlax: '17038', fire: '17216', lightning: '17218', tablet: '17133', abra: '11582', recycler: '17135', magnezone: '11215',
  dusknoir: '14734', greninja: '18442', fossil: '19215' };
const WATER = String([...pool.values()].find((c) => c.name === '基本【水】能量' && c.supertype === 'Energy')?.id ?? '');
for (const [k, id] of Object.entries({ ...C, water: WATER })) if (!pool.get(id)) throw new Error(`找不到 ${k} ${id}（卡池變了？）`);
// 卡面前提（變了就要重新查證）
const ab = (id, n) => (pool.get(id).abilities || []).find((a) => a.name === n)?.effect ?? '';
const facts = [
  [/將這隻寶可夢與附加的卡，全部放回自己的牌庫並重洗/, ab(C.abra, '瞬間移動者'), '凱西｜瞬間移動者'],
  [/選擇1隻自己的場上寶可夢，將那隻寶可夢與附加的卡，全部放回手牌/, pool.get(C.recycler).rulesText ?? '', '寶可夢旋風回收機'],
  [/將這隻寶可夢【昏厥】/, ab(C.magnezone, '過度放電'), '三合一磁怪｜過度放電'],
  [/將這隻寶可夢【昏厥】。在對手的1隻寶可夢身上放置13個傷害指示物/, ab(C.dusknoir, '咒詛炸彈'), '黑夜魔靈｜咒詛炸彈'],
  [/在對手的1隻寶可夢身上放置6個傷害指示物/, ab(C.greninja, '必殺手裡劍'), '超級甲賀忍蛙ex｜必殺手裡劍'],
];
for (const [re, t, n] of facts) if (!re.test(t)) throw new Error(n + ' 卡面變了：' + t.slice(0, 60));
if (pool.get(C.abra).hp > 130 || pool.get(C.abra).hp > 60) { /* 凱西 HP 40：6 個／13 個指示物都打得倒 */ }

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'p' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const fill = (n, cid = C.tablet) => Array.from({ length: n }, () => inst(cid));
function mk(ENG, { active, bench = [], hand = [], oppActive, oppBench }) {
  const s = ENG.createGame({ name: 'P1', entries: [{ cardId: C.snorlax, count: 1 }] }, { name: 'P2', entries: [{ cardId: C.snorlax, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, setupDone: [true, true],
    pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, activeStadium: null, stadiumUsedThisTurn: [false, false],
    players: [{ ...s.players[0], hand, deck: fill(12), discard: [inst(C.lightning), inst(C.lightning), inst(C.lightning)], prizes: fill(6, C.snorlax), active, bench, energyAttachedThisTurn: false, supporterPlayedThisTurn: false },
      { ...s.players[1], hand: [], deck: fill(20, C.snorlax), discard: [], prizes: fill(6, C.snorlax), active: oppActive ?? inst(C.snorlax), bench: oppBench ?? [inst(C.snorlax)] }] };
}
const same = (a, b) => JSON.stringify(a.players) === JSON.stringify(b.players) && a.turn === b.turn && a.activePlayerIndex === b.activePlayerIndex;
/** 解完選擇視窗與取獎賞（pick 決定選擇視窗的答案） */
function drain(ENG, st, pick) {
  for (let i = 0; i < 12; i++) {
    if (st.pendingSelection) { const ps = st.pendingSelection; const n = ENG.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: pick(ps, st), senderIdx: ps.actorIdx }, pool); if (n === st) break; st = n; continue; }
    const pp = st.pendingPrizes || [0, 0]; const w = pp[0] > 0 ? 0 : pp[1] > 0 ? 1 : -1;
    if (w >= 0) { const n = ENG.applyAction(st, { type: 'TAKE_PRIZES', count: pp[w], playerIdx: w }, pool); if (n === st) break; st = n; continue; }
    break;
  }
  return st;
}
/** 回傳：雙方戰鬥場是否空、補位前四種動作是否被擋（true＝被擋） */
function probe(ENG, st0, act, pick) {
  const st = drain(ENG, ENG.applyAction(st0, act, pool), pick);
  const me = st.players[0], hm = inst(C.snorlax), he = inst(C.fire);
  const st2 = { ...st, players: [{ ...me, hand: [...me.hand, hm, he] }, st.players[1]] };
  const tgt = me.active ?? me.bench[0];
  return { st: st2, hm, he, meEmpty: me.active === null, oppEmpty: st.players[1].active === null,
    blockBasic: same(ENG.applyAction(st2, { type: 'PLAY_BASIC', iid: hm.iid }, pool), st2),
    blockAttach: !tgt || same(ENG.applyAction(st2, { type: 'ATTACH_ENERGY', energyIid: he.iid, targetIid: tgt.iid }, pool), st2),
    blockAttack: !me.active || same(ENG.applyAction(st2, { type: 'ATTACK', attackIndex: 0 }, pool), st2),
    blockEnd: same(ENG.applyAction(st2, { type: 'END_TURN' }, pool), st2) };
}
const allBlocked = (r) => r.blockBasic && r.blockAttach && r.blockAttack && r.blockEnd;

function scenarios(M) {
  const ENG = M.ENG, r = {};
  const T = (k, f) => { try { r[k] = f(); } catch (e) { r[k] = { err: String(e.message).slice(0, 80) }; } };
  T('O1', () => { const a = inst(C.snorlax), it = inst(C.recycler); return probe(ENG, mk(ENG, { active: a, bench: [inst(C.snorlax)], hand: [it] }), { type: 'PLAY_TRAINER', iid: it.iid }, () => [a.iid]); });
  T('O2', () => { const a = inst(C.magnezone); return probe(ENG, mk(ENG, { active: a, bench: [inst(C.snorlax)] }), { type: 'USE_ABILITY', iid: a.iid, abilityIndex: 0 }, (ps) => (ps.params?.validIids ?? []).slice(0, 1)); });
  T('O3', () => { const a = inst(C.dusknoir); return probe(ENG, mk(ENG, { active: a, bench: [inst(C.snorlax)] }), { type: 'USE_ABILITY', iid: a.iid, abilityIndex: 0 }, (ps, st) => [st.players[1].bench[0].iid]); });
  T('O4', () => { const a = inst(C.fossil, [], { fossilOnField: true }); return probe(ENG, mk(ENG, { active: a, bench: [inst(C.snorlax)] }), { type: 'DISCARD_FOSSIL', iid: a.iid }, () => []); });
  T('K1', () => { const a = inst(C.abra); return probe(ENG, mk(ENG, { active: a, bench: [inst(C.snorlax)] }), { type: 'USE_ABILITY', iid: a.iid, abilityIndex: 0 }, (ps) => (ps.params?.validIids ?? ps.validIids ?? []).slice(0, 1)); });
  T('P1', () => { const b = inst(C.dusknoir), oa = inst(C.abra); return probe(ENG, mk(ENG, { active: inst(C.snorlax), bench: [b], oppActive: oa, oppBench: [inst(C.snorlax)] }), { type: 'USE_ABILITY', iid: b.iid, abilityIndex: 0 }, () => [oa.iid]); });
  T('P2', () => { const a = inst(C.greninja), oa = inst(C.abra); return probe(ENG, mk(ENG, { active: a, bench: [inst(C.snorlax)], hand: [inst(WATER)], oppActive: oa, oppBench: [inst(C.snorlax)] }), { type: 'USE_ABILITY', iid: a.iid, abilityIndex: 0 }, (ps) => ps.type === 'opp-poke-choose' ? [oa.iid] : (ps.params?.validIids ?? ps.validIids ?? []).slice(0, 1)); });
  T('P3', () => {   // 對手在我方回合補位 ⇒ 我方照常行動
    const p = r.P1; if (!p?.st) return false;
    const after = ENG.applyAction(p.st, { type: 'SEND_NEW_ACTIVE', iid: p.st.players[1].bench[0].iid, senderIdx: 1 }, pool);
    if (after.players[1].active == null || after.activePlayerIndex !== 0) return false;
    return !same(ENG.applyAction(after, { type: 'PLAY_BASIC', iid: p.hm.iid }, pool), after);
  });
  T('P4a', () => r.P1?.st ? M.getAIAction(r.P1.st, pool, 0) === null : false);
  T('P4b', () => { const p = r.P1; if (!p?.st) return false; const a = M.getAIAction(p.st, pool, 1); return a?.type === 'SEND_NEW_ACTIVE' && a.senderIdx === 1; });
  return r;
}

console.log('【自己的戰鬥場空】');
const CUR = scenarios(await bundleFrom(ROOT, 'cur'));
const show = (r) => JSON.stringify(r?.err ? r : { meEmpty: r?.meEmpty, oppEmpty: r?.oppEmpty, b: r?.blockBasic, a: r?.blockAttach, k: r?.blockAttack, e: r?.blockEnd });
ok('★★★[O1] 寶可夢旋風回收機收回戰鬥寶可夢 ⇒ 補位前其他動作全擋', CUR.O1?.meEmpty && allBlocked(CUR.O1), show(CUR.O1));
ok('★★★[O2] 三合一磁怪｜過度放電（戰鬥場）⇒ 對手取完獎賞後、補位前全擋', CUR.O2?.meEmpty && allBlocked(CUR.O2), show(CUR.O2));
ok('★★★[O3] 黑夜魔靈｜咒詛炸彈（自己在戰鬥場）⇒ 補位前全擋', CUR.O3?.meEmpty && allBlocked(CUR.O3), show(CUR.O3));
ok('★★[O4] 丟棄戰鬥場的化石 ⇒ 補位前全擋', CUR.O4?.meEmpty && allBlocked(CUR.O4), show(CUR.O4));
ok('★★[K1] 凱西｜瞬間移動者：效果內就選備戰上場，戰鬥場不會空著', CUR.K1 && CUR.K1.meEmpty === false, show(CUR.K1));
console.log('\n【對手的戰鬥場空（我方回合）】');
ok('★★★[P1] 咒詛炸彈打倒對手戰鬥寶可夢 ⇒ 對手補位前，我方下寶可夢／附能量／攻擊／結束回合全擋', CUR.P1?.oppEmpty && allBlocked(CUR.P1), show(CUR.P1));
ok('★★★[P2] 必殺手裡劍打倒對手戰鬥寶可夢 ⇒ 同上', CUR.P2?.oppEmpty && allBlocked(CUR.P2), show(CUR.P2));
ok('★★★[P3] 對手在我方回合補位（senderIdx=1）照常可以，補完我方照常行動（不會互等卡死）', CUR.P3 === true, JSON.stringify(CUR.P3));
ok('★★[P4a] AI：對手戰鬥場空著時不出動作（等補位，不會一直送被退回的動作）', CUR.P4a === true, JSON.stringify(CUR.P4a));
ok('★★[P4b] AI：自己的戰鬥場被打空時，在對手回合中也會補位', CUR.P4b === true, JSON.stringify(CUR.P4b));

console.log('\n【H】HEAD-FAIL：BASE（v6.515）');
let hasBase = false;
try { execSync(`git -C "${ROOT}" cat-file -e ${BASE_SHA}^{commit}`, { stdio: 'ignore' }); hasBase = true; } catch { /* 淺複製 */ }
if (!hasBase) console.log('  SHALLOW-SKIP H（沒有 BASE commit）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6516-'));
  try {
    execSync(`git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`);
    const B = scenarios(await bundleFrom(tmp, 'base'));
    ok('★★★[H1] v6.515：對手戰鬥場被打空時，我方還能下寶可夢、附能量、攻擊（＝本版 audit 找到的問題）',
      B.P1?.oppEmpty && !B.P1.blockBasic && !B.P1.blockAttach && !B.P1.blockAttack && B.P2?.oppEmpty && !B.P2.blockBasic, show(B.P1) + ' ' + show(B.P2));
    ok('[H2] v6.515：自己戰鬥場空的四種已經擋住（本版是擴大，不是第一次修）', allBlocked(B.O1) && allBlocked(B.O2) && allBlocked(B.O3) && allBlocked(B.O4));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`\n=== v6.516 補位閘 audit：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
