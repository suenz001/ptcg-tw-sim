#!/usr/bin/env node
/**
 * ⭐⭐⭐ v6.384 守衛：休閒（一般）對戰的版本閘。
 *
 * 站長 2026-09-14 裁定（玩家建議「讓玩家們的版本盡量可以一致」）：
 *   ・門檻與錦標賽**共用同一份設定**（伺服器 tournamentConfig 的 minClientVer）
 *   ・**所有人都擋**（含匿名）⇒ 門檻走公開端點 /api/client-min-version
 *   ・**觀戰也擋**
 *   ・擋法沿用錦標賽那套：提示一次 ＋ 永遠有逃生鈕
 *
 * 這支守衛的重心與 v6.160 相同：功能的**唯一**失敗模式是「把玩家鎖在房間外」。
 * 所以每一條 fail-open 都要**真的跑**（不是 grep 字串），而且要有正對照證明
 * 「這個判準真的擋得住東西」。
 *
 * 【A】中央判準本身（行為端，真的跑 evaluateVersionGate）
 * 【B】收斂：錦標賽與休閒**共用同一支**（Rule 38），舊的 inline 五條不得復活
 * 【C】三個入口都過閘（建立／加入／觀戰 —— 觀戰與加入同一支 handler）
 * 【D】提示視窗在最外層、兩顆鈕都會離開視窗、逃生鈕真的完成原本的動作
 * 【E】伺服器端點：公開、fail-open、重用 minVerConfig（沒有第二份判準）
 * 【F】零回歸：錦標賽那條路徑的判定結果與 v6.383 逐案相同
 * 【H】行為端 harness：把那三支函式抽出來**真的跑**（本支守衛的主體；【C】【D】只是結構面）
 *      ⭐ Fable 5 第二輪複審自設 28 個突變，沒有一個能讓玩家按 ≤2 次進不了房；
 *        它抓到的 Y1（視窗開著時鍵盤重入 ⇒ 兩間房）已修，由 H21 ＋ 突變 M8 釘住。
 * 【G】HEAD-FAIL：BASE(v6.383) 沒有這些東西 ⇒ 每一條都必須紅
 */
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
// ⭐v6.384：與 test-v6167 共用同一支 svelte if-chain 求值器（Rule 38：一個判準一份）。
import { ifChains, exclusiveCond } from './lib/svelte-if-chains.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTG = join(ROOT, '.xv6384g.mjs');
process.on('exit', () => { try { unlinkSync(OUTG); } catch { /* */ } });

// ⚠ HEAD-FAIL 的 BASE ＝ 本版的前一版（v6.383）。這不是「pin 死版本號」那種安慰劑 ——
//   HEAD-FAIL 本來就需要一顆具體的 commit 當對照；它過期的唯一後果是【G】整段 skip（會大聲印出來）。
const BASE_SHA = 'e78b2312bc5b59c7037c3a8280dea485d5b8a3cc';   // v6.383

const rd = (rel) => { try { return normEol(readFileSync(join(ROOT, rel), 'utf8')); } catch { return ''; } };
const PAGE = rd('src/routes/game/+page.svelte');
const SRV = rd('oracle-admin/server_admin_patch.js');
const GATE = rd('src/lib/version-gate.ts');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  let v = cond;
  if (typeof cond === 'function') {
    try { v = cond(); } catch (e) { v = false; extra = extra || ('例外：' + (e && e.message)); }
  }
  // ⚠⚠ Fable 5 複審 Y4：async thunk 回的是 Promise，而 Promise 恆為 truthy ⇒ 永遠 PASS。
  //   這是「將來有人把某條改成 async 就靜默變綠」的陷阱 ⇒ 直接判紅，逼呼叫端改用 okA。
  if (v && typeof v.then === 'function') { v = false; extra = extra || '斷言回傳 Promise（async 的要用 okA）'; }
  if (v) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

// ── 載入中央判準（真的跑，不是 grep）
let G = null, modErr = null;
try {
  await build({
    entryPoints: [join(ROOT, 'src/lib/version-gate.ts')],
    outfile: OUTG, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent',
  });
  G = await import(pathToFileURL(OUTG).href);
  if (typeof G.evaluateVersionGate !== 'function') { modErr = 'version-gate.ts 沒有 export evaluateVersionGate'; G = null; }
} catch (e) { modErr = 'version-gate.ts 載入失敗：' + (e && e.message ? String(e.message).split('\n')[0] : e); }
const okb = (name, thunk) => ok(name, modErr ? false : thunk, modErr || '');

const NOW = 1_800_000_000_000;
const BASE_IN = { cur: '6.100', min: '6.383', href: 'https://x.tw/game', now: NOW, alreadyPrompted: false };
const gate = (over) => G.evaluateVersionGate(Object.assign({}, BASE_IN, over || {}));

// ══ 【A】中央判準本身 ═══════════════════════════════════════════════════
console.log('\n【A】中央判準（真的跑 evaluateVersionGate）');
okb('A1 ⭐⭐⭐ 版本比門檻舊 ⇒ 擋（否則整支守衛下面全部是空轉）',
  () => gate().block === true && gate().reason === 'too-old');
okb('A2 ⭐⭐ 版本不舊 ⇒ 不擋', () => gate({ cur: '6.400' }).block === false);
okb('A3 ⭐⭐⭐ 門檻空字串（沒設定／灰度沒開）⇒ 不擋任何人',
  () => gate({ min: '' }).block === false && gate({ min: undefined }).block === false);
okb('A4 ⭐⭐⭐ 已提示過一次 ⇒ 不擋（v6.167 不變式：最壞只白按一次）',
  () => gate({ alreadyPrompted: true }).block === false);
okb('A5 ⭐⭐ 剛按過更新、版本仍舊 ⇒ 不擋',
  () => gate({ href: 'https://x.tw/game?_v=' + (NOW - 5000) }).block === false);
okb('A6 ⭐ 截止時間不足 ⇒ 不擋；剛好等於門檻 ⇒ 仍擋（邊界）',
  () => gate({ deadlineLeftMs: 29000 }).block === false && gate({ deadlineLeftMs: 30000 }).block === true);
