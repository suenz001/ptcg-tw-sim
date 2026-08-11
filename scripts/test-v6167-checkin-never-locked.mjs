#!/usr/bin/env node
/**
 * v6.167 守衛：**該能報到的玩家，在任何情況下都不會被鎖住**。
 *
 * 這支守衛是 v6.160 事故的直接產物。v6.160 為報到加了「client 版本太舊 → 跳視窗提示更新」，
 * 設計時把「把玩家鎖在賽外」列為唯一失敗模式並寫了五條 fail-open；但提示視窗被放進
 * `{#if isTournament && tStep !== 'playing'}` 的 **else（＝對戰中）** 分支，
 * 而「✋ 我要報到」鈕在 then（＝大廳）分支 —— 兩者條件互斥 ⇒ 版本閘一擋人，
 * 視窗永遠畫不出來，玩家只看到「按了沒反應」，正是要防的那件事。
 *
 * ⚠⚠ 斷言「有呼叫某函式」≠「那件事發生了」（v6.137/v6.154 教訓）。所以：
 *   ① 版面可達性用 **svelte 編譯器的 AST 實跑求值** 兩個節點的 if-chain，不是字串比對；
 *   ② 「按下報到會不會真的報到」用 **真的把 +page.svelte 裡那三支函式抽出來執行**，
 *      斷言的是 `/checkin` 這一發 API 有沒有被送出去，不是「有沒有呼叫 tCheckinCommit」。
 */
import { build, transform } from 'esbuild';
import { parse } from 'svelte/compiler';
import { readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTVC = join(ROOT, '.xv6167-vc.mjs');
const OUTHN = join(ROOT, '.xv6167-hn.mjs');
process.on('exit', () => { for (const f of [OUTVC, OUTHN]) { try { unlinkSync(f); } catch { /* */ } } });

const rd = (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
const PAGE = rd('src/routes/game/+page.svelte');
const CLOG = rd('static/changelog.html');
const VER = rd('src/lib/version.ts');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  let v = cond;
  if (typeof cond === 'function') { try { v = cond(); } catch (e) { v = false; extra = extra || ('例外：' + (e && e.message)); } }
  if (v) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

// ── 共用：算出某個字元位置所在節點的「if-chain」（每一層記下條件字面量與走 then/else）──
function ifChains(src, targets) {
  const ast = parse(src, { modern: true });
  const out = {};
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, path); return; }
    if (node.type === 'IfBlock' && node.test) {
      const cond = src.slice(node.test.start, node.test.end).replace(/\s+/g, ' ').trim();
      walk(node.consequent, path.concat([{ cond, branch: 'then' }]));
      if (node.alternate) walk(node.alternate, path.concat([{ cond, branch: 'else' }]));
      return;
    }
    if (typeof node.start === 'number' && typeof node.end === 'number') {
      for (const k of Object.keys(targets)) {
        const i = targets[k];
        if (i >= 0 && node.start <= i && i < node.end) out[k] = path;
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'parent') continue;
      walk(node[k], path);
    }
  };
  walk(ast.fragment, []);
  return out;
}
/** 兩條 if-chain 若對同一個條件各走 then / else ⇒ 兩個節點**永遠不可能同時在畫面上**。 */
function exclusiveCond(a, b) {
  for (const x of (a || [])) for (const y of (b || [])) {
    if (x.cond === y.cond && x.branch !== y.branch) return x.cond;
  }
  return null;
}

// ══ ⓪ 掃描器自我驗證（Rule 25：掃描器自身要先驗）══════════════════════════
console.log('⓪ 掃描器自我驗證');
{
  const bad = `{#if A}<button class="X"></button>{:else}<div class="Y"></div>{/if}`;
  const good = `{#if A}<button class="X"></button>{/if}<div class="Y"></div>`;
  ok('★互斥偵測器抓得到「一個在 then、一個在 else」', () => {
    const c = ifChains(bad, { b: bad.indexOf('class="X"'), m: bad.indexOf('class="Y"') });
    return exclusiveCond(c.b, c.m) === 'A';
  });
  ok('★互斥偵測器不會冤枉「兩個都在同一層」（有正對照，非否定型空轉）', () => {
    const c = ifChains(good, { b: good.indexOf('class="X"'), m: good.indexOf('class="Y"') });
    return exclusiveCond(c.b, c.m) === null;
  });
}

