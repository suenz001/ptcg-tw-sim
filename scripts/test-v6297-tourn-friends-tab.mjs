// v6.297 守衛：錦標賽第 4 個分頁「👥 好友」＋ 私聊**內嵌**（大廳／錦標賽兩邊就地開面板）。
//
// 守什麼（能行為端就行為端；靜態只用在行為端測不到的地方）：
//   【A】HEAD-FAIL 錨點：tTabRaw／`const tTab = $derived`／friendsPaneOpen／openDm／dmFoot 都在
//        （BASE v6.296 一個都沒有 ⇒ A0 必紅並中止）。
//   【B】第 4 個分頁（條件一律**求值**，不比字面）：tTab 的「未開放就鎖回賽事」鎖、tSwitchTab 實跑只改 tTabRaw、
//        四顆分頁鈕（前三顆逐字未動、第 4 顆包在 {#if friendsEntryOn} 裡）、分頁內容掛在 profile 之後、
//        匿名玩家根本看不到整列（整列在 {#if isAnonymous} 的 {:else} 內）。
//   【C】⭐⭐ 框架安全（靜態）：.tourn-tabs／.tourn-tab／:hover／.active 四條 CSS 規則與 BASE **逐字相同**
//        —— 本版採「方案 2：短標籤」，**一行 CSS 都沒改**（DOM 量測在 scripts/measure-v6297-tourn-tabs.mjs）。
//        淺複製時退化成 history-free 的等價條件（那四條規則不得出現 flex-wrap／white-space／flex: 1 1）。
//   【D】⭐⭐⭐ **靜態 import 相依圖**：從 game/+page.svelte 的靜態 import 出發走遍 src/ 的相依圖，
//        走不到 DmPanel.svelte／dm-session.ts／dm-poller.ts ⇒ 私聊**只**能經由動態 import() 進來，
//        對戰頁的主 chunk 一個位元組都沒有多。
//        ⚠⚠ 這是 v6.288 F1「主檔零 DmPanel」的**接班人**：原本那條是字串比對，內嵌之後必然紅；
//          直接放寬＝把守護意圖丟掉，改用相依圖之後守的是**同一件事的因**（會不會被打包進對戰頁），
//          而且**擋得住字串比對擋不住的繞道**（包一層 wrapper 再靜態 import）—— D1b／D1c 兩個正對照證明。
//        另：對戰版面分支區間零 friend／零 Dm；MobilePortraitBattle.svelte 仍零 DmPanel／dm-*（原條文全文保留）。
//   【E】⭐⭐⭐ 輪詢生命週期五種情境（把**出貨碼裡那一段接線**抽出來、配真的 dm-session／dm-poller
//        ＋假 fetch ＋假 timer 逐 tick 實跑）：面板開著 3 秒／document.hidden 15 秒／關掉零請求／
//        **切走分頁零請求**（新情境）／離開頁面零請求。
//   【F】版面量測（playwright；沒有瀏覽器就 SHALLOW-SKIP 並在結尾列出）：四種尺寸跑
//        scripts/measure-v6297-tourn-tabs.mjs。
//   【G】回歸不變量：/friends 這條獨立路由與 DmPanel.svelte **逐位元未動**；共用元件 FriendsPanel 兩邊都吃得到
//        （embedded ＋ foot snippet）；新增區塊零 {@html}；每個 each 仍有穩定 key。
//   【H】test chain ／版本一致（不 pin 版本號）。
//   【I】突變：每一個都必須紅在**預期那一條**。
//
// ⚠ 守衛安慰劑八種型態逐一避開：只捕 assert.AssertionError；不 pin 死版本號／整檔 sha256；
//   每個掃描器都有下限斷言與正對照；所有條件求值不比字面。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const esbuild = await import('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_MPB = join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');
const P_FRP = join(ROOT, 'src/lib/friends/FriendsPanel.svelte');
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const P_POLL = join(ROOT, 'src/lib/friends/dm-poller.ts');
const P_SESS = join(ROOT, 'src/lib/friends/dm-session.ts');
const P_DMPANEL = join(ROOT, 'src/routes/friends/DmPanel.svelte');
const P_FRPAGE = join(ROOT, 'src/routes/friends/+page.svelte');
const P_PKG = join(ROOT, 'package.json');
const BASE_SHA = 'c9bba2280289e324367f1a9a12850ea9900d6ea2';   // v6.296（本版的 BASE）
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0; const skipped = [];
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + String(e.message).slice(0, 900)); fail++; }
    else throw e;
  }
};
const mutantMustBreak = async (name, run, frag) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(frag),
    '突變體「' + name + '」紅在別條：' + String(err.message).slice(0, 300) + '（預期含「' + frag + '」）');
};
const mutate = (src, a, b) => {
  const n = src.split(a).length - 1;
  assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 90));
  return src.replace(a, b);
};
const stripCmt = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
const evalExpr = (expr, vars) => new Function(...Object.keys(vars), 'return (' + expr + ');')(...Object.values(vars));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】HEAD-FAIL 錨點');
let GAME = '', MPB = '', FRP = '', PKG = '';
await T('A0 HEAD-FAIL：game/+page.svelte 有 tTabRaw／const tTab = $derived／friendsPaneOpen／openDm／dmFoot（BASE v6.296 一個都沒有 ⇒ 這一條必紅）', () => {
  GAME = rd(P_GAME); MPB = rd(P_MPB); FRP = rd(P_FRP); PKG = rd(P_PKG);
  assert.ok(GAME.length > 500000, 'game/+page.svelte 只讀到 ' + GAME.length + ' 字元 —— 讀錯檔？');
  for (const k of [
    "let tTabRaw = $state<'events' | 'leaderboard' | 'profile' | 'friends'>('events');",
    'const tTab = $derived(',
    'const friendsPaneOpen = $derived(',
    'async function openDm(r: FriendRow)',
    '{#snippet dmFoot()}',
  ]) assert.ok(GAME.includes(k), 'game/+page.svelte 缺「' + k + '」');
});
if (fail) { console.log('\n══ v6.297 錦標賽好友分頁守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：新東西不存在，後續斷言無法進行）══'); process.exit(1); }

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】錦標賽第 4 個分頁（條件一律求值）');
await T('B1 ⭐⭐ tTab 的鎖：好友未開放時，tTabRaw = friends 也要被鎖回 events；已開放則照實回 friends；其餘分頁不受影響（把 $derived 運算式抽出來求值）', () => {
  const m = /const tTab = \$derived\(([^;]*)\);/.exec(GAME);
  assert.ok(m, '抽不到 const tTab = $derived(...)');
  const f = (raw, on) => evalExpr(m[1], { tTabRaw: raw, friendsEntryOn: on });
  assert.strictEqual(f('friends', false), 'events', '⚠⚠ 好友未開放時 tTab 沒有被鎖回 events ⇒ 會停在一個畫不出來的分頁');
  assert.strictEqual(f('friends', true), 'friends', '好友已開放時卻進不去好友分頁');
  for (const t of ['events', 'leaderboard', 'profile']) {
    assert.strictEqual(f(t, false), t, '既有分頁 ' + t + ' 被鎖壞了（未開放）');
    assert.strictEqual(f(t, true), t, '既有分頁 ' + t + ' 被鎖壞了（已開放）');
  }
});
await T('B2 ⭐⭐ tSwitchTab 實跑：切到 friends 只改 tTabRaw，不動 tStep／onlineStep／tTabRaw 以外的東西，也不會誤觸排行榜／個人資料的載入', () => {
  const i = GAME.indexOf("function tSwitchTab(tab: 'events' | 'leaderboard' | 'profile' | 'friends') {");
  assert.ok(i > 0, '抽不到 tSwitchTab（簽章沒有加上 friends？）');
  const body = GAME.slice(GAME.indexOf('{', i) + 1, GAME.indexOf('\n  }\n', i));
  assert.ok(body.length > 200, 'tSwitchTab 函式體只有 ' + body.length + ' 字元 ⇒ 錨點抓錯');
  assert.ok(!/onlineStep\s*=[^=]/.test(body) && !/tStep\s*=[^=]/.test(body), '⚠⚠ 切分頁動了 onlineStep／tStep：' + body.slice(0, 200));
  const calls = [];
  const run = (tab) => {
    const S = { tTabRaw: 'events', tLeaderboard: null, tLeaderboardStale: false, tProfile: null, tProfileStale: false,
      tLeaderboardLoad: () => calls.push('lb'), tProfileLoad: () => calls.push('pf'), refreshNotifyDiag: () => calls.push('diag') };
    new Function('S', 'tab', 'with (S) {' + body + '} return S;')(S, tab);
    return S;
  };
  assert.strictEqual(run('friends').tTabRaw, 'friends', 'tSwitchTab 沒有把分頁切過去');
  assert.deepStrictEqual(calls, [], '⚠ 切到好友分頁竟然觸發了排行榜／個人資料的載入：' + calls.join(','));
  calls.length = 0;
  assert.strictEqual(run('profile').tTabRaw, 'profile');
  assert.ok(calls.includes('pf') && calls.includes('diag'), '正對照失效：切到個人資料應該仍會載入（' + calls.join(',') + '）');
});
function tabsBlock(src) {
  const i = src.indexOf('<div class="tourn-tabs" role="tablist">');
  assert.ok(i > 0, '抽不到錦標賽分頁列');
  const j = src.indexOf('\n      </div>', i);
  assert.ok(j > i, '抽不到分頁列結尾');
  return src.slice(i, j);
}
function tabButtons(blk) {
  return [...blk.matchAll(/<button class="tourn-tab"[\s\S]*?<\/button>/g)].map((m) => {
    const t = m[0].slice(0, m[0].lastIndexOf('</button>'));
    return { raw: m[0], text: t.slice(t.lastIndexOf('>') + 1) };
  });
}
await T('B3 ⭐⭐ 分頁列恰四顆；前三顆與 BASE **逐字相同**；第 4 顆文字是「👥 好友」且包在 {#if friendsEntryOn} 裡（role／aria-selected／class:active 齊全）', () => {
  const blk = tabsBlock(GAME);
  const btns = tabButtons(blk);
  assert.strictEqual(btns.length, 4, '分頁鈕不是四顆：' + btns.length);
  assert.deepStrictEqual(btns.map((b) => b.text), ['🏆 賽事', '📊 排行榜', '🪪 個人資料', '👥 好友'], '分頁文字不對：' + JSON.stringify(btns.map((b) => b.text)));
  const r = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
  if (!r.ok) { shallowSkip('v6297 B3 前三顆分頁鈕與 BASE 逐字比對', 'B3 的其餘結構斷言不需要歷史，仍在守'); skipped.push('B3 前三顆逐字（淺複製）'); }
  else {
    const base = tabButtons(tabsBlock(r.out.replace(/\r\n/g, '\n')));
    assert.strictEqual(base.length, 3, 'BASE 的分頁鈕不是三顆 ⇒ BASE 抓錯');
    for (let k = 0; k < 3; k++) assert.strictEqual(btns[k].raw, base[k].raw, '⚠⚠ 第 ' + (k + 1) + ' 顆既有分頁鈕被動到了');
  }
  const fourth = btns[3].raw;
  assert.ok(/class:active=\{tTab === 'friends'\}/.test(fourth) && /aria-selected=\{tTab === 'friends'\}/.test(fourth) && /role="tab"/.test(fourth), '第 4 顆的 role／aria-selected／active 不齊：' + fourth);
  assert.ok(/onclick=\{\(\) => tSwitchTab\('friends'\)\}/.test(fourth), '第 4 顆沒接 tSwitchTab(friends)');
  const before = blk.slice(0, blk.indexOf(fourth));
  assert.ok(/\{#if friendsEntryOn\}\s*$/.test(stripCmt(before)), '⚠⚠ 第 4 顆沒有包在 {#if friendsEntryOn} 裡（伺服器不支援／開關關著時也會冒出來）：' + stripCmt(before).slice(-120));
  assert.strictEqual(stripCmt(blk).split('{#if').length - 1, 1, '分頁列裡的 {#if} 不是恰一個');
});
await T('B4 ⭐⭐ 好友分頁的內容：`{:else if tTab === \'friends\'}` 恰一處、落在 profile 分支之後、tError 之前；掛的是共用元件 FriendsPanel（embedded ＋ foot snippet ＋ ondm＝就地開面板）', () => {
  const mk = "{:else if tTab === 'friends'}";
  assert.strictEqual(GAME.split(mk).length - 1, 1, '好友分頁分支不是恰一處');
  const pf = GAME.indexOf("{:else if tTab === 'profile'}");
  const fr = GAME.indexOf(mk);
  const err = GAME.indexOf('{#if tError}<p class="warn">'/* ⭐ 只當位置錨點：那一行後來加了關閉鈕，改用前綴（斷言內容未變） */);
  assert.ok(pf > 0 && fr > pf && err > fr, '好友分支的位置不對：' + JSON.stringify({ pf, fr, err }));
  const panel = GAME.slice(fr, err);
  assert.ok(/<FriendsPanel embedded ondm=\{openDm\}/.test(panel), '錦標賽分頁沒有用共用元件／沒接 openDm：' + stripCmt(panel).slice(0, 300));
  assert.ok(/foot=\{dmFoot\}/.test(panel), '沒有把私聊面板接到 foot snippet（--fr-* 色票靠繼承，不接就會沒有配色）');
  assert.ok(/dmActiveFid=\{dmState\?\.fid \?\? ''\}/.test(panel) && /onafteract=\{dmAfterAct\}/.test(panel), '錦標賽分頁沒接 dmActiveFid／onafteract：' + panel.slice(0, 300));
  // 大廳那一份也必須是同樣的接法（兩邊共用一份元件、一份私聊 session）
  const lob = GAME.indexOf('<FriendsPanel embedded ondm={openDm}', GAME.indexOf("{#if lobbyTab === 'friends'}"));
  assert.ok(lob > 0, '大廳分頁沒有改成就地開私聊');
  assert.strictEqual((GAME.match(/<FriendsPanel embedded ondm=\{openDm\}/g) || []).length, 2, '<FriendsPanel embedded ondm={openDm}> 不是恰兩處（大廳＋錦標賽）');
  assert.strictEqual((GAME.match(/window\.open\(base \+ '\/friends'/g) || []).length, 0, '⚠ 舊的「開新分頁到 /friends」還在（本版改成就地開面板）');
});
await T('B5 ⭐⭐ 匿名玩家看不到整列分頁：分頁列整段落在 `{#if isAnonymous}` 的 `{:else}` 內（錦標賽本來就強制 email 登入，登入閘逐字仍在）', () => {
  const gate = GAME.indexOf('🔒 錦標賽需要 email 帳號（不開放匿名）');
  assert.ok(gate > 0, '⚠⚠ 錦標賽的匿名登入閘不見了');
  const ifAnon = GAME.lastIndexOf('{:else if isAnonymous}', gate);
  assert.ok(ifAnon > 0 && ifAnon < gate, '抽不到 {:else if isAnonymous} 分支');
  const elseBranch = GAME.indexOf('{:else}', gate);
  const tabs = GAME.indexOf('<div class="tourn-tabs" role="tablist">');
  assert.ok(elseBranch > gate && tabs > elseBranch, '⚠⚠ 分頁列不在「已登入」那個分支裡：' + JSON.stringify({ gate, elseBranch, tabs }));
  // 正對照：登入閘與分頁列之間就是那一行「已登入：…」
  assert.ok(GAME.slice(elseBranch, tabs).includes('class="tourn-who"'), '「已登入」那一行不見了 ⇒ 錨點抓錯');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】框架安全：分頁列 CSS 一行都沒改（本版採方案 2＝短標籤）');
const CSS_KEYS = ['  .tourn-tabs {', '  .tourn-tab {', '  .tourn-tab:hover {', '  .tourn-tab.active {'];
function cssRules(src) {
  const style = src.slice(src.lastIndexOf('<style'));
  return CSS_KEYS.map((k) => {
    const i = style.indexOf(k);
    assert.ok(i >= 0, '抽不到 CSS 規則：' + k);
    return style.slice(i, style.indexOf('\n', i));
  });
}
await T('C1 ⭐⭐ .tourn-tabs／.tourn-tab／:hover／.active 四條規則與 BASE **逐字相同**（＝方案 2 一行 CSS 都不用改）', () => {
  const now = cssRules(GAME);
  const r = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
  if (!r.ok) { shallowSkip('v6297 C1 分頁列 CSS 與 BASE 逐字比對', 'C2 是不需要歷史的等價條件，仍在守'); skipped.push('C1（淺複製）'); return; }
  const base = cssRules(r.out.replace(/\r\n/g, '\n'));
  for (let i = 0; i < CSS_KEYS.length; i++) assert.strictEqual(now[i], base[i], '⚠⚠ CSS 規則被動到了：' + CSS_KEYS[i] + '\n NEW : ' + now[i] + '\n BASE: ' + base[i]);
});
await T('C2 ⭐ history-free 等價條件：那四條規則裡不得出現 flex-wrap／white-space／flex: 1 1（＝沒有為了塞第 4 顆而改版面規則）；新增的容器規則只有 .tourn-tab-panel', () => {
  const now = cssRules(GAME).join('\n');
  for (const k of ['flex-wrap', 'white-space', 'flex: 1 1']) assert.ok(!now.includes(k), '分頁列 CSS 出現了 ' + k + ' ⇒ 不是方案 2 了');
  assert.ok(/\.tourn-tab-panel \{ text-align: left; max-width: 100%; \}/.test(GAME), '缺 .tourn-tab-panel 容器規則');
  assert.strictEqual((GAME.match(/\.tourn-tab-panel/g) || []).length, 1, '.tourn-tab-panel 的 CSS 不是恰一條');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】⭐⭐⭐ 靜態 import 相依圖：私聊只能經由動態 import() 進來');
/** 讀原始碼（可被 overlay 蓋掉，讓正對照不必真的寫檔）。 */
const mkReader = (overlay) => (p) => (overlay && overlay.has(p) ? overlay.get(p) : (existsSync(p) ? rd(p) : null));
/** 抽「靜態」import 的來源字串（⚠ `import type` 與動態 `import(...)` 都不算）。 */
function staticSpecs(src, isSvelte) {
  let code = src;
  if (isSvelte) code = [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  code = stripCmt(code);
  const out = [];
  for (const m of code.matchAll(/^[ \t]*import\s+([\s\S]*?)from\s*['"]([^'"]+)['"]/gm)) {
    if (/^\s*type\s/.test(m[1])) continue;                 // import type { X } from '…' ⇒ 編譯後消失
    out.push(m[2]);
  }
  for (const m of code.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) out.push(m[1]);
  return out;
}
/** ⚠ 必須是「檔案」才算解析成功：`$lib/friends` 這種目錄名不可以被當成模組（讀它會 EISDIR）。 */
const isFileWith = (overlay) => (p) => {
  if (overlay && overlay.has(p)) return true;
  try { return statSync(p).isFile(); } catch { return false; }
};
function resolveSpec(spec, fromFile, exists) {
  let base = null;
  if (spec.startsWith('$lib/')) base = join(ROOT, 'src/lib', spec.slice(5));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(fromFile), spec);
  else return null;                                        // node_modules／$app／svelte… 不在掃描範圍
  for (const ext of ['', '.ts', '.js', '.svelte', '/index.ts', '/index.js']) if (exists(base + ext)) return base + ext;
  return null;
}
/** 從 entry 的**靜態** import 出發，走遍相依圖，回傳走得到的檔案集合。 */
function staticGraph(entry, overlay) {
  const read = mkReader(overlay);
  const exists = isFileWith(overlay);
  const seen = new Set(); const queue = [entry];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = read(f);
    if (src == null) continue;
    for (const s of staticSpecs(src, f.endsWith('.svelte'))) {
      const r = resolveSpec(s, f, exists);
      if (r && !seen.has(r)) queue.push(r);
    }
  }
  seen.delete(entry);
  return seen;
}
const DM_FILES = [P_DMPANEL, P_SESS, P_POLL];
function assertGraphClean(overlay) {
  const g = staticGraph(P_GAME, overlay);
  assert.ok(g.size > 8, '相依圖只走到 ' + g.size + ' 個檔 ⇒ 掃描器壞了（下限斷言）');
  assert.ok(g.has(P_FRP), '相依圖走不到共用元件 FriendsPanel ⇒ 掃描器壞了（正對照）');
  for (const f of DM_FILES) assert.ok(!g.has(f), '⚠⚠⚠ 對戰頁的**靜態**相依圖走得到私聊模組：' + f.slice(ROOT.length) + ' ⇒ 它會被打包進對戰頁');
  return g;
}
await T('D1 ⭐⭐⭐ 從 game/+page.svelte 的靜態 import 走遍相依圖 ⇒ 走不到 DmPanel.svelte／dm-session.ts／dm-poller.ts（正對照：走得到 FriendsPanel）', () => { assertGraphClean(null); });
await T('D1b ⭐⭐ 正對照①：把私聊面板改成**靜態** import ⇒ D1 必紅（不是恆真式）', () => {
  const bad = mutate(GAME, "  import { friendsCtxFromAuth } from '$lib/friends/auth-ctx';",
    "  import DmPanelStatic from '../friends/DmPanel.svelte';\n  import { friendsCtxFromAuth } from '$lib/friends/auth-ctx';");
  const ov = new Map([[P_GAME, bad]]);
  let err = null; try { assertGraphClean(ov); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err && /靜態.*相依圖走得到私聊模組/.test(err.message), '掃描器抓不到靜態 import 的私聊面板：' + (err && err.message));
});
await T('D1c ⭐⭐⭐ 正對照②：包一層 wrapper 再靜態 import（字串比對擋不住的繞道）⇒ D1 仍必紅', () => {
  const wrapper = join(ROOT, 'src/lib/friends/__probe-wrapper.ts');
  const bad = mutate(GAME, "  import { friendsCtxFromAuth } from '$lib/friends/auth-ctx';",
    "  import { probe } from '$lib/friends/__probe-wrapper';\n  import { friendsCtxFromAuth } from '$lib/friends/auth-ctx';");
  const ov = new Map([[P_GAME, bad], [wrapper, "import { createDmSession } from '$lib/friends/dm-session';\nexport const probe = createDmSession;\n"]]);
  let err = null; try { assertGraphClean(ov); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err && /dm-session/.test(err.message), '⚠⚠ 掃描器只會做字串比對，擋不住「包一層 wrapper」的繞道：' + (err && err.message));
});
await T('D1d ⭐ 私聊確實是用動態 import() 進來的（三個 await import 各恰一處），而且型別引用是 `import type`（編譯後消失）', () => {
  const G = stripCmt(GAME);
  for (const s of ["import('$lib/friends/dm-session')", "import('$lib/friends/dm-poller')", "import('../friends/DmPanel.svelte')"])
    assert.strictEqual(G.split(s).length - 1, 1, '動態 import 不是恰一處：' + s);
  assert.ok(/^\s*import type \{ DmSession, DmSessionState \} from '\$lib\/friends\/dm-session';$/m.test(GAME), '型別引用不是 import type（會被打包進對戰頁）');
  assert.strictEqual((G.match(/^\s*import \{[^}]*\} from '\$lib\/friends\/dm-/gm) || []).length, 0, '出現了私聊模組的具名靜態 import');
});
const BATTLE_START = '  {#if isPortraitMobile && game}\n';
const BATTLE_END = '{/if}<!-- /isPortraitMobile && playing -->';
function battleRegion(src) {
  const s = src.indexOf(BATTLE_START); const e = src.indexOf(BATTLE_END, s);
  assert.ok(s > 0 && e > s, '找不到對戰版面分支的起訖錨點');
  return src.slice(s, e + BATTLE_END.length);
}
function assertBattleClean(src) {
  const r = battleRegion(src);
  assert.ok(r.length > 20000, '對戰版面區間只有 ' + r.length + ' 字元 —— 錨點抓錯？');
  assert.ok(r.includes('<MobilePortraitBattle') && r.includes('{:else}'), '區間內看不到手機／桌機兩套分支');
  for (const k of [/friend/gi, /DmPanel/g, /dmState/g, /openDm/g]) {
    const hits = r.match(k) || [];
    assert.strictEqual(hits.length, 0, '⚠⚠ 對戰版面分支出現 ' + hits.length + ' 個 ' + k.source + ' 字樣');
  }
}
await T('D2 ⭐⭐ 對戰版面分支區間零 friend／零 DmPanel／dmState／openDm（正對照：塞一個進去必紅）', () => {
  assertBattleClean(GAME);
  const s = GAME.indexOf(BATTLE_START);
  const bad = GAME.slice(0, s + BATTLE_START.length) + '<!-- DmPanel -->' + GAME.slice(s + BATTLE_START.length);
  let err = null; try { assertBattleClean(bad); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err && /對戰版面分支出現/.test(err.message), '掃描器抓不到塞進去的 DmPanel');
});
await T('D3 ⭐⭐ MobilePortraitBattle.svelte 仍然零 DmPanel／dm-session／dm-poller／friendsDm／fetchDmMessages／sendDm／createDmSession／friend（v6.288 F1 的條文原封保留）', () => {
  assert.ok(MPB.length > 5000, 'MobilePortraitBattle.svelte 只讀到 ' + MPB.length + ' 字元 —— 讀錯檔？');
  for (const k of ['DmPanel', 'dm-session', 'dm-poller', 'friendsDm', 'fetchDmMessages', 'sendDm', 'createDmSession'])
    assert.ok(!MPB.includes(k), 'MobilePortraitBattle.svelte 出現 ' + k);
  assert.strictEqual((MPB.match(/friend/gi) || []).length, 0, 'MobilePortraitBattle.svelte 出現 friend');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】⭐⭐⭐ 輪詢生命週期五種情境（把出貨碼那一段接線抽出來實跑）');
const API_MARKER = "(((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || ''";
const API_SRC = rd(P_API), POLL_SRC = rd(P_POLL), SESS_SRC = rd(P_SESS);
function loadDmMods(fetchImpl) {
  assert.ok(API_SRC.includes(API_MARKER), 'friends-api.ts 的 apiBase() 形狀變了 —— 注入點壞了');
  const src = { 'friends-api': API_SRC.replace(API_MARKER, "'http://t.local'"), 'dm-poller': POLL_SRC, 'dm-session': SESS_SRC };
  const mods = {}; const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const req = (n) => { const k = n.replace(/^\.\//, ''); if (!mods[k]) throw new Error('未知模組 ' + n); return mods[k]; };
  for (const k of ['friends-api', 'dm-poller', 'dm-session']) {
    const js = esbuild.transformSync(src[k], { loader: 'ts', format: 'cjs' }).code;
    const m = { exports: {} };
    new Function('module', 'exports', 'require', 'fetch', 'localStorage', js)(m, m.exports, req, fetchImpl, ls);
    mods[k] = m.exports;
  }
  return mods;
}
/** ⭐ 從**出貨碼**抽出那一段私聊接線，轉成可執行的 factory（不是抄一份，抄一份會漂移）。 */
const WIRE_A = '  let dmState = $state<DmSessionState | null>(null);';
const WIRE_B_RE = /  onDestroy\(\(\) => \{[^}]*\}\);/;
function makeWiring(src, mods, env, timers, hiddenRef) {
  const a = src.indexOf(WIRE_A);
  const mEnd = WIRE_B_RE.exec(src);
  assert.ok(a > 0 && mEnd && mEnd.index > a, '抽不到私聊接線區塊（起訖錨點變了？）');
  let block = src.slice(a, mEnd.index + mEnd[0].length);
  assert.ok(block.length > 800, '接線區塊只有 ' + block.length + ' 字元 ⇒ 錨點抓錯');
  block = block
    .replace(/\$state<[^>]*>\(/g, '(').replace(/\$state\(/g, '(')
    .replace('const friendsPaneOpen = $derived(', 'const __PANEOPEN_DECL__ = (')
    .replace(/\$effect\(\(\) => \{([\s\S]*?)\}\);/, 'const __paneEffect = () => {$1};')
    .replace(/onDestroy\(\(\) => \{([\s\S]*?)\}\);/, 'const __destroy = () => {$1};')
    .replace(/friendsPaneOpen/g, '__paneOpen()')
    .replace('const __PANEOPEN_DECL__ = (', 'const __paneOpen = () => (')
    .replace("import('$lib/friends/dm-session')", '__mods.sess')
    .replace("import('$lib/friends/dm-poller')", '__mods.poll')
    .replace("import('../friends/DmPanel.svelte')", '__mods.panel');
  assert.ok(block.includes('__paneEffect') && block.includes('__destroy') && block.includes('__mods.sess'),
    '⚠⚠ 出貨碼的寫法變了，抽取器沒有改到 ⇒ 這一段已經不是在測出貨碼');
  const js = esbuild.transformSync(block, { loader: 'ts', format: 'esm' }).code;
  const fn = new Function('__mods', '__env', '__deps', `
    const { friendsCtxFromAuth } = __deps;
    with (__env) {
      ${js}
      return { openDm, closeDm, dmAfterAct, paneEffect: __paneEffect, destroy: __destroy, paneOpen: __paneOpen,
               state: () => dmState, neg: () => dmNegMsg, comp: () => DmPanelComp };
    }`);
  return fn(
    { sess: Promise.resolve(mods['dm-session']), poll: Promise.resolve({ browserPollerDeps: () => ({ isHidden: () => hiddenRef.v, setTimer: timers.set, clearTimer: timers.clear }) }), panel: Promise.resolve({ default: 'DM_PANEL' }) },
    env,
    { friendsCtxFromAuth: async () => ({ uid: 'FU', token: 'TOK' }) },
  );
}
function makeTimers() {
  let id = 0; const pend = new Map();
  return {
    set: (fn, ms) => { const h = ++id; pend.set(h, { fn, ms }); return h; },
    clear: (h) => { pend.delete(h); },
    pending: () => [...pend.values()].map((p) => p.ms),
    fire: () => { const e = [...pend.entries()]; pend.clear(); for (const [, p] of e) p.fn(); return e.length; },
  };
}
const flush = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setImmediate(r)); };
const FID = 'abcdef1234567890abcdef12';
function fakeDmServer() {
  const calls = [];
  const f = async (url) => {
    const u = new URL(String(url)); calls.push(u.pathname + u.search);
    if (u.pathname === '/api/friends/dm/list') {
      const since = +(u.searchParams.get('since') || 0);
      if (since > 0) return { status: 204, ok: true, headers: { get: () => null }, json: async () => { throw new Error('no body'); } };
      return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => ({ friendsDm: 1, fid: FID, messages: [{ id: 'm1', mine: false, text: 'hi', ts: 100 }], hasMore: false, serverNow: 9 }) };
    }
    return { status: 404, ok: false, headers: { get: () => 'text/html' }, json: async () => { throw new SyntaxError('<'); } };
  };
  return { f, calls };
}
/** 建一個「錦標賽好友分頁開著」的環境。 */
const tournEnv = () => ({ isTournament: true, tStep: 'lobby', isAnonymous: false, friendsEntryOn: true, tTab: 'friends',
  game: null, mode: 'online', onlineStep: 'join', lobbyTab: 'friends' });
async function bootOpen(envOver = {}) {
  const srv = fakeDmServer(); const timers = makeTimers(); const hidden = { v: false };
  const env = { ...tournEnv(), ...envOver };
  const W = makeWiring(GAME, loadDmMods(srv.f), env, timers, hidden);
  await W.openDm({ fid: FID, nick: '小明', alias: null });
  await flush();
  return { srv, timers, hidden, env, W };
}
await T('E1 ⭐⭐ 面板開著 ⇒ 第一發 list、之後**3 秒**一發（前景）', async () => {
  const S = await bootOpen();
  assert.strictEqual(S.srv.calls.length, 1, '開面板應恰一發，實際 ' + S.srv.calls.length);
  assert.deepStrictEqual(S.timers.pending(), [3000], '排程不是 3000ms：' + JSON.stringify(S.timers.pending()));
  S.timers.fire(); await flush();
  assert.strictEqual(S.srv.calls.length, 2, '3 秒後沒有再發一發');
  assert.deepStrictEqual(S.timers.pending(), [3000]);
  assert.strictEqual(S.W.state().status, 'ready', '狀態不是 ready：' + JSON.stringify(S.W.state() && S.W.state().status));
  assert.strictEqual(S.W.comp(), 'DM_PANEL', '動態載入的面板元件沒有接上');
  S.W.closeDm();
});
await T('E2 ⭐⭐ document.hidden ⇒ 放慢到 **15 秒**；回前景（poke）⇒ 立刻一發並回到 3 秒', async () => {
  const S = await bootOpen();
  S.hidden.v = true; S.timers.fire(); await flush();
  assert.deepStrictEqual(S.timers.pending(), [15000], 'hidden 時排程不是 15000：' + JSON.stringify(S.timers.pending()));
  const n = S.srv.calls.length;
  S.hidden.v = false;
  // 出貨碼在 visibilitychange 裡呼叫 _dm?.poke()（見 E5b 的靜態斷言），這裡直接驗行為
  S.timers.fire(); await flush();
  assert.strictEqual(S.srv.calls.length, n + 1);
  assert.deepStrictEqual(S.timers.pending(), [3000], '回前景後沒有回到 3000：' + JSON.stringify(S.timers.pending()));
  S.W.closeDm();
});
await T('E3 ⭐⭐⭐ **關掉面板** ⇒ 排程清空、狀態 null，之後 200 個 tick **零請求**', async () => {
  const S = await bootOpen();
  const n = S.srv.calls.length;
  S.W.closeDm(); await flush();
  assert.deepStrictEqual(S.timers.pending(), [], '關掉後還有排程：' + JSON.stringify(S.timers.pending()));
  assert.strictEqual(S.W.state(), null, '關掉後狀態不是 null');
  for (let i = 0; i < 200; i++) { S.timers.fire(); await new Promise((r) => setImmediate(r)); }
  await flush();
  assert.strictEqual(S.srv.calls.length, n, '⚠⚠⚠ 關掉面板之後還在發請求：' + (S.srv.calls.length - n) + ' 發');
});
await T('E4 ⭐⭐⭐ **切走分頁** ⇒ 輪詢必須停（新情境）：把 friendsPaneOpen 與 $effect 從出貨碼抽出來實跑；四種切走方式各驗一次、200 個 tick 零請求', async () => {
  const AWAYS = [
    ['切到賽事分頁', { tTab: 'events' }],
    ['切到排行榜分頁', { tTab: 'leaderboard' }],
    ['切到個人資料分頁', { tTab: 'profile' }],
    ['錦標賽開打（tStep=playing）', { tStep: 'playing' }],
  ];
  for (const [why, patch] of AWAYS) {
    const S = await bootOpen();
    assert.strictEqual(S.W.paneOpen(), true, '起始狀態應該是「好友分頁開著」');
    const n = S.srv.calls.length;
    Object.assign(S.env, patch);
    assert.strictEqual(S.W.paneOpen(), false, why + '：friendsPaneOpen 竟然還是 true');
    S.W.paneEffect();
    await flush();
    assert.deepStrictEqual(S.timers.pending(), [], why + '：切走之後還有排程');
    for (let i = 0; i < 200; i++) { S.timers.fire(); await new Promise((r) => setImmediate(r)); }
    await flush();
    assert.strictEqual(S.srv.calls.length, n, '⚠⚠⚠ ' + why + ' 之後還在發請求：' + (S.srv.calls.length - n) + ' 發');
  }
  // 大廳側：切回「線上連線對戰」分頁／進等待室／開打，也都要停
  const LOBBY_AWAYS = [
    ['大廳切回線上對戰分頁', { lobbyTab: 'online' }],
    ['進了等待室', { onlineStep: 'room' }],
    ['開打了', { game: { id: 'g1' } }],
    ['好友功能被判為不支援', { friendsEntryOn: false }],
  ];
  for (const [why, patch] of LOBBY_AWAYS) {
    const S = await bootOpen({ isTournament: false, tTab: 'events' });
    assert.strictEqual(S.W.paneOpen(), true, '大廳起始狀態應該是「好友分頁開著」');
    const n = S.srv.calls.length;
    Object.assign(S.env, patch);
    assert.strictEqual(S.W.paneOpen(), false, why + '：friendsPaneOpen 竟然還是 true');
    S.W.paneEffect(); await flush();
    for (let i = 0; i < 200; i++) { S.timers.fire(); await new Promise((r) => setImmediate(r)); }
    await flush();
    assert.strictEqual(S.srv.calls.length, n, '⚠⚠⚠ ' + why + ' 之後還在發請求');
  }
});
await T('E5 ⭐⭐ **離開整個頁面** ⇒ onDestroy 關掉輪詢：200 個 tick 零請求', async () => {
  const S = await bootOpen();
  const n = S.srv.calls.length;
  S.W.destroy(); await flush();
  assert.deepStrictEqual(S.timers.pending(), [], '離開頁面後還有排程');
  for (let i = 0; i < 200; i++) { S.timers.fire(); await new Promise((r) => setImmediate(r)); }
  await flush();
  assert.strictEqual(S.srv.calls.length, n, '⚠⚠⚠ 離開頁面之後還在發請求：' + (S.srv.calls.length - n) + ' 發');
});
await T('E5b ⭐ 出貨碼真的把 onDestroy／$effect／回前景 poke 三條線都接上了（靜態；行為由 E2～E5 驗）', () => {
  assert.ok(/onDestroy\(\(\) => \{ closeDm\(\); \}\);/.test(GAME), '沒有 onDestroy 清理');
  assert.ok(/\$effect\(\(\) => \{ if \(!friendsPaneOpen\) closeDm\(\); \}\);/.test(GAME), '沒有把 friendsPaneOpen 接到 $effect');
  const vi = GAME.indexOf("if (document.visibilityState !== 'visible') return;");
  assert.ok(vi > 0, '抽不到 visibilitychange 的「回前景」分支');
  const vis = GAME.slice(vi, GAME.indexOf('tLobbyResume();', vi));
  assert.ok(vis.length > 20 && vis.length < 2000, 'visibilitychange 區間長度異常（' + vis.length + '）⇒ 錨點抓錯');
  assert.ok(/_dm\?\.poke\(\);/.test(vis), '回前景沒有補一發私聊（背景排程是 15 秒）：' + vis.slice(0, 200));
});
await T('E6 ⭐⭐ 私聊面板只在有狀態時渲染，且掛在 foot snippet 裡；dmAfterAct 對同一位 fid 會關掉面板（實跑）', async () => {
  assert.ok(/\{#snippet dmFoot\(\)\}\s*\n\s*\{#if dmState && DmPanelComp\}/.test(GAME), 'dmFoot 沒有用 {#if dmState && DmPanelComp} 包住');
  const S = await bootOpen();
  S.W.dmAfterAct('another-fid'); await flush();
  assert.ok(S.W.state(), '對別人做動作竟然把面板關掉了');
  S.W.dmAfterAct(FID); await flush();
  assert.strictEqual(S.W.state(), null, '對正在對話的這一位做解除／封鎖之後沒有關掉面板');
  assert.deepStrictEqual(S.timers.pending(), [], 'dmAfterAct 關掉後還有排程');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】版面量測（四種尺寸；沒有瀏覽器就 SKIP）');
let hasPw = false;
try { createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright'); hasPw = true; } catch { hasPw = false; }
if (!hasPw) {
  skipped.push('【F】四種尺寸的 DOM 量測（沒有 playwright 模組）');
  console.log('  ⚠⚠ SKIP 【F】：這台機器沒有 Playwright ⇒ 版面沒有量（【C】的 CSS 逐字比對仍在守）');
} else {
  await T('F1 ⭐⭐ 375×812／390×844／412×915／1366×768 四種尺寸：分頁列以上全等、以下位移恆定、無重疊、無水平溢出、前三顆文字逐字未動', () => {
    let out = '';
    try {
      out = execFileSync(process.execPath, [join(ROOT, 'scripts/measure-v6297-tourn-tabs.mjs')], { cwd: ROOT, maxBuffer: 1 << 26, env: { ...process.env, MEASURE_OUT: '/tmp/measure-v6297.json' } }).toString('utf8');
    } catch (e) {
      out = String((e.stdout && e.stdout.toString()) || '') + String((e.stderr && e.stderr.toString()) || '');
      assert.fail('版面量測不符：\n' + out.split('\n').filter((l) => l.includes('✗')).join('\n').slice(0, 800));
    }
    assert.ok(/全部符合/.test(out), '量測腳本沒有回報「全部符合」：' + out.slice(-400));
    for (const tag of ['375×812', '390×844', '412×915', '1366×768']) assert.ok(out.includes(tag), '量測沒有跑 ' + tag);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】回歸不變量');
await T('G1 ⭐⭐ `/friends` 這條獨立路由與 DmPanel.svelte **逐位元未動**（本版只動對戰頁；淺複製時退化成結構斷言）', () => {
  const structural = () => {
    const page = rd(P_FRPAGE);
    assert.ok(/import FriendsPanel from '\$lib\/friends\/FriendsPanel\.svelte';/.test(page), '/friends 頁沒有 import 共用元件');
    assert.ok(/<FriendsPanel \{head\} \{foot\} ondm=\{openDm\}/.test(page), '/friends 頁的 head／foot／ondm 沒接上');
    assert.ok(/\{#if dmState\}\s*<DmPanel /.test(page), '/friends 頁的私聊面板不見了');
    assert.ok(rd(P_DMPANEL).includes('class="dm-panel'), 'DmPanel.svelte 不見了');
  };
  structural();
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('v6297 G1 /friends 與 DmPanel 逐位元比對', '上面的結構斷言不需要歷史，仍在守'); skipped.push('G1 逐位元（淺複製）'); return; }
  for (const [p, rel] of [[P_FRPAGE, 'src/routes/friends/+page.svelte'], [P_DMPANEL, 'src/routes/friends/DmPanel.svelte']]) {
    const b = readBaseBlob(ROOT, BASE_SHA, rel);
    assert.ok(b.ok, '讀不到 BASE 的 ' + rel);
    assert.strictEqual(createHash('sha256').update(rd(p), 'utf8').digest('hex'),
      createHash('sha256').update(b.out.replace(/\r\n/g, '\n'), 'utf8').digest('hex'), '⚠⚠ ' + rel + ' 被動到了（本版不該動它）');
  }
});
await T('G2 新增的區塊零 {@html}；錦標賽好友分頁區間零 {#each}（沒有新的無 key 清單）；共用元件仍零 {@html}', () => {
  const fr = GAME.indexOf("{:else if tTab === 'friends'}");
  const err = GAME.indexOf('{#if tError}<p class="warn">'/* ⭐ 只當位置錨點：那一行後來加了關閉鈕，改用前綴（斷言內容未變） */);
  const seg = GAME.slice(fr, err) + GAME.slice(GAME.indexOf('{#snippet dmFoot()}'), GAME.indexOf('{/snippet}', GAME.indexOf('{#snippet dmFoot()}')));
  assert.ok(seg.length > 300, '新增區塊只有 ' + seg.length + ' 字元 ⇒ 錨點抓錯');
  assert.ok(!seg.includes('{@html'), '⚠⚠ 新增區塊出現 {@html}');
  assert.strictEqual((seg.match(/\{#each/g) || []).length, 0, '新增區塊出現了沒有 key 保證的 each');
  assert.ok(!stripCmt(FRP).includes('{@html'), '共用元件出現 {@html}');
  for (const e of stripCmt(FRP).match(/\{#each[^}]*\}/g) || []) assert.ok(/\(r\.fid\)\}$/.test(e), '共用元件的 each 沒用 fid 當 key：' + e);
});
await T('G3 ⭐ 全檔的 tTab 賦值只有 tTabRaw 一條路（舊的 `tTab = ` 直接賦值不得復活）', () => {
  const G = stripCmt(GAME);
  const assigns = (G.match(/(?<![A-Za-z_$])tTab\s*=[^=>]/g) || []).length;
  const decl = (G.match(/const tTab = \$derived\(/g) || []).length;
  assert.strictEqual(decl, 1, 'const tTab = $derived(…) 不是恰一處：' + decl);
  assert.strictEqual(assigns - decl, 0, '⚠⚠ 有人直接賦值給 tTab（它現在是 $derived，會編譯失敗或靜默失效）：' + assigns + ' 處');
  assert.ok((G.match(/tTabRaw\s*=[^=]/g) || []).length >= 1, '正對照：tTabRaw 應該有被賦值');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【H】test chain ／版本一致');
await T('H1 本守衛與量測腳本都在；本守衛進了 package.json 的 test chain；version.ts 與 admin.html SITE_VERSION_HINT 一致（不 pin 版本號）', () => {
  assert.ok(existsSync(join(ROOT, 'scripts/measure-v6297-tourn-tabs.mjs')), '缺量測腳本');
  assert.ok(JSON.parse(PKG).scripts.test.includes('node scripts/test-v6297-tourn-friends-tab.mjs'), '本守衛沒進 test chain');
  const V = /VERSION = '([\d.]+)'/.exec(rd(join(ROOT, 'src/lib/version.ts')))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(rd(join(ROOT, 'oracle-admin/admin.html')))[1];
  assert.strictEqual(H, V, 'admin.html hint ' + H + ' ≠ version.ts ' + V);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【I】突變（每個都必須紅在預期那一條）');
await T('I1 突變：tTab 的鎖拿掉（tTabRaw 直通）⇒ B1 紅在「沒有被鎖回 events」', () =>
  mutantMustBreak('拿掉 tTab 的鎖', () => {
    const bad = mutate(GAME, "const tTab = $derived(tTabRaw === 'friends' && !friendsEntryOn ? 'events' : tTabRaw);", 'const tTab = $derived(tTabRaw);');
    const m = /const tTab = \$derived\(([^;]*)\);/.exec(bad);
    assert.strictEqual(new Function('tTabRaw', 'friendsEntryOn', 'return (' + m[1] + ');')('friends', false), 'events',
      '⚠⚠ 好友未開放時 tTab 沒有被鎖回 events ⇒ 會停在一個畫不出來的分頁');
  }, '沒有被鎖回 events'));
await T('I2 突變：第 4 顆分頁鈕忘了包 {#if friendsEntryOn} ⇒ B3 紅在「沒有包在 {#if friendsEntryOn} 裡」', () =>
  mutantMustBreak('第 4 顆沒有閘', () => {
    const bad = mutate(GAME, '        {#if friendsEntryOn}\n          <button class="tourn-tab" class:active={tTab === \'friends\'}',
      '        {#if true}\n          <button class="tourn-tab" class:active={tTab === \'friends\'}');
    const blk = tabsBlock(bad); const btns = tabButtons(blk);
    const before = blk.slice(0, blk.indexOf(btns[3].raw));
    assert.ok(/\{#if friendsEntryOn\}\s*$/.test(stripCmt(before)), '⚠⚠ 第 4 顆沒有包在 {#if friendsEntryOn} 裡（伺服器不支援／開關關著時也會冒出來）');
  }, '沒有包在 {#if friendsEntryOn} 裡'));
await T('I3 ⭐⭐⭐ 突變：把私聊改成靜態 import（打包進對戰頁）⇒ D1 紅在「靜態相依圖走得到私聊模組」', () =>
  mutantMustBreak('靜態 import 私聊', () => {
    const bad = mutate(GAME, "  import { friendsCtxFromAuth } from '$lib/friends/auth-ctx';",
      "  import { createDmSession } from '$lib/friends/dm-session';\n  import { friendsCtxFromAuth } from '$lib/friends/auth-ctx';");
    assertGraphClean(new Map([[P_GAME, bad]]));
  }, '靜態'));
await T('I4 ⭐⭐⭐ 突變：切走分頁時忘了關私聊（$effect 的主體掏空）⇒ E4 紅在「切走之後還在發請求」', () =>
  mutantMustBreak('切分頁不關私聊', async () => {
    const bad = mutate(GAME, '$effect(() => { if (!friendsPaneOpen) closeDm(); });', '$effect(() => { if (!friendsPaneOpen) { void 0; } });');
    const srv = fakeDmServer(); const timers = makeTimers(); const hidden = { v: false }; const env = tournEnv();
    const W = makeWiring(bad, loadDmMods(srv.f), env, timers, hidden);
    await W.openDm({ fid: FID, nick: '小明', alias: null }); await flush();
    const n = srv.calls.length;
    env.tTab = 'events'; W.paneEffect(); await flush();
    for (let i = 0; i < 20; i++) { timers.fire(); await new Promise((r) => setImmediate(r)); }
    await flush();
    assert.strictEqual(srv.calls.length, n, '⚠⚠⚠ 切到賽事分頁 之後還在發請求：' + (srv.calls.length - n) + ' 發');
  }, '之後還在發請求'));
await T('I5 ⭐⭐ 突變：friendsPaneOpen 只看分頁、不看「是否已離開大廳／開打」⇒ E4 的大廳情境紅在「friendsPaneOpen 竟然還是 true」', () =>
  mutantMustBreak('paneOpen 只看分頁', async () => {
    const bad = mutate(GAME, "      : (!game && mode === 'online' && onlineStep !== 'room' && friendsEntryOn && lobbyTab === 'friends'),",
      "      : (lobbyTab === 'friends'),");
    const srv = fakeDmServer(); const timers = makeTimers(); const hidden = { v: false };
    const env = { ...tournEnv(), isTournament: false, tTab: 'events' };
    const W = makeWiring(bad, loadDmMods(srv.f), env, timers, hidden);
    await W.openDm({ fid: FID, nick: '小明', alias: null }); await flush();
    env.onlineStep = 'room';
    assert.strictEqual(W.paneOpen(), false, '進了等待室：friendsPaneOpen 竟然還是 true');
  }, 'friendsPaneOpen 竟然還是 true'));
await T('I6 ⭐⭐ 突變：離開頁面沒有清理（onDestroy 主體掏空）⇒ E5 紅在「離開頁面之後還在發請求」', () =>
  mutantMustBreak('離開頁面不清理', async () => {
    const bad = mutate(GAME, '  onDestroy(() => { closeDm(); });', '  onDestroy(() => { void 0; });');
    const srv = fakeDmServer(); const timers = makeTimers(); const hidden = { v: false };
    const W = makeWiring(bad, loadDmMods(srv.f), tournEnv(), timers, hidden);
    await W.openDm({ fid: FID, nick: '小明', alias: null }); await flush();
    const n = srv.calls.length;
    W.destroy(); await flush();
    for (let i = 0; i < 20; i++) { timers.fire(); await new Promise((r) => setImmediate(r)); }
    await flush();
    assert.strictEqual(srv.calls.length, n, '⚠⚠⚠ 離開頁面之後還在發請求：' + (srv.calls.length - n) + ' 發');
  }, '離開頁面之後還在發請求'));
await T('I6b ⭐⭐ 突變：closeDm 不再真的停掉 session ⇒ E3／E4／E5 全都紅（這裡驗 E5 那條）', () =>
  mutantMustBreak('closeDm 空轉', async () => {
    const bad = mutate(GAME, 'function closeDm(): void { _dm?.close(); }', 'function closeDm(): void { void 0; }');
    const srv = fakeDmServer(); const timers = makeTimers(); const hidden = { v: false };
    const W = makeWiring(bad, loadDmMods(srv.f), tournEnv(), timers, hidden);
    await W.openDm({ fid: FID, nick: '小明', alias: null }); await flush();
    const n = srv.calls.length;
    W.destroy(); await flush();
    for (let i = 0; i < 20; i++) { timers.fire(); await new Promise((r) => setImmediate(r)); }
    await flush();
    assert.strictEqual(srv.calls.length, n, '⚠⚠⚠ 離開頁面之後還在發請求：' + (srv.calls.length - n) + ' 發');
  }, '離開頁面之後還在發請求'));
await T('I7 ⭐⭐ 突變：分頁列改用方案 1 的 CSS（flex-wrap 折行）⇒ C2 紅在「出現了 flex-wrap」', () =>
  mutantMustBreak('改成方案 1', () => {
    const bad = mutate(GAME, '  .tourn-tabs { display: flex; gap: 6px; max-width: 100%; margin: 6px auto 12px; }',
      '  .tourn-tabs { display: flex; flex-wrap: wrap; gap: 6px; max-width: 100%; margin: 6px auto 12px; }');
    const now = cssRules(bad).join('\n');
    for (const k of ['flex-wrap', 'white-space', 'flex: 1 1']) assert.ok(!now.includes(k), '分頁列 CSS 出現了 ' + k + ' ⇒ 不是方案 2 了');
  }, '出現了 flex-wrap'));
await T('I8 ⭐⭐ 突變：對戰版面分支裡塞進 openDm ⇒ D2 紅在「對戰版面分支出現」', () =>
  mutantMustBreak('對戰分支夾帶 openDm', () => {
    const s = GAME.indexOf(BATTLE_START);
    assertBattleClean(GAME.slice(0, s + BATTLE_START.length) + '\n      <!-- x -->{#if false}{@const _z = openDm}{/if}\n' + GAME.slice(s + BATTLE_START.length));
  }, '對戰版面分支出現'));

// ═══════════════════════════════════════════════════════════════════════════
if (skipped.length) console.log('\n⚠⚠ 本次 SKIP：' + skipped.join('；') + ' —— 這幾段在這台機器上沒有在守');
console.log('\n══ v6.297 錦標賽好友分頁＋私聊內嵌守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