okb('A7 ⭐⭐⭐ 沒傳 deadlineLeftMs（休閒對戰沒有截止時間）⇒ 視為無限 ⇒ 照常擋',
  () => gate({ deadlineLeftMs: undefined }).block === true);
okb('A8 ⭐⭐ deadlineLeftMs 是 NaN／null ⇒ 也視為無限（不可以靜默走錯邊）',
  () => gate({ deadlineLeftMs: NaN }).block === true && gate({ deadlineLeftMs: null }).block === true);
okb('A9 ⭐⭐ 任何輸入都不 throw（會 throw 就等於逃生口壞掉）', () => {
  for (const bad of [null, undefined, 0, '', {}, [], NaN]) {
    try { G.evaluateVersionGate(bad); } catch { return false; }
    try { gate({ cur: bad, min: bad, href: bad, now: bad }); } catch { return false; }
  }
  return true;
});
okb('A9b ⭐⭐⭐ 判斷本身出錯 ⇒ 一律放行（A9 只驗不 throw，那不等於 fail-open）', () => {
  for (const bad of [null, undefined, 0, 1, '', 'x', {}, [], NaN, true]) {
    const r = G.evaluateVersionGate(bad);
    if (!r || r.block !== false) return false;
  }
  return true;
});
okb('A10 ⭐ reason 可用來送診斷（四條放行各有自己的 reason）', () => {
  const rs = [gate({ cur: '6.400' }).reason, gate({ alreadyPrompted: true }).reason,
    gate({ href: 'https://x.tw/game?_v=' + (NOW - 5000) }).reason, gate({ deadlineLeftMs: 1 }).reason];
  return rs.join(',') === 'not-old,already-prompted,recently-refreshed,deadline-near';
});
okb('A11 ⭐⭐ readMinVersionPayload：enabled 不是 true ⇒ 一律空字串（灰度沒開就不生效）', () => {
  const f = G.readMinVersionPayload;
  return f({ enabled: true, min: '6.380' }) === '6.380'
    && f({ enabled: false, min: '6.380' }) === ''
    && f({ min: '6.380' }) === ''
    && f({ enabled: true, min: 123 }) === ''
    // ⚠ Fable 5 複審 Y7：`enabled` 必須是**嚴格布林 true**。伺服器目前保證送布林，
    //   但只要哪天改成送 1／'true'，寬鬆比較就會讓灰度「看起來沒開卻真的開了」。
    && f({ enabled: 1, min: '6.380' }) === ''
    && f({ enabled: 'true', min: '6.380' }) === ''
    && f(null) === '' && f('x') === '' && f(undefined) === '';
});