// ══ ① 報到鈕 vs 版本閘提示視窗：**同時可見** ════════════════════════════
console.log('① 報到鈕與版本提示視窗的版面可達性（svelte AST 實跑求值）');
const BTN_MARK = 'onclick={() => tCheckin(ev._id)}';
const MODAL_MARK = 'class="tourn-vergate-mask"';
let chains = null;
try {
  chains = ifChains(PAGE, { btn: PAGE.indexOf(BTN_MARK), modal: PAGE.indexOf(MODAL_MARK) });
} catch (e) { chains = null; console.log('  （AST 解析失敗：' + (e && e.message) + '）'); }
ok('報到鈕存在於 src/routes/game/+page.svelte', PAGE.indexOf(BTN_MARK) >= 0);
ok('版本閘提示視窗存在於 src/routes/game/+page.svelte', PAGE.indexOf(MODAL_MARK) >= 0);
ok('★★★報到鈕與提示視窗沒有任何互斥條件（視窗真的畫得出來）', () => {
  const c = exclusiveCond(chains && chains.btn, chains && chains.modal);
  if (c) throw new Error('互斥於條件：' + c);
  return !!(chains && chains.btn && chains.modal);
});
ok("★★★提示視窗不在 tStep !== 'playing' 的任何一邊（大廳／對戰兩個版面分支之外）", () => {
  const ch = (chains && chains.modal) || [];
  return !ch.some((p) => /tStep\s*!==\s*'playing'/.test(p.cond));
});
// ⚠ 上面兩條只抓「字面相同的條件」的互斥（Fable 5 指出的盲點）：語義互斥但字面不同
//   （例如 tStep === 'lobby' vs tStep === 'playing'）抓不到。所以再加一條**更強**的：
//   提示視窗的 if-chain 深度必須恰好是 1 ＝ 它就在 fragment 頂層、只受自己那個條件管。
ok('★★★提示視窗的 if-chain 深度恰好為 1（就在最外層，任何巢狀都不允許）', () => {
  const ch = (chains && chains.modal) || null;
  if (!ch) throw new Error('找不到提示視窗的 if-chain');
  if (ch.length !== 1) throw new Error('深度 ' + ch.length + '：' + ch.map((p) => p.branch + ' ' + p.cond).join(' / '));
  return /tVerModalEventId/.test(ch[0].cond);
});

// ══ ② 報到鈕的 disabled 條件 ════════════════════════════════════════════
console.log('② 報到鈕的 disabled 條件');
{
  const line = (PAGE.split('\n').find((l) => l.includes(BTN_MARK)) || '');
  const m = /disabled=\{([^}]*)\}/.exec(line);
  ok('報到鈕有 disabled 屬性', !!m);
  // ⚠ 只允許 tBusy（有 finally 保證會放開的短暫操作鎖）。任何新條件都可能變成永久 disabled，
  //   要加請先想清楚「這個條件卡住時玩家怎麼自救」，並回來改這條守衛。
  ok('★★★disabled 只綁 tBusy（沒有任何可能永久成立的新條件）', () => !!m && m[1].trim() === 'tBusy');
}

