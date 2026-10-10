#!/usr/bin/env node
/**
 * v6.521 守衛：倖存鍛鍊器與不朽身軀同時可以防止昏厥時，由持有者選擇處理順序
 *   （官方 Q&A 綠寶石風暴；站長 2026-10-10 裁定「還是要做選擇視窗」）。
 *
 * 【M】engine 主管線（攻擊戰鬥寶可夢）：
 *   M1 兩者都能用 ⇒ 暫停、回到攻擊前（傷害未套、攻擊方能量未動），對防守方開 modal-choice（v6521-prevent-ko-order）
 *   M2 選「先特性」＋正面 ⇒ 不朽身軀保住（剩 10）、倖存鍛鍊器留著
 *   M3 選「先特性」＋反面 ⇒ 改用倖存鍛鍊器保住、道具丟棄
 *   M4 選「先道具」⇒ 倖存鍛鍊器保住、道具丟棄、不擲不朽身軀的硬幣
 *   M5 零回歸：只有不朽身軀（沒道具）⇒ 不開視窗，照常擲幣
 *   M6 零回歸：只有倖存鍛鍊器（沒特性）⇒ 不開視窗，道具保住
 *   M7 重跑沿用剛才招式的擲幣（超級袋獸ex｜機關槍合擊）：選完後招式不重擲
 * 【E】effects 路徑（狙擊／多目標，無法暫停）：applyPreventKOToVictim 兩者都能用時先處理特性
 *   E1 正面 ⇒ 特性保住、道具留著；E2 反面 ⇒ 道具保住；E3 只有道具 ⇒ 道具保住（零回歸）
 * 【C】中央判準 preventKoOrderDecision（站長 2026-10-10：盡量走中央管線）：
 *   C1 判準表逐格實跑；C2 engine 與 effects 都呼叫它、不再就地寫「tool && ability」
 * 【H】HEAD-FAIL：同樣盤面餵 v6.520 的引擎逐條紅（M1、M2、E1）
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.520。
const BASE_SHA = '757d0ec7';
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
// 卡號都從卡庫實查：棄世猴 19183（不朽身軀、HP150）、倖存鍛鍊器 10306、密勒頓 9893（閃雷攻擊 160、無效果文字）、
//   超級袋獸ex 14071（機關槍合擊，擲幣）、卡比獸 12537（無防昏厥特性的對照）
const ID = { monkey: '19183', trainer: byName('倖存鍛鍊器'), mira: '9893', kanga: '14071', snorlax: '12537',
  L: byName('基本【雷】能量'), P: byName('基本【超】能量'), W: byName('基本【水】能量'), F: byName('基本【鬥】能量') };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.has(String(v))).map(([k]) => k);

async function loadEngine(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6521-'));
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

// 固定擲幣序列（'H'＝正面 <0.5；序列用完一律反面）
function withFlips(seq, fn) {
  const orig = Math.random; let i = 0;
  Math.random = () => { const v = seq[i++]; return v === 'H' ? 0.1 : 0.9; };
  try { return fn(); } finally { Math.random = orig; }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'q' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const mk = (me, opp) => ({ phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], log: [], pendingSelection: null, stadiumPlayedThisTurn: [false, false], stadiumUsedThisTurn: [false, false],
    players: [{ name: 'P1', active: null, bench: [], hand: [], deck: [inst(ID.F), inst(ID.F)], discard: [], prizes: [inst(ID.F), inst(ID.F), inst(ID.F)], ...me },
              { name: 'P2', active: null, bench: [inst(ID.snorlax)], hand: [], deck: [inst(ID.F), inst(ID.F)], discard: [], prizes: [inst(ID.F), inst(ID.F), inst(ID.F)], ...opp }] });
  const act = (s, a) => M.applyAction(s, a, pool);
  const msgs = (s) => (s.log || []).map((l) => String(l?.message ?? l));
  const toolOn = (i) => !!i && (i.toolAttached?.cardId === ID.trainer || (i.extraTools || []).some((t) => t.cardId === ID.trainer));
  const view = (s, victimIid) => {
    const a = s.players[1].active;
    return { pending: s.pendingSelection?.effectKey ?? null, pendingActor: s.pendingSelection?.actorIdx ?? null,
      alive: a?.iid === victimIid, dmg: a?.iid === victimIid ? a.damage : null, tool: toolOn(a),
      toolInDiscard: s.players[1].discard.some((c) => c.cardId === ID.trainer),
      immortalFlip: msgs(s).some((m) => /不朽身軀/.test(m) && /擲|正面|反面/.test(m)), prizesTaken: 3 - s.players[0].prizes.length };
  };
  const out = {};
  // 密勒頓（L L P）打棄世猴；withTool / withAbility 控制防守方
  const setup = (withTool, holderId = ID.monkey) => {
    const victim = inst(holderId, withTool ? { toolAttached: inst(ID.trainer) } : {});
    const atk = inst(ID.mira, { energyAttached: [inst(ID.L), inst(ID.L), inst(ID.P)] });
    return { s: mk({ active: atk }, { active: victim }), victim, atk };
  };
  const answer = (s, choice) => { const ps = s.pendingSelection; return act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: [choice], actorIdx: ps.actorIdx, pendingToken: ps.token, senderIdx: ps.actorIdx }); };
  try {
    out.M1 = withFlips([], () => { const { s, victim, atk } = setup(true); const r = act(s, { type: 'ATTACK', attackIndex: 1 });
      return { ...view(r, victim.iid), atkEnergy: (r.players[0].active?.energyAttached || []).length, opts: (r.pendingSelection?.params?.options || []).map((o) => o.id).join(','), sameAtk: r.players[0].active?.iid === atk.iid }; });
  } catch (e) { out.M1err = e.message; }
  try {
    out.M2 = withFlips(['H'], () => { const { s, victim } = setup(true); let r = act(s, { type: 'ATTACK', attackIndex: 1 }); if (r.pendingSelection?.effectKey === 'v6521-prevent-ko-order') r = answer(r, 'ability'); return view(r, victim.iid); });
    out.M3 = withFlips(['T'], () => { const { s, victim } = setup(true); let r = act(s, { type: 'ATTACK', attackIndex: 1 }); if (r.pendingSelection?.effectKey === 'v6521-prevent-ko-order') r = answer(r, 'ability'); return view(r, victim.iid); });
    out.M4 = withFlips(['H'], () => { const { s, victim } = setup(true); let r = act(s, { type: 'ATTACK', attackIndex: 1 }); if (r.pendingSelection?.effectKey === 'v6521-prevent-ko-order') r = answer(r, 'tool'); return view(r, victim.iid); });
    out.M5 = withFlips(['H'], () => { const { s, victim } = setup(false); return view(act(s, { type: 'ATTACK', attackIndex: 1 }), victim.iid); });
    out.M6 = withFlips([], () => { const { s, victim } = setup(true, ID.snorlax); return view(act(s, { type: 'ATTACK', attackIndex: 1 }), victim.iid); });
  } catch (e) { out.Merr = e.message; }
  try {
    // M7：機關槍合擊第一次擲 正、反（兩枚）後暫停；若重跑沿用 ⇒ 下一個亂數（正）給不朽身軀 ⇒ 道具留著
    //     若重跑重新擲 ⇒ 招式吃掉 正(idx2)、反(idx3)，不朽身軀拿到 idx4＝反 ⇒ 用掉道具
    out.M7 = withFlips(['H', 'T', 'H', 'T', 'T'], () => {
      const victim = inst(ID.monkey, { toolAttached: inst(ID.trainer) });
      let s = mk({ active: inst(ID.kanga, { energyAttached: [inst(ID.W), inst(ID.W), inst(ID.W)] }) }, { active: victim });
      let r = act(s, { type: 'ATTACK', attackIndex: 0 });
      const paused = r.pendingSelection?.effectKey;
      if (paused === 'v6521-prevent-ko-order') r = answer(r, 'ability');
      return { paused, ...view(r, victim.iid) };
    });
  } catch (e) { out.M7err = e.message; }
  try {
    const runE = (seq, holder) => withFlips(seq, () => {
      const victim = inst(holder, { toolAttached: inst(ID.trainer) });
      const s = mk({ active: inst(ID.mira) }, { active: victim });
      const r = M.EFF.applyPreventKOToVictim(s, victim, pool.get(holder), 1, 200, pool, 'attack-damage');
      const a = r.state.players[1].active;
      return { prevented: r.prevented, tool: toolOn(a), dmg: a.damage };
    });
    out.E1 = runE(['H'], ID.monkey);
    out.E2 = runE(['T'], ID.monkey);
    out.E3 = runE([], ID.snorlax);
  } catch (e) { out.Eerr = e.message; }
  return out;
}
const judge = (r) => ({
  M1: !!r.M1 && r.M1.pending === 'v6521-prevent-ko-order' && r.M1.pendingActor === 1 && r.M1.dmg === 0 && r.M1.tool && r.M1.atkEnergy === 3 && r.M1.opts === 'ability,tool' && r.M1.sameAtk,
  M2: !!r.M2 && !r.M2.pending && r.M2.alive && r.M2.dmg === 140 && r.M2.tool && !r.M2.toolInDiscard,
  M3: !!r.M3 && !r.M3.pending && r.M3.alive && r.M3.dmg === 140 && !r.M3.tool && r.M3.toolInDiscard && r.M3.immortalFlip,
  M4: !!r.M4 && !r.M4.pending && r.M4.alive && r.M4.dmg === 140 && !r.M4.tool && r.M4.toolInDiscard && !r.M4.immortalFlip,
  M5: !!r.M5 && !r.M5.pending && r.M5.alive && r.M5.dmg === 140 && r.M5.immortalFlip,
  M6: !!r.M6 && !r.M6.pending && r.M6.alive && !r.M6.tool && r.M6.toolInDiscard,
  M7: !!r.M7 && r.M7.paused === 'v6521-prevent-ko-order' && !r.M7.pending && r.M7.alive && r.M7.tool,
  E1: !!r.E1 && r.E1.prevented && r.E1.tool,
  E2: !!r.E2 && r.E2.prevented && !r.E2.tool,
  E3: !!r.E3 && r.E3.prevented && !r.E3.tool,
});

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const H = scenarios(await loadEngine(ROOT)), J = judge(H);
console.log('實測：' + JSON.stringify(H));
ok('★★★[M1] 兩者都能用 ⇒ 回到攻擊前、對防守方開順序選擇視窗（傷害未套、能量未動）', J.M1, JSON.stringify([H.M1, H.M1err]));
ok('★★★[M2] 先特性＋正面 ⇒ 不朽身軀保住、倖存鍛鍊器留著', J.M2, JSON.stringify([H.M2, H.Merr]));
ok('★★[M3] 先特性＋反面 ⇒ 改用倖存鍛鍊器保住、道具丟棄', J.M3, JSON.stringify(H.M3));
ok('★★[M4] 先道具 ⇒ 道具保住並丟棄、不擲不朽身軀', J.M4, JSON.stringify(H.M4));
ok('★[M5] 零回歸：只有不朽身軀 ⇒ 不開視窗、照常擲幣', J.M5, JSON.stringify(H.M5));
ok('★[M6] 零回歸：只有倖存鍛鍊器 ⇒ 不開視窗、道具保住', J.M6, JSON.stringify(H.M6));
ok('★★★[M7] 選完重跑沿用剛才招式的擲幣（不重擲）', J.M7, JSON.stringify([H.M7, H.M7err]));
ok('★★[E1] 狙擊路徑兩者都能用 ⇒ 先處理特性：正面保住、道具留著', J.E1, JSON.stringify([H.E1, H.Eerr]));
ok('★★[E2] 狙擊路徑反面 ⇒ 改用道具', J.E2, JSON.stringify(H.E2));
ok('★[E3] 狙擊路徑零回歸：只有道具 ⇒ 道具保住', J.E3, JSON.stringify(H.E3));

console.log('\n【C】中央判準');
{
  const HM2 = await loadEngine(ROOT);
  const D = HM2.EFF.preventKoOrderDecision;
  const both = { tool: '倖存鍛鍊器', ability: '不朽身軀' };
  const table = typeof D === 'function' ? [
    D({ tool: '倖存鍛鍊器', ability: null }, null, true), D({ tool: null, ability: '不朽身軀' }, 'ability', true), D({ tool: null, ability: null }, null, false),
    D(both, null, true), D(both, null, false), D(both, 'tool', true), D(both, 'ability', false), D(both, 'tool', false),
  ].join(',') : 'MISSING';
  ok('★★★[C1] 判準表：單邊⇒tool（含已選 ability 也一樣）；兩者＋未選＋可暫停⇒ask、不可暫停⇒ability；已選⇒照選擇',
    table === 'tool,tool,tool,ask,ability,tool,ability,tool', table);
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const eng = strip(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
  const eff = strip(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'));
  ok('★★[C2] engine 與 effects 都呼叫 preventKoOrderDecision(，且沒有就地的「.tool && ….ability」判斷',
    /preventKoOrderDecision\(_c,/.test(eng) && /preventKoOrderDecision\(_pkoCand,/.test(eff)
      && !/\.tool\s*&&\s*\w+\.ability/.test(eng) && !/\.tool\s*&&\s*_pkoCand\.ability/.test(eff));
}

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6521b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const B = scenarios(await loadEngine(tmp)), BJ = judge(B);
    ok('★★★[H1] v6.520：M1、M2、E1 逐條紅（而且不是例外）；零回歸的 M5、M6、E3 在 BASE 也綠',
      !BJ.M1 && !BJ.M2 && !BJ.E1 && BJ.M5 && BJ.M6 && BJ.E3 && !B.M1err && !B.Merr && !B.Eerr, JSON.stringify({ BJ, B }));
  } catch (e) { ok('★★★[H1] BASE 引擎打包／執行', false, e.message); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6521 H', '需要 v6.520 commit');

console.log(`\n=== v6.521 防止昏厥的處理順序：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
