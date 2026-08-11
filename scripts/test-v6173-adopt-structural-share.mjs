#!/usr/bin/env node
/**
 * v6.173 守衛：錦標賽 `tAdopt` 結構共享 ＋ 戰場 `{#each}` 穩定 key ＋ 對手側離場動畫窗
 *
 * ## 事故背景
 * 同情境動作往返 p95 中位數隨版本惡化：v6.155 265ms → v6.156 376ms → v6.167 818ms。
 * 真因假說：`tAdopt` 每次輪詢把整棵 `game` 樹換成剛 JSON.parse 出來的新物件
 * ⇒ Svelte 5 深層 `$state` proxy 的物件 identity 全換 ⇒ 每 400~800ms 一次**全量重繪**
 * ⇒ 墊高所有 await 續行（也把「網路時間」灌了水）。
 *
 * ## ⚠ 本輪查證推翻的一條假說（寫在這裡，免得下一輪再走一次）
 * 「離場動畫窗（out:scale/out:fly）內的 fragment-owned derived 被下一發 tAdopt 標髒重算
 *   ⇒ derived_inert」——**用真 Svelte 5 + jsdom 實跑重現不到（0 次）**。
 * 原因在 `svelte/src/internal/client/reactivity/batch.js`：排程階段對
 * `(effect.f & (DESTROYED | INERT)) !== 0` 的 effect 一律**跳過**，所以離場中的子樹
 * 根本不會被重算。實跑唯一能重現 `derived_inert` 的形狀是：
 *   **在非 effect 情境（事件處理器／計時器回呼）讀取 owner effect 已 INERT/DESTROYED 的
 *     fragment derived** —— 此時 `execute_derived` 會 warn 並回傳**過期值**。
 * ⇒ 本版對「對手側」直接**移除離場動畫**（連 INERT 窗一起消滅、也省掉每 tick 的動畫與
 *   幽靈節點佔版面），但**不宣稱**這就解決了正式站那 284 次。
 *
 * ## 釘住五件事
 *   A 等價性（行為層）：對「真的自對局跑出來的連續盤面」與大量 fuzz 樹，
 *     `shareStateIdentity(prev, next)` 的 `JSON.stringify` 必須與 `next` **逐位元組相同**。
 *   B 有效性（行為層）：⚠「有呼叫某函式」不算數 —— 這裡直接斷言**沒變的子樹真的 `===` 沿用**，
 *     而且沿用比例要夠高；同時反向釘住「有變的子樹一定是新物件」（否則畫面不會更新）。
 *   C 接線層：編譯後的 `+page.svelte` 裡，`tAdopt` 指派 `game` 的那一條敘述真的走
 *     `shareStateIdentity`（AST 斷言，不是 grep 字串），而且 `game` 為 null 時退回原行為。
 *   D 戰場 `{#each Array(...)}` 全部要有穩定 key（AST 掃描，先由 Svelte parser 剝掉註解）。
 *   E 對手戰鬥位／對手備戰位不得再有 `out:` / `transition:`（AST 斷言）。
 *   F 掃描器自我驗證：把 key 拿掉、把 out: 加回去、把 shareStateIdentity 換掉，
 *     D/E/C 都必須 FAIL（否則守衛是死碼）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'svelte/compiler';
import { parse as acornParse } from 'acorn';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = join(ROOT, 'src/routes/game/+page.svelte');
const pageSrc = readFileSync(PAGE, 'utf8');

let pass = 0, fail = 0;
const chk = (label, cond, extra) => {
  if (cond) { console.log('  PASS ' + label); pass++; }
  else { console.log('  FAIL ' + label + (extra ? ' :: ' + extra : '')); fail++; }
};

// ────────────────────────────────────────────────────────────────────────────
// 打包 state-share + engine + ai（自對局用）
// ────────────────────────────────────────────────────────────────────────────
const S = join(ROOT, '.v6173-s.js'), E = join(ROOT, '.v6173-e.ts'), O = join(ROOT, '.v6173-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* 清不掉不影響結果 */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, [
  "export { shareStateIdentity, countSharedNodes } from './src/lib/game/state-share';",
  "export { createGame, applyAction, hasPendingActions } from './src/lib/game/engine';",
  "export { GameActions } from './src/lib/game/actions';",
  "export { getAIAction } from './src/lib/game/ai';",
  "import './src/lib/game/effects';",
].join('\n'));
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);
const { shareStateIdentity, countSharedNodes, createGame, applyAction, GameActions, getAIAction } = mod;