// ══ ③ 行為端：按下「我要報到」，一定會報到成功 ══════════════════════════
console.log('③ 行為端：任何情境下按 ≤2 次一定完成報到');
let runHarness = null, harnessErr = null;
try {
  await build({
    entryPoints: [join(ROOT, 'src/lib/version-compare.ts')],
    outfile: OUTVC, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent',
  });
  const a = PAGE.indexOf('function tCheckinBlockedByVersion');
  const b = PAGE.indexOf('function tSendLobbyDiag');
  if (a < 0 || b < 0 || b <= a) throw new Error('抓不到 tCheckinBlockedByVersion / tVerModalUpdate 的區間');
  const tsSrc = PAGE.slice(a, b);
  const js = (await transform(tsSrc, { loader: 'ts', target: 'node20' })).code;
  const mod = `
import { isClientTooOld, recentlyHardRefreshed } from ${JSON.stringify(pathToFileURL(OUTVC).href)};
export function run(env) {
  const VERSION = env.VERSION;
  let tMinClientVer = env.minVer;
  let tEvents = env.events;
  let tNow = env.now;
  let tBusy = false, tError = '', tCheckinErrId = '';
  let tVerModalEventId = '';
  let tVerModalBusy = false;
  const hardRefreshCalls = [];
  const hardRefreshNow = async () => { hardRefreshCalls.push(1); };
  const _tVerPrompted = new Set();
  const isTournament = true;
  const window = { location: { href: env.href } };
  const apiCalls = [];
  const diags = [];
  const tApi = async (path, body) => { apiCalls.push({ path, body }); return {}; };
  const tournLoadEvent = () => {};
  const tSendLobbyDiag = (reason) => { diags.push(reason); };
${js}
  return { press: (id) => tCheckin(id), skip: () => tVerModalSkip(), apiCalls, diags,
           modal: () => tVerModalEventId, hardRefreshCalls };
}
`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUTHN, mod, 'utf8');
  runHarness = (await import(pathToFileURL(OUTHN).href + '?t=' + Date.now())).run;
} catch (e) { harnessErr = (e && e.message ? String(e.message).split('\n')[0] : String(e)); }

const NOW = 1800000000000;
const EV = (over) => [Object.assign({ _id: 'E1', checkInDeadline: NOW + 600000 }, over || {})];
const base = { VERSION: '6.100', minVer: '', events: EV(), now: NOW, href: 'https://x.tw/game?t=1' };
async function pressUntilCheckin(env, maxPress) {
  const h = runHarness(env);
  let n = 0;
  while (n < maxPress) {
    n++;
    await h.press('E1');
    if (h.apiCalls.some((c) => c.path === '/checkin')) return { presses: n, h };
  }
  return { presses: Infinity, h };
}
const scen = [
  ['閘關閉（minClientVer 空字串）⇒ 一次就報到', { minVer: '' }, 1],
  ['閘開啟但 client 夠新 ⇒ 一次就報到', { VERSION: '6.170', minVer: '6.160' }, 1],
  ['★★★閘開啟且 client 太舊 ⇒ 最多按兩次一定報到', { VERSION: '6.100', minVer: '6.160' }, 2],
  ['門檻是垃圾值 ⇒ 一次就報到', { minVer: 'abc' }, 1],
  ['門檻是 null ⇒ 一次就報到', { minVer: null }, 1],
  ['剛強制更新過（URL 帶新鮮 _v）⇒ 一次就報到', { VERSION: '6.100', minVer: '6.160', href: 'https://x.tw/game?_v=' + Date.now() }, 1],
  ['報到只剩 10 秒 ⇒ 一次就報到', { VERSION: '6.100', minVer: '6.160', events: EV({ checkInDeadline: NOW + 10000 }) }, 1],
  ['★找不到該場賽事（剩餘時間算成 Infinity）⇒ 最多兩次', { VERSION: '6.100', minVer: '6.160', events: [] }, 2],
  ['★checkInDeadline 為 null ⇒ 最多兩次', { VERSION: '6.100', minVer: '6.160', events: EV({ checkInDeadline: null }) }, 2],
  ['判定本身丟例外（tEvents 為 null）⇒ 一次就報到', { VERSION: '6.100', minVer: '6.160', events: null }, 1],
  ['VERSION 解析不出來 ⇒ 一次就報到', { VERSION: '6.16.0', minVer: '6.160' }, 1],
  ['★★★連按 5 次也一定至少報到一次（不會無限空轉）', { VERSION: '6.100', minVer: '6.160' }, 5],
];
for (const [name, over, limit] of scen) {
  if (harnessErr) { ok(name, false, 'harness 載入失敗：' + harnessErr); continue; }
  let r = null, err = null;
  try { r = await pressUntilCheckin(Object.assign({}, base, over), 5); } catch (e) { err = e && e.message; }
  ok(name, !!r && r.presses <= limit, err || (r ? ('實際需要按 ' + r.presses + ' 次（上限 ' + limit + '）') : ''));
}
// ⚠ 正對照（否定型守衛必須配正對照，v6.059 教訓）：上面全綠也可能只是「版本閘整個壞掉、
//   從來不擋人」。所以要反過來確認「該擋的時候第一次按確實只開視窗、沒有直接報到」。
{
  if (harnessErr) ok('★正對照：閘開啟且 client 太舊時，第一次按確實只開提示視窗', false, harnessErr);
  else {
    const h = runHarness(Object.assign({}, base, { VERSION: '6.100', minVer: '6.160' }));
    await h.press('E1');
    ok('★正對照：閘開啟且 client 太舊時，第一次按確實只開提示視窗',
      h.modal() === 'E1' && !h.apiCalls.some((c) => c.path === '/checkin'), 'modal=' + h.modal());
  }
}

