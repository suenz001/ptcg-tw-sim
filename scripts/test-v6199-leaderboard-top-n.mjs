// ⭐⭐⭐v6.199 守衛：錦標賽「📊 排行榜」顯示筆數（5 / 10 / 20）
//   跑法：node scripts/test-v6199-leaderboard-top-n.mjs
//
// 站長需求：排行榜五個榜長年只看得到前 5 名，要能選到前 20 名，而且「不可以破壞排版」。
//
// ⚠ 真因（先定位再動手）：截斷點**不在前端**。前端排行榜分頁是 `{#each rows}`，
//   伺服器回幾筆就畫幾筆；真正的 `slice(0, 5)` 有兩處，都在
//   oracle-admin/server_admin_patch.js 的 GET /api/tournament/leaderboard
//   （`topN()` 與 `communityHost`）⇒ 只在前端加下拉會完全沒有效果。
//
// ⚠⚠ 這支刻意**不是**只驗字串存在（本專案反覆踩「斷言有呼叫某函式 ≠ 那件事發生了」）：
//   ① 中央模組 leaderboard-top.ts、② 前端 `#each` 的**表達式原文**、
//   ③ 伺服器的 _lbClampLimit/_lbSliceResult —— 三段都切出來**真的跑起來**求值；
//   版面則內建 box-model 求值器**算出實際 px**（桌機與手機直式各一），
//   而且求值器自己先用手算得出答案的 fixture 自我驗證（IRON_RULES Rule 25）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const ROOT = process.env.V6199_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const readOr = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
const PAGE = readOr('src/routes/game/+page.svelte');
const LBT  = readOr('src/lib/ui/leaderboard-top.ts');
const SRV  = readOr('oracle-admin/server_admin_patch.js');

let pass = 0; const fails = [];
const T = (name, fn) => { try { fn(); pass++; } catch (e) { fails.push(name + ' — ' + (e && e.message)); } };
const TA = async (name, fn) => { try { await fn(); pass++; } catch (e) { fails.push(name + ' — ' + (e && e.message)); } };

const ts = (s) => transformSync(s, { loader: 'ts' }).code;
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
/** 從 `from` 起，用大括號配對切出**整個區塊**（不是切到第一個換行 —— 那會讓多行改寫後負向斷言瞎掉）。 */
function sliceBlock(src, from, label) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, '找不到區塊起點（守衛需同步更新）：' + label);
  let d = 0, j = src.indexOf('{', i);
  assert.ok(j > i, '區塊沒有大括號：' + label);
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('大括號沒有配對：' + label);
}
function slice(src, from, to, label) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, '找不到起始錨點（守衛需同步更新）：' + label);
  const j = src.indexOf(to, i + from.length);
  assert.ok(j > i, '找不到結束錨點：' + label);
  return src.slice(i, j);
}

// ── 0) 剝註解器自我驗證（否定型斷言一律先剝，且剝的人自己要先被驗） ──────────
T('0a 剝註解器：區塊註解裡的 @media 不會被算進去', () => {
  assert.equal(stripComments('a{x:1} /* @media (max-width:1px){} */ b{y:2}').includes('@media'), false);
});
T('0b 剝註解器：HTML 註解裡的 @media 不會被算進去', () => {
  assert.equal(stripComments('<!-- @media zz -->x').includes('@media'), false);
});
T('0c 剝註解器：沒有誤刪正文', () => {
  const o = stripComments('a{x:1} /* c */ b{y:2}');
  assert.ok(o.includes('a{x:1}') && o.includes('b{y:2}'));
});