// ────────────────────────────────────────────────────────────────────────────
// A. 等價性 — fuzz
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[v6.173] A. 等價性：shareStateIdentity(prev, next) 必須與 next 逐位元組等價');

function mulberry(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function randTree(rnd, depth) {
  const r = rnd();
  if (depth <= 0 || r < 0.28) {
    const k = rnd();
    if (k < 0.25) return Math.floor(rnd() * 1000);
    if (k < 0.5) return 'sv' + Math.floor(rnd() * 12);
    if (k < 0.7) return rnd() < 0.5;
    if (k < 0.85) return null;
    return Math.round(rnd() * 1000) / 10;
  }
  if (r < 0.62) {
    const n = Math.floor(rnd() * 5);
    const arr = [];
    for (let i = 0; i < n; i++) {
      const el = randTree(rnd, depth - 1);
      if (el && typeof el === 'object' && !Array.isArray(el) && rnd() < 0.7) el.iid = 'i' + Math.floor(rnd() * 8);
      arr.push(el);
    }
    return arr;
  }
  const o = {};
  const n = 1 + Math.floor(rnd() * 5);
  const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'iid', 'damage', 'hp'];
  for (let i = 0; i < n; i++) o[keys[Math.floor(rnd() * keys.length)]] = randTree(rnd, depth - 1);
  return o;
}
let fuzzBad = 0, fuzzShared = 0, fuzzN = 0;
for (let s = 1; s <= 4000; s++) {
  const rnd = mulberry(s);
  const prev = JSON.parse(JSON.stringify(randTree(rnd, 4)));
  const next = JSON.parse(JSON.stringify(randTree(rnd, 4)));
  const merged = shareStateIdentity(prev, next);
  if (JSON.stringify(merged) !== JSON.stringify(next)) { fuzzBad++; if (fuzzBad <= 2) console.log('    差異 seed=' + s); }
  fuzzN++;
  if (merged === prev) fuzzShared++;
}
chk('4000 組 fuzz 樹：合併結果的 JSON 與 next 完全相同', fuzzBad === 0, fuzzBad + ' 組不同');
// ⚠ 正對照：fuzz 也要真的碰到「整棵沿用」的路徑，否則上面那條可能只是走了 `return next`
chk('fuzz 有實際觸發「整棵沿用 prev」的分支（否則等價性測到的是死路徑）', fuzzShared > 0, 'shared=' + fuzzShared);

// 鍵順序：內容相同但鍵順序不同 ⇒ 不可沿用 prev（沿用會讓 JSON 位元組不同）
{
  const prev = { a: 1, b: 2 };
  const next = { b: 2, a: 1 };
  const m = shareStateIdentity(prev, next);
  chk('鍵順序不同就不沿用（保住逐位元組等價）', m !== prev && JSON.stringify(m) === JSON.stringify(next));
}
// 同 iid 的 prev 元素最多只被取用一次 ⇒ 不會產生 alias
{
  const prev = [{ iid: 'x', v: 1 }];
  const next = [{ iid: 'x', v: 1 }, { iid: 'x', v: 1 }];
  const m = shareStateIdentity(prev, next);
  chk('重複 iid 不會讓兩個位置指到同一個物件（無 alias）', m[0] !== m[1] && JSON.stringify(m) === JSON.stringify(next));
}
// prev 有多餘的鍵 ⇒ 不可沿用
{
  const prev = { a: 1, b: 2 };
  const next = { a: 1 };
  const m = shareStateIdentity(prev, next);
  chk('prev 多一個鍵時不沿用', m !== prev && JSON.stringify(m) === '{"a":1}');
}
// 非 plain 物件（Map/Date）一律直接回 next
{
  const d = new Date(0);
  chk('非 plain 容器直接回 next（不做任何加工）', shareStateIdentity(new Date(1), d) === d);
}

