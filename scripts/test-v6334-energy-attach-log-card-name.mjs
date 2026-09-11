// v6.334 行為級守衛：附能的對戰 log 必須列出「實際附上去的那張能量卡」的卡名。
//
// ⭐ 這不是字串掃描：每一條都真的跑 applyAction('ATTACH_ENERGY') 或真的跑那支 resolver，
//    再去斷言回傳 state 的 log —— 而且斷言的是 cardLink 的 PUA marker
//    `\uE100<iid>\uE101<卡名>\uE102`，iid 必須是**那一張實體能量卡**的 iid。
//    只斷言「log 裡有這個名字」不夠：基本【草】能量全站幾十種印刷，純文字會被
//    splitCardNames 靠名字猜印刷，玩家點下去可能跳到別張。
//
// ⭐ HEAD-FAIL（Rule 41：不可整支 throw）：同一批斷言會拿 BASE_SHA(v6.333) 的 src
//    重新 build 一份再跑一次，要求**每一條都紅**，而且是逐條記錄，不是包一個 try 就算數。
// ⭐ 哨兵（Rule 23）：另有一條「填能 log 要含目標寶可夢卡名」的斷言，本版前後都該綠。
//    若連哨兵在 BASE 也紅 ⇒ BASE 那份根本沒跑起來（不是判準生效），整支報錯。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { hasBaseCommit, readBaseBlob, restoreBaseSubtree, shallowSkip } from './lib/base-blob.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'fec4b4eecf4d5062df8efed171d16693b0cf1277'; // v6.333（本版改動之前）

// ── 卡池（static/cards 本版沒動，兩份 build 共用）────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const GAS = '14129';      // 鬼斯（非規則基礎）
const S2 = '17971';       // 大竺葵（2 階進化，鳴依的勉勵用）
const SUP = '14019';      // 莉莉艾的決意（占位支援者）
const E_GRASS = '14102';  // 基本【草】能量
const E_LIGHT = '18520';  // 基本【雷】能量
const E_WATER = '18519';  // 基本【水】能量
const E_PRISM = '14852';  // 稜鏡能量（特殊能量）
const nameOf = id => pool.get(id).name;
const MK = (iid, id) => `\uE100${iid}\uE101${nameOf(id)}\uE102`;
const logStr = s => (s.log || []).map(l => (typeof l === 'string' ? l : (l.message || ''))).join('\n');
const tail = s => logStr(s).split('\n').slice(-3).join(' | ');