// ── 1) 中央模組 leaderboard-top.ts：實跑求值 ─────────────────────────────────
let M = null;
T('1a 中央模組存在且匯出全部介面', () => {
  assert.ok(LBT.trim().length > 0, 'src/lib/ui/leaderboard-top.ts 不存在（顯示筆數沒有單一來源）');
  const body = ts(LBT).replace(/export\s+/g, '')
    + '\n; return { LB_TOP_OPTIONS, LB_TOP_DEFAULT, LB_TOP_MAX, LB_TOP_KEY, normalizeLbTop, lbTopRows, loadLbTop, saveLbTop };';
  M = new Function(body)();
  for (const k of ['normalizeLbTop', 'lbTopRows', 'loadLbTop', 'saveLbTop']) assert.equal(typeof M[k], 'function', k);
});
T('1b 級距是 5 / 10 / 20，且上限 = 選項最大值（下拉選得到 20 ⇒ 伺服器就得送 20）', () => {
  assert.deepEqual([...M.LB_TOP_OPTIONS], [5, 10, 20]);
  assert.equal(M.LB_TOP_MAX, Math.max(...M.LB_TOP_OPTIONS));
  assert.equal(M.LB_TOP_DEFAULT, 5, '預設必須維持 5：沒動過下拉的人版面不可以變');
});
const mkRows = (n) => Array.from({ length: n }, (_, i) => ({ displayName: 'P' + (i + 1), count: 100 - i }));
T('1c ⭐核心①：選 20 真的拿到 20 筆（不是 5 筆、也不是全部）', () => {
  const out = M.lbTopRows(mkRows(25), 20);
  assert.equal(out.length, 20);
  assert.equal(out[0].displayName, 'P1');
  assert.equal(out[19].displayName, 'P20');
});
T('1d 選 5 / 10 分別拿到 5 / 10 筆，且順序不變', () => {
  assert.equal(M.lbTopRows(mkRows(25), 5).length, 5);
  assert.equal(M.lbTopRows(mkRows(25), 10).length, 10);
  assert.deepEqual(M.lbTopRows(mkRows(25), 10).map((x) => x.displayName), mkRows(10).map((x) => x.displayName));
});
T('1e ⭐核心②：名次編號 1..N 連續、不跳號、不補空列（資料只有 8 筆時就是 8 筆）', () => {
  const out = M.lbTopRows(mkRows(8), 20);
  assert.equal(out.length, 8, '資料不足不可以補空列');
  const ranks = out.map((_, i) => i + 1);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8]);
  const big = M.lbTopRows(mkRows(25), 20).map((_, i) => i + 1);
  assert.deepEqual(big, Array.from({ length: 20 }, (_, i) => i + 1));
});
T('1f lbTopRows 對 null / undefined / 非陣列一律回空陣列（不炸畫面）', () => {
  assert.deepEqual(M.lbTopRows(null, 20), []);
  assert.deepEqual(M.lbTopRows(undefined, 20), []);
  assert.deepEqual(M.lbTopRows({}, 20), []);
});
T('1g normalizeLbTop：不在選項內／亂填／被竄改的值一律退回預設', () => {
  assert.equal(M.normalizeLbTop('10'), 10);
  assert.equal(M.normalizeLbTop(20), 20);
  assert.equal(M.normalizeLbTop('abc'), 5);
  assert.equal(M.normalizeLbTop(999), 5);
  assert.equal(M.normalizeLbTop(null), 5);
  assert.equal(M.normalizeLbTop(-3), 5);
});

// localStorage：⭐核心④
function withLocalStorage(impl, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const old = had ? globalThis.localStorage : undefined;
  Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true, writable: true });
  try { return fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', { value: old, configurable: true, writable: true });
    else delete globalThis.localStorage;
  }
}
T('1h ⭐核心④：選擇會被記住（存進去、讀回來是同一個值）', () => {
  const store = new Map();
  withLocalStorage({ getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) }, () => {
    M.saveLbTop(20);
    assert.equal(store.get(M.LB_TOP_KEY), '20');
    assert.equal(M.loadLbTop(), 20);
    M.saveLbTop(10);
    assert.equal(M.loadLbTop(), 10);
  });
});
T('1i ⭐核心④：Safari 無痕 setItem throw ⇒ 不可以炸出去（且畫面仍可用預設值）', () => {
  const boom = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
  withLocalStorage(boom, () => {
    assert.doesNotThrow(() => M.saveLbTop(20), 'saveLbTop 必須自己 try/catch');
    assert.doesNotThrow(() => M.loadLbTop(), 'loadLbTop 必須自己 try/catch');
    assert.equal(M.loadLbTop(), 5);
  });
});
T('1j 沒有 localStorage 的環境（SSR / 預渲染）不可以炸', () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const old = had ? globalThis.localStorage : undefined;
  if (had) delete globalThis.localStorage;
  try {
    assert.doesNotThrow(() => M.saveLbTop(20));
    assert.equal(M.loadLbTop(), 5);
  } finally { if (had) Object.defineProperty(globalThis, 'localStorage', { value: old, configurable: true, writable: true }); }
});

// ── 2) 前端接線：把 template 的 #each 表達式原文抓出來「真的跑」 ─────────────
const LB_BLOCK = (() => {
  try { return slice(PAGE, "{:else if tTab === 'leaderboard'}", "{:else if tTab === 'profile'}", '排行榜分頁 template'); }
  catch { return ''; }
})();
T('2a 找得到排行榜分頁的 template 區塊', () => { assert.ok(LB_BLOCK.length > 0); });

