/**
 * v6.165 HEAD-FAIL 守衛 — 「依傷害量判定」的被動免疫（暴噬龜｜鐵壁硬殼）在
 * 手動結算傷害的路徑上必須真的成立。
 *
 * 卡面（static/cards SV7 10921，台灣官方中文，唯一權威）：
 *   暴噬龜｜鐵壁硬殼：「這隻寶可夢不會受到對手的寶可夢『200』以上的招式的傷害。」
 *
 * 官方裁定（PTCG RULES/PTCG_RULES.md，唯一權威）：
 *   §17.27.D L1750-1751：故勒頓ex「瘋狂衝擊」220 −「硬硬束帶」30 ＝ 190 → **可以造成傷害**
 *     ⇒ 判準是「**減傷之後**實際造成的傷害」，不是招式印刷值。
 *   §17.27.D L1762-1763：電燈怪「閃電伏特」140 對【雷】弱點的暴噬龜 → **不可以造成傷害**，
 *     「由於先計算弱點」⇒ **弱點×2 也要計入**（140×2＝280 ≥ 200）。
 *   §17.27.B L1730-1731：古簡蝸ex「追擊蔦」對**備戰區**的暴噬龜 → **不可以造成傷害**
 *     ⇒ **備戰區也適用**（卡面沒限定戰鬥場）。
 *
 * HEAD(v6.164) FAIL 點：`passiveImmunityDamageBlock` 以假值 `baseDamage = 1` 探測述詞
 *   （它同時服務會被 UI 預覽呼叫的 resolveBenchGuard，拿不到真實傷害）⇒ `1 >= 200` 恆 false
 *   ⇒ 鐵壁硬殼在**所有**手動結算傷害的路徑（狙擊／多目標／備戰 AOE／油之機關槍）永遠不成立。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.dti-s.js'), E = join(ROOT, '.dti-e.ts'), O = join(ROOT, '.dti-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { dealAttackDamageToTarget, resolveBenchGuard, passiveImmunityDamageBlock,\n"
  + "  passiveImmunityByDamageAmount, PASSIVE_IMMUNITY, DAMAGE_AMOUNT_DEPENDENT_IMMUNITY } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ── 卡面驗證（fixture 必須真的是那張卡） ─────────────────────────────────
const KAJIRIGAME = '10921';   // 暴噬龜（SV7・H）鐵壁硬殼
const SHIBIRE = '10926';      // 電燈怪（SV7・H）閃電伏特 140
const PLAIN = '14086';        // 願增猿（無特性對照）
const kg = pool.get(KAJIRIGAME);
T('fixture: 暴噬龜卡面逐字 = 「200」以上的招式的傷害', () => {
  ok(kg, '找不到暴噬龜 10921（live index 有變？）');
  ok(kg.abilities?.[0]?.name === '鐵壁硬殼', '特性名不符');
  ok(kg.abilities[0].effect === '這隻寶可夢不會受到對手的寶可夢「200」以上的招式的傷害。',
    '卡面 effect 已變更，請回查 static/cards：' + kg.abilities[0].effect);
  ok(kg.weakness?.type === 'Lightning', '弱點應為【雷】（官方判例前提）');
  ok(['H', 'I', 'J'].includes(kg.regulationMark), '只維護 H/I/J');
});

// ── A. 宣告表掃描器（含自我驗證＋下限斷言） ──────────────────────────────
function secondParamName(fn) {
  const src = String(fn);
  const m = src.match(/^\s*(?:async\s*)?(?:function\s*[\w$]*\s*)?\(([^)]*)\)/);
  if (!m) return null;                       // 無括號單參數箭頭 → 只有 1 個參數
  const parts = m[1].split(',').map(x => x.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : undefined;   // undefined = 沒有第 2 參數
}
T('掃描器自我驗證（正對照）：用到 baseDamage / 沒用到 各自判得出來', () => {
  const used = (_a, baseDamage) => baseDamage >= 200;
  const unused = (_a, _baseDamage) => true;
  const onlyOne = (a) => !!a;
  ok(secondParamName(used) === 'baseDamage', '應抓到第 2 參數名 baseDamage');
  ok(secondParamName(unused).startsWith('_'), '未使用的第 2 參數應為 _ 前綴');
  ok(secondParamName(onlyOne) === undefined, '只有 1 個參數應回傳 undefined');
});
T('PASSIVE_IMMUNITY：凡用到傷害量的述詞都必須登記在 DAMAGE_AMOUNT_DEPENDENT_IMMUNITY', () => {
  const entries = [...mod.PASSIVE_IMMUNITY.entries()];
  ok(entries.length >= 7, `只掃到 ${entries.length} 筆 PASSIVE_IMMUNITY，掃描器壞了？`);
  const declared = mod.DAMAGE_AMOUNT_DEPENDENT_IMMUNITY;
  ok(declared instanceof Set && declared.size >= 1, 'DAMAGE_AMOUNT_DEPENDENT_IMMUNITY 應為非空 Set');
  const missing = [];
  for (const [name, fn] of entries) {
    const p2 = secondParamName(fn);
    const usesDamage = typeof p2 === 'string' && !p2.startsWith('_');
    if (usesDamage && !declared.has(name)) missing.push(`${name}（第2參數 ${p2}）`);
  }
  ok(missing.length === 0,
    '這些特性依「傷害量」判定卻沒登記 → 會被假值 1 探測而靜默失效：' + missing.join('、'));
  for (const name of declared) {
    ok(mod.PASSIVE_IMMUNITY.has(name), `DAMAGE_AMOUNT_DEPENDENT_IMMUNITY 有死條目：${name}`);
  }
});
T('鐵壁硬殼確實登記在 DAMAGE_AMOUNT_DEPENDENT_IMMUNITY', () => {
  ok(mod.DAMAGE_AMOUNT_DEPENDENT_IMMUNITY.has('鐵壁硬殼'), '鐵壁硬殼未登記');
});

// ── 盤面 ────────────────────────────────────────────────────────────────
let iid = 0;
const inst = (cid, e = {}) => ({ iid: `d${++iid}`, cardId: String(cid), damage: 0, energyAttached: [], extraTools: [], ...e });
function base() {
  const s = mod.createGame({ name: 'P1', entries: [{ cardId: PLAIN, count: 1 }] },
    { name: 'P2', entries: [{ cardId: PLAIN, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0] };
}
function board(attackerCid, defActiveCid, defBenchCids = []) {
  const b = base();
  const att = inst(attackerCid, { energyAttached: [] });
  const da = inst(defActiveCid);
  const bench = defBenchCids.map(c => inst(c));
  return {
    state: { ...b, players: [
      { ...b.players[0], active: att, bench: [], hand: [], deck: [inst(PLAIN)], discard: [], prizes: [inst(PLAIN)] },
      { ...b.players[1], active: da, bench, hand: [], deck: [inst(PLAIN)], discard: [], prizes: [inst(PLAIN)] },
    ] }, att, da, bench };
}

// ── B. 中央述詞直測 ─────────────────────────────────────────────────────
T('passiveImmunityByDamageAmount：210 → blocked；199 → 不 blocked', () => {
  const { state, da } = board(PLAIN, KAJIRIGAME);
  const r210 = mod.passiveImmunityByDamageAmount(state, 0, da, kg, pool, 210, { isBench: false });
  ok(r210.blocked, '210 ≥ 200 應免疫');
  const r199 = mod.passiveImmunityByDamageAmount(state, 0, da, kg, pool, 199, { isBench: false });
  ok(!r199.blocked, '199 < 200 不應免疫（不可過度攔截）');
  const r200 = mod.passiveImmunityByDamageAmount(state, 0, da, kg, pool, 200, { isBench: false });
  ok(r200.blocked, '「200」以上 → 剛好 200 也免疫');
});
// ⭐ 特性有效性必須與 engine 主管線同一條判準（Fable 5 審查抓到的缺口）
T('【傳說的熔岩洞】在場 → 暴噬龜（Stage1 進化）特性被消除 ⇒ 鐵壁硬殼不成立', () => {
  const LAVA = '19623';   // 傳說的熔岩洞（M6・J）「雙方場上所有進化寶可夢的特性全部消除。」
  ok(pool.get(LAVA)?.rulesText === '雙方場上所有進化寶可夢的特性全部消除。', '場地卡卡面已變更');
  ok((kg.stage ?? kg.subtype) === 'Stage1', '暴噬龜應為進化寶可夢（熔岩洞才管得到）');
  const { state, da } = board(PLAIN, KAJIRIGAME);
  const s = { ...state, activeStadium: { iid: 'stad1', cardId: LAVA } };
  const r = mod.passiveImmunityByDamageAmount(s, 0, da, kg, pool, 300, { isBench: false });
  ok(!r.blocked, '特性被消除時不得免疫（否則與 engine 主管線判準分岔）');
  const r2 = mod.dealAttackDamageToTarget(s, 0, da.iid, 210, pool, { kind: 'attack-damage', label: '狙擊', noWeakness: true });
  ok(r2.players[1].active === null || r2.players[1].active.iid !== da.iid, '熔岩洞在場 → 210 應照打（HP140 → 擊倒）');
});

// ── C. UI 預覽端行為釘住：v6.165 前後必須完全一致（零回歸） ──────────────
T('UI 預覽端 resolveBenchGuard(暴噬龜, attack-damage) → 不 blocked（行為不變）', () => {
  const { state } = board(PLAIN, PLAIN, [KAJIRIGAME]);
  const g = mod.resolveBenchGuard(state, pool, 0, kg, 'attack-damage', { targetInst: state.players[1].bench[0] });
  ok(!g.blocked, 'resolveBenchGuard 拿不到傷害量 ⇒ 不得在預覽端擅自擋（否則 UI 會顯示假免疫）');
});
T('passiveImmunityDamageBlock(暴噬龜) → 不 blocked（跳過依傷害量述詞，行為等價）', () => {
  const { state } = board(PLAIN, KAJIRIGAME);
  const r = mod.passiveImmunityDamageBlock(state, 0, state.players[1].active, kg, pool);
  ok(!r.blocked, '不帶傷害量的探測不得判成免疫');
});
T('對照：無特性的一般卡在預覽端也不 blocked（判準沒有一刀切）', () => {
  const { state } = board(PLAIN, PLAIN, [PLAIN]);
  const g = mod.resolveBenchGuard(state, pool, 0, pool.get(PLAIN), 'attack-damage', { targetInst: state.players[1].bench[0] });
  ok(!g.blocked, '一般卡不該被擋');
});

// ── D. 行為端 HEAD-FAIL：dealAttackDamageToTarget（狙擊/延後型中央管線） ──
T('狙擊型對【戰鬥位】暴噬龜 210 傷害 → 免疫（HEAD：照打 210）', () => {
  const { state, da } = board(PLAIN, KAJIRIGAME);
  const r = mod.dealAttackDamageToTarget(state, 0, da.iid, 210, pool, { kind: 'attack-damage', label: '狙擊', noWeakness: true });
  ok(r.players[1].active.damage === 0, `應完全免疫，實得 damage=${r.players[1].active.damage}`);
});
T('狙擊型對【備戰】暴噬龜 210 傷害 → 免疫（官方 §17.27.B 備戰也適用；HEAD：照打）', () => {
  const { state, bench } = board(PLAIN, PLAIN, [KAJIRIGAME]);
  const r = mod.dealAttackDamageToTarget(state, 0, bench[0].iid, 210, pool, { kind: 'attack-damage', label: '狙擊' });
  const b = r.players[1].bench.find(x => x.iid === bench[0].iid);
  ok(b.damage === 0, `備戰暴噬龜應免疫，實得 damage=${b.damage}`);
});
// 暴噬龜 HP 140 ⇒ 只要沒被免疫、傷害 ≥140 就會被擊倒；以「有沒有被擊倒」當受傷判準。
const koed = (r, iid) => r.players[1].active === null || r.players[1].active.iid !== iid;
T('狙擊型 190 傷害 → 照樣受傷被擊倒（官方 §17.27.D 220-30=190 可造成傷害）', () => {
  const { state, da } = board(PLAIN, KAJIRIGAME);
  const r = mod.dealAttackDamageToTarget(state, 0, da.iid, 190, pool, { kind: 'attack-damage', label: '狙擊', noWeakness: true });
  ok(koed(r, da.iid), '190 < 200 應照打（HP140 → 擊倒）');
});
T('狙擊型 110 傷害 × 弱點【雷】2 = 220 → 免疫（弱點要先計算）', () => {
  const { state, da } = board(SHIBIRE, KAJIRIGAME);   // 電燈怪【雷】
  const r = mod.dealAttackDamageToTarget(state, 0, da.iid, 110, pool, { kind: 'attack-damage', label: '狙擊' });
  ok(r.players[1].active && r.players[1].active.iid === da.iid && r.players[1].active.damage === 0,
    `110×2=220 應免疫且不被擊倒，實得 ${JSON.stringify(r.players[1].active && r.players[1].active.damage)}`);
});
T('狙擊型 90 傷害 × 弱點【雷】2 = 180 → 受傷被擊倒（不過度攔截）', () => {
  const { state, da } = board(SHIBIRE, KAJIRIGAME);
  const r = mod.dealAttackDamageToTarget(state, 0, da.iid, 90, pool, { kind: 'attack-damage', label: '狙擊' });
  ok(koed(r, da.iid), '90×2=180 < 200 應照打（HP140 → 擊倒）');
});
T('放置傷害指示物（kind=attack-effect）不套此免疫 —— 卡面寫的是「招式的傷害」', () => {
  const { state, da } = board(PLAIN, KAJIRIGAME);
  const r = mod.dealAttackDamageToTarget(state, 0, da.iid, 210, pool, { kind: 'attack-effect', label: '放指示物' });
  ok(koed(r, da.iid), '放指示物不是「招式的傷害」，不該被鐵壁硬殼擋');
});

// ── E. 正對照：engine 主管線本來就正確，不可回歸 ─────────────────────────
T('engine 主管線（官方判例）：電燈怪｜閃電伏特 140×弱點2=280 → 暴噬龜不受傷害', () => {
  const { state, att, da } = board(SHIBIRE, KAJIRIGAME);
  const s = { ...state, players: [
    { ...state.players[0], active: { ...att, energyAttached: [inst('18520'), inst('18520'), inst('18520')] } },
    state.players[1],
  ] };
  const atkIdx = (pool.get(SHIBIRE).attacks ?? []).findIndex(a => a.name === '閃電伏特');
  ok(atkIdx >= 0, '找不到 閃電伏特');
  const r = mod.applyAction(s, { type: 'ATTACK', attackIndex: atkIdx, actorIdx: 0 }, pool);
  const d = r.players[1].active;
  ok(d && d.iid === da.iid && d.damage === 0, `官方裁定「不可以造成傷害」，實得 damage=${d?.damage}`);
});

// ── F. 同維度漏網路徑守衛：每一條「自跑傷害迴圈」都要接上依傷害量的免疫 ────────
//   判準：`applyDefenderCoinAvoid(`（＝該處已經算出最終傷害、正在做最後一層免疫）
//   的呼叫點，往前 3000 字元內必須看得到 `passiveImmunityByDamageAmount(`
//   （鏡射 engine 主管線順序：PASSIVE_IMMUNITY 就排在擲幣免傷之前）。
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/[\u200b-\u200d\ufeff]/g, '');
}
// 錨點①：`_applyBenchAbilityReduce(` ＝「防守方減傷」那一步，每一條自跑傷害迴圈都恰好有一個
//   （hitBenchAll／bench-hit-N／dealAttackDamageToTarget／snipe-multi／clone-strike-multi-hit）。
//   依傷害量的免疫必須排在它**之後**（傷害算完才判）。
// 錨點②：`applyDefenderCoinAvoid(` ＝ active 的擲幣免傷（最後一層），必須排在它**之前**。
function scanDamageLoopSites(src) {
  const code = stripComments(src);
  const sites = [];
  const isDef = (i) => /function\s+$/.test(code.slice(Math.max(0, i - 20), i));
  for (const m of code.matchAll(/_applyBenchAbilityReduce\s*\(/g)) {
    if (isDef(m.index)) continue;
    const after = code.slice(m.index, m.index + 3000);
    sites.push({ index: m.index, name: '_applyBenchAbilityReduce', hasThreshold: after.includes('passiveImmunityByDamageAmount(') });
  }
  for (const m of code.matchAll(/applyDefenderCoinAvoid\s*\(/g)) {
    if (isDef(m.index)) continue;
    const before = code.slice(Math.max(0, m.index - 3000), m.index);
    sites.push({ index: m.index, name: 'applyDefenderCoinAvoid', hasThreshold: before.includes('passiveImmunityByDamageAmount(') });
  }
  return sites;
}
T('掃描器自我驗證（正對照）：缺少門檻免疫的樣本必須被抓到', () => {
  const bad = 'const x = applyDefenderCoinAvoid(s); /* passiveImmunityByDamageAmount( */';
  const good = 'const p = passiveImmunityByDamageAmount(s,0,t,c,pool,d,{}); const x = applyDefenderCoinAvoid(s);';
  const badBench = 'const r = _applyBenchAbilityReduce(s); const n = c.damage + amt;';
  const goodBench = 'const r = _applyBenchAbilityReduce(s); const p = passiveImmunityByDamageAmount(s,0,t,c,pool,d,{});';
  ok(scanDamageLoopSites(bad).length === 1 && !scanDamageLoopSites(bad)[0].hasThreshold,
    '註解裡的字串不可算數（剝註解失敗）');
  ok(scanDamageLoopSites(good).length === 1 && scanDamageLoopSites(good)[0].hasThreshold,
    '正常樣本應判為 OK');
  ok(scanDamageLoopSites(badBench).length === 1 && !scanDamageLoopSites(badBench)[0].hasThreshold,
    'bench 迴圈缺門檻免疫應被抓到');
  ok(scanDamageLoopSites(goodBench).length === 1 && scanDamageLoopSites(goodBench)[0].hasThreshold,
    'bench 迴圈正常樣本應判為 OK');
});
T('全站每條自跑傷害迴圈都接上 passiveImmunityByDamageAmount（含 bench 迴圈與 mega_decks）', () => {
  const files = ['src/lib/game/effects.ts', 'src/lib/game/effects/cards/mega_decks.ts'];
  let total = 0; const missing = [];
  for (const f of files) {
    const sites = scanDamageLoopSites(readFileSync(join(ROOT, f), 'utf8'));
    total += sites.length;
    for (const x of sites) if (!x.hasThreshold) missing.push(`${f}@${x.index}(${x.name})`);
  }
  ok(total >= 8, `只掃到 ${total} 個傷害迴圈錨點，掃描器壞了？（預期 ≥8＝5 減傷 + 3 擲幣）`);
  ok(missing.length === 0,
    `${missing.length} 條傷害迴圈沒有接依傷害量的被動免疫（鐵壁硬殼會在那裡靜默失效）：` + missing.join('、'));
});
T('五＋一條插入點逐一存在（hitBenchAll／bench-hit-N／dealAttackDamageToTarget／snipe-multi／clone-strike／油之機關槍）', () => {
  const eff = stripComments(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'));
  const mega = stripComments(readFileSync(join(ROOT, 'src/lib/game/effects/cards/mega_decks.ts'), 'utf8'));
  const nEff = (eff.match(/passiveImmunityByDamageAmount\s*\(/g) || []).length;
  const nMega = (mega.match(/passiveImmunityByDamageAmount\s*\(/g) || []).length;
  // effects.ts：1 個定義 + 5 個呼叫；mega_decks.ts：1 個 import + 1 個呼叫
  ok(nEff >= 6, `effects.ts 只有 ${nEff} 處（定義 1 + 呼叫 5），有插入點被拿掉？`);
  ok(nMega >= 1, `mega_decks.ts 的油之機關槍插入點不見了（${nMega} 處）`);
});

console.log(`\n=== v6.165 damage-threshold immunity: ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
