#!/usr/bin/env node
/**
 * v6.520 守衛：官方 Q&A 比對第二批（昏厥結算的兩條判例；站長 2026-10-10 裁定照官方）。
 *
 * 【A】R011 密勒頓｜光子纜線：被頭蓋龍｜推倒打到致死、再被換到備戰區才昏厥 ⇒ 仍然發動
 *      （官方：受到傷害時在戰鬥場；同 PTCG_RULES 甲殼刺判例）
 * 【B】R102 傳說的山頂在場，念力土偶｜退化光線沒打倒銃嘴大鳥、退化成喇叭啄鳥後才昏厥 ⇒ 獎賞卡不會減少（拿 1 張）
 *      對照：同一招的傷害當下就打倒 ⇒ 山頂照樣 −1（拿 0 張）
 *      ⚠ 推翻站長 2026-10-06 的 v6.490 裁定（古舊能量版本同理，見 test-v6490 G12 的 Rule 40 調整）
 * 【C】R063 延伸：混亂的寶可夢帶重試徽章用機關槍合擊 ⇒ 混亂那一枚不被重試徽章重擲、保留時也不吃掉招式的硬幣
 *      保留（混亂正、招式 正反）＝ 250；重擲時招式從頭擲、不會重擲混亂（不會變成自傷 30、攻擊失敗）
 * 【H】HEAD-FAIL：同樣盤面餵 v6.519 的引擎逐條紅
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.519。
const BASE_SHA = 'f5a5e591';
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
const ID = { kanga: '14071', badge: '19218', W: byName('基本【水】能量'), L: byName('基本【雷】能量'), F: byName('基本【鬥】能量'), miraidon: '19171', cranidos: '19186', snorlax: '12537', grass: '19147',
  doll: '18467', toucannon: '19210', trumbeak: '19209', peak: '19622', spearow: '14009' };
ID.pikipek = pool.get(ID.trumbeak)?.evolvesFrom ? byName(pool.get(ID.trumbeak).evolvesFrom) : null;
const missing = Object.entries(ID).filter(([k, v]) => !v || !pool.has(String(v)) && k !== 'peak').map(([k]) => k);

// ── 打包引擎（HEAD 或 BASE 的 src 樹）──
async function loadEngine(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6520-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, `export { applyAction, createGame, getUsableAbilities } from '${join(srcRoot, 'src/lib/game/engine').replace(/\\/g, '/')}';\nimport '${join(srcRoot, 'src/lib/game/effects').replace(/\\/g, '/')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}


function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'q' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const mk = (me, opp, extra = {}) => ({ phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], log: [], pendingSelection: null, stadiumPlayedThisTurn: [false, false], stadiumUsedThisTurn: [false, false],
    players: [{ name: 'P1', active: null, bench: [], hand: [], deck: [inst(ID.F), inst(ID.F)], discard: [], prizes: [inst(ID.F), inst(ID.F), inst(ID.F)], ...me },
              { name: 'P2', active: null, bench: [], hand: [], deck: [inst(ID.F), inst(ID.F)], discard: [], prizes: [inst(ID.F), inst(ID.F), inst(ID.F)], ...opp }], ...extra });
  const act = (s, a) => M.applyAction(s, a, pool);
  const msgs = (s) => (s.log || []).map((l) => String(l?.message ?? l));
  const out = {};
  try {
    // A：P2 的頭蓋龍推倒 P1 的密勒頓（60 傷害、2 雷）；P1 選卡比獸上場 ⇒ 密勒頓在備戰區昏厥
    const mil = inst(ID.miraidon, { damage: 60, energyAttached: [inst(ID.L), inst(ID.L)] }), g = inst(ID.grass), sx = inst(ID.snorlax);
    let s = mk({ active: mil, bench: [g, sx] }, { active: inst(ID.cranidos, { energyAttached: [inst(ID.F), inst(ID.F)] }) }, { activePlayerIndex: 1 });
    s = act(s, { type: 'ATTACK', attackIndex: 0, actorIdx: 1 });
    let guard = 0, photon = false;
    while (s.pendingSelection && guard++ < 6) {
      const ps = s.pendingSelection;
      let sel;
      if (ps.params?.label === '光子纜線' || /光子纜線/.test(ps.prompt || '')) { photon = true; sel = (ps.params?.validIids ?? []).slice(0, ps.maxCount || 2); }
      else if (/swap|force/.test(ps.effectKey || '')) sel = [sx.iid];          // 推倒：由被打的一方選上場的寶可夢 ⇒ 卡比獸
      else if (ps.effectKey === 'm5-mirieton-photon-code') sel = [g.iid];     // 光子纜線第二步：改附給偽螳草
      else sel = (ps.params?.validIids ?? []).slice(0, Math.max(1, ps.minCount || 0));
      if (ps.type === 'modal-choice') sel = [(ps.params?.options ?? [])[0]?.id ?? 'yes'];
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: sel, actorIdx: ps.actorIdx ?? ps.playerIdx ?? 0, pendingToken: ps.token, senderIdx: ps.actorIdx });
    }
    const lEnergyOnBench = s.players[0].bench.reduce((k, b) => k + (b.energyAttached || []).filter((e) => e.cardId === ID.L).length, 0)
      + ((s.players[0].active?.energyAttached || []).filter((e) => e.cardId === ID.L).length);
    out.A = { photon, milGone: !s.players[0].bench.some((b) => b.iid === mil.iid) && s.players[0].active?.iid !== mil.iid,
      lMoved: lEnergyOnBench, log: msgs(s).some((m) => /光子纜線/.test(m)) };
  } catch (e) { out.Aerr = e.message; }
  try {
    // B：退化光線打銃嘴大鳥（進化堆疊：基礎＋喇叭啄鳥）
    const run = (peak, dmg) => {
      const top = inst(ID.toucannon, { damage: dmg, evolvedFromStack: [inst(ID.pikipek), inst(ID.trumbeak)] });
      const s = mk({ active: inst(ID.doll, { energyAttached: [inst(ID.F)] }) }, { active: top, bench: [inst(ID.spearow)] },
        peak ? { activeStadium: inst(ID.peak), activeStadiumPartner: inst(ID.peak + '-1'), activeStadiumOwnerIdx: 1 } : {});
      let r = act(s, { type: 'ATTACK', attackIndex: 0 });
      let g = 0; while (r.pendingSelection && g++ < 4) { const ps = r.pendingSelection; r = act(r, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: (ps.params?.validIids ?? []).slice(0, Math.max(1, ps.minCount || 0)), actorIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); }
      const taken = 3 - r.players[0].prizes.length + (r.pendingPrizes?.[0] ?? 0) * 0;
      return { taken, ko: !r.players[1].active || r.players[1].active.iid !== top.iid, sweep: msgs(r).some((m) => /系統擊倒檢查/.test(m)) };
    };
    out.B1 = run(true, 80);    // 80＋20＝100：銃嘴大鳥 150 沒倒；退化成喇叭啄鳥（90）後昏厥
    out.B2 = run(false, 80);
    out.B3 = run(true, 130);   // 130＋20＝150：傷害當下就打倒 ⇒ 山頂 −1
  } catch (e) { out.Berr = e.message; }
  try {
    // C：重試徽章 × 混亂（以固定的 Math.random 序列擲幣：<0.5＝正面）
    const runC = (seq, choice) => {
      const orig = Math.random; let i = 0;
      Math.random = () => { const v = seq[i++]; return v === undefined ? 0.9 : (v === 'H' ? 0.1 : 0.9); };
      try {
        const me = inst(ID.kanga, { toolAttached: inst(ID.badge), status: 'confused', energyAttached: [inst(ID.W), inst(ID.W), inst(ID.W)] });
        let s = mk({ active: me }, { active: inst(ID.kanga) });
        s = act(s, { type: 'ATTACK', attackIndex: 0 });
        const ps = s.pendingSelection;
        if (!ps || ps.effectKey !== 'm5-retry-badge-decide') return { noModal: true, key: ps?.effectKey };
        s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: [choice], actorIdx: 0, pendingToken: ps.token });
        return { self: s.players[0].active?.damage ?? 'KO', opp: s.players[1].active?.damage ?? 'KO' };
      } finally { Math.random = orig; }
    };
    out.C1 = runC(['H', 'H', 'T'], 'keep');            // 混亂正；招式 正、反 ⇒ 250
    out.C2 = runC(['H', 'H', 'T', 'T'], 'retry');      // 重擲：招式從頭擲（反）⇒ 200，不可以把混亂重擲成反面
  } catch (e) { out.Cerr = e.message; }
  return out;
}
const judge = (r) => ({
  C: !!r.C1 && r.C1.opp === 250 && r.C1.self === 0 && !!r.C2 && r.C2.opp === 200 && r.C2.self === 0,
  A: !!r.A && r.A.photon === true && r.A.milGone && r.A.lMoved === 2 && r.A.log,
  B: !!r.B1 && r.B1.ko && r.B1.taken === 1 && r.B2.taken === 1 && r.B3.ko && r.B3.taken === 0 && !r.B1.sweep,
});

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await loadEngine(ROOT);
const H = scenarios(HM), J = judge(H);
console.log('實測：' + JSON.stringify(H));
ok('★★★[A] 密勒頓被推倒換到備戰區後昏厥 ⇒ 光子纜線照樣發動（2 個雷能量改附到備戰）', J.A, JSON.stringify([H.A, H.Aerr]));
ok('★★★[C] 重試徽章不重擲混亂的硬幣：保留 ⇒ 250、重擲 ⇒ 招式重擲為 200，兩者都沒有自傷', J.C, JSON.stringify([H.C1, H.C2, H.Cerr]));
ok('★★★[B] 山頂在場、退化後才昏厥 ⇒ 拿 1 張（不減少）；沒有山頂也是 1 張；對照：傷害當下打倒 ⇒ 山頂 −1 拿 0 張；不走 sanityKOSweep 簡化版', J.B, JSON.stringify([H.B1, H.B2, H.B3, H.Berr]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6520b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const B = scenarios(await loadEngine(tmp)), BJ = judge(B);
    ok('★★★[H1] v6.519：A、B、C 逐條紅（而且不是例外）', !BJ.A && !BJ.B && !BJ.C && !B.Aerr && !B.Berr && !B.Cerr, JSON.stringify({ BJ, B }));
  } catch (e) { ok('★★★[H1] BASE 引擎可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6520 H', '需要 v6.519 commit');

console.log(`\n=== v6.520 官方 Q&A 第二批（昏厥結算＋重試徽章）：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
