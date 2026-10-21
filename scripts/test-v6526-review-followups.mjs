#!/usr/bin/env node
/**
 * v6.526 守衛：補審 v6.518～v6.521 後的修正（站長 2026-10-11：「最近的更新是否都有經過審查？……一定都要審查」）。
 *
 * Fable 5.1 補審（無 P1）：
 *   F3 v6.519 大力捕捉器：可以選化隱／光之翼的備戰、但不會互換（pending 帶 immuneIids）——
 *      ①AI 不認 immuneIids，退回「剩餘 HP 最少」時可能選到它、白白浪費特性；②選擇視窗沒標示哪隻選了也不會互換。
 *   F4 v6.518 接手建局的計時器：只在 onDestroy 清，換房／離開房間不清（觸發時冪等重判，現況無害；避免日後加副作用出事）。
 *
 * 【A】實跑引擎＋AI：大力捕捉器的選擇裡，化隱那隻是剩餘 HP 最少的 ⇒ AI 必須選另一隻；全部都不受影響時仍要選一隻（不卡住）
 * 【U】選擇視窗：selImmuneIids 從 pendingSelection.params.immuneIids 來、候選卡上標「🛡 不受影響」
 * 【T】startRoomSubscription 與 leaveOnlineGame 一開始就清掉 _startGraceTimer
 * 【H】BASE（v6.525）：A1、U、T 逐條紅
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
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.525。
const BASE_SHA = 'bb15549e';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n) => { for (const c of pool.values()) if (c.name === n) return String(c.id); return null; };
const withAbility = (cardName, abName) => { for (const c of pool.values()) if (c.name === cardName && (c.abilities || []).some((a) => a.name === abName)) return String(c.id); return null; };
const ID = { W: byName('基本【水】能量'), filler: '19178', hariyama: withAbility('鐵掌力士', '大力捕捉器'), sinistea: withAbility('斯魔茶', '化隱'), makuhita: byName('幕下力士') };
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6526-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, `export { applyAction, createGame } from '${join(srcRoot, 'src/lib/game/engine').replace(/\\/g, '/')}';\n`
    + `export { getAIAction } from '${join(srcRoot, 'src/lib/game/ai').replace(/\\/g, '/')}';\nimport '${join(srcRoot, 'src/lib/game/effects').replace(/\\/g, '/')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const en = (k) => Array.from({ length: k }, () => inst(ID.W));
  const mk = (b1) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    const base = inst(ID.makuhita), evo = inst(ID.hariyama);
    return { st: { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [evo], deck: en(10), discard: [], prizes: en(6), bench: [], active: base },
        { ...s.players[1], hand: [], deck: en(10), discard: [], prizes: en(6), bench: b1, active: inst(ID.filler) },
      ] }, base, evo };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  // 進化觸發大力捕捉器，走到 opp-bench-choose（中間的「是否發動」modal 一律答是）
  const toGust = (b1) => {
    const { st, base, evo } = mk(b1);
    let s = act(st, { type: 'EVOLVE', fromIid: base.iid, toIid: evo.iid });
    let g = 0;
    while (s.pendingSelection && s.pendingSelection.type === 'modal-choice' && g++ < 4) {
      const ps = s.pendingSelection;
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: ['yes'], actorIdx: ps.actorIdx ?? 0, pendingToken: ps.token });
    }
    return s;
  };
  const out = {};
  try {
    // A1：化隱（斯魔茶）受重傷、剩餘 HP 最少；另一隻滿血 ⇒ 應選另一隻
    const smt = inst(ID.sinistea, { damage: 20 }), oth = inst(ID.filler);
    const s1 = toGust([smt, oth]);
    const ps = s1.pendingSelection;
    const im = ps && ps.params && Array.isArray(ps.params.immuneIids) ? ps.params.immuneIids : [];
    const a1 = ps ? M.getAIAction(s1, pool, 0) : null;
    out.A1 = { type: ps && ps.type, immune: im.includes(smt.iid), pick: a1 && a1.selectedIids, smt: smt.iid, oth: oth.iid };
    // A2：唯一的備戰就是化隱 ⇒ 仍要選一隻（不卡住）
    const smt2 = inst(ID.sinistea);
    const s2 = toGust([smt2]);
    const a2 = s2.pendingSelection ? M.getAIAction(s2, pool, 0) : null;
    out.A2 = { type: s2.pendingSelection && s2.pendingSelection.type, pick: a2 && a2.selectedIids, smt: smt2.iid };
  } catch (e) { out.err = e.message; }
  return out;
}
const judgeA = (r) => ({
  A1: !!r.A1 && r.A1.type === 'opp-bench-choose' && r.A1.immune === true && JSON.stringify(r.A1.pick) === JSON.stringify([r.A1.oth]),
  A2: !!r.A2 && r.A2.type === 'opp-bench-choose' && JSON.stringify(r.A2.pick) === JSON.stringify([r.A2.smt]),
});
function judgeSrc(P) {
  const fnHead = (name, n) => { const i = P.indexOf('function ' + name + '('); return i < 0 ? '' : P.slice(i, i + n); };
  return {
    U: /const selImmuneIids = \$derived\(new Set<string>\(Array\.isArray\(pendingSelection\?\.params\?\.immuneIids\)/.test(P)
      && /\{#if selImmuneIids\.has\(item\.iid\)\}<span class="sel-immune"[^>]*>🛡 不受影響<\/span>\{\/if\}/.test(P),
    T: /^function startRoomSubscription\(\) \{\n(\s*\/\/[^\n]*\n)*\s*if \(typeof _startGraceTimer !== 'undefined' && _startGraceTimer !== null\) \{ clearTimeout\(_startGraceTimer\); _startGraceTimer = null; \}/.test(fnHead('startRoomSubscription', 500))
      && /^function leaveOnlineGame\(\) \{\n(\s*\/\/[^\n]*\n)*\s*if \(typeof _startGraceTimer !== 'undefined' && _startGraceTimer !== null\) \{ clearTimeout\(_startGraceTimer\); _startGraceTimer = null; \}/.test(fnHead('leaveOnlineGame', 500)),
  };
}

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), HJ = judgeA(H);
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
const HS = judgeSrc(PAGE);
if (H.err) console.log('實跑錯誤：' + H.err);
ok('★★★[A1] 大力捕捉器：化隱那隻剩餘 HP 最少，AI 仍選會互換的另一隻', HJ.A1, JSON.stringify(H.A1));
ok('★★[A2] 唯一的備戰就是化隱：AI 仍選它（不卡住；正對照：A1 不是「永遠不選第一隻」）', HJ.A2, JSON.stringify(H.A2));
ok('★★[U] 選擇視窗標示「🛡 不受影響」（來源是 pending 的 immuneIids）', HS.U);
ok('★★[T] 換房（startRoomSubscription）與離開房間（leaveOnlineGame）一開始就清掉接手建局計時器', HS.T);

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6526b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src"], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judgeA(B);
    const BS = judgeSrc(readFileSync(join(tmp, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n'));
    ok('★★★[H1] v6.525：A1、U、T 逐條紅（A2 兩版都對，是正對照）', !BJ.A1 && BJ.A2 && !BS.U && !BS.T && !B.err, JSON.stringify({ BJ, B, BS }));
  } catch (e) { ok('★★★[H1] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6526 H', '需要 v6.525 commit');

console.log(`\n=== v6.526 補審修正：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
