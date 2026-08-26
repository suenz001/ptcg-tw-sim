#!/usr/bin/env node
/**
 * ⭐⭐⭐ v6.237 守衛：**框架環境差異**（Svelte 5 `$state` = Proxy）。
 *
 * ## 這條守衛是為了抓什麼（未來的人請不要拿掉）
 * v6.233～v6.236 的「預估傷害」**從來沒有在畫面上出現過**，而那三個版本
 * 62 條專屬守衛全綠、完整 npm test 全綠、tsc 全綠。
 *
 * 真因：`src/routes/game/+page.svelte` 的 `let game = $state<GameState|null>(null)`
 * 在執行期是一個 **Proxy**（Svelte 5 的深層反應式代理），而
 * `src/lib/game/damage-estimate.ts` 乾跑的第一件事是 `structuredClone(base)`。
 * 依 HTML 規格，**帶有 [[ProxyHandler]] 內部欄位的物件不可結構化序列化**
 * ⇒ 一律拋 `DataCloneError` ⇒ 每一招都回 `{ kind: 'unknown' }` ⇒ 什麼都不顯示。
 *
 * ⚠⚠ **為什麼舊守衛結構性地抓不到**：守衛跑在 Node，`game` 是**普通物件**；
 *    真實環境是 **Svelte Proxy**。同一份程式碼、兩種執行環境、兩種結果。
 *    ⇒ 只要守衛永遠餵普通物件，這一整類 bug 就永遠測不到。
 *
 * ## 所以這支守衛做的事
 * ① 用**真的** Svelte 代理（`svelte/internal/client` 的 `proxy()`，
 *    就是 `$state(...)` 編譯後實際呼叫的那一支）包住 GameState 再跑預估；
 * ② 另外用一份**手寫的深層 Proxy** 再測一次（不依賴 svelte 內部 API 是否改名）；
 * ③ 每一種代理都先自驗「`structuredClone` 對它真的會炸」——
 *    否則樣本沒重現危害，這條守衛就只是安慰劑（IRON_RULES Rule 25/33）；
 * ④ **接線行為端**：把 `+page.svelte` 裡 `damageEstimates` 的 `$derived.by` 本體
 *    **原樣抽出來執行**，餵一個真的 Svelte 代理，必須算得出可顯示的預估。
 *    ⚠ 這一條刻意**不是**「原始碼裡有沒有 `$state.snapshot` 字串」的檢查 ——
 *      那種只驗字串存在的守衛擋不住「接線沒接上」。
 *
 * ⚠ 不要把 ①②④ 任何一條換成字串比對。BASE(v6.236) 必須在 ④ 變紅（見 ⑪ HEAD-FAIL）。
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.pv-s.js'), E = join(ROOT, '.pv-e.ts'), O = join(ROOT, '.pv-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export * from './src/lib/game/damage-estimate';\n" +
  "export { applyAction, getEffectiveAttacks, getAvailableAttacks, canAffordAttack, createGame } from './src/lib/game/engine';\n" +
  "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

let n = 0, bad = 0;
const chk = (label, cond) => { n++; console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) bad++; };

// ── 卡池 ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// ── fixture（與 test-v6233 同一套，刻意保持一致好對照） ─────────────────────
const inst = (cardId, iid, ex = {}) =>
  ({ iid, cardId: String(cardId), damage: 0, energyAttached: [], evolvedFromStack: [], ...ex });
const ENERGY = {};
for (const c of pool.values()) {
  if (c.supertype === 'Energy' && c.subtype === 'Basic') {
    const m = /基本【(.)】能量/.exec(c.name || ''); if (m) ENERGY[m[1]] = c;
  }
}
const T2C = { Grass:'草', Fire:'火', Water:'水', Lightning:'雷', Psychic:'超',
              Fighting:'鬥', Darkness:'惡', Metal:'鋼', Colorless:'草', Dragon:'草' };
function payFor(cost, pkType) {
  const out = []; let k = 0;
  for (const c of (cost || [])) {
    const t = (c === 'Colorless') ? (T2C[pkType] || '草') : (T2C[c] || '草');
    const e = ENERGY[t]; if (e) out.push(inst(e.id, 'e' + (k++)));
  }
  for (let i = 0; i < 6; i++) out.push(inst((ENERGY[T2C[pkType] || '草']).id, 'ex' + (k++)));
  return out;
}
const DECK_IDS = [...pool.values()]
  .filter(c => String(c.supertype || '').startsWith('Pok') && ['H','I','J'].includes(c.regulationMark))
  .slice(0, 6).map(c => c.id);
const deckOf = (tag) => DECK_IDS.map((id, i) => inst(id, tag + i));
function mkState(attCard, defCard, energyInsts) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    activeStadium: null, pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: inst(attCard.id, 'a1', { energyAttached: energyInsts }),
        bench: [inst(attCard.id, 'b1')], hand: [inst(attCard.id, 'h1')], deck: deckOf('d'),
        discard: [inst(attCard.id, 'g1')], prizes: [inst(attCard.id, 'pz1'), inst(attCard.id, 'pz2')],
        energyAttachedThisTurn: false },
      { name: 'P2', active: inst(defCard.id, 'oa1'),
        bench: [inst(defCard.id, 'ob1')], hand: [inst(defCard.id, 'oh1'), inst(defCard.id, 'oh2')],
        deck: deckOf('od'), discard: [inst(defCard.id, 'og1')],
        prizes: [inst(defCard.id, 'opz1'), inst(defCard.id, 'opz2')], energyAttachedThisTurn: false },
    ],
  };
}
const findAtk = (name, atkName) => {
  const c = [...pool.values()].find(x => x.name === name && (x.attacks || []).some(a => a.name === atkName));
  if (!c) return null;
  return { card: c, idx: (c.attacks || []).findIndex(a => a.name === atkName), atk: (c.attacks || []).find(a => a.name === atkName) };
};
const findCard = (name) => [...pool.values()].find(x => x.name === name) ?? null;

const CHIKO = findAtk('菊草葉', '飛葉快刀');
const SNEASEL = findCard('狃拉');   // 草弱點 ⇒ 20 ×2 = 40
const NEUTRAL = [...pool.values()].find(x =>
  String(x.supertype || '').startsWith('Pok') && ['H','I','J'].includes(x.regulationMark) &&
  (x.stage ?? x.subtype) === 'Basic' && !x.abilities?.length && !x.weakness && !x.resistance && x.hp >= 200);

const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

// ══════════════════════════════════════════════════════════════════════════
console.log('⓪ 前提：掃描器與樣本自身先驗（Rule 25）');
chk('卡池載入（> 4000 張）', pool.size > 4000);
chk('fixture 素材齊備（菊草葉｜飛葉快刀 vs 狃拉、中性防守方）', !!CHIKO && !!SNEASEL && !!NEUTRAL);
chk(`+page.svelte 讀得到且未截斷（${PAGE.length} 字）`, PAGE.length > 900000);

const PLAIN = CHIKO && SNEASEL ? mkState(CHIKO.card, SNEASEL, payFor(CHIKO.atk.cost, CHIKO.card.pokemonType)) : null;
const EXPECT = PLAIN ? mod.estimateAttackDamage(PLAIN, CHIKO.idx, pool, 0) : null;
chk(`基準（普通物件）算得出確切值：${EXPECT ? EXPECT.kind + ' ' + (EXPECT.value ?? '') : '—'}`,
    !!EXPECT && EXPECT.kind === 'exact' && EXPECT.value > 0);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n① 兩種代理：先自驗「structuredClone 對它真的會炸」，再驗預估算不算得出來');
/** 手寫的深層 Proxy（模擬 Svelte 5 的 deep reactive proxy：讀到物件就再包一層）。 */
function deepProxy(v) {
  if (v === null || typeof v !== 'object') return v;
  return new Proxy(v, {
    get(t, k, r) { return deepProxy(Reflect.get(t, k, r)); },
    set(t, k, val, r) { return Reflect.set(t, k, val, r); },
  });
}
let svelteProxy = null, svelteSnapshot = null, svelteErr = '';
try {
  const sv = await import('svelte/internal/client');
  if (typeof sv.proxy === 'function' && typeof sv.snapshot === 'function') {
    svelteProxy = sv.proxy; svelteSnapshot = sv.snapshot;
  } else svelteErr = 'svelte/internal/client 沒有 proxy/snapshot';
} catch (e) { svelteErr = String(e && e.message).slice(0, 120); }