// ══ 【B】收斂 ═══════════════════════════════════════════════════════════
console.log('\n【B】收斂：兩邊共用同一支判準');
ok('B1 ⭐⭐⭐ 錦標賽的 tCheckinBlockedByVersion 改走中央判準',
  /function tCheckinBlockedByVersion[\s\S]{0,1200}?evaluateVersionGate\(\{/.test(PAGE));
ok('B2 ⭐⭐⭐ 休閒的閘也走同一支（不是自己抄一份 if）',
  /function casualVerBlock[\s\S]{0,900}?evaluateVersionGate\(\{/.test(PAGE));
ok('B3 ⭐⭐⭐ 舊的 inline 五條不得復活（頁面上不再自己比版本／自己判剛更新過）', () => {
  const a = PAGE.indexOf('function tCheckinBlockedByVersion');
  const b = PAGE.indexOf('async function tCheckin(', a);
  const seg = a >= 0 && b > a ? PAGE.slice(a, b) : '';
  return seg.length > 100 && !/isClientTooOld\(/.test(seg) && !/recentlyHardRefreshed\(/.test(seg);
});
ok('B4 ⭐ 掃描器自我驗證：舊寫法會被 B3 判為未收斂',
  'function tCheckinBlockedByVersion(){ if (!isClientTooOld(a,b)) return false; }'.includes('isClientTooOld('));
ok('B5 ⭐⭐ 門檻數字只有一份（頁面上不再出現 30000 這個字面量的判斷）',
  !/_left < 30000/.test(PAGE) && /DEADLINE_FLOOR_MS_DEFAULT = 30000/.test(GATE));

// ══ 【C】三個入口 ═══════════════════════════════════════════════════════
console.log('\n【C】三個入口都過閘');
ok('C1 ⭐⭐⭐ 建立房間過閘，且擋下來就不執行原本的動作',
  /async function handleCreateRoom\(\) \{[\s\S]{0,400}?if \(await casualVerGate\('create', handleCreateRoomCommit\)\) return;/.test(PAGE));
ok('C2 ⭐⭐⭐ 加入房間過閘（列表的「加入」與「👁 觀戰」都走這一支）',
  /async function handleJoinRoom\(\) \{[\s\S]{0,500}?if \(await casualVerGate\(_k, handleJoinRoomCommit\)\) return;/.test(PAGE));
ok('C3 ⭐⭐⭐ 觀戰真的與加入同一條路（handleJoinFromList → handleJoinRoom）', () => {
  const a = PAGE.indexOf('async function handleJoinFromList');
  const seg = a >= 0 ? PAGE.slice(a, a + 500) : '';
  return /await handleJoinRoom\(\)/.test(seg);
});
ok('C4 ⭐⭐ 觀戰按鈕確實呼叫 handleJoinFromList（模板端；否則 C3 只是紙上談兵）',
  (PAGE.match(/onclick=\{\(\) => handleJoinFromList\(r\.roomId\)\}/g) || []).length >= 2);
ok('C5 ⭐ 原本的動作被搬成 Commit（沒有把身分檢查一起搬掉）',
  /async function handleCreateRoomCommit\(\) \{[\s\S]{0,200}?請輸入玩家名稱/.test(PAGE)
  && /async function handleJoinRoomCommit\(\) \{[\s\S]{0,200}?請輸入玩家名稱/.test(PAGE));
ok('C6 ⭐⭐ 抓門檻有時間上限（端點慢也不能讓按鈕看起來沒反應）',
  /Promise\.race\(\[ensureCasualMinVer\(\), new Promise\(\(r\) => setTimeout\(r, 1500\)\)\]\)/.test(PAGE));
ok('C7 ⭐⭐ 門檻只抓一次、失敗不重試（旗標先設再抓）',
  /if \(_casualMinVerFetched\) return;\s*\n\s*_casualMinVerFetched = true;/.test(PAGE));
ok('C8 ⭐⭐⭐ 抓不到門檻 ⇒ 維持空字串（fail-open，不擋任何人）',
  /if \(!r\.ok\) return;/.test(PAGE) && /catch \{ \/\* 網路錯誤/.test(PAGE));

// ══ 【D】提示視窗 ═══════════════════════════════════════════════════════
console.log('\n【D】提示視窗（可達性與逃生口）');
// ⭐ 判準：svelte 模板裡**巢狀的區塊一定有縮排**，只有最外層才頂在行首。
//   （v6.167 的教訓：視窗寫進某個版面分支 ⇒ 另一個分支永遠畫不出來 ＝ 按了沒反應。）
ok('D1 ⭐⭐⭐ 休閒視窗在**最外層**（行首，不在任何版面分支裡）',
  /^\{#if !isTournament && casualVerModalKey\}$/m.test(PAGE));
ok('D2 ⭐ 正對照：錦標賽那個視窗也在行首（證明這個判準抓得到「最外層」這件事）',
  /^\{#if isTournament && !isTournSpectator && tVerModalEventId\}$/m.test(PAGE));
ok('D2b ⭐ 掃描器自我驗證：有縮排（＝巢狀）的話 D1 會判為未修',
  !/^\{#if !isTournament && casualVerModalKey\}$/m.test('  {#if !isTournament && casualVerModalKey}'));
// ⚠⚠ D1 的行首 regex 有一個 Fable 5（v6.384 獨立審查）指出的盲點：**把視窗搬進某個互斥
//   分支、但仍然維持行首**（例如整個包進 `{#if !isTournament}`，而按鈕在別的分支）
//   D1 照樣會綠。⇒ 底下改用 svelte 編譯器的 AST **實跑求值**，判的是
//   「視窗與三顆入口按鈕有沒有互斥條件」「視窗的 if-chain 深度是不是恰好 1」。
//   ⚠ 這支求值器與 v6.167 用的是**同一份**（已抽成 scripts/lib/svelte-if-chains.mjs）——
//     複製一份會讓兩支守衛的判準各自漂移（Rule 38）。
let CH = null, chErr = '';
try {
  CH = ifChains(PAGE, {
    cvg: PAGE.indexOf('aria-labelledby="cvg-title"'),
    btnCreate: PAGE.indexOf('onclick={handleCreateRoom}'),
    btnJoin: PAGE.indexOf('onclick={handleJoinRoom}'),
    btnSpec: PAGE.indexOf('class="btn-sm spectator-btn or-act"'),
  });
} catch (e) { chErr = 'svelte AST 解析失敗：' + (e && e.message ? String(e.message).split('\n')[0] : e); }
ok('D1c ⭐ 掃描器自我驗證：互斥偵測器抓得到「一個在 then、一個在 else」', () => {
  const bad = '{#if A}<button class="X"></button>{:else}<div class="Y"></div>{/if}';
  const c = ifChains(bad, { b: bad.indexOf('class="X"'), m: bad.indexOf('class="Y"') });
  return exclusiveCond(c.b, c.m) === 'A';
});
ok('D1d ⭐ 掃描器自我驗證：不會冤枉「兩個都在同一層」（正對照，不是否定型空轉）', () => {
  const good = '{#if A}<button class="X"></button>{/if}<div class="Y"></div>';
  const c = ifChains(good, { b: good.indexOf('class="X"'), m: good.indexOf('class="Y"') });
  return exclusiveCond(c.b, c.m) === null;
});
ok('D1e ⭐⭐⭐ AST：休閒視窗的 if-chain 深度恰好為 1（就在最外層，任何巢狀都不允許）', () => {
  if (chErr) throw new Error(chErr);
  const c = CH && CH.cvg;
  if (!c) throw new Error('AST 找不到休閒視窗（aria-labelledby="cvg-title"）');
  if (c.length !== 1) throw new Error('深度 ' + c.length + '：' + c.map((p) => p.branch + ' ' + p.cond).join(' / '));
  return /casualVerModalKey/.test(c[0].cond);
});
// ⚠ 誠實標註（Fable 5 複審 Y2）：D1e 一旦成立（視窗的 chain 只剩自己那一條），
//   D1f 幾乎必然也成立 —— `exclusiveCond` 只比對**字面相同**的條件字串，
//   而三顆鈕的 chain 不可能含有視窗那一條。⇒ D1f 是輔助條，真正的判準是 D1e。
//   它仍然有用：AST 找不到任何一顆鈕（被改名／搬走）時會紅。
ok('D1f ⭐ AST（輔助）：三顆入口鈕都找得到，且與休閒視窗沒有字面互斥的條件', () => {
  if (chErr) throw new Error(chErr);
  for (const k of ['btnCreate', 'btnJoin', 'btnSpec']) {
    if (!(CH && CH[k])) throw new Error('AST 找不到節點：' + k);
    const x = exclusiveCond(CH.cvg, CH[k]);
    if (x) throw new Error(k + ' 與視窗互斥於條件：' + x);
  }
  return true;
});

ok('D3 ⭐⭐⭐ 逃生鈕存在且真的執行原本的動作（不是只把視窗關掉）',
  PAGE.includes('先不更新，直接進房') && PAGE.includes('onclick={casualVerModalSkip}')
  && /async function casualVerModalSkip\(\)[\s\S]{0,400}?if \(_act\) await _act\(\);/.test(PAGE));
ok('D4 ⭐⭐ 逃生路徑沒有任何會 throw 的前置動作（Safari 無痕 setItem 會 throw）', () => {
  const a = PAGE.indexOf('async function casualVerModalSkip');
  const seg = a >= 0 ? PAGE.slice(a, a + 500) : '';
  return seg.length > 50 && !/sessionStorage|localStorage/.test(seg);
});
ok('D5 ⭐⭐⭐ 更新鈕有 5 秒看門狗（否則 replace 沒導航 ⇒ 連逃生口都按不動）',
  /setTimeout\(\(\) => \{ casualVerModalBusy = false; \}, 5000\);[\s\S]{0,220}?await hardRefreshNow\(\)/.test(PAGE));
ok('D6 ⭐ 看門狗掛在 await 之前（掛在後面等於沒掛）', () => {
  const a = PAGE.indexOf('casualVerModalBusy = false; }, 5000)');
  const u = PAGE.indexOf('async function casualVerModalUpdate');
  const b = u < 0 ? -1 : PAGE.indexOf('await hardRefreshNow();', u);
  return a >= 0 && b > a;
});
ok('D7 ⭐⭐ pendingAction 在開視窗當下就存好（不可事後從 key 反推）',
  /_casualVerPendingAction = action;\s*\n\s*casualVerModalKey = key;/.test(PAGE));
ok('D8 ⭐ 判定路徑上沒有 hardRefreshNow（絕不自動重載）', () => {
  const a = PAGE.indexOf('function casualVerBlock');
  const b = PAGE.indexOf('async function casualVerModalUpdate');
  const seg = a >= 0 && b > a ? PAGE.slice(a, b) : '';
  return seg.length > 200 && !seg.includes('hardRefreshNow(');
});

// ⚠⚠ Fable 5 複審 Y3：下面四條是**字面 pin**，不是行為斷言 —— 它們守的是模板，
//   而模板沒有便宜的行為測法（harness 只抽得到 <script> 那半邊）。已知它們擋不住
//   「換個等價寫法」，但擋得住審查實測會存活的那三個突變：
//     ・逃生鈕 disabled={casualVerModalBusy} → disabled={true}（重載沒導航時逃生鈕永遠灰）
//     ・casualVerModalKey 從 $state 退回普通 let（視窗永遠不出現）
//     ・遮罩被 hidden 掉
ok('D9 ⭐⭐⭐ 逃生鈕的 disabled 只能掛 casualVerModalBusy（那個有 5 秒看門狗）',
  PAGE.includes('<button class="tvg-btn tvg-ghost" disabled={casualVerModalBusy} onclick={casualVerModalSkip}>先不更新，直接進房</button>'));
ok('D10 ⭐⭐ 更新鈕同理（disabled 也只掛 casualVerModalBusy）',
  PAGE.includes('<button class="tvg-btn tvg-primary" disabled={casualVerModalBusy} onclick={casualVerModalUpdate}>'));
ok('D11 ⭐⭐⭐ casualVerModalKey／Busy 必須是 $state（普通 let 不驅動畫面 ⇒ 視窗永遠不出現）',
  /let casualVerModalKey = \$state\(''\);/.test(PAGE) && /let casualVerModalBusy = \$state\(false\);/.test(PAGE));
ok('D12 ⭐⭐ 遮罩標籤本身沒有被改掉（hidden／aria 被拿掉都會讓視窗形同不存在）',
  PAGE.includes('<div class="tourn-vergate-mask" role="alertdialog" aria-modal="true" aria-labelledby="cvg-title">'));

// ══ 【E】伺服器端點 ═════════════════════════════════════════════════════
console.log('\n【E】公開端點');
// ⚠ 取「這一支端點自己的範圍」，不可以用固定長度 —— 它後面緊接著的正好是
//   admin 版的 minclientver（那支**必須**有 isTournAdmin），吃進來就會誤判。
const EP = (() => {
  const a = SRV.indexOf("app.get('/api/client-min-version'");
  if (a < 0) return '';
  const b = SRV.indexOf('\n    });', a);
  return b < 0 ? '' : SRV.slice(a, b + 8);
})();
ok('E0 ⭐ 抽取器真的抽到端點（抽不到的話 E1/E3/E6 全是空轉）',
  EP.length > 150 && EP.includes('minVerConfig') && EP.trimEnd().endsWith('});'));
ok('E1 ⭐⭐⭐ 端點存在且**不驗身分**（匿名玩家也要拿得到門檻）',
  EP.length > 150 && !/tournIdentity|isTournAdmin|res\.status\(40[13]\)/.test(EP));
ok('E2 ⭐⭐⭐ 重用既有的 minVerConfig（沒有第二份判準，也沒有自己讀 TCONFIG）',
  /await minVerConfig\(\)/.test(EP) && !/TCONFIG\.findOne/.test(EP));
ok('E3 ⭐⭐⭐ catch 也回「不擋」的形狀（fail-open；不是回 500 讓 client 多一條例外路徑）',
  /app\.get\('\/api\/client-min-version'[\s\S]{0,700}?catch \(e\) \{[\s\S]{0,260}?res\.json\(\{ enabled: false, min: '' \}\)/.test(SRV));
ok('E4 ⭐ 有短快取（與 minVerConfig 自己的 10 秒同級）',
  /app\.get\('\/api\/client-min-version'[\s\S]{0,500}?max-age=10/.test(SRV));
ok('E5 ⭐⭐ 整段是純新增，且被哨兵框住（revert-chain 才剝得掉）',
  SRV.includes('// >>> v6384-public-min-client-version') && SRV.includes('// <<< v6384-public-min-client-version'));
ok('E6 ⭐⭐⭐ 後端**永遠不因為版本拒絕**（擋人的判斷只在 client，v6.160 硬約束原封不動）',
  EP.length > 150 && !/res\.status\(4\d\d\)/.test(EP));

// ══ 【F】零回歸 ═════════════════════════════════════════════════════════
console.log('\n【F】錦標賽路徑零回歸（逐案與 v6.383 的 inline 實作對照）');
okb('F1 ⭐⭐⭐ 12 組輸入，中央判準與 v6.383 的 inline 邏輯結論完全相同', () => {
  // v6.383 的 inline 實作（逐字抄自 BASE，只為了對照；**不是**第二份判準 ——
  //   它不參與任何生產路徑，只在這一條斷言裡當作「舊行為的標準答案」）。
  const oldImpl = (cur, min, href, now, prompted, left) => {
    try {
      const tooOld = _isOld(cur, min);
      if (!tooOld) return false;
      if (prompted) return false;
      if (_recent(href, now)) return false;
      const l = (typeof left === 'number' && Number.isFinite(left)) ? left : Infinity;
      if (l < 30000) return false;
      return true;
    } catch { return false; }
  };
  // 版本比較與 recently 用同一支（它們本來就沒搬家，v6.160 起就是中央的）
  const _isOld = (a, b) => {
    const R2 = /^(\d{1,4})\.(\d{1,9})$/;
    const pa = typeof a === 'string' ? R2.exec(a.trim()) : null;
    const pb = typeof b === 'string' ? R2.exec(b.trim()) : null;
    if (!pa || !pb) return false;
    if (Number(pa[1]) !== Number(pb[1])) return Number(pa[1]) < Number(pb[1]);
    const L = Math.max(pa[2].length, pb[2].length);
    return Number(pa[2].padEnd(L, '0')) < Number(pb[2].padEnd(L, '0'));
  };
  const _recent = (href, now) => {
    if (typeof href !== 'string') return false;
    const m = /[?&]_v=(\d+)/.exec(href);
    if (!m) return false;
    const t = Number(m[1]);
    if (!Number.isSafeInteger(t)) return false;
    return t > now ? true : (now - t < 600000);
  };
  const CASES = [
    ['6.100', '6.383', 'https://x/g', false, undefined],
    ['6.400', '6.383', 'https://x/g', false, undefined],
    ['6.100', '', 'https://x/g', false, undefined],
    ['6.100', '6.383', 'https://x/g', true, undefined],
    ['6.100', '6.383', 'https://x/g?_v=' + (NOW - 1000), false, undefined],
    ['6.100', '6.383', 'https://x/g?_v=' + (NOW - 999999), false, undefined],
    ['6.100', '6.383', 'https://x/g', false, 29000],
    ['6.100', '6.383', 'https://x/g', false, 30000],
    ['6.100', '6.383', 'https://x/g', false, 31000],
    ['6.100', '6.383', 'https://x/g', false, NaN],
    ['6.9', '6.159', 'https://x/g', false, undefined],
    ['6.15', '6.150', 'https://x/g', false, undefined],
  ];
  for (const [cur, min, href, prompted, left] of CASES) {
    const a = G.evaluateVersionGate({ cur, min, href, now: NOW, alreadyPrompted: prompted, deadlineLeftMs: left }).block;
    const b = oldImpl(cur, min, href, NOW, prompted, left);
    if (a !== b) { console.log('        ↳ 不一致：' + JSON.stringify([cur, min, href, prompted, left]) + ' 新=' + a + ' 舊=' + b); return false; }
  }
  return true;
});
okb('F2 ⭐⭐ 正對照：把中央門檻改成 90 秒，上面那組的第 9 筆（剩 31 秒）會翻面 ⇒ F1 不是恆真',
  () => G.evaluateVersionGate({ cur: '6.100', min: '6.383', href: 'https://x/g', now: NOW, alreadyPrompted: false, deadlineLeftMs: 31000, deadlineFloorMs: 90000 }).block === false);

// ══ 【H】行為端 harness ═════════════════════════════════════════════════
// ⭐⭐⭐ 這一段是本支守衛的**主體**。
//
// ⚠⚠⚠ 誠實紀錄（v6.384，Fable 5 獨立審查當場打臉）：原本這支守衛只有【C】【D】的
//   **regex 比對**。審查者對實作下了 12 個突變，regex 只殺掉 1 個 —— 活下來的裡面有
//   **4 個是鎖死級**（會把玩家永遠關在房間外）：
//     ・逃生鈕 `if (_act) await _act();` 改成 throw    ⇒ regex 照樣綠
//     ・`_casualVerPrompted.add(key)` 拿掉（永遠擋）   ⇒ regex 照樣綠
//     ・`casualVerModalKey = key` 拿掉（擋了不開窗）   ⇒ regex 照樣綠
//     ・1.5 秒 race 拿掉（端點黑洞就永遠按不動）      ⇒ regex 照樣綠
//   這正是站長列為「守衛安慰劑第一型：只驗字串存在、不驗行為」的寫法，我自己踩了。
//
// ⇒ 修法（仿 test-v6167 ③）：把 `>>> v6384-casual-version-gate` 那整段與兩支 handler
//   **原封不動抽出來**，注入 stub 之後**真的執行**。斷言的是
//   「handleCreateRoomCommit／handleJoinRoomCommit 到底有沒有被呼叫」這個行為，
//   不是「原始碼裡有沒有那個字串」。
//
// ⚠ 而且每一條 fail-open 都再配一個**變異測試**，而且變異版跑的是**同一個 probe 函式**
//   （PROBES.Hx）—— 不可能發生「突變測到的其實是別的東西」。突變若活下來，那一條就紅。
console.log('\n【H】行為端：按 ≤2 次一定進得了房間（把那三支函式抽出來真的跑）');

// ── 抽原始碼（PAGE 已 normEol ⇒ 一律 LF；哨兵帶 \n 才不會誤命中 `-state` 那個哨兵）
const _ga = PAGE.indexOf('// >>> v6384-casual-version-gate\n');
const _gb = PAGE.indexOf('// <<< v6384-casual-version-gate\n');
const _ca = PAGE.indexOf('  async function handleCreateRoom() {');
const _cb = PAGE.indexOf('  async function handleCreateRoomCommit(');
const _ja = PAGE.indexOf('  async function handleJoinRoom() {');
const _jb = PAGE.indexOf('  async function handleJoinRoomCommit(');
let HSRC = '', hErr = modErr;
if (!hErr) {
  if (_ga < 0 || _gb <= _ga) hErr = '抓不到 v6384-casual-version-gate 哨兵區段（哨兵被改名／刪掉了？）';
  else if (_ca < 0 || _cb <= _ca) hErr = '抓不到 handleCreateRoom 的區間';
  else if (_ja < 0 || _jb <= _ja) hErr = '抓不到 handleJoinRoom 的區間';
  else HSRC = PAGE.slice(_ga, _gb) + '\n' + PAGE.slice(_ca, _cb) + '\n' + PAGE.slice(_ja, _jb);
}

// ── harness 骨架。⚠ 這裡**只提供環境**（state 宣告與 stub），任何判定邏輯都必須來自
//   上面抽出來的真原始碼 —— 在這裡自己寫一份等價邏輯，就等於在測我自己寫的假貨。
const H_HEAD = `
import { evaluateVersionGate, readMinVersionPayload } from ${JSON.stringify(pathToFileURL(OUTG).href)};
export function run(env) {
  const VERSION = env.VERSION;
  let casualMinClientVer = '';
  let casualVerModalKey = '';
  const _casualVerPrompted = new Set();
  let _casualVerPendingAction = null;
  let _casualMinVerFetched = false;
  let casualVerModalBusy = false;
  let onlineLoading = false;
  let joinInput = env.joinInput || 'AB12';
  const createCalls = [], joinCalls = [], fetchCalls = [], hardRefreshCalls = [];
  const window = { location: { href: env.href } };
  // ⚠ 遮蔽全域 setTimeout：計時器改成可手動推進，這樣「端點黑洞 ⇒ 1.5 秒上限」
  //   才測得到（真的等 1.5 秒會讓整支守衛變慢，而且測不準）。
  const timers = [];
  const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const fetch = async (u) => { fetchCalls.push(u); return env.fetchImpl(u); };
  const hardRefreshNow = async () => {
    hardRefreshCalls.push(1);
    if (env.hardRefreshThrows) throw new Error('hard-refresh boom');
  };
  async function handleCreateRoomCommit() { createCalls.push(1); }
  async function handleJoinRoomCommit() { joinCalls.push(1); }
`;
const H_TAIL = `
  const advance = async (ms) => {
    const keep = [];
    for (const t of timers.splice(0)) { if (t.ms <= ms) { try { t.fn(); } catch { /* */ } } else keep.push(t); }
    for (const t of keep) timers.push(t);
    for (let i = 0; i < 24; i++) await Promise.resolve();
  };
  return {
    create: () => handleCreateRoom(), join: () => handleJoinRoom(),
    update: () => casualVerModalUpdate(), skip: () => casualVerModalSkip(),
    advance, createCalls, joinCalls, fetchCalls, hardRefreshCalls,
    modal: () => casualVerModalKey, busy: () => casualVerModalBusy, loading: () => onlineLoading,
    setJoin: (v) => { joinInput = v; },
  };
}
`;
const _hTmp = [];
process.on('exit', () => { for (const f of _hTmp) { try { unlinkSync(f); } catch { /* */ } } });
let _hSeq = 0;
/** 建一個 runner；mutate 不為 null 時代表這是變異版，**沒命中就要大聲丟錯**（否則突變是空轉）。 */
const mkRunner = async (mutate, tag) => {
  let s = HSRC;
  if (mutate) {
    const t = mutate(s);
    if (t === s) throw new Error('突變「' + tag + '」沒有命中：實作寫法變了 ⇒ 這個突變已經不再有效，請改寫它');
    s = t;
  }
  const js = (await transform(H_HEAD + s + H_TAIL, { loader: 'ts', target: 'node20' })).code;
  const f = join(ROOT, '.xv6384h-' + (_hSeq++) + '.mjs');
  writeFileSync(f, js, 'utf8');
  _hTmp.push(f);
  return (await import(pathToFileURL(f).href + '?t=' + Date.now())).run;
};

// ── 真的 setTimeout（harness 內的那個被遮蔽了）：用來偵測「卡住不回來」
const REAL_ST = globalThis.setTimeout;
const withTimeout = (p, tag, ms = 3000) => Promise.race([
  p, new Promise((_, rj) => REAL_ST(() => rj(new Error(tag + '：卡住超過 ' + ms + 'ms 沒有回來')), ms)),
]);

const FI = {
  off: async () => ({ ok: true, json: async () => ({ enabled: false, min: '' }) }),
  on: (min) => (async () => ({ ok: true, json: async () => ({ enabled: true, min }) })),
  notfound: async () => ({ ok: false, json: async () => ({}) }),
  garbage: async () => ({ ok: true, json: async () => 'nope' }),
  throws: async () => { throw new Error('network down'); },
  blackhole: () => new Promise(() => { /* 永不 resolve */ }),
};
const HB = (over) => Object.assign(
  { VERSION: '6.100', href: 'https://x.tw/game', fetchImpl: FI.on('6.384') }, over || {});

// ⭐⭐⭐ 每一條行為斷言都寫成一個 probe：**正版與變異版跑的是同一支 probe**。
const PROBES = {
  // 門檻沒開 ⇒ 一次就建房、完全不開窗
  H1: async (RUN) => { const h = RUN(HB({ fetchImpl: FI.off })); await h.create(); return h.createCalls.length === 1 && h.modal() === ''; },
  // 版本夠新 ⇒ 一次就建房
  H2: async (RUN) => { const h = RUN(HB({ VERSION: '6.900' })); await h.create(); return h.createCalls.length === 1 && h.modal() === ''; },
  // 正對照：太舊時第一次確實只開窗、沒建房（證明這個閘真的擋得住東西）
  H3: async (RUN) => { const h = RUN(HB({})); await h.create(); return h.createCalls.length === 0 && h.modal() === 'create'; },
  // ★★★ 太舊時按第二次一定建房（v6.167 不變式：同一入口最多只擋一次）
  H4: async (RUN) => { const h = RUN(HB({})); await h.create(); await h.create(); return h.createCalls.length === 1; },
  // ★★★ 逃生鈕真的完成原本的動作，而且視窗關掉、沒有偷偷重載
  H5: async (RUN) => { const h = RUN(HB({})); await h.create(); await h.skip(); return h.createCalls.length === 1 && h.modal() === '' && h.hardRefreshCalls.length === 0; },
  // ★★★ 加入房間那一路的逃生鈕也一樣
  H6: async (RUN) => { const h = RUN(HB({})); await h.join(); await h.skip(); return h.joinCalls.length === 1 && h.modal() === ''; },
  // ★★★ 門檻端點是黑洞 ⇒ 1.5 秒上限到就照樣建房（絕不能「按了沒反應」）
  H7: async (RUN) => { const h = RUN(HB({ fetchImpl: FI.blackhole })); const p = h.create(); await h.advance(1500); await withTimeout(p, 'H7'); return h.createCalls.length === 1 && h.modal() === ''; },
  // ★★★ 提示視窗開著時**又按到背後那顆原按鈕**（鍵盤重入）：放行建房，但視窗要
  //   順手收掉 —— 否則玩家接著按逃生鈕會再建一間（孤兒房）。Fable 5 複審 Y1。
  H21: async (RUN) => {
    const h = RUN(HB({}));
    await h.create();                                     // 第一次：擋下並開窗
    if (h.modal() !== 'create' || h.createCalls.length !== 0) return false;
    await h.create();                                     // 視窗還開著時鍵盤重入
    if (h.createCalls.length !== 1 || h.modal() !== '') return false;   // 放行建房 ＋ 收窗
    await h.skip();                                       // 逃生鈕已經沒有動作可做
    return h.createCalls.length === 1;                    // 絕不可以變成兩間房
  },
  // ★★ 雙擊競態：抓門檻那段 await 之內再按一次，只會建出一間房
  H17: async (RUN) => { const h = RUN(HB({ fetchImpl: FI.blackhole, VERSION: '6.900' })); const p1 = h.create(); const p2 = h.create(); await h.advance(1500); await withTimeout(Promise.all([p1, p2]), 'H17'); return h.createCalls.length === 1; },
};

let RUN = null;
if (!hErr) { try { RUN = await mkRunner(null, ''); } catch (e) { hErr = 'harness 建置失敗：' + (e && e.message ? String(e.message).split('\n')[0] : e); } }
/** async 版的 ok（⚠ 直接把 async thunk 丟給 ok() 會拿到 Promise ＝ 恆真，是安慰劑）。 */
const okA = async (name, fn, extra = '') => {
  if (hErr) { ok(name, false, hErr); return; }
  let v = false, ex = extra;
  try { v = await fn(); } catch (e) { v = false; ex = ex || ('例外：' + (e && e.message)); }
  ok(name, !!v, ex);
};

await okA('H1 ⭐⭐⭐ 門檻沒開 ⇒ 按一次就建立房間（不開窗）', () => PROBES.H1(RUN));
await okA('H2 ⭐⭐⭐ 版本夠新 ⇒ 按一次就建立房間', () => PROBES.H2(RUN));
await okA('H3 ⭐⭐⭐ 正對照：版本太舊 ⇒ 第一次確實只開視窗、沒有建房', () => PROBES.H3(RUN));
await okA('H4 ⭐⭐⭐ 版本太舊 ⇒ 按第二次一定建房（同一入口最多只擋一次）', () => PROBES.H4(RUN));
await okA('H5 ⭐⭐⭐ 逃生鈕「先不更新，直接進房」真的建了房、關了窗、沒有重載', () => PROBES.H5(RUN));
await okA('H6 ⭐⭐⭐ 加入房間那一路的逃生鈕也真的加入了', () => PROBES.H6(RUN));
await okA('H7 ⭐⭐⭐ 門檻端點是黑洞（永不回應）⇒ 1.5 秒上限到就照樣建房', () => PROBES.H7(RUN));
await okA('H8 ⭐⭐ 端點 404（伺服器還沒部署）⇒ 一次就建房', async () => {
  const h = RUN(HB({ fetchImpl: FI.notfound })); await h.create(); return h.createCalls.length === 1 && h.modal() === '';
});
await okA('H9 ⭐⭐ 端點回垃圾（不是物件）⇒ 一次就建房', async () => {
  const h = RUN(HB({ fetchImpl: FI.garbage })); await h.create(); return h.createCalls.length === 1;
});
await okA('H10 ⭐⭐ fetch 直接丟例外 ⇒ 一次就建房', async () => {
  const h = RUN(HB({ fetchImpl: FI.throws })); await h.create(); return h.createCalls.length === 1;
});
await okA('H11 ⭐⭐ 剛強制更新過（URL 帶新鮮 _v）⇒ 一次就建房（不再糾纏）', async () => {
  const h = RUN(HB({ href: 'https://x.tw/game?_v=' + Date.now() })); await h.create(); return h.createCalls.length === 1;
});
await okA('H12 ⭐ VERSION 解析不出來 ⇒ 一次就建房', async () => {
  const h = RUN(HB({ VERSION: '6.10.0' })); await h.create(); return h.createCalls.length === 1;
});
await okA('H13 ⭐⭐⭐ 連按 5 次一定至少建房一次（不會無限空轉）', async () => {
  const h = RUN(HB({})); for (let i = 0; i < 5; i++) await h.create(); return h.createCalls.length >= 1;
});
await okA('H14 ⭐⭐ 門檻只抓一次（連按 3 次也只打一發，不會每按一次就多一發）', async () => {
  const h = RUN(HB({})); for (let i = 0; i < 3; i++) await h.create();
  return h.fetchCalls.length === 1 && h.fetchCalls[0] === '/api/client-min-version';
});
await okA('H15 ⭐⭐ 建立房間與加入房間各自算一次（換一個入口仍會提示一次）', async () => {
  const h = RUN(HB({})); await h.create();
  const m1 = h.modal(); await h.skip();
  await h.join();
  return m1 === 'create' && h.modal() === 'join:AB12' && h.joinCalls.length === 0;
});
await okA('H16 ⭐ 同一個房號按兩次加入 ⇒ 只擋一次（第二次直接進房）', async () => {
  const h = RUN(HB({})); await h.join(); await h.join(); return h.joinCalls.length === 1;
});
await okA('H17 ⭐⭐ 雙擊競態：抓門檻那段 await 之內再按一次，只會建出一間房', () => PROBES.H17(RUN));
await okA('H21 ⭐⭐⭐ 視窗開著時鍵盤重入 ⇒ 放行建房並收窗，逃生鈕不會再建第二間', () => PROBES.H21(RUN));
await okA('H18 ⭐ 更新鈕真的呼叫清快取（而且判定路徑上永遠不會自動呼叫它）', async () => {
  const h = RUN(HB({})); await h.create();
  if (h.hardRefreshCalls.length !== 0) return false;   // 判定階段絕不自動重載
  await h.update();
  return h.hardRefreshCalls.length === 1;
});
await okA('H19 ⭐⭐ 清快取丟例外 ⇒ busy 放開、視窗關閉（不會兩顆鈕都按不動）', async () => {
  const h = RUN(HB({ hardRefreshThrows: true })); await h.create(); await h.update();
  return h.busy() === false && h.modal() === '';
});
await okA('H20 ⭐⭐⭐ 更新鈕按下去但瀏覽器沒導航 ⇒ 5 秒看門狗讓逃生鈕復活', async () => {
  const h = RUN(HB({})); await h.create(); await h.update();
  if (h.busy() !== true) return false;                 // 前提：按下去當下是 busy
  await h.advance(5000);                               // 看門狗到期
  if (h.busy() !== false) return false;                // 逃生鈕復活
  await h.skip();
  return h.createCalls.length === 1;                   // 而且真的救得回來
});

// ── ⭐⭐⭐ 變異測試：把每一條 fail-open 拿掉的實作，**必須**讓對應的 probe 翻紅。
//   （沒有這一段，上面 20 條都可能只是「閘整個壞掉、從來不擋人」造成的假綠。）
const MUTANTS = [
  ['M1 拿掉「同一入口只擋一次」（_casualVerPrompted.add）⇒ 永遠擋 ⇒ 玩家進不去',
    (s) => s.replace('_casualVerPrompted.add(key);', ''), 'H4'],
  ['M2 逃生鈕改成丟例外 ⇒ 逃生口變死路',
    (s) => s.replace('if (_act) await _act();', "if (_act) { throw new Error('mutant'); }"), 'H5'],
  ['M3 拿掉 `if (!v.block) return false` ⇒ 連該放行的人也擋',
    (s) => s.replace('if (!v.block) {', 'if (false) {'), 'H1'],
  ['M4 拿掉 1.5 秒上限 ⇒ 端點黑洞時按鈕永遠沒反應',
    (s) => s.replace('await Promise.race([ensureCasualMinVer(), new Promise((r) => setTimeout(r, 1500))]);', 'await ensureCasualMinVer();'), 'H7'],
  ['M5 拿掉建立房間的雙擊鎖 ⇒ 手快連點兩下會開出孤兒房',
    (s) => s.replace('if (onlineLoading) return;', ''), 'H17'],
  ['M6 擋下來卻不開視窗（casualVerModalKey = key 拿掉）⇒ 按了沒反應',
    (s) => s.replace('casualVerModalKey = key;', ''), 'H3'],
  ['M8 放行時不收窗（Fable 5 複審 Y1 的原始 bug）⇒ 鍵盤重入會開出兩間房',
    (s) => s.replace("          casualVerModalKey = '';\n          _casualVerPendingAction = null;", '/* mutant */'), 'H21'],
  ['M7 逃生鈕沒有清掉 pendingAction／視窗（只執行動作）⇒ 視窗永遠蓋著',
    (s) => s.replace("casualVerModalKey = '';\n    _casualVerPendingAction = null;", '/* mutant */'), 'H5'],
];
// ⚠⚠ Fable 5 複審 Y4：probeKey 打錯字時 PROBES[key] 是 undefined ⇒ 呼叫丟 TypeError
//   ⇒ 被下面的 catch 當成「突變被殺死」⇒ 靜默 PASS。先驗它存在。
for (const [name, mutate, probeKey] of MUTANTS) {
  if (typeof PROBES[probeKey] !== 'function') {
    ok('★★★突變測試：' + name, false, 'probeKey「' + probeKey + '」在 PROBES 裡不存在 ⇒ 這條突變測試等於空轉');
    continue;
  }
  await okA('★★★突變測試（' + probeKey + ' 必須翻紅）：' + name, async () => {
    const mr = await mkRunner(mutate, name);      // ⚠ 沒命中會丟錯 ⇒ 這一條紅，不會靜默空轉
    let alive = false;
    try { alive = await PROBES[probeKey](mr); } catch { alive = false; }
    return alive === false;                        // 突變還活著 ⇒ 那條 probe 是安慰劑
  });
}
// ⚠ 掃描器自我驗證：上面七條若全綠，也可能是「mkRunner 根本跑不起來所以每個 probe 都 false」。
//   ⇒ 用一個**無害**的突變（只改註解）確認：不改行為的突變，probe 必須仍然是活的。
await okA('★★掃描器自我驗證：無害突變（只動註解）下 H4 仍然成立（證明 probe 不是恆假）', async () => {
  const mr = await mkRunner((s) => s.replace('v6.167 不變式', 'v6.167 不變式（無害突變）'), 'noop');
  return (await PROBES.H4(mr)) === true;
});

// ══ 【G】HEAD-FAIL ══════════════════════════════════════════════════════
console.log('\n【G】HEAD-FAIL（BASE 沒有這些東西 ⇒ 每一條都必須紅）');
{
  const sha = BASE_SHA;
  if (!hasBaseCommit(ROOT, sha)) {
    shallowSkip('v6.384 HEAD-FAIL（BASE ' + sha + ' 的三個檔案）', '這個 checkout 沒有 BASE 那顆 commit（淺複製）');
  } else {
    const bPage = readBaseBlob(ROOT, sha, 'src/routes/game/+page.svelte');
    const bSrv = readBaseBlob(ROOT, sha, 'oracle-admin/server_admin_patch.js');
    const bGate = readBaseBlob(ROOT, sha, 'src/lib/version-gate.ts');
    const txt = (r) => (r && r.ok ? normEol(typeof r === 'string' ? r : r.out) : '');
    ok('G1 ⭐⭐⭐ BASE 的 +page.svelte 沒有 casualVerGate（C1/C2 對 BASE 必紅）',
      txt(bPage).length > 1000 && !txt(bPage).includes('casualVerGate'));
    ok('G2 ⭐⭐⭐ BASE 的 server_admin_patch.js 沒有公開端點（E1 對 BASE 必紅）',
      txt(bSrv).length > 1000 && !txt(bSrv).includes('/api/client-min-version'));
    ok('G3 ⭐⭐⭐ BASE 根本沒有 src/lib/version-gate.ts（A 段對 BASE 必紅）',
      !bGate || bGate.ok === false || txt(bGate).length === 0);
    ok('G4 ⭐ 哨兵：BASE 本來就有的東西（tCheckinBlockedByVersion）在 BASE 也找得到 —— 這條也紅代表 blob 根本沒讀到',
      txt(bPage).includes('function tCheckinBlockedByVersion'));
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.384 休閒對戰版本閘：${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