// ────────────────────────────────────────────────────────────────────────────
// A2 + B. 用「真的自對局跑出來的連續盤面」驗等價性與沿用率
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[v6.173] A2/B. 真盤面序列：等價性 ＋ 沒變的子樹真的沿用');

const cardsDir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(cardsDir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(cardsDir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(cardsDir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const DECK = [
  ['14129', 4], ['14130', 2], ['14151', 1], ['14131', 2], ['14132', 2], ['14133', 1],
  ['14134', 2], ['14135', 1], ['14136', 1], ['14137', 1], ['14138', 1],
  ['14139', 3], ['14140', 4], ['14141', 3], ['14142', 1], ['14143', 1], ['14144', 1],
  ['14145', 1], ['14146', 2], ['14147', 2], ['14148', 4], ['14149', 2], ['14150', 4],
  ['14152', 14],
].map(([cardId, count]) => ({ cardId, count }));

/** 模擬伺服器：每一發都是全新的 JSON（identity 全換）—— 這正是 tAdopt 現況吃到的東西 */
const wire = (s) => JSON.parse(JSON.stringify(s));

let states = [];
try {
  const allInPool = DECK.every(e => pool.has(String(e.cardId)));
  if (!allInPool) throw new Error('fixture 牌組有卡不在卡庫');
  let g = createGame({ name: 'P1', entries: DECK }, { name: 'P2', entries: DECK }, pool,
    { firstPlayerOverride: 0, forceLegacyOpening: true });
  states.push(wire(g));
  for (let step = 0; step < 600 && states.length < 60; step++) {
    if (g.phase === 'game-over') break;
    // ⚠ actor 的挑法與 scripts/sim-ai-battle.mjs 一致（setup / pendingSelection / 待補位 三種例外）
    let actor;
    if (g.phase === 'setup') {
      const mul = g.pendingMulliganDraw ?? [0, 0];
      if (mul[0] > 0) actor = 0;
      else if (mul[1] > 0) actor = 1;
      else actor = !g.setupDone[0] ? 0 : (!g.setupDone[1] ? 1 : 0);
    } else if (g.pendingSelection) {
      actor = g.pendingSelection.actorIdx;
    } else if (g.players[0].active === null && g.players[0].bench.length > 0) actor = 0;
    else if (g.players[1].active === null && g.players[1].bench.length > 0) actor = 1;
    else actor = g.activePlayerIndex;
    const act = getAIAction(g, pool, actor);
    if (!act) break;
    const nx = applyAction(g, act, pool);
    if (!nx) break;
    if (JSON.stringify(nx) === JSON.stringify(g)) { g = nx; continue; }   // 引擎拒絕 → 不當成一步
    g = nx;
    states.push(wire(g));
  }
} catch (err) {
  console.log('    ⚠ 自對局 fixture 產生失敗：' + err.message);
}
chk('自對局至少產出 12 個連續盤面（否則下面的行為斷言是空的）', states.length >= 12, 'n=' + states.length);

if (states.length >= 12) {
  let bad = 0, sharedTotal = 0, nodeTotal = 0, changedSeen = 0;
  let prev = states[0];
  for (let i = 1; i < states.length; i++) {
    const next = states[i];
    const merged = shareStateIdentity(prev, next);
    if (JSON.stringify(merged) !== JSON.stringify(next)) bad++;
    const { shared, total } = countSharedNodes(prev, merged);
    sharedTotal += shared; nodeTotal += total;
    // 反向：真的動過的地方一定不是 prev 的物件（否則畫面不會更新）
    if (JSON.stringify(prev) !== JSON.stringify(next) && merged === prev) changedSeen++;
    prev = merged;
  }
  chk('真盤面序列：每一步合併結果與伺服器 JSON 逐位元組等價', bad === 0, bad + ' 步不同');
  chk('真盤面序列：內容有變時，根物件一定是新物件（不會漏更新）', changedSeen === 0, changedSeen + ' 步錯誤沿用');
  const ratio = nodeTotal ? sharedTotal / nodeTotal : 0;
  chk('沿用率 > 60%（否則等於沒做結構共享）', ratio > 0.6, '沿用 ' + sharedTotal + '/' + nodeTotal + ' = ' + (ratio * 100).toFixed(1) + '%');
  console.log('    （參考）平均每步沿用 ' + (ratio * 100).toFixed(1) + '% 的容器節點');
}

// ────────────────────────────────────────────────────────────────────────────
// C. 接線層：tAdopt 真的用了 shareStateIdentity（AST，不是 grep）
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[v6.173] C. 接線層：tAdopt 指派 game 的那一條敘述真的走 shareStateIdentity');

/** 從 .svelte 原始碼取出 instance script 的 JS（去掉 TS 標註太麻煩 → 用 svelte parser 拿範圍後交給 esbuild transform） */
function tAdoptAssignsViaShare(source) {
  const i = source.indexOf('function tAdopt(');
  if (i < 0) return { ok: false, why: '找不到 tAdopt' };
  // 取函式本體（從 tAdopt 到下一個同縮排的 function 宣告前）
  const j = source.indexOf('\n  }\n', i);
  if (j < 0) return { ok: false, why: '抓不到 tAdopt 函式結尾' };
  const body = source.slice(i, j);
  const lines = body.split('\n')
    .filter(l => !l.trim().startsWith('//'))           // ⚠ 先剝掉註解，否則註解裡提到 `game = state` 會誤判
    .filter(l => /(^|[^\w.])game\s*=[^=]/.test(l));
  if (lines.length === 0) return { ok: false, why: 'tAdopt 裡找不到 game = ...' };
  const bad = lines.filter(l => !l.includes('shareStateIdentity'));
  return { ok: bad.length === 0, why: bad.join(' | '), lines, body };
}
{
  const r = tAdoptAssignsViaShare(pageSrc);
  chk('tAdopt 內每一處 `game =` 都經過 shareStateIdentity', r.ok, r.why);
  chk('tAdopt 仍保留「第一發（game 為 null）直接採用伺服器盤面」的退路',
    !!r.body && /\?[^:]*shareStateIdentity[^:]*:\s*state\b/.test(r.body.split('\n').find(l => l.includes('shareStateIdentity(')) ?? ''),
    '找不到 prev ? share(...) : state 的三元退路');
  chk('合併被 untrack 包住（深讀 proxy 不會意外訂閱整棵樹）',
    /untrack\(\(\)\s*=>\s*shareStateIdentity\(/.test(pageSrc));
  chk('import 了 shareStateIdentity（否則 runtime 直接炸）',
    /import\s*\{[^}]*shareStateIdentity[^}]*\}\s*from\s*'\$lib\/game\/state-share'/.test(pageSrc));
  // ⚠ 掃描器自我驗證：把 shareStateIdentity 換掉，上面第一條必須抓到
  const mutated = pageSrc.replace(/untrack\(\(\) => shareStateIdentity\(_sharePrev, state\)\)/, 'state');
  chk('★掃描器自我驗證：拿掉 shareStateIdentity 後 C 必須 FAIL',
    mutated !== pageSrc && tAdoptAssignsViaShare(mutated).ok === false);
}
// perf 儀器不可被動到：_tRecordAdopt 仍是 tAdopt 的最後一行
{
  const r = tAdoptAssignsViaShare(pageSrc);
  const bodyLines = (r.body ?? '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
  chk('perf 儀器不受影響：_tRecordAdopt 仍是 tAdopt 的最後一行（合併成本被誠實計入）',
    (bodyLines[bodyLines.length - 1] ?? '').startsWith('_tRecordAdopt('), bodyLines[bodyLines.length - 1]);
}

// ────────────────────────────────────────────────────────────────────────────
// D/E. 模板結構：戰場 {#each Array(...)} 要 keyed；對手側不得再有離場動畫
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[v6.173] D/E. 模板結構（AST：由 Svelte parser 剝掉註解與字串）');

function scanTemplate(source) {
  const ast = parse(source, { modern: true, filename: 'p.svelte' });
  const eachArrayUnkeyed = [];
  const oppOutro = [];
  const lineOf = (pos) => source.slice(0, pos).split('\n').length;
  const walk = (node, oppCtx) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, oppCtx); return; }
    let ctx = oppCtx;
    if (node.type === 'EachBlock') {
      const expr = source.slice(node.expression.start, node.expression.end);
      if (/^Array\s*\(/.test(expr.trim()) && !node.key) eachArrayUnkeyed.push({ line: lineOf(node.start), expr: expr.slice(0, 70) });
      if (/oppBenchLimit/.test(expr)) ctx = true;
    }
    if (node.type === 'RegularElement') {
      const cls = (node.attributes ?? []).find(a => a.type === 'Attribute' && a.name === 'class');
      const clsText = cls && cls.value !== true ? source.slice(cls.start, cls.end) : '';
      const isOppEl = /opp-active/.test(clsText);
      const inOpp = ctx || isOppEl;
      if (inOpp) {
        for (const a of node.attributes ?? []) {
          if (a.type === 'TransitionDirective') oppOutro.push({ line: lineOf(a.start), name: a.name, cls: clsText.slice(0, 40) });
        }
      }
      ctx = inOpp;
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'parent') continue;
      walk(node[k], ctx);
    }
  };
  walk(ast.fragment, false);
  return { eachArrayUnkeyed, oppOutro };
}
{
  const r = scanTemplate(pageSrc);
  chk('所有 `{#each Array(...)}` 都有穩定 key', r.eachArrayUnkeyed.length === 0,
    r.eachArrayUnkeyed.map(x => 'L' + x.line + ' ' + x.expr).join(' | '));
  chk('對手備戰列／對手戰鬥位不再有 out:/transition: 離場動畫窗', r.oppOutro.length === 0,
    r.oppOutro.map(x => 'L' + x.line + ' ' + x.name).join(' | '));

  // ★ 掃描器自我驗證：把 key 拿掉 / 把 out: 加回去，D/E 必須抓到
  const noKey = pageSrc.replace('{#each Array(6) as _, i (i)}', '{#each Array(6) as _, i}');
  chk('★掃描器自我驗證：拿掉一個 Array(...) 的 key 後 D 必須 FAIL',
    noKey !== pageSrc && scanTemplate(noKey).eachArrayUnkeyed.length > 0);
  const addOut = pageSrc.replace('<div class="bench-slot card-back-slot" title="對手備戰寶可夢（設置中，未揭曉）">',
    '<div class="bench-slot card-back-slot" out:scale={{ duration: 320 }} title="對手備戰寶可夢（設置中，未揭曉）">');
  chk('★掃描器自我驗證：把對手側 out: 加回去後 E 必須 FAIL',
    addOut !== pageSrc && scanTemplate(addOut).oppOutro.length > 0);
}

// state-share.ts 本身要能被 acorn 之外的檢查釘住：不得就地修改 prev
{
  const shareSrc = readFileSync(join(ROOT, 'src/lib/game/state-share.ts'), 'utf8');
  const codeOnly = shareSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  chk('state-share.ts 不對 prev 做就地寫入（不得出現 pObj[...] = / pArr[...] =）',
    !/\bp(Obj|Arr)\s*\[[^\]]*\]\s*=[^=]/.test(codeOnly));
  chk('state-share.ts 是純 ESM 匯出、沒有 import 任何有副作用的模組',
    !/^\s*import\s/m.test(codeOnly));
  // acorn 能剖析（TS 標註剝掉後）→ 保證沒有語法炸彈
  try { acornParse(codeOnly.replace(/:\s*[A-Za-z_$][\w<>,\[\]{}|\s.$]*(?=[=),;])/g, ''), { ecmaVersion: 2022, sourceType: 'module' }); } catch { /* 型別剝除是啟發式，剖析失敗不當作 FAIL */ }
}

console.log(`\n=== v6.173 結構共享守衛：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