// ⭐ 逃生口「先不更新，直接報到」的行為端（Fable 5 指出原本只有結構斷言）
{
  if (harnessErr) ok('★★★逃生鈕「先不更新，直接報到」真的完成報到', false, harnessErr);
  else {
    const h = runHarness(Object.assign({}, base, { VERSION: '6.100', minVer: '6.160' }));
    await h.press('E1');
    await h.skip();
    ok('★★★逃生鈕「先不更新，直接報到」真的完成報到',
      h.apiCalls.some((c) => c.path === '/checkin') && h.modal() === '' && h.hardRefreshCalls.length === 0,
      'checkin=' + h.apiCalls.map((c) => c.path).join(',') + ' modal=' + h.modal());
  }
}

// ══ ④ 玩家看得到的自救說明 ══════════════════════════════════════════════
console.log('④ 報到鈕旁的自救說明與版本');
ok('★報到鈕附近有「按了沒反應請再按一次」的提示', PAGE.includes('按了沒反應請再按一次'));
ok('★提示裡有站長指定的「請至首頁更新版本」', PAGE.includes('請至首頁更新版本'));
ok('版本已 bump 到 6.167 以上', () => {
  const m = /VERSION\s*=\s*'(\d+)\.(\d+)'/.exec(VER);
  if (!m) return false;
  const cur = Number(m[1]) + Number('0.' + m[2]);
  return cur >= 6.167 - 1e-9;
});
// ⭐⭐⭐v6.167：tApi 的 getIdToken 在 v6.135 那顆 fetch 逾時之前，卡住＝tBusy 永久 true
//   ＝大廳每一顆鈕（含報到）永久 disabled。這一條釘住它有自己的上限。
ok('★★★tApi 的 getIdToken 有逾時上限（否則 tBusy 會永久 true ⇒ 報到鈕永久 disabled）', () => {
  const i = PAGE.indexOf('async function tApi(');
  const seg = PAGE.slice(i, i + 3000);
  return /Promise\.race[\s\S]{0,300}?getIdToken\(\)/.test(seg) && /setTimeout\(\(\) => r\(null\), \d+\)/.test(seg);
});
ok('★報到失敗的訊息會貼著報到鈕顯示（不是只印在大廳最底下）',
  PAGE.includes('tCheckinErrId === ev._id && tError') && PAGE.includes('tCheckinErrId = eventId'));
ok('首頁 changelog 有 v6.167 這一則（玩家有感）', CLOG.includes('v6.167') && CLOG.includes('報到'));

console.log(`\nv6.167 報到不被鎖住守衛：${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