const wrappers = [['手寫深層 Proxy', deepProxy]];
if (svelteProxy) wrappers.push(['真的 Svelte proxy()（＝$state 編譯後呼叫的那一支）', svelteProxy]);
chk(`⭐ 真的 Svelte 代理可用（否則只剩手寫版；原因：${svelteErr || '—'}）`, !!svelteProxy);

/**
 * ⭐ 介面約定（這一節就是在釘死它）：
 *   `damage-estimate.ts` **維持與框架無關**（它也被 Node 守衛直接呼叫），
 *   所以它的契約是「傳進來的盤面必須是**純物件**」。
 *   ⇒ 丟 Proxy 進來的正確行為是 **fail-closed（回 unknown、絕不吐錯數字）＋ 留下一行診斷**，
 *     而不是自己去猜要不要 unwrap。
 *   ⇒ 「把 Proxy 轉成純物件」是**呼叫端**的責任，由第 ④ 節的行為端測試釘死。
 */
for (const [who, wrap] of wrappers) {
  const p = wrap(structuredClone(PLAIN));
  let threw = '';
  try { structuredClone(p); } catch (e) { threw = e.name; }
  chk(`${who}：樣本自驗 —— structuredClone 對它真的會炸（實得 ${threw || '沒炸(樣本無效!)'}）`,
      threw === 'DataCloneError');
  const e = mod.estimateAttackDamage(p, CHIKO.idx, pool, 0);
  chk(`⭐ ${who}：直接丟進來 ⇒ fail-closed 回 unknown（絕不拿錯數字騙玩家）`, e.kind === 'unknown');
  const e2 = mod.estimateAttackDamage(svelteSnapshot ? svelteSnapshot(p) : structuredClone(PLAIN), CHIKO.idx, pool, 0);
  chk(`⭐⭐ ${who}：呼叫端先做 snapshot ⇒ 算得出來且與普通物件一致（實得 ${e2.kind}${e2.kind === 'exact' ? ' ' + e2.value : ''}）`,
      e2.kind === 'exact' && e2.value === EXPECT.value);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n② $state.snapshot 與 structuredClone 的等價性（GameState 這種資料上）');
if (svelteSnapshot) {
  const p = svelteProxy(structuredClone(PLAIN));
  const snap = svelteSnapshot(p);
  let cloneOk = true; try { structuredClone(snap); } catch { cloneOk = false; }
  chk('snapshot 的產物可以 structuredClone（＝已是純物件）', cloneOk);
  chk('snapshot 與原盤面深等價（逐欄位）', JSON.stringify(snap) === JSON.stringify(PLAIN));
  chk('snapshot 的產物與原物件不是同一個參照（真的複製了一份）', snap !== PLAIN && snap.players !== PLAIN.players);
  // ⚠ snapshot 對 Map/Set 只做**淺**複製（svelte/src/internal/shared/clone.js:
  //   `if (value instanceof Map) return new Map(value)`），structuredClone 則是深複製。
  //   ⇒ 只要 GameState 裡有 Map/Set，兩者就**不等價**。下面 ③ 就是在釘死「不會有」。
  const m = svelteSnapshot({ m: new Map([['k', { deep: 1 }]]) });
  chk('⚠ 已知差異：snapshot 對 Map 是淺複製（所以 ③ 必須釘死 GameState 不含 Map/Set）',
      m.m instanceof Map && m.m.get('k') !== undefined);
} else {
  chk('snapshot 等價性（缺 svelte 內部 API，無法驗）', false);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n③ GameState 是純資料（沒有 Map／Set／Date／類別實體）⇒ 兩種複製才等價');
{
  /** 遞迴檢查：只允許 primitive / 純物件 / 陣列。 */
  function scanImpure(v, path, out, seen) {
    if (v === null || typeof v !== 'object') return;
    if (seen.has(v)) return; seen.add(v);
    if (Array.isArray(v)) { v.forEach((x, i) => scanImpure(x, path + '[' + i + ']', out, seen)); return; }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      out.push(path + ' → ' + (v.constructor?.name ?? '未知型別'));
      return;
    }
    for (const k of Object.keys(v)) scanImpure(v[k], path + '.' + k, out, seen);
  }
  // 真的用引擎建一局（不是我自己拼的 fixture），再打一招，掃描結果盤面。
  const BASIC = [...pool.values()].find(c => String(c.supertype || '').startsWith('Pok')
    && (c.stage ?? c.subtype) === 'Basic' && ['H','I','J'].includes(c.regulationMark) && (c.attacks || []).length > 0);
  const EN = [...pool.values()].find(c => c.supertype === 'Energy' && c.subtype === 'Basic');
  let real = null;
  try {
    real = mod.createGame({ name: 'A', entries: [{ cardId: String(BASIC.id), count: 8 }, { cardId: String(EN.id), count: 52 }] },
                          { name: 'B', entries: [{ cardId: String(BASIC.id), count: 8 }, { cardId: String(EN.id), count: 52 }] },
                          pool, { firstPlayerOverride: 0 });
  } catch (e) { real = null; }
  chk('用真實的 createGame 建得出一局（掃描對象不是我自己拼的 fixture）', !!real && !!real.players);
  const targets = [['createGame 的盤面', real], ['乾跑基準 fixture', PLAIN],
                   ['applyAction 之後的盤面', PLAIN ? mod.applyAction(structuredClone(PLAIN), { type: 'ATTACK', attackIndex: CHIKO.idx }, pool) : null]];
  for (const [who, st] of targets) {
    if (!st) { chk(`${who}：取得失敗`, false); continue; }
    const bad2 = []; scanImpure(st, who, bad2, new Set());
    chk(`${who}：沒有 Map／Set／Date／類別實體${bad2.length ? '（實得 ' + bad2.slice(0, 3).join('、') + '）' : ''}`,
        bad2.length === 0);
  }
  // 交叉驗證：掃描器自身要抓得到（否則上面三條都是恆真的安慰劑）
  const probe = []; scanImpure({ a: { m: new Map(), d: new Date() } }, 'probe', probe, new Set());
  chk('掃描器自驗：故意塞 Map/Date 一定抓得到', probe.length === 2);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n④ ⭐⭐⭐ 接線行為端：把 +page.svelte 的 damageEstimates 本體原樣抽出來執行');
/**
 * ⚠ 這一節是本版的核心。它**不是**字串比對 —— 是真的把頁面上那段程式碼跑起來，
 *   餵一個真的 Svelte 代理當 `game`，看它到底吐不吐得出可顯示的預估。
 * ⚠ 抽取失敗一律 FAIL（不是 SKIP）：若 damageEstimates 被重構過，
 *   請更新這裡的抽法，**不可以直接把這條刪掉**。
 */
function extractDerivedBody(pageSrc) {
  const i = pageSrc.indexOf('const damageEstimates = $derived.by');
  if (i < 0) return { err: '找不到 const damageEstimates = $derived.by' };
  const arrow = pageSrc.indexOf('=> {', i);
  if (arrow < 0) return { err: '找不到 derived 的箭頭函式本體' };
  let k = arrow + 4, depth = 1;
  while (k < pageSrc.length && depth > 0) {
    const ch = pageSrc[k];
    if (ch === '{') depth++; else if (ch === '}') depth--;
    k++;
  }
  if (depth !== 0) return { err: '大括號配對失敗' };
  return { body: pageSrc.slice(arrow + 4, k - 1) };
}
function toRunnable(body) {
  // 這段 TS 只可能出現我們宣告過的型別註記；出現別的就 FAIL（不要默默放行）。
  const DECLARED = [' as GameState'];
  let js = body;
  for (const t of DECLARED) js = js.split(t).join('');
  if (/\bas\s+[A-Z]/.test(js)) return { err: '本體含未宣告的 TS 型別註記：' + (/\bas\s+[A-Z]\w*/.exec(js) || [''])[0] };
  return { js };
}
function runDerived(js, ctx) {
  // eslint-disable-next-line no-new-func
  const f = new Function('__ctx', 'with (__ctx) { return (function () {' + js + '})(); }');
  return f(ctx);
}
function mkCtx(gameValue, snapshotFn) {
  return {
    isTournament: false, isSpectator: false, isTournSpectator: false, isTReplay: false,
    poolReady: true, pool, game: gameValue, isMyTurn: () => true,
    getEffectiveAttacks: mod.getEffectiveAttacks, estimateAllAttacks: mod.estimateAllAttacks,
    warnEstimateOnce: mod.warnEstimateOnce ?? (() => {}),
    // `$state.snapshot(...)` 在本體裡是 `$state.snapshot(` 這串文字 ⇒ 用 with 綁一個 `$state` 物件即可，
    // 完全不必改寫原始碼（改寫愈少，測到的就愈接近頁面上真正跑的那一份）。
    $state: { snapshot: snapshotFn },
  };
}
{
  const ex = extractDerivedBody(PAGE);
  chk('抽得出 damageEstimates 的本體' + (ex.err ? '（' + ex.err + '）' : ''), !!ex.body);
  const conv = ex.body ? toRunnable(ex.body) : { err: ex.err };
  chk('本體可轉成可執行的 JS' + (conv.err ? '（' + conv.err + '）' : ''), !!conv.js);
  if (conv.js && svelteProxy && svelteSnapshot) {
    const proxied = svelteProxy(structuredClone(PLAIN));
    let out = null, runErr = '';
    try { out = runDerived(conv.js, mkCtx(proxied, svelteSnapshot)); } catch (e) { runErr = String(e && e.message).slice(0, 160); }
    chk('本體跑得起來' + (runErr ? '（' + runErr + '）' : ''), !runErr);
    chk('⭐⭐⭐ 餵真的 Svelte $state 代理，仍算得出**可顯示**的預估（BASE 這裡會全紅）',
        Array.isArray(out) && out.length > 0 && out.some(e => mod.hasEstimateToShow(e)));
    chk('  └ 而且數字與普通物件一致（沒有因為 snapshot 而算成別的東西）',
        Array.isArray(out) && out.some(e => e && e.kind === 'exact' && e.value === EXPECT.value));
    // 負對照：把 snapshot 換成「原樣回傳」（＝沒有做 snapshot）⇒ 必須全部不可顯示
    let out2 = null;
    try { out2 = runDerived(conv.js, mkCtx(proxied, (x) => x)); } catch { out2 = null; }
    chk('⭐ 負對照：snapshot 換成原樣回傳（＝沒接上）⇒ 一個都顯示不出來',
        !out2 || out2.length === 0 || out2.every(e => !mod.hasEstimateToShow(e)));
    // 正對照：普通物件（＝舊守衛的環境）本來就會過 ⇒ 證明舊守衛為何抓不到
    const out3 = runDerived(conv.js, mkCtx(structuredClone(PLAIN), svelteSnapshot));
    chk('⭐ 正對照：餵普通物件時新舊都會過（這正是舊守衛結構性抓不到的原因）',
        Array.isArray(out3) && out3.some(e => mod.hasEstimateToShow(e)));
  } else {
    chk('④ 需要 svelte 內部 API 才能跑（缺就是紅，不 SKIP）', false);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑤ 【B】不可再靜靜吞掉錯誤：失敗時一定留診斷，而且只留一次');
{
  const orig = console.warn;
  const seen = [];
  console.warn = (...a) => { seen.push(a.map(x => String(x)).join(' ')); };
  try {
    if (typeof mod.resetEstimateWarnings === 'function') mod.resetEstimateWarnings();
    const p = deepProxy(structuredClone(PLAIN));
    // 直接呼叫「沒有 snapshot」的路徑：深複製一定失敗
    const before = seen.length;
    // ⚠ 用手寫 proxy 直接進 damage-estimate（繞過 +page 的 snapshot）
    const rawClone = (base) => { structuredClone(base); };
    try { rawClone(p); } catch { /* 預期 */ }
    // 讓 runOnce 真的踩到 catch：把 proxy 丟進去
    mod.estimateAttackDamage(p, CHIKO.idx, pool, 0);
    chk('深複製失敗時**有**留下 console.warn（v6.236 是一行都沒有）', seen.length > before);
    const after1 = seen.length;
    for (let i = 0; i < 5; i++) mod.estimateAttackDamage(p, CHIKO.idx, pool, 0);
    chk('⚠ 同一種原因只噴一次（連跑 5 次沒有再噴）', seen.length === after1);
    chk('訊息講得出「要先 $state.snapshot」（讓下一個人 3 秒內知道怎麼修）',
        seen.some(s => s.includes('snapshot')));
    if (typeof mod.resetEstimateWarnings === 'function') mod.resetEstimateWarnings();
  } finally { console.warn = orig; }
  chk('resetEstimateWarnings 有匯出（守衛才驗得了「只噴一次」）',
      typeof mod.resetEstimateWarnings === 'function');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ 【D】能量還沒附夠也要顯示（站長要的是「出招前的規劃」）');
{
  const noE = mkState(CHIKO.card, SNEASEL, []);
  chk('前提：這個盤面引擎確實不讓它出招（getAvailableAttacks 不含它）',
      !mod.getAvailableAttacks(noE, pool).includes(CHIKO.idx));
  const e = mod.estimateAttackDamage(noE, CHIKO.idx, pool, 0);
  chk(`⭐ 能量 0 也給得出數字（實得 ${e.kind}${e.kind === 'exact' ? ' ' + e.value : ''}）`,
      e.kind === 'exact' && e.value === EXPECT.value);
  chk('⭐ 而且標記成「假設」（assumedEnergy），不假裝是現況', e.assumedEnergy === true);
  const txt = mod.estimateShortText(e);
  chk(`⭐ 文案講明白是假設：「${txt}」`, txt.startsWith('附滿能量後') && txt.includes('預估'));
  // 負對照：能量夠的時候文案逐字不變（v6.234 的文案守衛不可被這一版弄壞）
  const full = mod.estimateAttackDamage(PLAIN, CHIKO.idx, pool, 0);
  chk('⭐ 負對照：能量足夠時沒有「附滿能量後」，文案與 v6.236 逐字相同',
      !full.assumedEnergy && mod.estimateShortText(full) === '預估 40（弱點 ×2）');

  // 依附著能量數計算的招式：必須額外標示「依附著的能量而定」
  const lap = findAtk('拉普拉斯ex', '水炮迴旋');
  if (lap && NEUTRAL) {
    const s0 = mkState(lap.card, NEUTRAL, []);
    const e0 = mod.estimateAttackDamage(s0, lap.idx, pool, 0);
    chk(`⭐ 傷害隨附著能量數變動的招式被行為端偵測到（拉普拉斯ex｜水炮迴旋 → ${mod.estimateShortText(e0)}）`,
        e0.assumedEnergy === true && e0.energyScaled === true &&
        mod.estimateShortText(e0).includes('依附著的能量而定'));
    const sf = mkState(lap.card, NEUTRAL, payFor(lap.atk.cost, lap.card.pokemonType));
    const ef = mod.estimateAttackDamage(sf, lap.idx, pool, 0);
    chk('  └ 負對照：能量足夠時不標 energyScaled（那是「假設」才有的附註）',
        !ef.energyScaled && !ef.assumedEnergy);
  } else chk('找得到 拉普拉斯ex｜水炮迴旋', false);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑦ 【D】盤面污染：補能量只發生在丟棄用的複本上（逐位元組比對）');
{
  let dirty = 0, ran = 0;
  const cands = [...pool.values()].filter(c => String(c.supertype || '').startsWith('Pok')
    && ['H','I','J'].includes(c.regulationMark) && (c.attacks || []).length > 0).slice(0, 400);
  const step = Math.max(1, Math.floor(cands.length / 60));
  for (const c of cands.filter((_, i) => i % step === 0).slice(0, 60)) {
    const st = mkState(c, NEUTRAL, []);   // ⚠ 能量 0 ⇒ 一定走補能量那條路
    let cnt = 0; try { cnt = mod.getEffectiveAttacks(st, st.players[0].active, pool).length; } catch { continue; }
    if (!cnt) continue;
    const before = JSON.stringify(st);
    try { mod.estimateAllAttacks(st, cnt, pool, 0); } catch { continue; }
    ran++;
    if (JSON.stringify(st) !== before) dirty++;
  }
  chk(`實跑 ${ran} 個「能量 0」的盤面，污染 ${dirty} 個`, ran >= 30 && dirty === 0);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑧ 【D】桌機 hover：提示掛在容器上，但按鈕**仍然按不下去**');
{
  // ⚠v6.238：這個容器多了 `class:est-open={…}`（放大鏡點開狀態）⇒ 錨點不能含結尾的 `>`。
  const i = PAGE.indexOf('<span class="atk-slot"');
  chk('模板有 .atk-slot 容器', i > 0);
  const seg = i > 0 ? PAGE.slice(i, i + 2600) : '';
  const iBtnEnd = seg.indexOf('</button>');
  const iEst = seg.indexOf('class="dmg-est"');
  chk('⭐ 提示在 </button> **之後**（不再是 disabled 按鈕的子節點）',
      iBtnEnd > 0 && iEst > iBtnEnd);
  chk('⭐⭐ 招式按鈕仍是**原生 disabled**（絕不可讓玩家按得下不能用的招式）',
      /disabled=\{actionBusy\|\|!availableAttacks\.includes\(i\)\|\|!!pendingSelection\}/.test(seg));
  chk('⭐ 沒有改用 aria-disabled 這種「看起來不能按、其實按得到」的做法',
      !/aria-disabled/.test(seg));
  chk('CSS 有 .atk-slot 定位基準（position:relative）', /\.atk-slot\{[^}]*position:relative;/.test(PAGE));
  chk('CSS hover 目標改成容器（.atk-slot:hover .dmg-est）', /\.atk-slot:hover \.dmg-est\{/.test(PAGE));
  chk('⚠ 舊的 .btn-act.atk:hover .dmg-est 已移除（留著會變成 unused CSS 警告）',
      !PAGE.includes('.btn-act.atk:hover .dmg-est{'));
  chk('⚠ .atk-slot 沒有被包在 @media 裡（禁止拿 @media 當手機開關）',
      (() => {
        const j = PAGE.indexOf('.atk-slot{');
        const head = PAGE.lastIndexOf('@media', j);
        if (head < 0 || j < 0) return j > 0;
        let depth = 0; const start = PAGE.indexOf('{', head);
        for (let k = start; k < j; k++) {
          if (PAGE[k] === '{') depth++; else if (PAGE[k] === '}') depth--;
          if (depth === 0 && k > start) break;
        }
        return depth <= 0;
      })());
  // 手機直式：本來就是把文字接在招式名後面，disabled 的招式照樣列出來 ⇒ 只要有數字就看得到
  const MOB = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');
  chk('手機直式：能量不足的招式照樣會被列出來（disabled 而不是不 render）',
      /disabled: !ok,/.test(MOB) && MOB.includes('estLabelSuffix(i)'));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑧b ⚠ 換 DOM 結構會讓 CSS 選擇器悄悄失聯 —— 用編譯器的 unused-CSS 警告當儀器');
{
  /**
   * ⚠⚠ 真實事故（就發生在寫這一版的時候）：招式鈕外面包了一層 `.atk-slot` 之後，
   *   `.playmat.layout-fable .action-bar > .action-btns > .btn-act.atk:nth-of-type(N)`
   *   （Fable 版面把招式鈕鎖在固定 grid 槽位的三條規則）因為**直接子選擇器**不再成立
   *   而整組失效 —— 桌機**預設**就是 Fable 版，版面會直接跑掉。
   *   靜態字串比對抓不到這種事；svelte 編譯器的 unused-CSS 警告抓得到 ⇒ 拿它當儀器。
   * ⚠ 只針對這一版碰到的 class 斷言（整份 +page.svelte 本來就有一批既有的 unused，
   *   那是另一件事，不在這一版的範圍）。
   */
  let warns = null, cerr = '', compile = null;
  try {
    ({ compile } = await import('svelte/compiler'));
    const out = compile(PAGE, { filename: 'game/+page.svelte', generate: 'client', dev: false });
    warns = (out.warnings || []).filter(w => /css_unused/.test(w.code || ''))
      .map(w => String(w.message).split('\n')[0]);
  } catch (e) { cerr = String(e && e.message).slice(0, 160); }
  chk('+page.svelte 編譯得過（模板沒有沒跳脫的 { } < >）' + (cerr ? '：' + cerr : ''), !!warns);
  if (warns) {
    const RELEVANT = ['.atk-slot', '.btn-act.atk', '.dmg-est'];
    const hit = warns.filter(w => RELEVANT.some(r => w.includes(r)));
    chk('⭐⭐ 招式鈕／預估提示相關的 CSS 選擇器沒有一條變成 unused'
        + (hit.length ? '（實得：' + hit.join(' ｜ ') + '）' : ''), hit.length === 0);
    // 儀器自驗（Rule 25）：拿一份**小**元件當試紙 —— 容器改名之後，
    //   「直接子選擇器」與「容器 class」兩種失聯都必須被警告抓到。
    //   ⚠ 刻意不用整份 +page.svelte 再編一次（1.1MB，編一次要十幾秒）。
    const PROBE = [
      '<div class="action-btns"><span class="atk-slot-XX">',
      '<button class="btn-act atk">x</button></span></div>',
      '<style>',
      '.action-btns{display:flex}',
      '.atk-slot{position:relative}',
      '.action-btns > .atk-slot:nth-of-type(1){grid-row:1}',
      '.btn-act.atk{color:red}',
      '</style>',
    ].join('\n');
    let probe = [], perr = '';
    try {
      const o2 = compile(PROBE, { filename: 'probe.svelte', generate: 'client', dev: false });
      probe = (o2.warnings || []).filter(w => /css_unused/.test(w.code || ''))
        .map(w => String(w.message).split('\n')[0]).filter(w => w.includes('.atk-slot'));
    } catch (e) { probe = []; perr = String(e && e.message).slice(0, 120); }
    chk(`儀器自驗：試紙上把容器改名 ⇒ 真的會冒出 .atk-slot 的 unused 警告（${probe.length} 條${perr ? '；' + perr : ''}）`,
        probe.length >= 2);
    // 反向自驗：class 正確時試紙必須全綠（否則上面那條可能是恆真的）
    let probe2 = [];
    try {
      const o3 = compile(PROBE.replace('atk-slot-XX', 'atk-slot'), { filename: 'probe2.svelte', generate: 'client', dev: false });
      probe2 = (o3.warnings || []).filter(w => /css_unused/.test(w.code || ''));
    } catch { probe2 = [{}]; }
    chk('儀器反向自驗：class 正確時試紙不會有 unused 警告', probe2.length === 0);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑨ 突變測試（沒有這一段，④ 可能只是恆真的安慰劑）');
{
  // 突變：把 +page.svelte 的 $state.snapshot(game) 改回 game ⇒ ④ 必須變紅
  const ex = extractDerivedBody(PAGE);
  if (!ex.body) chk('突變定位：抽不出本體', false);
  else {
    const mutated = ex.body.split('$state.snapshot(game) as GameState').join('game');
    chk('突變定位成功（找得到 $state.snapshot(game)）', mutated !== ex.body);
    const conv = toRunnable(mutated);
    if (conv.js && svelteProxy && svelteSnapshot) {
      let out = null;
      try { out = runDerived(conv.js, mkCtx(svelteProxy(structuredClone(PLAIN)), svelteSnapshot)); } catch { out = null; }
      chk('⭐ 突變：拿掉 $state.snapshot ⇒ 真的一個預估都顯示不出來（＝④ 抓得到）',
          !out || out.length === 0 || out.every(e => !mod.hasEstimateToShow(e)));
    } else chk('突變無法執行', false);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑩ HEAD-FAIL：BASE（v6.236）不可能通過這支守衛');
{
  const BASE = 'da59a0552e53a7668181a45f1f224891c7f42104';
  const git = (args) => {
    try {
      return { ok: true, out: execFileSync('git', ['-C', ROOT, ...args],
        { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8') };
    } catch { return { ok: false, out: '' }; }
  };
  // ⚠ CI 是 fetch-depth:1 的淺複製，物件庫裡沒有 BASE ⇒ 明講跳過，不可讓 git 例外炸掉整支測試。
  if (!git(['cat-file', '-e', BASE + '^{commit}']).ok) {
    console.log('  SKIP 本機物件庫沒有 BASE 這顆 commit（淺複製 / CI）⇒ 這一節只在完整 clone 才跑');
  } else {
    const bp = git(['cat-file', '-p', `${BASE}:src/routes/game/+page.svelte`]);
    const be = git(['cat-file', '-p', `${BASE}:src/lib/game/damage-estimate.ts`]);
    chk('取得 BASE 的兩個檔', bp.ok && be.ok);
    chk('HEAD-FAIL：BASE 的 +page.svelte 把 $state 的 game 直接丟進預估（④⑨ 會紅）',
        bp.ok && !bp.out.includes('$state.snapshot(') && /return estimateAllAttacks\(game,/.test(bp.out));
    chk('HEAD-FAIL：BASE 的深複製失敗是 `catch {` 全吞、一行診斷都沒有（⑤ 會紅）',
        be.ok && be.out.includes('    work = structuredClone(base);\n  } catch {') &&
        !be.out.includes('warnEstimateOnce'));
    chk('HEAD-FAIL：BASE 沒有能量不足的假設（⑥ 會紅）', be.ok && !be.out.includes('assumedEnergy'));
    chk('HEAD-FAIL：BASE 的提示掛在 disabled 按鈕上（⑧ 會紅）',
        bp.ok && bp.out.includes('.btn-act.atk:hover .dmg-est{') && !bp.out.includes('atk-slot'));
    // ⭐ 行為端 HEAD-FAIL：直接把 BASE 的 derived 本體抽出來跑，證明它真的算不出東西
    if (bp.ok && svelteProxy && svelteSnapshot) {
      const bex = extractDerivedBody(bp.out);
      const bconv = bex.body ? toRunnable(bex.body) : { err: bex.err };
      let out = null;
      if (bconv.js) { try { out = runDerived(bconv.js, mkCtx(svelteProxy(structuredClone(PLAIN)), svelteSnapshot)); } catch { out = null; } }
      chk('⭐⭐ 行為端 HEAD-FAIL：BASE 的本體餵 Svelte 代理 ⇒ 一個預估都顯示不出來',
          !!bconv.js && (!out || out.length === 0 || out.every(e => !mod.hasEstimateToShow(e))));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ⭐ IRON_RULES Rule 32：效能數字必須附量測腳本 —— 就是這一段。
console.log('\n⑪ 效能實測（沙盒 CPU 比正式機慢；看的是相對量級）');
{
  const cases = [];
  for (const [an, atkn] of [['菊草葉', '飛葉快刀'], ['大岩蛇', '怪力'], ['拉普拉斯ex', '水炮迴旋']]) {
    const f = findAtk(an, atkn);
    if (f && NEUTRAL) cases.push({ full: mkState(f.card, NEUTRAL, payFor(f.atk.cost, f.card.pokemonType)),
                                   empty: mkState(f.card, NEUTRAL, []), idx: f.idx, name: an + '｜' + atkn });
  }
  chk(`量測樣本 ${cases.length} 個`, cases.length >= 2);
  const REP = 30;
  const time = (fn) => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
  for (const c of cases) { mod.estimateAttackDamage(c.full, c.idx, pool, 0); mod.estimateAttackDamage(c.empty, c.idx, pool, 0); }
  for (const c of cases) {
    const tFull = time(() => { for (let i = 0; i < REP; i++) mod.estimateAttackDamage(c.full, c.idx, pool, 0); }) / REP;
    const tEmpty = time(() => { for (let i = 0; i < REP; i++) mod.estimateAttackDamage(c.empty, c.idx, pool, 0); }) / REP;
    console.log(`    ${c.name}：能量足夠 ${tFull.toFixed(3)} ms／招；能量 0（多一次乾跑）${tEmpty.toFixed(3)} ms／招`);
  }
  // ⭐ $state.snapshot 這一次額外的深拷貝值多少？（每次盤面變動**只做一次**，不是每招一次）
  if (svelteSnapshot && svelteProxy) {
    const p = svelteProxy(structuredClone(PLAIN));
    const tSnap = time(() => { for (let i = 0; i < 200; i++) svelteSnapshot(p); }) / 200;
    const tClone = time(() => { for (let i = 0; i < 200; i++) structuredClone(PLAIN); }) / 200;
    console.log(`    $state.snapshot 一次 ${tSnap.toFixed(3)} ms；structuredClone 一次 ${tClone.toFixed(3)} ms`);
    chk(`⭐ 多出來的那一次深拷貝 < 3 ms（實得 ${tSnap.toFixed(3)} ms）`, tSnap < 3);
  }
}

console.log(`\n[v6237-estimate-state-proxy] PASS ${n - bad} / FAIL ${bad}`);
process.exit(bad ? 1 : 0);
