#!/usr/bin/env node
/**
 * v6.673 守衛：沉重接力棒的候選能量＋吉憲的熱血（備戰區沒有寶可夢也能用）＋電腦對手不自殺
 *
 * 【A】沉重接力棒（卡面：「選擇最多3張那隻寶可夢身上附加的基本能量卡，以任意方式改附於自己的備戰寶可夢身上。」）
 *   舊版收集到 3 張就停 ⇒ 附 4～5 張基本能量時，只能選最先附上的 3 張（玩家沒辦法自己挑）。
 *   A1 附 5 張基本能量被打倒 ⇒ 候選＝5 張全部、最多選 3 張
 *   A2 玩家挑第 4、5 張 ⇒ 正是那兩張改附到備戰寶可夢身上
 *   A3 送 5 張 ⇒ 只改附 3 張（引擎消毒＋resolver 夾卡面上限，直呼 resolver 也一樣）
 *   A4 正對照：3 張基本能量＋1 張特殊能量 ⇒ 候選 3 張、上限 3（特殊能量不算，舊版也是這樣）
 *
 * 【B】吉憲的熱血 —— 站長裁定（2026-11-27，逐字）：
 *   「吉憲的熱血再備戰區沒有寶可夢的時候應該也要可以使用，但一使用後，玩家就會因為戰鬥場沒有寶可夢而被判敗」
 *   B1 備戰區空、戰鬥位是【水】寶可夢 ⇒ 打得出來，候選是戰鬥寶可夢
 *   B2 選它 ⇒ 放回牌庫、對局結束、對手獲勝
 *   B3 正對照：備戰區有【水】寶可夢 ⇒ 戰鬥＋備戰都是候選（舊版也是）
 *   B4 電腦對手：同樣盤面不會打出吉憲的熱血自殺（正對照性質：舊版是卡打不出來）
 *   B5 電腦對手：戰鬥＋備戰都是【水】⇒ 選備戰那隻（不把戰鬥寶可夢連能量送回牌庫）
 *   B6 中央 actionLosesGameNow：備戰空時打出吉憲的熱血 ⇒ true；有備戰候選 ⇒ false（同一支函式的正反兩面）
 *   B7 resolver 收到對不上候選的 payload：備戰空時不替玩家選「輸掉」；有備戰時退回備戰那隻（舊版退回戰鬥寶可夢）
 *
 * 【H】HEAD-FAIL：BASE（v6.672 c634ab9c）逐條紅（Rule 41：缺席的函式回哨兵，不整支 throw）。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { extractBaseArchive } from './lib/base-archive.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ BASE_SHA 必須是留在 main 上的那一顆（IRON_RULES Rule 45）：v6.672 收尾（鐵律 Rule 95）。
const BASE_SHA = 'c634ab9c';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) { pool.set(String(c.id), c); all.push(c); }
}
const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
const byName = (n) => String(all.find((c) => c.name === n && (c.supertype !== 'Pokemon' || HIJ(c)))?.id);
const EW = byName('基本【水】能量'), EF = byName('基本【火】能量'), EG = byName('基本【草】能量');
const SPECIAL = byName('薄霧能量');
const HB = byName('沉重接力棒'), HOT = byName('吉憲的熱血'), SQUIRTLE = byName('傑尼龜');
const PLAIN = all.filter((c) => HIJ(c) && c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && c.pokemonType !== 'Water' && !/ex$/.test(c.name)).sort((a, b) => Number(a.hp) - Number(b.hp))[0];
// 受害者：撤退 4、無特性的 H/I/J 基礎寶可夢（卡比獸）
const VICTIM = all.find((c) => HIJ(c) && c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && (c.retreatCost || []).length === 4);
// 攻擊方：無特性、招式無效果、全【無】費用、傷害 ≥ 30
const ATK = all.find((c) => HIJ(c) && c.supertype === 'Pokemon' && !(c.abilities || []).length
  && (c.attacks || []).some((a) => Number(a.damage) >= 30 && !a.effect && (a.cost || []).every((t) => t === 'Colorless')));
const AI_IDX = ATK ? ATK.attacks.findIndex((a) => Number(a.damage) >= 30 && !a.effect && (a.cost || []).every((t) => t === 'Colorless')) : -1;

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6673-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\n`
    + `export { RESOLVERS } from '${p('src/lib/game/effects/_shared')}';\n`
    + `export { getAIAction } from '${p('src/lib/game/ai')}';\n`
    + `export * as AE from '${p('src/lib/game/ai-eval')}';\n`
    + `import '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...x });
  const mk = (p0 = {}, p1 = {}) => {
    const s = M.createGame({ name: 'A', entries: [{ cardId: String(PLAIN.id), count: 1 }] }, { name: 'B', entries: [{ cardId: String(PLAIN.id), count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, activeStadium: null, log: [],
      players: [
        { ...s.players[0], hand: [], deck: Array.from({ length: 8 }, () => inst(PLAIN.id)), discard: [], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), bench: [inst(PLAIN.id)], active: inst(PLAIN.id), supporterPlayedThisTurn: false, ...p0 },
        { ...s.players[1], hand: [], deck: Array.from({ length: 8 }, () => inst(PLAIN.id)), discard: [], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), bench: [inst(PLAIN.id)], active: inst(PLAIN.id), ...p1 },
      ] };
  };
  const act = (st, a) => { const o = M.applyAction(st, a, pool); return o?.state ?? o; };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + String(e?.message ?? e).split('\n')[0]; } };
  const MISSING = '__MISSING__';
  const losesNow = typeof M.AE?.actionLosesGameNow === 'function' ? M.AE.actionLosesGameNow : () => MISSING;

  // 沉重接力棒：受害者附 energies、剩 10 HP、備戰 1 隻（改附時不用再分配）
  const batonKO = (energyIds) => {
    const ens = energyIds.map((e) => inst(e));
    const victim = inst(VICTIM.id, { damage: Number(VICTIM.hp) - 10, toolAttached: inst(HB), energyAttached: ens });
    const bench = inst(PLAIN.id);
    let st = mk({ active: inst(ATK.id, { energyAttached: ATK.attacks[AI_IDX].cost.map(() => inst(EW)) }) }, { active: victim, bench: [bench] });
    st = act(st, { type: 'ATTACK', attackIndex: AI_IDX });
    return { st, ens: ens.map((e) => e.iid), bench: bench.iid };
  };
  const benchEnergy = (st, iid) => st.players[1].bench.find((b) => b.iid === iid)?.energyAttached.map((e) => e.iid) ?? null;

  T('A1', () => {
    const { st, ens } = batonKO([EW, EF, EG, EW, EF]);
    const p = st.pendingSelection;
    return { key: p?.effectKey, valid: (p?.params?.validIids ?? []).length, all: ens.every((x) => (p?.params?.validIids ?? []).includes(x)), max: p?.maxCount };
  });
  T('A2', () => {
    const { st, ens, bench } = batonKO([EW, EF, EG, EW, EF]);
    const p = st.pendingSelection;
    if (p?.effectKey !== 'heavy-baton-pick-energies') return 'no-pending ' + p?.effectKey;
    const pick = [ens[3], ens[4]];
    let s2 = act(st, { type: 'RESOLVE_SELECTION', selectedIids: pick, pendingToken: p.token, playerIndex: 1 });
    const got = benchEnergy(s2, bench) ?? [];
    return { got: got.length, exact: pick.every((x) => got.includes(x)) && got.length === 2 };
  });
  T('A3', () => {
    const { st, ens, bench } = batonKO([EW, EF, EG, EW, EF]);
    const p = st.pendingSelection;
    if (p?.effectKey !== 'heavy-baton-pick-energies') return 'no-pending ' + p?.effectKey;
    const viaEngine = benchEnergy(act(st, { type: 'RESOLVE_SELECTION', selectedIids: ens, pendingToken: p.token, playerIndex: 1 }), bench)?.length;
    // 直呼 resolver（繞過引擎消毒）：送 5 張＋1 張候選以外的 iid ⇒ 仍只改附 3 張候選
    const r = M.RESOLVERS.get('heavy-baton-pick-energies');
    const cleared = { ...st, pendingSelection: null };
    // 候選以外的 iid：一張不存在的、一張「本來就在棄牌區」的基本能量（只有 validIids 擋得住它）
    const stray = inst(EW);
    const withStray = { ...cleared, players: [cleared.players[0], { ...cleared.players[1], discard: [...cleared.players[1].discard, stray] }] };
    const dm = r ? (benchEnergy(r(withStray, 1, ['not-a-candidate', stray.iid, ...ens], p.params, pool), bench) ?? []) : null;
    const direct = dm ? (dm.includes(stray.iid) ? 'stray' : dm.length) : 'no-resolver';
    // 排隊期間有 1 張已經不在棄牌區（被別的效果移走）⇒ 只改附仍在棄牌區的（審查 P3-2）
    const gone = { ...cleared, players: [cleared.players[0], { ...cleared.players[1], discard: cleared.players[1].discard.filter((c) => c.iid !== ens[0]) }] };
    const sg = r ? r(gone, 1, ens.slice(0, 3), p.params, pool) : null;
    const moved = sg ? (benchEnergy(sg, bench) ?? []) : [];
    const logOk = !!sg && (sg.log ?? []).some((l) => /全 2 張能量/.test(l.message ?? ''));   // 張數照實際改附的寫
    return { viaEngine, direct, goneSkipped: moved.length === 2 && !moved.includes(ens[0]) && logOk };
  });
  T('A4', () => {
    const { st } = batonKO([EW, SPECIAL, EF, EG]);
    const p = st.pendingSelection;
    return { key: p?.effectKey, valid: (p?.params?.validIids ?? []).length, max: p?.maxCount };
  });

  T('B1', () => {
    const tr = inst(HOT), sq = inst(SQUIRTLE);
    const st = act(mk({ hand: [tr], active: sq, bench: [] }), { type: 'PLAY_TRAINER', iid: tr.iid });
    return { key: st.pendingSelection?.effectKey, cand: st.pendingSelection?.params?.validIids ?? [], sq: sq.iid, played: !st.players[0].hand.some((h) => h.iid === tr.iid) };
  });
  T('B2', () => {
    const tr = inst(HOT), sq = inst(SQUIRTLE);
    let st = act(mk({ hand: [tr], active: sq, bench: [] }), { type: 'PLAY_TRAINER', iid: tr.iid });
    if (st.pendingSelection?.effectKey !== 'm7-hot-blood-return') return 'no-pending';
    st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: [sq.iid], pendingToken: st.pendingSelection.token });
    return { phase: st.phase, winner: st.winner, inDeck: st.players[0].deck.some((d) => d.iid === sq.iid || d.cardId === SQUIRTLE) };
  });
  T('B3', () => {
    const tr = inst(HOT), a = inst(SQUIRTLE), b = inst(SQUIRTLE);
    const st = act(mk({ hand: [tr], active: a, bench: [b] }), { type: 'PLAY_TRAINER', iid: tr.iid });
    const c = st.pendingSelection?.params?.validIids ?? [];
    return { n: c.length, both: c.includes(a.iid) && c.includes(b.iid) };
  });
  T('B4', () => {
    const tr = inst(HOT);
    const st = mk({ hand: [tr], active: inst(SQUIRTLE), bench: [] });
    const a = M.getAIAction(st, pool, 0);
    return { playsHot: a?.type === 'PLAY_TRAINER' && a.iid === tr.iid, type: a?.type };
  });
  T('B5', () => {
    const tr = inst(HOT), a = inst(SQUIRTLE, { energyAttached: [inst(EW)] }), b = inst(SQUIRTLE);
    let st = act(mk({ hand: [tr], active: a, bench: [b] }), { type: 'PLAY_TRAINER', iid: tr.iid });
    if (st.pendingSelection?.effectKey !== 'm7-hot-blood-return') return 'no-pending';
    const ai = M.getAIAction(st, pool, 0);
    return { pick: ai?.selectedIids?.[0] === b.iid ? 'bench' : ai?.selectedIids?.[0] === a.iid ? 'active' : JSON.stringify(ai) };
  });
  T('B6', () => {
    const tr1 = inst(HOT);
    const lose = losesNow(mk({ hand: [tr1], active: inst(SQUIRTLE), bench: [] }), 0, { type: 'PLAY_TRAINER', iid: tr1.iid }, pool);
    const tr2 = inst(HOT);
    const safe = losesNow(mk({ hand: [tr2], active: inst(SQUIRTLE), bench: [inst(SQUIRTLE)] }), 0, { type: 'PLAY_TRAINER', iid: tr2.iid }, pool);
    return { lose, safe };
  });
  T('B7', () => {
    // resolver 收到對不上候選的 payload（空陣列）：備戰空 ⇒ 不替玩家選「輸掉」；有備戰 ⇒ 退回備戰那隻、不是戰鬥寶可夢
    const r = M.RESOLVERS.get('m7-hot-blood-return');
    if (!r) return 'no-resolver';
    const sq = inst(SQUIRTLE);
    const s1 = r(mk({ active: sq, bench: [] }), 0, [], {}, pool);
    const a = inst(SQUIRTLE), b = inst(SQUIRTLE);
    const s2 = r(mk({ active: a, bench: [b] }), 0, [], {}, pool);
    return { alone: s1.phase !== 'game-over' && s1.players[0].active?.iid === sq.iid, fallback: s2.players[0].active?.iid === a.iid && !s2.players[0].bench.some((x) => x.iid === b.iid) };
  });
  return out;
}

const LABEL = {
  A1: '★★★ A1 接力棒：附 5 張基本能量 ⇒ 候選 5 張全部、最多選 3 張',
  A2: '★★★ A2 接力棒：玩家挑第 4、5 張 ⇒ 正是那兩張改附到備戰寶可夢',
  A3: '★★★ A3 接力棒：送 5 張 ⇒ 引擎只改附 3 張；直呼 resolver（含候選以外的 iid）也只改附 3 張；已不在棄牌區的不改附',
  A4: '★ A4 正對照：3 基本＋1 特殊能量 ⇒ 候選 3、上限 3',
  B1: '★★★ B1 吉憲的熱血：備戰區空 ⇒ 打得出來、候選是戰鬥寶可夢',
  B2: '★★★ B2 吉憲的熱血：放回唯一的寶可夢 ⇒ 對局結束、對手獲勝（站長裁定）',
  B3: '★ B3 正對照：備戰有【水】⇒ 戰鬥＋備戰都是候選',
  B4: '★ B4 電腦對手：備戰區空時不會打出吉憲的熱血自殺',
  B5: '★★★ B5 電腦對手：戰鬥＋備戰都是【水】⇒ 選備戰那隻',
  B6: '★★★ B6 中央 actionLosesGameNow：會輸 ⇒ true、不會輸 ⇒ false',
  B7: '★★★ B7 吉憲的熱血 resolver 收到空 payload：備戰空不判敗、有備戰退回備戰那隻（審查 P3-1）',
};
const judge = (r) => ({
  A1: r.A1?.key === 'heavy-baton-pick-energies' && r.A1.valid === 5 && r.A1.all === true && r.A1.max === 3,
  A2: r.A2?.got === 2 && r.A2.exact === true,
  A3: r.A3?.viaEngine === 3 && r.A3.direct === 3 && r.A3.goneSkipped === true,
  A4: r.A4?.key === 'heavy-baton-pick-energies' && r.A4.valid === 3 && r.A4.max === 3,
  B1: r.B1?.key === 'm7-hot-blood-return' && r.B1.played === true && r.B1.cand.length === 1 && r.B1.cand[0] === r.B1.sq,
  B2: r.B2?.phase === 'game-over' && r.B2.winner === 1 && r.B2.inDeck === true,
  B3: r.B3?.n === 2 && r.B3.both === true,
  B4: r.B4?.playsHot === false,
  B5: r.B5?.pick === 'bench',
  B6: r.B6?.lose === true && r.B6.safe === false,
  B7: r.B7?.alone === true && r.B7.fallback === true,
});
const POSITIVE = ['A4', 'B3', 'B4'];   // BASE 也必須綠（B4：BASE 是卡打不出來，所以也不會自殺）

console.log('【0】前置');
ok('00 harness：受害者（撤退 4）／攻擊方／傑尼龜／吉憲的熱血／沉重接力棒／特殊能量都找得到',
  !!VICTIM && !!ATK && AI_IDX >= 0 && !!PLAIN && ![HB, HOT, SQUIRTLE, SPECIAL, EW, EF, EG].includes('undefined'),
  `${VICTIM?.name} ${ATK?.name} ${PLAIN?.name}`);

console.log('\n【A／B】實跑');
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【C】接線');
{
  const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8');
  ok('C1 本檔在 npm test chain 裡恰好一次', (pkg.match(/test-v6673-heavy-baton-hot-blood\.mjs/g) || []).length === 1);
  const ai = readFileSync(join(ROOT, 'src/lib/game/ai.ts'), 'utf8');
  ok('C2 ai.ts 的訓練家與特性兩處都問中央 actionLosesGameNow', (ai.match(/actionLosesGameNow\(state, myIdx, \{ type: '(PLAY_TRAINER|USE_ABILITY)'/g) || []).length === 2);
  const ev = readFileSync(join(ROOT, 'src/lib/game/ai-eval.ts'), 'utf8');
  ok('C3 試跑只有一份：actionWeakensAttackThisTurn 與 actionLosesGameNow 都呼叫 simulateOwnAction、ai-eval.ts 只剩一處試跑迴圈',
    (ev.match(/simulateOwnAction\(state, me, action, pool\)/g) || []).length === 2
    && (ev.match(/applyAction\(shuffleHiddenZonesForSim\(cloneState\(state\), me\), action, pool\)/g) || []).length === 1);
}

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6673b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ['src'], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    const reds = [];
    for (const k of Object.keys(LABEL)) {
      if (POSITIVE.includes(k)) ok(`★[H 正對照] v6.672：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
      else { ok(`★★★[H] v6.672：${k} 紅`, BJ[k] === false, JSON.stringify(B[k])); if (BJ[k] === false) reds.push(k); }
    }
    console.log('  （BASE 紅：' + reds.join(' ') + '）');
  } catch (e) { ok('★★★[H] BASE 可打包', false, String(e?.message ?? e).split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6673 H', '需要 v6.672 commit');

console.log(`\n=== v6.673 沉重接力棒候選＋吉憲的熱血：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
