#!/usr/bin/env node
/**
 * v6.522 守衛：防止昏厥（倖存鍛鍊器＋結實／勤奮之心／堅忍之軀／不朽身軀）的**套用只有一份**
 *   （站長 2026-10-10：「把兩份防止昏厥的套用程式碼合成一份」）。
 *
 * 【S】結構：engine.ts 不再自己查 TOOL_PREVENT_KO／PASSIVE_PREVENT_KO（剝註解後零次）；
 *      effects.ts 各只剩一處 .get(（firstPreventKoTool／preventKoAbilityList），engine 與 applyPreventKOToVictim 都呼叫 applyPreventKo(
 * 【A】行為零回歸：同一批盤面餵 HEAD 與 BASE（v6.521）兩顆引擎，逐案比對結果
 *      （主管線 ATTACK：防守方 damage／道具／棄牌區／damageTakenLastOppTurn／獎賞張數／log；
 *        狙擊路徑 applyPreventKOToVictim：同上，但 log 扣掉本版新增的道具丟棄那一行）
 *      盤面：倖存鍛鍊器單獨、結實單獨、堅忍之軀正／反、不朽身軀正／反、兩者衝突選先道具／先特性、
 *            阻礙之塔讓道具失效、備戰位（狙擊路徑）倖存鍛鍊器／結實、沒有任何防昏厥的對照
 * 【N】新行為：狙擊路徑用掉倖存鍛鍊器時也印「🔧 倖存鍛鍊器 已丟棄到棄牌區」（v5.518 主管線早就有，狙擊路徑漏印）
 * 【H】HEAD-FAIL：BASE 的 S、N 逐條紅（A 是零回歸比對，本來就要兩邊一樣）
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.521。
const BASE_SHA = 'ded8e4c5';
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
// 卡號實查：瑪力露麗 11106（捨身衝撞 230）、福祿果（超屬性 −60 果實）、棄世猴 19183（不朽身軀 HP150）、岩殿居蟹 13741（結實 HP150）、超級摔角鷹人ex 14754（堅忍之軀 HP250）、
//   赫普的卡比獸 12537（HP150、無防昏厥特性）、倖存鍛鍊器 10306、阻礙之塔 15970、密勒頓 9893（閃雷攻擊 160）
const ID = { mari: '11106', berry: byName('福祿果'), monkey: '19183', crab: '13741', hawl: '14754', snorlax: '12537', trainer: '10306', tower: '15970', mira: '9893',
  L: byName('基本【雷】能量'), P: byName('基本【超】能量'), F: byName('基本【鬥】能量') };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.has(String(v))).map(([k]) => k);

async function loadEngine(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6522-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const r = (p) => join(srcRoot, p).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction } from '${r('src/lib/game/engine')}';\nexport * as EFF from '${r('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
function withFlips(seq, fn) {
  const orig = Math.random; let i = 0;
  Math.random = () => { const v = seq[i++]; return v === 'H' ? 0.1 : 0.9; };
  try { return fn(); } finally { Math.random = orig; }
}
const DISCARD_LOG = /🔧 .*倖存鍛鍊器.* 已丟棄到棄牌區/;

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'q' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const mk = (me, opp, extra = {}) => ({ phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], log: [], pendingSelection: null, stadiumPlayedThisTurn: [false, false], stadiumUsedThisTurn: [false, false],
    players: [{ name: 'P1', active: null, bench: [], hand: [], deck: [inst(ID.F), inst(ID.F)], discard: [], prizes: [inst(ID.F), inst(ID.F), inst(ID.F)], ...me },
              { name: 'P2', active: null, bench: [inst(ID.snorlax)], hand: [], deck: [inst(ID.F), inst(ID.F)], discard: [], prizes: [inst(ID.F), inst(ID.F), inst(ID.F)], ...opp }], ...extra });
  const msgs = (s) => (s.log || []).map((l) => String(l?.message ?? l).replace(/[^]*/g, '').replace(/[]/g, ''));
  const snapOf = (s, iid, dropDiscardLog) => {
    const p = s.players[1]; const v = p.active?.iid === iid ? p.active : p.bench.find((b) => b.iid === iid);
    return { alive: !!v, dmg: v?.damage ?? null, taken: v?.damageTakenLastOppTurn ?? null,
      tool: v?.toolAttached?.cardId ?? null, discard: p.discard.map((c) => c.cardId).join(','),
      prizes: s.players[0].prizes.length, pending: s.pendingSelection?.effectKey ?? null, phase: s.turnPhase,
      log: msgs(s).filter((m) => !(dropDiscardLog && DISCARD_LOG.test(m))).join(' | ') };
  };
  const out = {};
  const towerExtra = () => ({ activeStadium: inst(ID.tower), activeStadiumOwnerIdx: 1 });
  // 主管線：密勒頓（閃雷攻擊 160）打防守方戰鬥寶可夢；衝突時回答 choice
  const main = (key, holder, { tool = false, dmg = 0, flips = [], choice = 'tool', extra = {} } = {}) => {
    try {
      out[key] = withFlips(flips, () => {
        const v = inst(holder, { damage: dmg, ...(tool ? { toolAttached: inst(ID.trainer) } : {}) });
        let s = mk({ active: inst(ID.mira, { energyAttached: [inst(ID.L), inst(ID.L), inst(ID.P)] }) }, { active: v }, typeof extra === 'function' ? extra() : extra);
        s = M.applyAction(s, { type: 'ATTACK', attackIndex: 1 }, pool);
        let g = 0;
        while (s.pendingSelection && g++ < 3) {
          const ps = s.pendingSelection;
          const sel = ps.effectKey === 'v6521-prevent-ko-order' ? [choice] : (ps.params?.validIids ?? []).slice(0, Math.max(1, ps.minCount || 0));
          s = M.applyAction(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: sel, actorIdx: ps.actorIdx, pendingToken: ps.token, senderIdx: ps.actorIdx }, pool);
        }
        return snapOf(s, v.iid, false);
      });
    } catch (e) { out[key] = { err: e.message }; }
  };
  // 狙擊路徑：直呼 applyPreventKOToVictim（active／bench）
  const snipe = (key, holder, { tool = false, bench = false, flips = [], extra = {}, dmg = 200 } = {}) => {
    try {
      out[key] = withFlips(flips, () => {
        const v = inst(holder, tool ? { toolAttached: inst(ID.trainer) } : {});
        const s = mk({ active: inst(ID.mira) }, bench ? { active: inst(ID.snorlax), bench: [v] } : { active: v }, typeof extra === 'function' ? extra() : extra);
        const r = M.EFF.applyPreventKOToVictim(s, v, pool.get(holder), 1, dmg, pool, 'attack-damage');
        return { prevented: r.prevented, ...snapOf(r.state, v.iid, true), discardLog: msgs(r.state).some((m) => DISCARD_LOG.test(m)) };
      });
    } catch (e) { out[key] = { err: e.message }; }
  };
  main('m_tool', ID.snorlax, { tool: true });
  main('m_crab', ID.crab);
  main('m_crab_hurt', ID.crab, { dmg: 10 });             // 結實要滿血 ⇒ 不防
  main('m_hawl_H', ID.hawl, { dmg: 100, flips: ['H'] });
  main('m_hawl_T', ID.hawl, { dmg: 100, flips: ['T'] });
  main('m_monkey_H', ID.monkey, { flips: ['H'] });
  main('m_monkey_T', ID.monkey, { flips: ['T'] });
  main('m_both_tool', ID.monkey, { tool: true, flips: ['H'], choice: 'tool' });
  main('m_both_abH', ID.monkey, { tool: true, flips: ['H'], choice: 'ability' });
  main('m_both_abT', ID.monkey, { tool: true, flips: ['T'], choice: 'ability' });
  main('m_crab_tool', ID.crab, { tool: true, choice: 'ability' });   // 結實（非擲幣）＋道具，選先特性 ⇒ 道具留著
  main('m_tower', ID.snorlax, { tool: true, extra: towerExtra });     // 阻礙之塔 ⇒ 道具失效 ⇒ 昏厥
  main('m_none', ID.snorlax);
  // 果實減傷先丟、再防昏厥（KO 判定前 defenderState 已被改過的情境）
  const berry = (key, holder, tools, flips) => {
    try {
      out[key] = withFlips(flips, () => {
        const v = inst(holder, tools());
        let s = mk({ active: inst(ID.mari, { energyAttached: [inst(ID.P), inst(ID.P), inst(ID.P), inst(ID.P)] }) }, { active: v });
        s = M.applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool);
        let g = 0;
        while (s.pendingSelection && g++ < 3) {
          const ps = s.pendingSelection;
          const sel = ps.effectKey === 'v6521-prevent-ko-order' ? ['tool'] : (ps.params?.validIids ?? []).slice(0, Math.max(1, ps.minCount || 0));
          s = M.applyAction(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: sel, actorIdx: ps.actorIdx, pendingToken: ps.token, senderIdx: ps.actorIdx }, pool);
        }
        const snap = snapOf(s, v.iid, false);
        return { ...snap, extra: (s.players[1].active?.extraTools ?? []).map((t) => t.cardId).join(',') };
      });
    } catch (e) { out[key] = { err: e.message }; }
  };
  berry('b_crab', ID.crab, () => ({ toolAttached: inst(ID.berry) }), []);
  berry('b_snorlax_trainer', ID.snorlax, () => ({ toolAttached: inst(ID.berry), extraTools: [inst(ID.trainer)] }), []);
  berry('b_monkey_H', ID.monkey, () => ({ toolAttached: inst(ID.berry) }), ['H']);
  berry('b_monkey_T', ID.monkey, () => ({ toolAttached: inst(ID.berry) }), ['T']);
  snipe('s_tool', ID.snorlax, { tool: true });
  snipe('s_tool_bench', ID.snorlax, { tool: true, bench: true });
  snipe('s_crab_bench', ID.crab, { bench: true });
  snipe('s_monkey_H', ID.monkey, { flips: ['H'] });
  snipe('s_monkey_T', ID.monkey, { flips: ['T'] });
  snipe('s_both_H', ID.monkey, { tool: true, flips: ['H'] });
  snipe('s_both_T', ID.monkey, { tool: true, flips: ['T'] });
  snipe('s_tower', ID.snorlax, { tool: true, extra: towerExtra });
  snipe('s_none', ID.snorlax);
  return out;
}
function structural(srcRoot) {
  const eng = stripCommentsBlankChecked(readFileSync(join(srcRoot, 'src/lib/game/engine.ts'), 'utf8'));
  const eff = stripCommentsBlankChecked(readFileSync(join(srcRoot, 'src/lib/game/effects.ts'), 'utf8'));
  const cnt = (t, re) => (t.match(re) || []).length;
  return {
    engGets: cnt(eng, /\b(TOOL_PREVENT_KO|PASSIVE_PREVENT_KO)\.get\(/g),
    effTool: cnt(eff, /\bTOOL_PREVENT_KO\.get\(/g), effPassive: cnt(eff, /\bPASSIVE_PREVENT_KO\.get\(/g),
    engCalls: cnt(eng, /\bapplyPreventKo\(/g), effCalls: cnt(eff, /\bapplyPreventKo\(/g),
  };
}

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const H = scenarios(await loadEngine(ROOT));
console.log('HEAD 實測：' + JSON.stringify(H));

console.log('【S】結構');
const HS = structural(ROOT);
ok('★★★[S1] engine.ts 剝註解後不再自己查 TOOL_PREVENT_KO／PASSIVE_PREVENT_KO', HS.engGets === 0, JSON.stringify(HS));
ok('★★★[S2] effects.ts 各只剩一處查表（共用 helper），engine 與狙擊路徑都呼叫 applyPreventKo(',
  HS.effTool === 1 && HS.effPassive === 1 && HS.engCalls === 1 && HS.effCalls >= 2, JSON.stringify(HS));

console.log('\n【P】前提（盤面真的有走到防昏厥；否則零回歸比對是空真）');
ok('★★[P1] 主管線：倖存鍛鍊器／結實／堅忍之軀正面／不朽身軀正面都保住（剩 10），對照組（無、阻礙之塔、結實帶傷、反面）都昏厥',
  H.m_tool?.alive && H.m_tool.dmg === 140 && H.m_crab?.alive && H.m_hawl_H?.alive && H.m_hawl_H.dmg === 240 && H.m_monkey_H?.alive
  && !H.m_none?.alive && !H.m_tower?.alive && !H.m_crab_hurt?.alive && !H.m_hawl_T?.alive && !H.m_monkey_T?.alive
  && H.m_both_abH?.tool === ID.trainer && H.m_both_abT?.alive && !H.m_both_abT.tool && H.m_crab_tool?.tool === ID.trainer, JSON.stringify(H));
ok('★★[P2] 狙擊路徑：道具（戰鬥／備戰）、結實（備戰）、不朽身軀正面、兩者都有（正面道具留著、反面用道具）都保住；無／阻礙之塔／反面不保',
  H.s_tool?.prevented && H.s_tool_bench?.prevented && H.s_crab_bench?.prevented && H.s_monkey_H?.prevented
  && H.s_both_H?.prevented && H.s_both_H.tool === ID.trainer && H.s_both_T?.prevented && !H.s_both_T.tool
  && !H.s_none?.prevented && !H.s_tower?.prevented && !H.s_monkey_T?.prevented, JSON.stringify(H));

ok('★★★[P3] 果實減傷（福祿果）先丟、仍致死再被防昏厥保住 ⇒ 福祿果留在棄牌區（結實／倖存鍛鍊器在多重道具／不朽身軀正面）；反面昏厥的對照也在',
  H.b_crab?.alive && H.b_crab.discard === ID.berry
  && H.b_snorlax_trainer?.alive && H.b_snorlax_trainer.discard.split(',').sort().join(',') === [ID.berry, ID.trainer].sort().join(',')
  && H.b_monkey_H?.alive && H.b_monkey_H.discard === ID.berry
  && !H.b_monkey_T?.alive && H.b_monkey_T.discard.split(',').includes(ID.berry), JSON.stringify([H.b_crab, H.b_snorlax_trainer, H.b_monkey_H, H.b_monkey_T]));

console.log('\n【N】新行為');
ok('★★[N1] 狙擊路徑用掉倖存鍛鍊器 ⇒ 印出道具丟棄 log（戰鬥位、備戰位、兩者都有的反面）；沒用掉的不印',
  H.s_tool?.discardLog === true && H.s_tool_bench?.discardLog === true && H.s_both_T?.discardLog === true
  && H.s_both_H?.discardLog === false && H.s_tower?.discardLog === false, JSON.stringify([H.s_tool, H.s_both_H]));

console.log('\n【A】／【H】與 BASE 比對');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6522b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const B = scenarios(await loadEngine(tmp));
    const keys = Object.keys(H);   // 含果實盤面：BASE 本來就保留果實，HEAD 必須一樣
    const diffs = keys.filter((k) => {
      const h = { ...H[k] }, b = { ...B[k] };
      delete h.discardLog; delete b.discardLog;
      return JSON.stringify(h) !== JSON.stringify(b);
    });
    ok(`★★★[A1] ${keys.length} 個盤面 HEAD 與 BASE 逐欄位相同（damage／道具／棄牌區／受到的招式傷害／獎賞／階段／log）`,
      keys.length >= 24 && diffs.length === 0 && !keys.some((k) => H[k].err || B[k].err),
      JSON.stringify(diffs.map((k) => ({ k, H: H[k], B: B[k] }))));
    const BS = structural(tmp);
    ok('★★★[H1] BASE（v6.521）：S1、S2、N1 逐條紅（engine 自己查表、effects 兩份、狙擊路徑沒印丟棄 log）',
      BS.engGets > 0 && !(BS.effTool === 1 && BS.effPassive === 1) && B.s_tool?.discardLog === false, JSON.stringify(BS));
  } catch (e) { ok('★★★[A1/H1] BASE 引擎打包／執行', false, e.message); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6522 A/H', '需要 v6.521 commit');

console.log(`\n=== v6.522 防止昏厥套用唯一一份：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