const EACH_EXPRS = [...LB_BLOCK.matchAll(/\{#each\s+([^{}\n]+?)\s+as\s+r\s*,\s*i\}/g)].map((m) => m[1].trim());
T('2b 排行榜共有 3 種列渲染入口（共用 snippet ×1 ＋ 冠軍榜兩欄 ×2）', () => {
  assert.equal(EACH_EXPRS.length, 3, '實際找到：' + JSON.stringify(EACH_EXPRS));
});
T('2b-2 ⭐排行榜區塊內**沒有**任何繞過 lbTopRows 的列渲染（將來加第六個榜也會被抓到）', () => {
  const all = [...stripComments(LB_BLOCK).matchAll(/\{#each\s+([^{}\n]+?)\s+as\s+/g)].map((m) => m[1].trim());
  const bypass = all.filter((e) => e !== 'LB_TOP_OPTIONS' && !e.includes('lbTopRows('));
  assert.deepEqual(bypass, [], '這些 each 沒有走顯示筆數的中央切片：' + JSON.stringify(bypass));
  assert.ok(all.includes('LB_TOP_OPTIONS'), '下拉選項的 each 不見了（錨點失效，本檢查會空轉）');
});
T('2c ⭐核心①（行為端）：每一個 #each 的**表達式原文**餵 25 筆＋選 20 ⇒ 真的畫 20 列', () => {
  for (const expr of EACH_EXPRS) {
    const fn = new Function('lbTopRows', 'tLbTop', 'rows', 'tLeaderboard',
      'return (' + expr + ');');
    const rows25 = mkRows(25);
    const fakeLb = { champions: { official: rows25, community: rows25 }, wins: rows25, top8: rows25, finals: rows25, communityHost: rows25 };
    const out20 = fn(M.lbTopRows, 20, rows25, fakeLb);
    assert.ok(Array.isArray(out20), '表達式沒有回陣列：' + expr);
    assert.equal(out20.length, 20, '選 20 卻畫了 ' + out20.length + ' 列：' + expr);
    const out5 = fn(M.lbTopRows, 5, rows25, fakeLb);
    assert.equal(out5.length, 5, '選 5 卻畫了 ' + out5.length + ' 列：' + expr);
    // 名次連續（畫面上的名次就是這個 index+1）
    assert.deepEqual(out20.map((_, i) => i + 1), Array.from({ length: 20 }, (_, i) => i + 1));
  }
});
T('2d ⭐核心②：每一列仍然畫出「名次 + 暱稱 + 次數」三欄（欄位沒有被切換筆數弄丟）', () => {
  const b = stripComments(LB_BLOCK);
  assert.ok(b.includes('class="tourn-lb-rank tourn-lb-rank-{i + 1}"'), '名次圓標不見了或改了寫法');
  assert.ok(b.includes('{r.displayName}'), '暱稱欄不見了');
  assert.ok(/\{r\.count\}/.test(b), '次數欄不見了');
});
T('2e 下拉存在、選項來自中央模組、且 onchange 會寫回 localStorage', () => {
  const b = stripComments(LB_BLOCK);
  assert.ok(/<select[^>]*class="tourn-lb-topsel"/.test(b), '找不到顯示筆數下拉');
  assert.ok(b.includes('{#each LB_TOP_OPTIONS as _n}'), '選項沒有用中央模組的 LB_TOP_OPTIONS（會漂移）');
  assert.ok(/onchange=\{\(e\) => tLbSetTop\(e\.currentTarget\.value\)\}/.test(b), 'onchange 沒有接上 tLbSetTop');
  const setter = sliceBlock(PAGE, 'function tLbSetTop(', 'tLbSetTop');
  assert.ok(setter.includes('saveLbTop('), '切換筆數沒有記住選擇');
  assert.ok(setter.includes('tLbTop ='), '切換筆數沒有真的改到 tLbTop');
});
T('2e-2 ⭐舊伺服器（沒跑 redeploy-oracle.bat、不認識 ?limit=）不畫下拉 —— 不留一顆按了沒反應的控制項', () => {
  const b = stripComments(LB_BLOCK);
  const i = b.indexOf("{#if typeof tLeaderboard.limit === 'number'}");
  const j = b.indexOf('class="tourn-lb-bar"');
  assert.ok(i >= 0, '下拉沒有用「伺服器有沒有回 limit」當閘');
  assert.ok(j > i && b.indexOf('{/if}', j) > j, '下拉沒有被那道閘包住');
});
T('2f 下拉沿用站內既有的 select 寫法（value + onchange，同 #bgm-select），不是另做一套', () => {
  assert.ok(/<select id="bgm-select" value=\{bgmTrack\} onchange=/.test(PAGE), '站內既有寫法錨點不見了（守衛需更新）');
  assert.ok(/<select id="tourn-lb-top" class="tourn-lb-topsel" value=\{String\(tLbTop\)\} onchange=/.test(PAGE));
});

// ⭐核心⑤：切換筆數不重抓、不清空；載入仍走 stale-keep
T('2g ⭐核心⑤：tLbSetTop 只改本地筆數 —— 不重抓、不碰 tLeaderboard', () => {
  const setter = sliceBlock(PAGE, 'function tLbSetTop(', 'tLbSetTop');
  const s = stripComments(setter);
  assert.equal(/tLeaderboardLoad|tApi\(|fetch\(/.test(s), false, '切換筆數竟然會重新抓資料（會閃 / 會清空）');
  assert.equal(/tLeaderboard\s*=/.test(s), false, '切換筆數竟然會覆寫 tLeaderboard');
});
T('2g-2 正對照：sliceBlock 抓得到「函式被改成多行後藏在第 2 行」的重抓（不是只看第一行）', () => {
  const fake = 'function tLbSetTop(v) {\n  tLbTop = Number(v);\n  tLeaderboardLoad();\n}';
  const got = stripComments(sliceBlock(fake, 'function tLbSetTop(', 'fixture'));
  assert.ok(/tLeaderboardLoad/.test(got), 'sliceBlock 沒有切到整支函式 ⇒ 2g 會變成假綠');
});
// ⭐③2（審查抓到的假綠）：把 `$state(...)` 拿掉，瀏覽器裡下拉會完全沒反應
//   （Svelte 5 只給 non_reactive_update **警告**、不是錯誤，build 照樣過），
//   而純函式求值的 2c 完全驗不到響應式接線 ⇒ 必須有這一條把宣告本身釘死。
const RE_TLBTOP_STATE = /let\s+tLbTop\s*=\s*\$state\(\s*loadLbTop\(\)\s*\)/;
T('2i ⭐核心④/⑤：tLbTop 必須是 $state（否則選了不會重畫，而且一路綠燈到線上）', () => {
  assert.ok(RE_TLBTOP_STATE.test(PAGE), 'tLbTop 不是 $state(loadLbTop()) ⇒ 下拉會變成「選了沒反應」');
});
T('2i-2 正對照：這條規則抓得出「$state 被拿掉」', () => {
  assert.equal(RE_TLBTOP_STATE.test('let tLbTop = loadLbTop();'), false);
  assert.equal(RE_TLBTOP_STATE.test('let tLbTop = $state(5);'), false, '初值必須來自 loadLbTop() 才會記住選擇');
});
await TA('2h ⭐核心⑤（行為端）：tLeaderboardLoad 帶 limit=上限，且抓失敗時沿用上一份好資料', async () => {
  const FN = slice(PAGE, '  async function tLeaderboardLoad() {', '\n  async function tProfileLoad', 'tLeaderboardLoad');
  const asked = [];
  const factory = new Function('LB_TOP_MAX', 'adoptOrKeep', 'tApi', `
    let tLbLoading = false, tLeaderboard = null, tLeaderboardStale = false;
    ${ts(FN)}
    return { run: tLeaderboardLoad, get: () => ({ tLeaderboard, tLeaderboardStale, tLbLoading }) };
  `);
  let resp = { wins: mkRows(20) };
  const api = async (p) => { asked.push(p); return resp; };
  const inst = factory(M.LB_TOP_MAX, (prev, next) => (next == null ? { data: prev, stale: true } : { data: next, stale: false }), api);
  await inst.run();
  assert.equal(asked.length, 1);
  assert.ok(asked[0].includes('limit=' + M.LB_TOP_MAX), '沒有跟伺服器要上限筆數，實際請求：' + asked[0]);
  assert.equal(inst.get().tLeaderboard.wins.length, 20);
  // 第二發回不可信 ⇒ 必須沿用上一份好資料、只標 stale（v6.177 紀律，切筆數時畫面才不會空掉）
  resp = null;
  await inst.run();
  assert.ok(inst.get().tLeaderboard && inst.get().tLeaderboard.wins.length === 20, '抓失敗竟然把排行榜清空了');
  assert.equal(inst.get().tLeaderboardStale, true);
  assert.equal(inst.get().tLbLoading, false);
});

// ── 3) ⭐核心③ 版面：box-model 求值器（先自我驗證，再算實際 px） ─────────────
const CSS = (() => {
  const i = PAGE.lastIndexOf('<style');
  if (i < 0) return '';
  const j = PAGE.indexOf('>', i);
  return stripComments(PAGE.slice(j + 1));
})();
function parseRules(css) {
  const out = new Map();
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const k = d.indexOf(':'); if (k < 0) continue;
      decls[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim();
    }
    for (const sel of m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
      out.set(sel, Object.assign(out.get(sel) || {}, decls));
    }
  }
  return out;
}
const px = (v, root = 16) => {
  if (v == null) return null;
  const s = String(v).trim();
  let mm = s.match(/^(-?[\d.]+)px$/); if (mm) return parseFloat(mm[1]);
  mm = s.match(/^(-?[\d.]+)rem$/); if (mm) return parseFloat(mm[1]) * root;
  mm = s.match(/^(-?[\d.]+)$/); if (mm) return parseFloat(mm[1]);
  return null;
};
/** auto-fit + minmax(minPx, 1fr)：算出欄數與每欄寬。 */
function autoFitCols(containerW, minPx, gapPx) {
  let n = Math.max(1, Math.floor((containerW + gapPx) / (minPx + gapPx)));
  return { cols: n, colW: (containerW - gapPx * (n - 1)) / n };
}
// 求值器自我驗證：手算得出答案的 fixture
T('3a 求值器自我驗證：px/rem 轉換與 auto-fit 欄數計算正確', () => {
  assert.equal(px('12px'), 12);
  assert.equal(px('.9rem'), 14.4);
  assert.equal(px('1.5rem'), 24);
  // 640 寬、min 230、gap 12：2 欄需 472 ✓、3 欄需 714 ✗
  assert.deepEqual(autoFitCols(640, 230, 12), { cols: 2, colW: 314 });
  // 364.4 寬 ⇒ 只放得下 1 欄
  assert.equal(autoFitCols(364.4, 230, 12).cols, 1);
  // 邊界：剛好放得下 3 欄（3*230+2*12=714）
  assert.equal(autoFitCols(714, 230, 12).cols, 3);
});
const R = parseRules(CSS);
T('3b 讀得到排行榜的版面規則（求值的前提）', () => {
  for (const s of ['.tourn-lb-grid', '.tourn-lb-card', '.tourn-lb-row', '.tourn-lb-rank', '.tourn-lb-name', '.lobby.tourn-lobby', '.tourn-lb-bar', '.tourn-lb-topsel']) {
    assert.ok(R.get(s), '找不到 CSS 規則：' + s);
  }
});
const LAYOUT = {};
T('3c ⭐核心③：每列高度由固定的 22px 名次圓標決定 ⇒ 與筆數、字體度量都無關', () => {
  const rank = R.get('.tourn-lb-rank'), row = R.get('.tourn-lb-row'), name = R.get('.tourn-lb-name'), cnt = R.get('.tourn-lb-cnt');
  const rankH = px(rank.height); assert.equal(rankH, 22);
  const pad = row.padding.split(/\s+/).map((x) => px(x)); // "5px 0"
  const padY = pad[0];
  const border = px((row['border-bottom'] || '').split(/\s+/)[0]);
  // 名稱/次數的行框即使用寬鬆的 line-height 1.5 也不會超過 22px ⇒ 列高不會被文字撐開
  const nameLine = px(name['font-size']) * 1.5, cntLine = px(cnt['font-size']) * 1.5;
  assert.ok(nameLine <= rankH, '暱稱行框 ' + nameLine + 'px 會撐高列');
  assert.ok(cntLine <= rankH, '次數行框 ' + cntLine + 'px 會撐高列');
  LAYOUT.rowH = rankH + padY * 2 + border;
  assert.equal(LAYOUT.rowH, 33);
});
T('3d ⭐核心③：兩位數名次（10~20）塞得進 22px 的圓標，不會被切掉也不會撐開', () => {
  const rank = R.get('.tourn-lb-rank');
  const fs = px(rank['font-size']);                 // .78rem = 12.48px
  const twoDigitW = fs * 0.6 * 2;                   // 數字字元寬約 0.6em（tabular 上界）
  assert.ok(twoDigitW < px(rank.height), '兩位數寬 ' + twoDigitW.toFixed(1) + 'px ≥ 圓標 22px');
  assert.ok(/flex:\s*0 0 22px/.test(rank.flex.replace(/\s+/g, ' ')) || rank.flex.trim() === '0 0 22px', '名次圓標不是固定寬');
});
T('3e ⭐核心③：長暱稱不會撐爆列寬（overflow:hidden ⇒ flex auto 最小尺寸為 0 ⇒ 走 ellipsis）', () => {
  const name = R.get('.tourn-lb-name');
  assert.equal(name.overflow, 'hidden', 'flex 項目沒有 overflow:hidden 時 min-width:auto = 內容寬，長暱稱會把整列撐寬');
  assert.equal(name['text-overflow'], 'ellipsis');
  assert.equal(name['white-space'], 'nowrap');
  assert.ok(/1 1 auto/.test(name.flex));
});
/** 一列的**最小**寬度：名次圓標(固定 22) + gap + 次數欄（暱稱欄 overflow:hidden ⇒ 最小可到 0）。 */
function rowMinW() {
  const row = R.get('.tourn-lb-row'), rank = R.get('.tourn-lb-rank'), cnt = R.get('.tourn-lb-cnt');
  const gap = px(row.gap);
  const cntW = px(cnt['font-size']) * 6;   // 「20 冠」約 4 個字寬，取 6 當上界
  return px(rank.height) + gap * 2 + cntW;
}
function boardHeights(N, viewportW, lobbyPadPx, champCols) {
  const gridGap = px(R.get('.tourn-lb-grid').gap);
  const cardPad = R.get('.tourn-lb-card').padding.split(/\s+/).map((x) => px(x)); // 12px 14px
  const cardBorder = px(R.get('.tourn-lb-card').border.split(/\s+/)[0]);
  const titleH = Math.round(px(R.get('.tourn-lb-title')['font-size']) * 1.2);
  const titleMB = px(R.get('.tourn-lb-title')['margin-bottom']);
  const subH = Math.round(px(R.get('.tourn-lb-sub')['font-size']) * 1.2);
  const subMB = px(R.get('.tourn-lb-sub')['margin-bottom']);
  const champGap = px(R.get('.tourn-lb-champ-cols').gap);
  const listH = LAYOUT.rowH * N - 1;                       // 最後一列沒有 border-bottom
  const plainCard = cardBorder * 2 + cardPad[0] * 2 + titleH + titleMB + listH;
  const champColH = subH + subMB + listH;
  const champBody = champCols === 2 ? champColH : champColH * 2 + champGap;
  const champCard = cardBorder * 2 + cardPad[0] * 2 + titleH + titleMB + champBody;
  const lobbyContent = Math.min(px(R.get('.lobby.tourn-lobby')['max-width']), viewportW - lobbyPadPx * 2);
  const { cols, colW } = autoFitCols(lobbyContent, px(R.get('.tourn-lb-grid')['grid-template-columns'].match(/minmax\(\s*([\d.]+px)/)[1]), gridGap);
  const gridRows = 1 + Math.ceil(4 / cols);                  // 冠軍榜整列 + 其餘 4 張
  const total = champCard + (gridRows - 1) * (plainCard + gridGap);
  return { cols, colW, plainCard, champCard, total, lobbyContent };
}
// ⚠ 求值器自我驗證（IRON_RULES Rule 25）：用手算得出答案的 fixture 反推 boardHeights。
//   3 筆、列高 33 ⇒ listH = 98；plainCard = 1+12 + 19 + 8 + 98 + 12+1 = 151。
T('3e-2 求值器自我驗證：boardHeights 的卡片高度與手算相符（不是印個數字就算數）', () => {
  const b = boardHeights(3, 1280, 24, 2);
  const titleH = Math.round(px(R.get('.tourn-lb-title')['font-size']) * 1.2);
  const expectPlain = 1 * 2 + 12 * 2 + titleH + 8 + (33 * 3 - 1);
  assert.equal(b.plainCard, expectPlain, '一般榜卡片高度算錯');
  const subH = Math.round(px(R.get('.tourn-lb-sub')['font-size']) * 1.2);
  const expectChamp = 1 * 2 + 12 * 2 + titleH + 8 + (subH + 5 + (33 * 3 - 1));   // 桌機冠軍榜兩欄並排 ⇒ 取單欄高
  assert.equal(b.champCard, expectChamp, '冠軍榜卡片高度算錯');
  // 桌機 2 欄：冠軍榜整列 + 2 個 grid row ⇒ 2 個 gap
  assert.equal(b.total, expectChamp + 2 * (expectPlain + 12), '整塊高度的 grid row / gap 數算錯');
});
T('3f ⭐核心③ 桌機（viewport 1280）：20 筆版面實際尺寸算得出來、且橫向不爆', () => {
  const d5 = boardHeights(5, 1280, 24, 2);
  const d20 = boardHeights(20, 1280, 24, 2);
  assert.equal(d5.cols, 2); assert.equal(d20.cols, 2);
  assert.equal(Math.round(d20.colW), 314);
  const minTrack = px(R.get('.tourn-lb-grid')['grid-template-columns'].match(/minmax\(\s*([\d.]+px)/)[1]);
  const gap = px(R.get('.tourn-lb-grid').gap);
  // ⚠ 不能寫 colW*cols+gap <= container（那是 auto-fit 的定義，恆真）。
  //   真正要驗的是「欄數是容器塞得下的最大值」＋「一列的最小內容塞得進一欄」。
  assert.ok(d20.cols * minTrack + (d20.cols - 1) * gap <= d20.lobbyContent, '選到的欄數其實塞不下');
  assert.ok((d20.cols + 1) * minTrack + d20.cols * gap > d20.lobbyContent, '其實還塞得下更多欄 ⇒ 欄數算錯');
  assert.ok(rowMinW() <= d20.colW - 14 * 2 - 1 * 2, '一列的最小內容（名次+間距+次數）塞不進欄寬 ⇒ 會橫向捲動');
  LAYOUT.desktop = { w5: Math.round(d5.total), w20: Math.round(d20.total), colW: Math.round(d20.colW) };
});
T('3g ⭐核心③ 手機直式（viewport 390）：單欄、寬度夠、下拉列不會擠爆', () => {
  const m5 = boardHeights(5, 390, 12.8, 1);
  const m20 = boardHeights(20, 390, 12.8, 1);
  assert.equal(m20.cols, 1);
  assert.ok(m20.colW > 300, '手機欄寬只有 ' + m20.colW.toFixed(1) + 'px');
  assert.ok(rowMinW() <= m20.colW - 14 * 2 - 1 * 2, '手機上一列的最小內容塞不進欄寬 ⇒ 會橫向捲動');
  // 最窄的實機（iPhone SE 一代 320px）也要過
  const tiny = boardHeights(20, 320, 12.8, 1);
  assert.equal(tiny.cols, 1);
  assert.ok(rowMinW() <= tiny.colW - 14 * 2 - 1 * 2, '320px 螢幕會橫向捲動');
  // 下拉列：標籤(4 全形字 × .82rem) + gap + select(「前 20 名」約 5 字 + 內距 + 三角鈕)
  const lblW = px(R.get('.tourn-lb-toplbl')['font-size']) * 4;
  const selPad = R.get('.tourn-lb-topsel').padding.split(/\s+/).map((x) => px(x));
  const selW = px(R.get('.tourn-lb-topsel')['font-size']) * 5 + selPad[1] * 2 + 24;
  const barW = lblW + px(R.get('.tourn-lb-bar').gap) + selW;
  assert.ok(barW < m20.colW, '下拉列 ' + barW.toFixed(1) + 'px 放不進 ' + m20.colW.toFixed(1) + 'px');
  LAYOUT.mobile = { w5: Math.round(m5.total), w20: Math.round(m20.total), colW: Math.round(m20.colW), barW: Math.round(barW) };
});

T('3h ⭐版面求值所依賴的兩條既有 @media 前提，必須真的還在（不然 3f/3g 是在算空氣）', () => {
  const css = stripComments(PAGE);
  assert.ok(/@media \(max-width: 600px\) and \(orientation: portrait\) \{/.test(css), '手機直式緊縮的斷點不見了');
  assert.ok(/\.lobby \{ padding: 0\.8rem !important; \}/.test(css), '.lobby 在手機直式的 padding 前提變了（3g 的 12.8px 就不對了）');
  assert.ok(/@media \(max-width: 560px\) \{ \.tourn-lb-champ-cols \{ grid-template-columns: 1fr; \} \}/.test(css),
    '冠軍榜在窄螢幕改單欄的規則不見了（3g 的 champCols=1 前提就不成立）');
});

// ── 4) 否定型：沒有新增 @media 當手機開關 ────────────────────────────────
T('4a 沒有新增任何 @media（剝註解後逐一數，釘住 v6.198 的數量）', () => {
  const n = (stripComments(PAGE).match(/@media/g) || []).length;
  assert.equal(n, 16, '+page.svelte 的 @media 從 16 變成 ' + n + ' —— 手機分支不可以靠 @media 開關');
});
T('4b 正對照：這個計數方式抓得出「真的多加一條 @media」', () => {
  const n = (stripComments(PAGE + '\n@media (max-width: 400px) { .x { color: red; } }').match(/@media/g) || []).length;
  assert.equal(n, 17);
});

// ── 5) 伺服器端：把 limit 兩支 helper 抽出來真的跑 ───────────────────────────
let S = null;
T('5a 抽得出 _lbClampLimit / _lbSliceResult 並可執行', () => {
  const body = slice(SRV, '    const _LB_MAX = 20;', "    let _lbCache = { at: 0, data: null };", '排行榜 limit helpers')
    + '\n; return { _LB_MAX, _LB_DEFAULT, _lbClampLimit, _lbSliceResult };';
  S = new Function(body)();
  assert.equal(typeof S._lbClampLimit, 'function');
  assert.equal(typeof S._lbSliceResult, 'function');
});
T('5b ⭐向後相容：沒帶 limit（舊 client）一律回 5 —— 不可以無聲放大他們的版面', () => {
  assert.equal(S._lbClampLimit(undefined), 5);
  assert.equal(S._lbClampLimit(null), 5);
  assert.equal(S._lbClampLimit(''), 5);
  assert.equal(S._lbClampLimit('abc'), 5);
  assert.equal(S._lbClampLimit('0'), 5);
  assert.equal(S._lbClampLimit('-7'), 5);
});
T('5c limit 有效值照收、超過上限夾到 20（不讓人叫出整份名單）', () => {
  assert.equal(S._lbClampLimit('20'), 20);
  assert.equal(S._lbClampLimit('10'), 10);
  assert.equal(S._lbClampLimit(7), 7);
  assert.equal(S._lbClampLimit('99999'), 20);
  assert.equal(S._LB_MAX, 20);
});
T('5d ⭐核心①（伺服器端）：切片對五個榜都生效，冠軍榜的巢狀結構不被打平', () => {
  const rows = mkRows(20);
  const full = { champions: { official: rows, community: rows }, wins: rows, top8: rows, finals: rows, communityHost: rows };
  const out20 = S._lbSliceResult(full, 20);
  const out5 = S._lbSliceResult(full, 5);
  for (const k of ['wins', 'top8', 'finals', 'communityHost']) {
    assert.equal(out20[k].length, 20, k); assert.equal(out5[k].length, 5, k);
  }
  assert.equal(out20.champions.official.length, 20);
  assert.equal(out20.champions.community.length, 20);
  assert.equal(out5.champions.official.length, 5);
  assert.deepEqual(Object.keys(out20).sort(), ['champions', 'communityHost', 'finals', 'limit', 'top8', 'wins']);
});
T('5d-2 ⭐回應要帶 limit（新前端據此判斷伺服器支不支援；舊伺服器不會有這個欄位）', () => {
  const rows = mkRows(20);
  const full = { champions: { official: rows, community: rows }, wins: rows, top8: rows, finals: rows, communityHost: rows };
  assert.equal(S._lbSliceResult(full, 10).limit, 10);
  assert.equal(S._lbSliceResult(full, 5).limit, 5);
});
T('5d-3 將來多加一個榜忘了改 helper 時，那個榜會原樣送出、不會被白名單靜默丟掉', () => {
  const rows = mkRows(20);
  const full = { champions: { official: rows, community: rows }, wins: rows, top8: rows, finals: rows, communityHost: rows, futureBoard: rows };
  const out = S._lbSliceResult(full, 5);
  assert.ok(Array.isArray(out.futureBoard) && out.futureBoard.length === 20, '新欄位被白名單吃掉了（整個榜會消失）');
});
T('5e 切片不會改到原始（快取）那一份 —— 快取存的永遠是上限 20 筆', () => {
  const rows = mkRows(20);
  const full = { champions: { official: rows, community: rows }, wins: rows, top8: rows, finals: rows, communityHost: rows };
  S._lbSliceResult(full, 5);
  assert.equal(full.wins.length, 20);
  assert.equal(full.champions.official.length, 20);
});
T('5f 端點兩處 slice(0, 5) 都已改成上限；回應走 _lbSliceResult；快取只有一份', () => {
  const ep = slice(SRV, "app.get('/api/tournament/leaderboard'", '\n    });', '/leaderboard 端點');
  const s = stripComments(ep);
  assert.equal(/slice\(0,\s*5\)/.test(s), false, '端點裡還有寫死的 slice(0, 5)');
  assert.ok(s.includes('.slice(0, _LB_MAX)'), 'topN / communityHost 沒有改用上限');
  assert.equal((s.match(/\.slice\(0, _LB_MAX\)/g) || []).length, 2, '應該剛好兩處（topN 與 communityHost）');
  assert.ok(s.includes('const _limit = _lbClampLimit(req.query && req.query.limit);'),
    'limit 沒有從 req.query.limit 接進來（欄位名打錯會靜默永遠是預設值）');
  assert.ok(s.includes('res.json(_lbSliceResult(result, _limit))'), '新算出來的結果沒有切片就回出去');
  assert.ok(s.includes('res.json(_lbSliceResult(_lbCache.data, _limit))'), '快取命中時沒有切片');
  assert.equal(/_lbCache\s*=\s*\{ at: Date\.now\(\), data: result \}/.test(s), true, '快取存的不是上限那一份');
});

// ── 6) 沒有波及到別的榜（改錯對象防護） ─────────────────────────────────────
T('6a 瑞士制排名（OWP / OOWP）完全沒有被切片，欄位照舊', () => {
  const b = slice(PAGE, '{#snippet bracketBlock(brk)}', '{#if brk.matches && brk.matches.length}', '瑞士制排名表');
  const s = stripComments(b);
  assert.ok(s.includes('{#each standingsKeyed(brk.standings) as s (s._k)}'), '排名表的 each 被動到了');
  assert.equal(/lbTopRows|tLbTop/.test(s), false, '顯示筆數竟然套到瑞士制排名表上');
  assert.ok(s.includes('{s.owp}%') && s.includes('{s.oowp}%'), 'OWP / OOWP 欄位不見了');
  assert.ok(s.includes('{s.rank}'), '名次欄不見了');
});
T('6b 歷屆冠軍榜（/champions，最近 100 位）沒有被動到', () => {
  const s = stripComments(PAGE);
  assert.ok(s.includes("tChampions.filter((c) => !c.communityEvent)"), '網站賽歷屆冠軍的渲染被動到了');
  assert.equal(/lbTopRows\([^)]*tChampions/.test(s), false, '顯示筆數竟然套到歷屆冠軍榜上');
});
T('6c 伺服器只動了 /leaderboard 一支端點的筆數', () => {
  const srvNoBanner = SRV.slice(SRV.indexOf('\n') + 1);   // 檔頭那則巨型註解是一整行，先拿掉
  assert.equal((srvNoBanner.match(/_lbSliceResult\(/g) || []).length, 3,
    '_lbSliceResult 出現次數不是「1 個定義 + 2 個呼叫」⇒ 有別的端點被順手改到了');
  assert.equal((srvNoBanner.match(/_lbClampLimit\(/g) || []).length, 2, '_lbClampLimit 應該只有 1 個定義 + 1 個呼叫');
});

console.log('');
console.log('  桌機 1280：欄寬 ' + LAYOUT.desktop?.colW + 'px × 2 欄｜整塊高 ' + LAYOUT.desktop?.w5 + 'px(5 筆) → ' + LAYOUT.desktop?.w20 + 'px(20 筆)');
console.log('  手機 390 ：欄寬 ' + LAYOUT.mobile?.colW + 'px × 1 欄｜整塊高 ' + LAYOUT.mobile?.w5 + 'px(5 筆) → ' + LAYOUT.mobile?.w20 + 'px(20 筆)｜下拉列 ' + LAYOUT.mobile?.barW + 'px');
console.log('  每列高 ' + LAYOUT.rowH + 'px（由固定 22px 名次圓標決定）');
console.log('');
if (fails.length) { console.log('v6.199 排行榜顯示筆數：PASS ' + pass + ' / FAIL ' + fails.length); for (const f of fails) console.log('  ❌ ' + f); process.exit(1); }
console.log('v6.199 排行榜顯示筆數：PASS ' + pass + ' / FAIL 0');
