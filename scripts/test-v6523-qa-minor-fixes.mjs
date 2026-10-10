#!/usr/bin/env node
/**
 * v6.523 守衛：官方 Q&A 比對後剩下的小問題（站長 2026-10-10：「還沒修的小問題都處理掉」）。
 *
 * 【G】中央空選擇閘（v6523-empty-payload-gate，R106 希嘉娜的信賴）：
 *   G1 希嘉娜的信賴改附能量：送空陣列 ⇒ 不執行、pending 還在、能量沒動；之後照常選 ⇒ 能量真的改附
 *   G2 連送空陣列：最多退回 3 次，第 4 次照常解析（不軟鎖）
 *   G4 AI 也會選能量（AI 候選改走中央 activeEnergyDiscardCandidates；原本只看戰鬥寶可夢 ⇒ 永遠選不到、送空選擇）
 *   G5 中央候選的預設路徑也套 validIids（AI／畫面都不會列出不能選的能量）
 *   G3 不誤擋：候選全部不在了（validIids 過期）⇒ 空選擇直接放行；minCount 0 ⇒ 放行；
 *      牌庫搜尋（fail-to-find 型別）⇒ 不歸本閘；attach-tool（可取消）⇒ 道具退回手牌照舊
 * 【A】腎上腺腦力：
 *   A1 log 不再寫「回復 … HP」（官方：改放傷害指示物不是恢復 HP）
 *   A2 目標被化隱擋下 ⇒ 依官方 Q&A（深淵之瞳：「移除選擇的傷害指示物後，即結束處理」）指示物移除、不放回；
 *      log 不可再寫「已回復來源傷害」（v6.522 前行為對、log 錯）
 *   A3 正對照：一般目標照常改放（來源 −30、目標 +30）
 * 【L】log 用詞：
 *   L1 詛咒娃娃｜玩偶捕捉選「是」⇒ 不再寫「0~1」（任意選擇必選 1 張）
 *   L2 頭蓋龍｜推倒 ⇒ log 寫「推倒」不寫「撞飛」
 *   L3 傳說的海溝：手牌兩張同一半 ⇒ 擋下訊息講清楚「左半與右半各 1 張」
 * 【H】HEAD-FAIL：同樣盤面餵 v6.522 引擎，G1、G2、G4、A1、A2、L1、L2、L3 逐條紅；G3、A3 在 BASE 也綠
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.522。
const BASE_SHA = '85e80655';
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
// 卡號實查：希嘉娜的信賴 19619、願增猿 14741（腎上腺腦力）、詛咒娃娃 19176（化隱）、赫普的卡比獸 12537、
//   頭蓋龍 19186（推倒）、傳說的海溝 19621／19621-1（左右兩半）、倖存鍛鍊器 10306（attach-tool 對照）
const ID = { sigana: '19619', ape: '14741', doll: '19176', snorlax: '12537', cranidos: '19186', trench: '19621', tool: '10306',
  D: byName('基本【惡】能量'), F: byName('基本【鬥】能量'), P: byName('基本【超】能量') };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.has(String(v))).map(([k]) => k);

async function loadEngine(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6523-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const r = (p) => join(srcRoot, p).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction } from '${r('src/lib/game/engine')}';\nexport { getAIAction } from '${r('src/lib/game/ai')}';\nimport '${r('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'q' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const deck = () => Array.from({ length: 6 }, () => inst(ID.F));
  const mk = (me, opp, extra = {}) => ({ phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], log: [], pendingSelection: null, stadiumPlayedThisTurn: [false, false], stadiumUsedThisTurn: [false, false],
    supporterPlayedThisTurn: false,
    players: [{ name: 'P1', active: null, bench: [], hand: [], deck: deck(), discard: [], prizes: [inst(ID.F), inst(ID.F), inst(ID.F)], ...me },
              { name: 'P2', active: null, bench: [], hand: [], deck: deck(), discard: [], prizes: [inst(ID.F), inst(ID.F), inst(ID.F)], ...opp }], ...extra });
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, sel) => { const ps = s.pendingSelection; return act(s, { type: 'RESOLVE_SELECTION', effectKey: ps?.effectKey, selectedIids: sel, actorIdx: ps?.actorIdx ?? 0, pendingToken: ps?.token, senderIdx: ps?.actorIdx }); };
  const msgs = (s) => (s.log || []).map((l) => String(l?.message ?? l));
  const out = {};

  // G：希嘉娜的信賴（戰鬥＝卡比獸帶 2 能量、備戰＝卡比獸）
  const sigana = () => {
    const act0 = inst(ID.snorlax, { energyAttached: [inst(ID.F), inst(ID.F)] }), b = inst(ID.snorlax), card = inst(ID.sigana);
    let s = mk({ active: act0, bench: [b], hand: [card] }, { active: inst(ID.snorlax) });
    s = act(s, { type: 'PLAY_TRAINER', iid: card.iid });
    let g = 0;
    while (s.pendingSelection && s.pendingSelection.effectKey !== 'm6-sigana-energy' && g++ < 3) s = res(s, [b.iid]);
    return { s, act0, b };
  };
  try {
    const { s, act0, b } = sigana();
    const ps = s.pendingSelection;
    const e1 = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps?.effectKey, selectedIids: [], actorIdx: 0, pendingToken: ps?.token });
    const newActEnergy = (st) => (st.players[0].active?.iid === b.iid ? st.players[0].active.energyAttached.length : -1);
    const after = e1.pendingSelection?.effectKey === 'm6-sigana-energy' ? res(e1, [act0.energyAttached[0].iid]) : e1;
    out.G1 = { key: ps?.effectKey, declared: (ps?.params?.validIids ?? []).length, kept: e1.pendingSelection?.effectKey ?? null,
      moved0: newActEnergy(e1), movedAfter: newActEnergy(after) };
    let x = s, tries = 0;
    while (x.pendingSelection?.effectKey === 'm6-sigana-energy' && tries < 8) { x = act(x, { type: 'RESOLVE_SELECTION', effectKey: x.pendingSelection.effectKey, selectedIids: [], actorIdx: 0, pendingToken: x.pendingSelection.token }); tries++; }
    out.G2 = { tries, closed: !x.pendingSelection };
    // G4：AI 面對同一個能量 picker 會選換下那隻身上的能量（v6.523 起 AI 候選走中央 activeEnergyDiscardCandidates）
    const aiAct = M.getAIAction(s, pool, 0);
    const aiAfter = aiAct ? act(s, { ...aiAct, effectKey: aiAct.effectKey ?? ps?.effectKey, pendingToken: ps?.token, actorIdx: 0 }) : s;
    // G5：預設路徑（沒有 targetIid／scope／fromDiscard）的 validIids 子集 ⇒ AI 只選 validIids 裡的（returnSelfActiveEnergyPost basicOnly 型）
    {
      const burn = byName('燃火能量') ?? byName('基本【火】能量');
      const w1 = inst(ID.F), w2 = inst(ID.F), sp = inst(burn);
      const g5 = mk({ active: inst(ID.snorlax, { energyAttached: [sp, w1, w2] }), bench: [inst(ID.snorlax)] }, { active: inst(ID.snorlax) });
      g5.pendingSelection = { type: 'active-energy-discard', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1, effectKey: 'return-self-energy-pick-to-bench', params: { validIids: [w1.iid, w2.iid] }, token: 'tk5' };
      const a5 = M.getAIAction(g5, pool, 0);
      out.G5 = { sel: a5?.selectedIids ?? null, ok: Array.isArray(a5?.selectedIids) && a5.selectedIids.length >= 1 && a5.selectedIids.every((i) => i === w1.iid || i === w2.iid) };
    }
    out.G4 = { sel: aiAct?.selectedIids ?? null, moved: newActEnergy(aiAfter), warn: msgs(aiAfter).some((m) => /必須選擇/.test(m)) };
  } catch (e) { out.Gerr = e.message; }
  try {
    // G3a 候選過期：把換下那隻身上的能量拔掉再送空選擇 ⇒ 直接放行
    const { s } = sigana();
    const stale = { ...s, players: s.players.map((p, i) => i === 0 ? { ...p, bench: p.bench.map((c) => ({ ...c, energyAttached: [] })) } : p) };
    const r1 = act(stale, { type: 'RESOLVE_SELECTION', effectKey: stale.pendingSelection?.effectKey, selectedIids: [], actorIdx: 0, pendingToken: stale.pendingSelection?.token });
    // G3b attach-tool（可取消）⇒ 送空 ⇒ 道具退回手牌
    const tool = inst(ID.tool);
    let t = mk({ active: inst(ID.snorlax), hand: [tool] }, { active: inst(ID.snorlax) });
    t = act(t, { type: 'PLAY_TRAINER', iid: tool.iid });
    const tk = t.pendingSelection?.effectKey;
    const t2 = tk ? act(t, { type: 'RESOLVE_SELECTION', effectKey: tk, selectedIids: [], actorIdx: 0, pendingToken: t.pendingSelection.token }) : t;
    // G3c minCount 0 的 pending（合成）⇒ 放行
    const m0 = { ...mk({ active: inst(ID.snorlax), bench: [inst(ID.snorlax)] }, { active: inst(ID.snorlax) }) };
    const benchIid = m0.players[0].bench[0].iid;
    m0.pendingSelection = { type: 'bench-choose', actorIdx: 0, sourcePlayerIdx: 0, minCount: 0, maxCount: 1, effectKey: 'test-v6523-none', params: { validIids: [benchIid] }, token: 'tk0' };
    const m1 = act(m0, { type: 'RESOLVE_SELECTION', effectKey: 'test-v6523-none', selectedIids: [], actorIdx: 0, pendingToken: 'tk0' });
    // G3d deck-search minCount 1（合成）⇒ 不歸本閘（放行）
    const d0 = mk({ active: inst(ID.snorlax) }, { active: inst(ID.snorlax) });
    d0.pendingSelection = { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1, effectKey: 'test-v6523-none', filter: 'any', params: { validIids: [d0.players[0].deck[0].iid] }, token: 'tk1' };
    const d1 = act(d0, { type: 'RESOLVE_SELECTION', effectKey: 'test-v6523-none', selectedIids: [], actorIdx: 0, pendingToken: 'tk1' });
    // G3e 場上目標型 picker 的候選已經離場（只剩在棄牌區）⇒ 不算存活、放行（Fable 審查：不可掃到棄牌區／牌庫）
    const gone = inst(ID.snorlax);
    const f0 = mk({ active: inst(ID.snorlax) }, { active: inst(ID.snorlax), discard: [gone] });
    f0.pendingSelection = { type: 'opp-poke-choose', actorIdx: 0, sourcePlayerIdx: 1, minCount: 1, maxCount: 1, effectKey: 'test-v6523-none', params: { validIids: [gone.iid] }, token: 'tk2' };
    const f1 = act(f0, { type: 'RESOLVE_SELECTION', effectKey: 'test-v6523-none', selectedIids: [], actorIdx: 0, pendingToken: 'tk2' });
    out.G3 = { fieldGonePass: !f1.pendingSelection, stalePass: !r1.pendingSelection, toolKey: tk, toolBack: t2.players[0].hand.some((c) => c.iid === tool.iid) && !t2.pendingSelection,
      min0Pass: !m1.pendingSelection, deckPass: !d1.pendingSelection };
  } catch (e) { out.G3err = e.message; }

  // A：腎上腺腦力（願增猿帶惡能量、自己戰鬥位有 30 傷害；對手備戰＝詛咒娃娃（化隱）或卡比獸）
  const adrenal = (targetId) => {
    const ape = inst(ID.ape, { energyAttached: [inst(ID.D)], damage: 30 });
    const tgt = inst(targetId);
    let s = mk({ active: ape }, { active: inst(ID.snorlax), bench: [tgt] });
    s = act(s, { type: 'USE_ABILITY', iid: ape.iid, abilityIndex: 0 });
    let g = 0;
    while (s.pendingSelection && g++ < 5) {
      const k = s.pendingSelection.effectKey;
      if (k === 'adrenal-brain-src') s = res(s, [ape.iid]);
      else if (k === 'adrenal-brain-count') s = res(s, ['3']);
      else if (k === 'adrenal-brain-target') s = res(s, [tgt.iid]);
      else break;
    }
    const tNow = s.players[1].bench.find((c) => c.iid === tgt.iid) ?? s.players[1].active;
    return { apeDmg: s.players[0].active?.damage, tgtDmg: tNow?.damage ?? null, healLog: msgs(s).some((m) => /腎上腺腦力.*回復\s*\d+\s*HP/.test(m)),
      restoredLog: msgs(s).some((m) => /已回復來源傷害/.test(m)), removedLog: msgs(s).some((m) => /選擇的傷害指示物已移除/.test(m)),
      pending: s.pendingSelection?.effectKey ?? null };
  };
  try { out.A_doll = adrenal(ID.doll); out.A_norm = adrenal(ID.snorlax); } catch (e) { out.Aerr = e.message; }

  // L1：詛咒娃娃｜玩偶捕捉（附 1 超）選「是」
  try {
    const doll = inst(ID.doll, { energyAttached: [inst(ID.P)] });
    let s = mk({ active: doll }, { active: inst(ID.snorlax) });
    s = act(s, { type: 'ATTACK', attackIndex: 0 });
    let g = 0;
    while (s.pendingSelection && s.pendingSelection.type !== 'deck-search' && g++ < 3) {
      const ps = s.pendingSelection;
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: ps.type === 'binary-yes-no' ? ['yes'] : (ps.params?.options?.[0]?.id ? [ps.params.options[0].id] : ['yes']), actorIdx: 0, pendingToken: ps.token, discardedEnergyIids: ['x'] });
    }
    const lines = msgs(s).filter((m) => /玩偶捕捉/.test(m));
    out.L1 = { search: s.pendingSelection?.type ?? null, zeroTo: lines.some((m) => /0~1/.test(m)), any1: lines.some((m) => /任意選擇 1 張/.test(m)) };
  } catch (e) { out.L1err = e.message; }
  // L2：頭蓋龍｜推倒（2 鬥）打卡比獸，對手有備戰
  try {
    let s = mk({ active: inst(ID.cranidos, { energyAttached: [inst(ID.F), inst(ID.F)] }) }, { active: inst(ID.snorlax), bench: [inst(ID.snorlax)] });
    s = act(s, { type: 'ATTACK', attackIndex: 0 });
    let g = 0; while (s.pendingSelection && g++ < 3) s = res(s, (s.pendingSelection.params?.validIids ?? s.players[1].bench.map((c) => c.iid)).slice(0, 1));
    const lines = msgs(s);
    out.L2 = { push: lines.some((m) => /推倒[：:]/.test(m)), crash: lines.some((m) => /撞飛/.test(m)), lines: lines.filter((m) => /推倒|撞飛/.test(m)) };   // 換位那一行以「招式名：」開頭
  } catch (e) { out.L2err = e.message; }
  // L3：傳說的海溝，手牌兩張左半
  try {
    const h1 = inst(ID.trench), h2 = inst(ID.trench);
    let s = mk({ active: inst(ID.snorlax), hand: [h1, h2] }, { active: inst(ID.snorlax) });
    s = act(s, { type: 'PLAY_TRAINER', iid: h1.iid });
    const last = msgs(s).slice(-1)[0] ?? '';
    out.L3 = { blocked: s.players[0].hand.length === 2, clear: /左半與右半各 1 張/.test(last), last };
  } catch (e) { out.L3err = e.message; }
  return out;
}
const judge = (r) => ({
  G1: !!r.G1 && r.G1.key === 'm6-sigana-energy' && r.G1.declared === 2 && r.G1.kept === 'm6-sigana-energy' && r.G1.moved0 === 0 && r.G1.movedAfter === 1,
  G2: !!r.G2 && r.G2.closed && r.G2.tries === 4,
  G5: !!r.G5 && r.G5.ok,
  G4: !!r.G4 && Array.isArray(r.G4.sel) && r.G4.sel.length === 1 && r.G4.moved === 1 && !r.G4.warn,
  G3: !!r.G3 && r.G3.stalePass && r.G3.fieldGonePass && r.G3.toolKey === 'attach-tool' && r.G3.toolBack && r.G3.min0Pass && r.G3.deckPass,
  A1: !!r.A_doll && !r.A_doll.healLog && !r.A_norm.healLog,
  A2: !!r.A_doll && r.A_doll.apeDmg === 0 && r.A_doll.tgtDmg === 0 && !r.A_doll.pending && !r.A_doll.restoredLog && r.A_doll.removedLog,
  A3: !!r.A_norm && r.A_norm.apeDmg === 0 && r.A_norm.tgtDmg === 30,
  L1: !!r.L1 && r.L1.search === 'deck-search' && !r.L1.zeroTo && r.L1.any1,
  L2: !!r.L2 && r.L2.push && !r.L2.crash,
  L3: !!r.L3 && r.L3.blocked && r.L3.clear,
});

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const H = scenarios(await loadEngine(ROOT)), J = judge(H);
console.log('HEAD 實測：' + JSON.stringify(H));
ok('★★★[G1] 希嘉娜的信賴：宣告候選；送空選擇被退回（pending 還在、能量沒動）；再選能量 ⇒ 真的改附', J.G1, JSON.stringify([H.G1, H.Gerr]));
ok('★★[G2] 連送空選擇：退回 3 次、第 4 次照常解析（不軟鎖）', J.G2, JSON.stringify(H.G2));
ok('★★★[G4] AI 面對希嘉娜的信賴能量 picker ⇒ 選換下那隻身上的 1 個能量並真的改附（不送空選擇、不出警告）', J.G4, JSON.stringify(H.G4));
ok('★★[G5] AI 能量 picker 預設路徑也只選 validIids 之內（中央候選 fallback 套 validIids）', J.G5, JSON.stringify(H.G5));
ok('★★[G3] 不誤擋：候選過期、場上型候選已離場、attach-tool 取消（道具退回手牌）、minCount 0、牌庫搜尋都放行', J.G3, JSON.stringify([H.G3, H.G3err]));
ok('★★[A1] 腎上腺腦力 log 不再寫「回復 … HP」', J.A1, JSON.stringify([H.A_doll, H.A_norm, H.Aerr]));
ok('★★★[A2] 腎上腺腦力選到化隱 ⇒ 依官方判例指示物移除（來源 0、化隱 0），log 寫「已移除」不寫「已回復」', J.A2, JSON.stringify(H.A_doll));
ok('★[A3] 正對照：一般目標照常改放（來源 0、目標 30）', J.A3, JSON.stringify(H.A_norm));
ok('★★[L1] 玩偶捕捉 log：任意選擇 1 張、不再寫 0~1', J.L1, JSON.stringify([H.L1, H.L1err]));
ok('★★[L2] 頭蓋龍｜推倒 log 寫推倒、不寫撞飛', J.L2, JSON.stringify([H.L2, H.L2err]));
ok('★★[L3] 傳說的海溝兩張同一半 ⇒ 擋下且訊息寫左半與右半各 1 張', J.L3, JSON.stringify([H.L3, H.L3err]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6523b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const B = scenarios(await loadEngine(tmp)), BJ = judge(B);
    ok('★★★[H1] v6.522：G1、G2、G4、A1、A2、L1、L2、L3 逐條紅；G3、A3 在 BASE 也綠（不是例外）',
      !BJ.G1 && !BJ.G2 && !BJ.G4 && !BJ.A1 && !BJ.A2 && !BJ.L1 && !BJ.L2 && !BJ.L3 && BJ.G3 && BJ.A3 && !B.Gerr && !B.Aerr, JSON.stringify({ BJ, B }));
  } catch (e) { ok('★★★[H1] BASE 引擎打包／執行', false, e.message); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6523 H', '需要 v6.522 commit');

console.log(`\n=== v6.523 官方 Q&A 小問題：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