let _iid = 0;
const resetIid = () => { _iid = 0; };
const inst = (cid, e = {}) => ({ iid: `g${++_iid}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });
function ok(cond, msg) { if (!cond) throw new Error(msg); }

// ── build 一份引擎（srcRoot 指向工作樹的 src 或 BASE 解出來的 src）────────────
const STUB = join(ROOT, '.stub-v6334.js');
writeFileSync(STUB, 'export const base="";');
async function buildEngine(srcRoot, tag) {
  const posix = srcRoot.split('\\').join('/');
  const ent = join(ROOT, `.ent-v6334-${tag}.ts`);
  const out = join(ROOT, `.ent-v6334-${tag}.mjs`);
  writeFileSync(ent, `export { createGame, applyAction } from '${posix}/lib/game/engine';`);
  await build({
    entryPoints: [ent], outfile: out, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { '$lib': `${posix}/lib`, '$app/paths': STUB }, logLevel: 'error',
  });
  return import(pathToFileURL(out).href + `?t=${Date.now()}`);
}

function mkState(m, over = {}) {
  const s = m.createGame(
    { name: 'P1', entries: [{ cardId: SUP, count: 1 }] },
    { name: 'P2', entries: [{ cardId: SUP, count: 1 }] }, pool);
  const P = (p, o) => ({
    ...p, hand: [], deck: [inst(SUP)], discard: [], bench: [],
    prizes: Array.from({ length: 6 }, () => inst(SUP)), active: inst(GAS),
    energyAttachedThisTurn: false, ...o,
  });
  return {
    ...s, phase: 'playing', turnPhase: 'main', turn: 2, activePlayerIndex: 0,
    firstPlayerIdx: 0, isFirstTurn: false, setupDone: [true, true],
    pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [P(s.players[0], over.p1 || {}), P(s.players[1], over.p2 || {})],
  };
}
const resolve = (m, st, sel, selectedIids) =>
  m.applyAction({ ...st, pendingSelection: sel }, { type: 'RESOLVE_SELECTION', selectedIids }, pool);

const CASES = [
  { id: '⓪哨兵：填能 log 含目標寶可夢卡名', sentinel: true, run(m) {
    resetIid();
    const e = inst(E_GRASS);
    const st = mkState(m, { p1: { hand: [e] } });
    const t = st.players[0].active;
    const n = m.applyAction(st, { type: 'ATTACH_ENERGY', energyIid: e.iid, targetIid: t.iid }, pool);
    ok(logStr(n).includes(MK(t.iid, GAS)), '哨兵：log 應含目標 marker，log=' + tail(n));
  } },

  { id: '①手動填能（基本能量）', run(m) {
    resetIid();
    const e = inst(E_GRASS);
    const st = mkState(m, { p1: { hand: [e] } });
    const n = m.applyAction(st, { type: 'ATTACH_ENERGY', energyIid: e.iid, targetIid: st.players[0].active.iid }, pool);
    ok(logStr(n).includes(MK(e.iid, E_GRASS)), '填能 log 應含能量卡 marker（iid 要指向那一張），log=' + tail(n));
    ok(n.players[0].active.energyAttached.some(c => c.iid === e.iid), '能量應真的附上去了');
  } },

  { id: '②手動填能（特殊能量：稜鏡能量）', run(m) {
    resetIid();
    const e = inst(E_PRISM);
    const st = mkState(m, { p1: { hand: [e] } });
    const n = m.applyAction(st, { type: 'ATTACH_ENERGY', energyIid: e.iid, targetIid: st.players[0].active.iid }, pool);
    ok(logStr(n).includes(MK(e.iid, E_PRISM)), '特殊能量也要顯示卡名，log=' + tail(n));
  } },

  { id: '③真氣之拳 v312-attach-energy-to-active（多張頓號並列）', run(m) {
    resetIid();
    const a = inst(E_GRASS), b = inst(E_LIGHT);
    const st = mkState(m, { p1: { discard: [a, b] } });
    const n = resolve(m, st, { type: 'discard-search', actorIdx: 0, sourcePlayerIdx: 0,
      filter: 'BasicEnergy', minCount: 1, maxCount: 2,
      effectKey: 'v312-attach-energy-to-active', params: { label: '真氣之拳' } }, [a.iid, b.iid]);
    const lg = logStr(n);
    ok(lg.includes(MK(a.iid, E_GRASS)) && lg.includes(MK(b.iid, E_LIGHT)), '兩張能量卡名都要列出，log=' + tail(n));
    ok(lg.includes(`${MK(a.iid, E_GRASS)}、${MK(b.iid, E_LIGHT)}`), '多張要用頓號並列，log=' + tail(n));
  } },

  { id: '④能量支援 discard-energy-attach-bench-only（唯一備戰自動附）', run(m) {
    resetIid();
    const e = inst(E_GRASS), b = inst(GAS);
    const st = mkState(m, { p1: { discard: [e], bench: [b] } });
    const n = resolve(m, st, { type: 'discard-search', actorIdx: 0, sourcePlayerIdx: 0,
      filter: 'BasicEnergy', minCount: 1, maxCount: 1,
      effectKey: 'discard-energy-attach-bench-only', params: { label: '能量支援' } }, [e.iid]);
    ok(logStr(n).includes(MK(e.iid, E_GRASS)), '能量支援 log 應含能量卡名，log=' + tail(n));
  } },

  { id: '⑤能量支援 discard-energy-attach-commit-bench（多備戰選目標）', run(m) {
    resetIid();
    const e = inst(E_GRASS), b1 = inst(GAS), b2 = inst(GAS);
    const st = mkState(m, { p1: { discard: [e], bench: [b1, b2] } });
    const n = resolve(m, st, { type: 'bench-choose', actorIdx: 0, sourcePlayerIdx: 0,
      minCount: 1, maxCount: 1, effectKey: 'discard-energy-attach-commit-bench',
      params: { energyIids: [e.iid], label: '能量支援' } }, [b1.iid]);
    ok(logStr(n).includes(MK(e.iid, E_GRASS)), 'commit-bench log 應含能量卡名，log=' + tail(n));
  } },

  { id: '⑥能量車輪 energy-wheel-attach', run(m) {
    resetIid();
    const a = inst(E_GRASS), b = inst(E_LIGHT), bn = inst(GAS);
    const st = mkState(m, { p1: { bench: [bn] } });
    const n = resolve(m, st, { type: 'bench-choose', actorIdx: 0, sourcePlayerIdx: 0,
      minCount: 1, maxCount: 1, effectKey: 'energy-wheel-attach',
      params: { energies: [a, b] } }, [bn.iid]);
    const lg = logStr(n);
    ok(lg.includes(MK(a.iid, E_GRASS)) && lg.includes(MK(b.iid, E_LIGHT)), '能量車輪 log 應列出兩張能量卡名，log=' + tail(n));
  } },

  { id: '⑦附能+全回復 bench-hand-attach-fullheal-pick-energy', run(m) {
    resetIid();
    const e = inst(E_GRASS), bn = inst(GAS, { damage: 30 });
    const st = mkState(m, { p1: { hand: [e], bench: [bn] } });
    const n = resolve(m, st, { type: 'hand-discard', actorIdx: 0, sourcePlayerIdx: 0,
      filter: 'BasicEnergy', minCount: 1, maxCount: 1,
      effectKey: 'bench-hand-attach-fullheal-pick-energy',
      params: { label: '嫩葉之恩', validIids: [e.iid], benchValidIids: [bn.iid] } }, [e.iid]);
    ok(logStr(n).includes(MK(e.iid, E_GRASS)), '附能+全回復 log 應含能量卡名，log=' + tail(n));
  } },

  { id: '⑧親送花朵 deck-energy-attach-bench-pick-energy（原本 pool 沒傳進去）', run(m) {
    resetIid();
    const e = inst(E_GRASS), bn = inst(GAS);
    const st = mkState(m, { p1: { deck: [e, inst(SUP)], bench: [bn] } });
    const n = resolve(m, st, { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0,
      filter: 'Energy', minCount: 0, maxCount: 1,
      effectKey: 'deck-energy-attach-bench-pick-energy',
      params: { label: '親送花朵', validIids: [e.iid], benchTargets: [bn.iid] } }, [e.iid]);
    ok(logStr(n).includes(MK(e.iid, E_GRASS)), '親送花朵 log 應含能量卡名，log=' + tail(n));
  } },

  { id: '⑨鳴依的勉勵 naruei-encourage-pick-target（唯一 2 階自動附）', run(m) {
    resetIid();
    const e = inst(E_GRASS);
    const st = mkState(m, { p1: { discard: [e], active: inst(S2) } });
    const n = resolve(m, st, { type: 'discard-search', actorIdx: 0, sourcePlayerIdx: 0,
      filter: 'BasicEnergy', minCount: 1, maxCount: 1,
      effectKey: 'naruei-encourage-pick-target', params: {} }, [e.iid]);
    ok(logStr(n).includes(MK(e.iid, E_GRASS)), '鳴依的勉勵（自動）log 應含能量卡名，log=' + tail(n));
  } },

  { id: '⑩鳴依的勉勵 naruei-encourage-commit（第二條路徑）', run(m) {
    resetIid();
    const e = inst(E_GRASS), tgt = inst(S2);
    const st = mkState(m, { p1: { discard: [e], active: tgt } });
    const n = resolve(m, st, { type: 'heal-target', actorIdx: 0, sourcePlayerIdx: 0,
      minCount: 1, maxCount: 1, effectKey: 'naruei-encourage-commit',
      params: { energyIids: [e.iid], validIids: [tgt.iid] } }, [tgt.iid]);
    ok(logStr(n).includes(MK(e.iid, E_GRASS)), '鳴依的勉勵（commit）log 應含能量卡名，log=' + tail(n));
  } },

  { id: '⑪雷吉充能 j-2353-regi-self（原本只寫「N 張基本【水】能量」）', run(m) {
    resetIid();
    const a = inst(E_WATER), b = inst(E_WATER);
    const st = mkState(m, { p1: { discard: [a, b] } });
    const n = resolve(m, st, { type: 'discard-search', actorIdx: 0, sourcePlayerIdx: 0,
      filter: 'Energy:Water', minCount: 0, maxCount: 2,
      effectKey: 'j-2353-regi-self-雷吉艾斯ex-雷吉充能',
      params: { label: '雷吉充能', typeText: '【水】', validIids: [a.iid, b.iid] } }, [a.iid, b.iid]);
    const lg = logStr(n);
    ok(lg.includes(MK(a.iid, E_WATER)) && lg.includes(MK(b.iid, E_WATER)), '雷吉充能 log 應列出能量卡名，log=' + tail(n));
  } },
];

function runAll(m) {
  const r = new Map();
  for (const c of CASES) {
    try { c.run(m); r.set(c.id, { pass: true, msg: '' }); }
    catch (e) { r.set(c.id, { pass: false, msg: e.message }); }
  }
  return r;
}

let fail = 0;
const head = await buildEngine(join(ROOT, 'src'), 'head');
const hr = runAll(head);
console.log('── 本版（工作樹）──');
for (const c of CASES) {
  const v = hr.get(c.id);
  if (v.pass) console.log('PASS', c.id);
  else { console.log('FAIL', c.id, '::', v.msg); fail++; }
}

console.log('── HEAD-FAIL（BASE ' + BASE_SHA.slice(0, 8) + '）──');
// ⭐ v6.263 規範：讀歷史一律走中央 helper scripts/lib/base-blob.mjs
//   （拿不到歷史時大聲 shallowSkip 並登記，絵不 fail-open 成靜默全綠）。
//   BASE 樹的重建法：把**本版動過的那幾個檔**換成 BASE blob，其餘與工作樹相同 ——
//   本版只動這 5 個檔，所以這棵樹在語意上等同 BASE 的 src。
//   ⚠ 若日後這份清單漏列了某個檔，BASE 樹會與工作樹相同 ⇒ 下面「每一條都要紅」會自己翻紅，
//     不會靜默失效。
const CHANGED = [
  'src/lib/game/effects.ts',
  'src/lib/game/effects/cards/abra_mawile_deck.ts',
  'src/lib/game/effects/cards/draw_supporters.ts',
  'src/lib/game/effects/cards/v2353_j_mark_batch.ts',
  'src/lib/game/engine.ts',
];
let tmp = null, baseSrc = null;
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip(`v6.334 HEAD-FAIL（BASE ${BASE_SHA.slice(0, 8)} 的 11 條逐條對照）`,
    '這個 checkout 沒有 BASE 那顆 commit（淺複製）');
} else {
  tmp = mkdtempSync(join(tmpdir(), 'v6334-base-'));
  cpSync(join(ROOT, 'src'), join(tmp, 'src'), { recursive: true });
  // ⭐ v6.343 harness 修正：只換 effects.ts 會與 HEAD 的卡檔不相容 ——
  //   HEAD 的卡檔可能 `import { 新helper } from '../../effects'`，而 BASE 的 effects.ts
  //   還沒有那個符號 ⇒ esbuild build failed ⇒ 整支守衛爆掉（紅在 harness，不是判準）。
  //   ⇒ 整個 src/lib/game/effects 子樹一起換回 BASE（含刪掉 BASE 沒有的新卡檔）才自洽。
  //   ⚠ pathspec `src/lib/game/effects` 只涵蓋**目錄**，不含 `effects.ts`；
  //     effects.ts 仍由下面 CHANGED 的逐檔清單換回 BASE blob。
  const sub = restoreBaseSubtree(ROOT, BASE_SHA, join(tmp, 'src'), 'src/lib/game/effects');
  console.log(`  [BASE 子樹] src/lib/game/effects：換回 ${sub.replaced} 檔、刪除 ${sub.removed} 檔（BASE 沒有的）`);
  if (!sub.ok) { console.log('FAIL BASE 子樹重建失敗（harness 壞了，不可以當成「BASE 是紅的」）::', sub.reason); fail++; }
  let miss = 0;
  for (const rel of CHANGED) {
    const r = readBaseBlob(ROOT, BASE_SHA, rel);
    if (!r.ok) { miss++; continue; }
    writeFileSync(join(tmp, rel.split('/').join(sep)), r.out, 'utf8');
  }
  if (miss) shallowSkip('v6.334 HEAD-FAIL', `取不到 ${miss} 個 BASE blob`);
  else if (sub.ok) baseSrc = join(tmp, 'src');
}
if (baseSrc) {
  const base = await buildEngine(baseSrc, 'base');
  const br = runAll(base);
  const sentinel = CASES.find(c => c.sentinel);
  const sv = br.get(sentinel.id);
  if (!sv.pass) {
    console.log('FAIL 哨兵在 BASE 也紅 ⇒ BASE 那份根本沒跑起來，整扴「紅」不算數 ::', sv.msg);
    fail++;
  } else {
    console.log('PASS 哨兵在 BASE 是綠的（BASE build 確實跑得起來）');
    for (const c of CASES) {
      if (c.sentinel) continue;
      const v = br.get(c.id);
      if (v.pass) { console.log('FAIL HEAD-FAIL 沒紅（BASE 也通過 ⇒ 這條斷言抓不到本版改動）', c.id); fail++; }
      else console.log('PASS HEAD-FAIL 有紅', c.id);
    }
  }
}
if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } }

console.log(`\n=== FAILED=${fail} ===`);
process.exit(fail ? 1 : 0);
