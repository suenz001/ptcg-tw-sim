// v6.303 守衛：站長交辦的三件 UI 改善。
//
// 守什麼（能行為端就行為端；靜態只用在行為端測不到的地方）：
//   【A】HEAD-FAIL 錨點：五個新東西都在（BASE v6.302 一個都沒有 ⇒ A0 必紅並中止）。
//   【B】錦標賽四顆分頁縮成 2 字：文字逐字正確、每顆都是「icon ＋ 恰 2 個中文字」；
//        既有分頁鈕**除了文字以外逐字未動**（把 BASE 的按鈕做字串代換後必須完全相等）；
//        .tourn-tabs／.tourn-tab／:hover／.active 四條 CSS 與 BASE **逐字相同**（框架安全）。
//   【C】賽事卡左側色條：把模板的 class: 指令**抽出來求值**，四種狀態各跑一次
//        （報名中未報名＝綠／報到中未報名＝金／已報名＝無／其他＝無）；
//        色票**證明是從既有 CSS 挑的**（同兩支色碼在 BASE 的既有規則裡就有）；
//        新規則只宣告 box-shadow（不得碰 border／padding／margin／width ⇒ 不推擠內容），
//        且 .tourn-event 本體規則與 BASE 逐字相同。
//   【D】⭐⭐ tEvOpenBy「只是多加一條」：把**現在**與**BASE**兩個版本的函式都抽出來實跑，
//        在六個舊參數的完整笛卡兒矩陣上逐格比對 —— 只要 status 不是 'checkin'，兩者必須**完全一致**
//        （這就是「沒有改寫既有強制展開條件」的證明，不是用讀的）；
//        再逐條回歸既有四條規則，並驗新條件的優先序在「使用者手動摺疊」之上。
//   【E】接線：tEvOpen 衍生表真的把 e.status 傳下去；tEvForced 真的把「已報名＋報到中」列為 🔒。
//   【F】卡牌資料庫左右箭頭：.modal-nav／:hover／-prev／-next／媒體查詢五組宣告與牌組編輯器的
//        .pv-nav 那一套**完全相同**（比宣告集合，不是比字面版本號）；正對照＝BASE 的那一組**不相同**。
//   【G】版面量測（playwright；沒有瀏覽器就 SHALLOW-SKIP 並在結尾列出）：四種尺寸跑
//        scripts/measure-v6303-ui-batch.mjs。
//   【H】test chain ／版本一致（不 pin 版本號）／本檔不得整檔 sha256 鎖。
//   【I】突變：每一個都必須紅在**預期那一條**。
//
// ⚠ 守衛安慰劑八種型態逐一避開：只捕 assert.AssertionError；不 pin 死版本號／整檔 sha256；
//   每個抽取器都有下限斷言與正對照；條件一律**求值**不比字面。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const esbuild = await import('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_CARDS = join(ROOT, 'src/routes/cards/+page.svelte');
const P_DECKS = join(ROOT, 'src/routes/decks/+page.svelte');
const P_PKG = join(ROOT, 'package.json');
const P_SELF = join(ROOT, 'scripts/test-v6303-ui-batch.mjs');
const P_MEASURE = join(ROOT, 'scripts/measure-v6303-ui-batch.mjs');
const BASE_SHA = '5264ff88f3c37d7fbd5ec777818c1559fd62669c';   // v6.302（本版的 BASE）
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0; const skipped = [];
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + String(e.message).slice(0, 900)); fail++; }
    else throw e;   // ⚠ 只吞斷言失敗；打錯字／模組壞掉必須直接炸
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
const tsRun = (code, ret) => {
  const js = esbuild.transformSync(code, { loader: 'ts', target: 'es2020' }).code;
  return new Function(js + '\nreturn ' + ret + ';')();
};

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】HEAD-FAIL 錨點');
let GAME = '', CARDS = '', DECKS = '', PKG = '';
await T('A0 HEAD-FAIL：分頁短標籤／色條 class 與 CSS／tEvOpenBy 的 status 參數／箭頭半透明底色 全部都在（BASE v6.302 一個都沒有 ⇒ 這一條必紅）', () => {
  GAME = rd(P_GAME); CARDS = rd(P_CARDS); DECKS = rd(P_DECKS); PKG = rd(P_PKG);
  assert.ok(GAME.length > 900000, 'game/+page.svelte 只讀到 ' + GAME.length + ' 字元 —— 讀錯檔？');
  assert.ok(CARDS.length > 40000, 'cards/+page.svelte 只讀到 ' + CARDS.length + ' 字元');
  for (const k of ['>📊 排行</button>', '>🪪 個人</button>', 'class:ev-open-reg=', 'class:ev-open-checkin=',
                   '.tourn-event.ev-open-reg {', '.tourn-event.ev-open-checkin {',
                   "if (registered && !dropped && status === 'checkin') return true;",
                   'status?: string): boolean {'])
    assert.ok(GAME.includes(k), 'game/+page.svelte 缺「' + k + '」');
  assert.ok(CARDS.includes('background: rgba(255, 255, 255, 0.18);'), 'cards/+page.svelte 的箭頭沒有半透明底色');
});
if (fail) { console.log('\n══ v6.303 三件 UI 改善守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：新東西不存在，後續斷言無法進行）══'); process.exit(1); }

const baseGame = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
const baseCards = readBaseBlob(ROOT, BASE_SHA, 'src/routes/cards/+page.svelte');
const BGAME = baseGame.ok ? baseGame.out.replace(/\r\n/g, '\n') : null;
const BCARDS = baseCards.ok ? baseCards.out.replace(/\r\n/g, '\n') : null;
const hasHistory = hasBaseCommit(ROOT, BASE_SHA) && BGAME && BCARDS;

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】錦標賽四顆分頁縮成 2 字');
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
const WANT_TABS = ['🏆 賽事', '📊 排行', '🪪 個人', '👥 好友'];
await T('B1 ⭐⭐ 分頁列恰四顆，文字**逐字**是「🏆 賽事／📊 排行／🪪 個人／👥 好友」', () => {
  const btns = tabButtons(tabsBlock(GAME));
  assert.strictEqual(btns.length, 4, '分頁鈕不是四顆：' + btns.length);
  assert.deepStrictEqual(btns.map((b) => b.text), WANT_TABS, '分頁文字不對：' + JSON.stringify(btns.map((b) => b.text)));
});
await T('B2 ⭐ 每一顆都是「icon ＋ 一個半形空白 ＋ 恰 2 個中文字」（站長規格；抽取器有下限斷言）', () => {
  const btns = tabButtons(tabsBlock(GAME));
  assert.strictEqual(btns.length, 4, '掃描器只抓到 ' + btns.length + ' 顆 ⇒ 下面的迴圈會空轉');
  for (const b of btns) {
    const m = /^(\S+) (\S+)$/u.exec(b.text);
    assert.ok(m, '「' + b.text + '」不是「icon 空白 文字」的形狀');
    const cjk = [...m[2]].length;
    assert.strictEqual(cjk, 2, '「' + b.text + '」的文字是 ' + cjk + ' 個字（站長要求 2 個字）');
    assert.ok(/\p{Extended_Pictographic}/u.test(m[1]), '「' + b.text + '」的 icon 不見了（站長要求保留原有 icon）');
  }
  // 正對照：判準真的在看東西（三個字會被抓到）
  assert.throws(() => {
    const t = '📊 排行榜'; const m = /^(\S+) (\S+)$/u.exec(t);
    assert.strictEqual([...m[2]].length, 2, 'probe');
  }, /probe/, '正對照失效：3 個字竟然沒被抓到');
});
await T('B3 ⭐⭐ 既有分頁鈕**只有文字改變**：把 BASE 那顆按鈕的文字換成新文字之後，必須與現在**逐位元相同**（class／role／aria-selected／onclick 一個字都沒動）', () => {
  if (!hasHistory) { shallowSkip('v6303 B3 分頁鈕與 BASE 逐字比對', 'B1／B2 的形狀斷言不需要歷史，仍在守'); skipped.push('B3（淺複製）'); return; }
  const now = tabButtons(tabsBlock(GAME));
  const base = tabButtons(tabsBlock(BGAME));
  assert.strictEqual(base.length, 4, 'BASE 的分頁鈕不是四顆 ⇒ BASE 抓錯');
  const MAP = { '🏆 賽事': '🏆 賽事', '📊 排行榜': '📊 排行', '🪪 個人資料': '🪪 個人', '👥 好友': '👥 好友' };
  let changed = 0;
  for (let k = 0; k < 4; k++) {
    const want = MAP[base[k].text];
    assert.ok(want !== undefined, 'BASE 第 ' + (k + 1) + ' 顆的文字「' + base[k].text + '」不在預期的改名表裡');
    const rebuilt = base[k].raw.replace('>' + base[k].text + '</button>', '>' + want + '</button>');
    assert.strictEqual(now[k].raw, rebuilt,
      '⚠⚠ 第 ' + (k + 1) + ' 顆分頁鈕除了文字以外還被動到了\n NEW : ' + now[k].raw + '\n WANT: ' + rebuilt);
    if (base[k].text !== want) changed++;
  }
  assert.strictEqual(changed, 2, '這一版應該恰好改兩顆的文字（排行榜／個人資料），實際 ' + changed + ' 顆');
});
const CSS_KEYS = ['  .tourn-tabs {', '  .tourn-tab {', '  .tourn-tab:hover {', '  .tourn-tab.active {'];
function cssLine(src, key) {
  const style = src.slice(src.lastIndexOf('<style'));
  const i = style.indexOf(key);
  assert.ok(i >= 0, '抽不到 CSS 規則：' + key);
  return style.slice(i, style.indexOf('\n', i));
}
await T('B4 ⭐⭐ 框架安全：.tourn-tabs／.tourn-tab／:hover／.active 四條規則與 BASE **逐字相同**（本版只改文字，一行 CSS 都沒動）', () => {
  if (!hasHistory) { shallowSkip('v6303 B4 分頁列 CSS 與 BASE 逐字比對', 'B5 是不需要歷史的等價條件，仍在守'); skipped.push('B4（淺複製）'); return; }
  for (const k of CSS_KEYS) assert.strictEqual(cssLine(GAME, k), cssLine(BGAME, k), '⚠⚠ CSS 規則被動到了：' + k + '\n NEW : ' + cssLine(GAME, k) + '\n BASE: ' + cssLine(BGAME, k));
});
await T('B5 ⭐ history-free 等價條件：那四條規則裡不得出現 flex-wrap／white-space／flex: 1 1（＝沒有為了塞下文字而改版面規則）', () => {
  const all = CSS_KEYS.map((k) => cssLine(GAME, k)).join('\n');
  for (const k of ['flex-wrap', 'white-space', 'flex: 1 1']) assert.ok(!all.includes(k), '分頁列 CSS 出現了 ' + k + ' ⇒ 版面規則被改了');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】賽事卡左側色條（四種狀態各自求值）');
function evCardOpenTag(src) {
  const i = src.indexOf('{#snippet eventCard(ev)}');
  assert.ok(i > 0, '抽不到 {#snippet eventCard}');
  const j = src.indexOf('<div class="tourn-event"', i);
  assert.ok(j > i && j - i < 3000, 'eventCard 內找不到 .tourn-event 開頭標籤');
  return src.slice(j, src.indexOf('>', src.indexOf('class:ev-open-checkin', j)) + 1);
}
await T('C1 ⭐⭐ 四種狀態實跑：報名中未報名＝綠條、報到中未報名＝金條、已報名＝無條、其他狀態＝無條', () => {
  const tag = evCardOpenTag(GAME);
  const gm = /class:ev-open-reg=\{([^}]*)\}/.exec(tag);
  const cm = /class:ev-open-checkin=\{([^}]*)\}/.exec(tag);
  assert.ok(gm && cm, '抽不到兩個 class: 指令：' + tag);
  const reg = (ev) => !!evalExpr(gm[1], { ev });
  const chk = (ev) => !!evalExpr(cm[1], { ev });
  const CASES = [
    // [狀態, 已報名, 期望綠, 期望金]
    ['registration', false, true, false],
    ['registration', true, false, false],
    ['checkin', false, false, true],
    ['checkin', true, false, false],
    ['running', false, false, false],
    ['running', true, false, false],
    ['draft', false, false, false],
    ['done', true, false, false],
    [undefined, false, false, false],
  ];
  for (const [st, registered, wg, wc] of CASES) {
    const ev = { status: st, registered };
    assert.strictEqual(reg(ev), wg, JSON.stringify(ev) + ' 的綠色條判斷錯（得 ' + reg(ev) + '，應 ' + wg + '）');
    assert.strictEqual(chk(ev), wc, JSON.stringify(ev) + ' 的金色條判斷錯（得 ' + chk(ev) + '，應 ' + wc + '）');
    assert.ok(!(reg(ev) && chk(ev)), JSON.stringify(ev) + ' 同時吃到兩條色條');
  }
});
function cssBlock(src, sel) {
  const style = src.slice(src.lastIndexOf('<style'));
  const i = style.indexOf('\n  ' + sel + ' {');
  assert.ok(i >= 0, '抽不到 CSS 規則：' + sel);
  const j = style.indexOf('}', i);
  return style.slice(i + 1, j + 1);
}
const declsOf = (block) => block.replace(/\/\*[\s\S]*?\*\//g, '').split('{')[1].split('}')[0]
  .split(';').map((s) => s.trim()).filter(Boolean);
await T('C2 ⭐⭐ 色條**不推擠內容**（靜態）：兩條新規則只宣告 box-shadow，且用的是 inset；不得出現 border／padding／margin／width／inline-size', () => {
  for (const sel of ['.tourn-event.ev-open-reg', '.tourn-event.ev-open-checkin']) {
    const d = declsOf(cssBlock(GAME, sel));
    assert.strictEqual(d.length, 1, sel + ' 宣告了 ' + d.length + ' 條（只該有 box-shadow 一條）：' + d.join(' | '));
    assert.ok(/^box-shadow:\s*inset\s/.test(d[0]), sel + ' 不是 inset 陰影：' + d[0]
      + '\n      ⚠ border-left 會改盒模型 —— .tourn-event 是 content-box，加寬左邊框會把卡片內文字往右推');
    for (const bad of ['border', 'padding', 'margin', 'width'])
      assert.ok(!d[0].includes(bad + ':'), sel + ' 出現 ' + bad);
  }
});
await T('C3 ⭐⭐ .tourn-event 本體規則與 BASE **逐字相同**（色條是「多加兩條選擇器」，不是改本體）', () => {
  if (!hasHistory) { shallowSkip('v6303 C3 .tourn-event 本體與 BASE 逐字比對', 'C2 的宣告面斷言不需要歷史，仍在守'); skipped.push('C3（淺複製）'); return; }
  assert.strictEqual(cssBlock(GAME, '.tourn-event'), cssBlock(BGAME, '.tourn-event'), '⚠⚠ .tourn-event 本體被動到了');
  assert.strictEqual(cssBlock(GAME, '.tourn-event h3'), cssBlock(BGAME, '.tourn-event h3'), '.tourn-event h3 被動到了');
});
await T('C4 ⭐ 色票是**從既有 CSS 挑的**，不是憑空發明：#6ab87a 與 #ffd35a 在 BASE 的樣式表裡本來就有（且各自出現在指定的既有規則上）', () => {
  if (!hasHistory) { shallowSkip('v6303 C4 色票溯源到 BASE', '沒有歷史就證明不了「既有」'); skipped.push('C4（淺複製）'); return; }
  const baseStyle = BGAME.slice(BGAME.lastIndexOf('<style'));
  for (const c of ['#6ab87a', '#ffd35a']) assert.ok(baseStyle.includes(c), '色票 ' + c + ' 在 BASE 樣式表裡不存在 ⇒ 是憑空發明的');
  assert.ok(cssLine(BGAME, '  .tourn-tab.active {').includes('#6ab87a'), '#6ab87a 的出處（.tourn-tab.active 的邊框色）對不上');
  assert.ok(baseStyle.includes('.tcmsg.tcsys { color: #ffd35a; }'), '#ffd35a 的出處（系統播報的強調金）對不上');
  // 現在這兩條新規則用的就是那兩支
  assert.ok(cssBlock(GAME, '.tourn-event.ev-open-reg').includes('#6ab87a'), '報名中色條沒用 #6ab87a');
  assert.ok(cssBlock(GAME, '.tourn-event.ev-open-checkin').includes('#ffd35a'), '報到中色條沒用 #ffd35a');
  // 正對照：隨便一支沒用過的色碼在 BASE 裡查無此物
  assert.ok(!baseStyle.includes('#0f9d5b'), '正對照失效：連沒用過的色碼都「有」⇒ 掃描器壞了');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】⭐⭐ tEvOpenBy 只是「多加一條」（現在 vs BASE 逐格比對）');
function fnSrc(src, name) {
  const i = src.indexOf('  function ' + name + '(');
  assert.ok(i > 0, '抽不到 function ' + name);
  const j = src.indexOf('\n  }\n', i);
  assert.ok(j > i, name + ' 抓不到結尾');
  const s = src.slice(i, j + 4);
  assert.ok(s.length > 200 && s.length < 4000, name + ' 抽出來 ' + s.length + ' 字元 ⇒ 錨點抓錯');
  return s;
}
const NOW_FN_SRC = fnSrc(GAME, 'tEvOpenBy');
const nowOpenBy = tsRun(NOW_FN_SRC, 'tEvOpenBy');
await T('D0 抽取器自我驗證：抽出來的是真的函式，而且五段判斷都在（fail-open／myMatch|myBye／新條件／手動偏好／預設）', () => {
  assert.strictEqual(typeof nowOpenBy, 'function');
  for (const k of ['if (!eventId) return true;', 'myMatchEventId || eventId === myByeEventId',
                   "status === 'checkin'", "typeof p === 'boolean'", 'return !!registered && !dropped;'])
    assert.ok(NOW_FN_SRC.includes(k), '抽出來的函式缺「' + k + '」⇒ 抽取器抓錯範圍');
});
/** 六個舊參數的完整矩陣（288 格）。 */
function oldMatrix() {
  const out = [];
  for (const eventId of ['', 'e1'])
    for (const registered of [true, false])
      for (const dropped of [true, false])
        for (const pref of [null, {}, { e1: true }, { e1: false }])
          for (const mm of [null, 'e1', 'zz'])
            for (const mb of [null, 'e1', 'zz'])
              out.push([eventId, registered, dropped, pref, mm, mb]);
  return out;
}
await T('D1 ⭐⭐⭐ 既有強制展開條件**逐條回歸**：拿 BASE 的 tEvOpenBy 與現在這支，在六個舊參數的 288 格矩陣上逐格比對 —— 全部相同（＝既有邏輯一個字都沒被改寫）', () => {
  if (!hasHistory) { shallowSkip('v6303 D1 現在 vs BASE 的 288 格逐格比對', 'D2～D5 的行為斷言不需要歷史，仍在守'); skipped.push('D1（淺複製）'); return; }
  const baseOpenBy = tsRun(fnSrc(BGAME, 'tEvOpenBy'), 'tEvOpenBy');
  const M = oldMatrix();
  assert.ok(M.length === 288, '矩陣只有 ' + M.length + ' 格 ⇒ 產生器壞了');
  const diff = [];
  for (const a of M) if (baseOpenBy(...a) !== nowOpenBy(...a)) diff.push(JSON.stringify(a));
  assert.deepStrictEqual(diff, [], '⚠⚠⚠ 舊參數下行為改變了 ' + diff.length + ' 格（＝改寫了既有條件，不是多加一條）：' + diff.slice(0, 5).join(' / '));
  // 正對照：同一組矩陣真的分得出差異（拿一個刻意改壞的版本比一次必須有差）
  const broken = tsRun(fnSrc(BGAME, 'tEvOpenBy').replace('if (!eventId) return true;', 'if (!eventId) return false;'), 'tEvOpenBy');
  assert.ok(M.some((a) => broken(...a) !== nowOpenBy(...a)), '正對照失效：連改壞的版本都比不出差 ⇒ 比對器沒在比');
});
await T('D2 ⭐ 既有四條規則逐條再驗一次（history-free；即使淺複製也在守）', () => {
  // ①fail-open
  assert.strictEqual(nowOpenBy('', false, false, {}, null, null), true, '①認不出賽事必須 fail-open 展開');
  // ②硬約束：輪到我進場／我本輪輪空（即使使用者手動摺疊）
  assert.strictEqual(nowOpenBy('e1', false, false, { e1: false }, 'e1', null), true, '②myMatch 的硬約束被破壞 —— 進場鈕會消失');
  assert.strictEqual(nowOpenBy('e1', true, true, { e1: false }, 'e1', null), true, '②已棄賽但仍有 myMatch 也要展開');
  assert.strictEqual(nowOpenBy('e9', false, false, { e9: false }, null, 'e9'), true, '②myBye 的硬約束被破壞');
  // ③使用者手動偏好蓋過預設
  assert.strictEqual(nowOpenBy('e1', false, false, { e1: true }, null, null), true, '③手動展開沒報名的場');
  assert.strictEqual(nowOpenBy('e1', true, false, { e1: false }, null, null), false, '③手動摺疊有報名的場');
  assert.strictEqual(nowOpenBy('e2', true, false, { e1: false }, null, null), true, '③沒記錄的場必須回退預設規則');
  // ④預設規則
  assert.strictEqual(nowOpenBy('e1', true, false, {}, null, null), true, '④有報名應展開');
  assert.strictEqual(nowOpenBy('e1', false, false, {}, null, null), false, '④沒報名應摺疊');
  assert.strictEqual(nowOpenBy('e1', true, true, {}, null, null), false, '④已棄賽應摺疊');
});
await T('D3 ⭐⭐⭐ 本版新增的那一條：已報名 ＋ 報到中 ⇒ tEvOpenBy 回 true（**即使使用者手動摺過**）', () => {
  // ⚠ 這一條才是載重的：沒有手動偏好時，預設規則本來就會展開（刪掉新條件也照樣是 true）
  //   ⇒ 只驗那一格等於安慰劑。真正只有新條件擋得住的情況是「手動摺過」。
  assert.strictEqual(nowOpenBy('e1', true, false, { e1: false }, null, null, 'checkin'), true,
    '⚠⚠ 手動摺疊竟然蓋過了「報到中」的強制展開 ⇒ 玩家看不到報到鈕（新條件的優先序必須與既有硬約束一致，在手動偏好之前）');
  assert.strictEqual(nowOpenBy('e1', true, false, {}, null, null, 'checkin'), true, '沒有手動偏好時也要展開');
  assert.strictEqual(nowOpenBy('e1', true, false, { e1: true }, null, null, 'checkin'), true, '手動展開時當然也是展開');
});
await T('D4 ⭐ 新條件的邊界：沒報名／已棄賽／不是報到中，一律**不觸發**強制展開（回到既有規則）', () => {
  assert.strictEqual(nowOpenBy('e1', false, false, { e1: false }, null, null, 'checkin'), false, '沒報名的場不該被強制展開');
  assert.strictEqual(nowOpenBy('e1', true, true, { e1: false }, null, null, 'checkin'), false, '已棄賽的場不該被強制展開');
  for (const st of ['registration', 'running', 'done', 'draft', undefined, null, '', 'CHECKIN'])
    assert.strictEqual(nowOpenBy('e1', true, false, { e1: false }, null, null, st), false,
      '狀態 ' + JSON.stringify(st) + ' 竟然也觸發強制展開（只有 checkin 才可以）');
});
await T('D5 ⭐ 參數相容：status 是**最後一個**且可選 —— 舊的六參數呼叫（test-v6252 全部都是這種）行為與加參數前完全一樣', () => {
  const sig = /function tEvOpenBy\(([\s\S]*?)\): boolean/.exec(NOW_FN_SRC);
  assert.ok(sig, '抽不到 tEvOpenBy 的簽章');
  // ⚠ 不可以直接 split(',')：`Record<string, boolean> | null` 裡面就有逗號 —— 先把泛型參數剝掉。
  const params = sig[1].replace(/<[^<>]*>/g, '').split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean);
  assert.deepStrictEqual(params, ['eventId', 'registered', 'dropped', 'pref', 'myMatchEventId', 'myByeEventId', 'status?'],
    '參數順序被動了 —— status 必須加在最後且可選，否則 test-v6252 的六參數呼叫會全部錯位：' + JSON.stringify(params));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】接線：衍生表真的把 status 傳下去、鎖也標了');
function derivedBody(src, name) {
  const i = src.indexOf('  const ' + name + ' = $derived.by(() => {');
  assert.ok(i > 0, '抽不到 const ' + name + ' = $derived.by');
  const j = src.indexOf('\n  });', i);
  assert.ok(j > i, name + ' 抓不到結尾');
  const s = src.slice(src.indexOf('{', src.indexOf('=> {', i)) + 1, j);
  assert.ok(s.length > 60, name + ' 函式體只有 ' + s.length + ' 字元 ⇒ 錨點抓錯');
  return s;
}
await T('E1 ⭐⭐ tEvOpen 衍生表**實跑**：真的把 e.status 傳給 tEvOpenBy（報到中且已報名的那一場算成展開，其餘照舊）', () => {
  const body = derivedBody(GAME, 'tEvOpen');
  const js = esbuild.transformSync(body, { loader: 'ts', target: 'es2020' }).code;
  const run = (events, pref) => new Function('tEvFold', 'tMyMatch', 'tMyBye', 'tEvents', 'tEvOpenBy', js)(
    pref, null, null, events, nowOpenBy);
  const EV = (id, st, reg, dropped) => ({ _id: id, status: st, registered: reg, dropped: !!dropped });
  const got = run([EV('a', 'checkin', true), EV('b', 'checkin', false), EV('c', 'registration', true),
                   EV('d', 'registration', false), EV('e', 'checkin', true, true)],
                  { a: false, b: false, c: false, d: false, e: false });
  assert.deepStrictEqual(got, { a: true, b: false, c: false, d: false, e: false },
    '⚠⚠ 已報名＋報到中的那一場沒有被強制展開（e.status 沒傳下去？）：' + JSON.stringify(got));
  // 正對照：把 status 拿掉之後同一組資料就會全 false（證明上面那個 true 真的來自 status）
  const noStatus = run([{ _id: 'a', registered: true, dropped: false }], { a: false });
  assert.deepStrictEqual(noStatus, { a: false }, '正對照失效：沒有 status 也會被強制展開');
});
await T('E2 ⭐⭐ tEvForced 衍生表**實跑**：已報名＋報到中的場也要標 🔒（否則玩家點標題列沒反應會以為壞掉）', () => {
  const body = derivedBody(GAME, 'tEvForced');
  const js = esbuild.transformSync(body, { loader: 'ts', target: 'es2020' }).code;
  const run = (events, mm, mb) => new Function('tMyMatch', 'tMyBye', 'tEvents', js)(
    mm ? { eventId: mm } : null, mb ? { eventId: mb } : null, events);
  const EV = (id, st, reg, dropped) => ({ _id: id, status: st, registered: reg, dropped: !!dropped });
  const s = run([EV('a', 'checkin', true), EV('b', 'checkin', false), EV('c', 'registration', true), EV('d', 'checkin', true, true)], null, null);
  assert.ok(s instanceof Set, 'tEvForced 不是 Set');
  assert.deepStrictEqual([...s].sort(), ['a'], '鎖標的集合不對：' + JSON.stringify([...s]));
  // 既有兩條仍在
  const s2 = run([EV('x', 'running', true)], 'x', null);
  assert.ok(s2.has('x'), 'myMatch 的鎖不見了');
  const s3 = run([EV('y', 'running', true)], null, 'y');
  assert.ok(s3.has('y'), 'myBye 的鎖不見了');
});
await T('E3 賽事卡的 {@const _evOpen} / {@const _evLock} 仍然接在 tEvOpen / tEvForced 上（沒有被繞過）', () => {
  const i = GAME.indexOf('{#snippet eventCard(ev)}');
  const blk = GAME.slice(i, i + 600);
  assert.ok(/\{@const _evOpen = tEvOpen\[ev\._id\] !== false\}/.test(blk), 'eventCard 的 _evOpen 沒接 tEvOpen');
  assert.ok(/\{@const _evLock = tEvForced\.has\(ev\._id\)\}/.test(blk), 'eventCard 的 _evLock 沒接 tEvForced');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】卡牌資料庫左右箭頭＝牌組編輯器那一套');
function ruleBlock(src, sel) {
  const style = src.slice(src.lastIndexOf('<style'));
  const i = style.indexOf('\n  ' + sel + ' {');
  assert.ok(i >= 0, '抽不到 CSS 規則：' + sel + '（' + (src === CARDS ? 'cards' : src === DECKS ? 'decks' : 'base') + '）');
  const j = style.indexOf('\n  }', i);
  const k = style.indexOf('}', i);
  // 單行規則（`.x { a: b; }`）與多行規則都要吃得下
  return (j >= 0 && j < k) || k < 0 ? style.slice(i + 1, j + 4) : style.slice(i + 1, k + 1);
}
const declSet = (block) => declsOf(block).sort();
const PAIRS = [['.modal-nav', '.pv-nav'], ['.modal-nav:hover', '.pv-nav:hover'],
               ['.modal-nav-prev', '.pv-nav-prev'], ['.modal-nav-next', '.pv-nav-next']];
await T('F1 ⭐⭐⭐ .modal-nav／:hover／-prev／-next 的宣告與牌組編輯器的 .pv-nav 那一組**完全相同**（比宣告，不是比字面版本號）', () => {
  let total = 0;
  for (const [a, b] of PAIRS) {
    const A = declSet(ruleBlock(CARDS, a)), B = declSet(ruleBlock(DECKS, b));
    assert.ok(A.length >= 1, a + ' 一條宣告都沒抽到 ⇒ 抽取器壞了');
    assert.deepStrictEqual(A, B, '⚠⚠ ' + a + ' 與 ' + b + ' 不是同一套：\n cards: ' + A.join(' | ') + '\n decks: ' + B.join(' | '));
    total += A.length;
  }
  // ⭐ 掃描器下限斷言（Rule 25）：四組加起來至少 20 條，否則「全部相同」可能只是都抽到空的
  assert.ok(total >= 20, '四組只抽到 ' + total + ' 條宣告 ⇒ 抽取器壞了，「相同」是假綠');
});
await T('F2 ⭐⭐ 正對照：BASE 的 .modal-nav 與 .pv-nav **不相同**（證明 F1 真的在比、而且本版確實改了東西）', () => {
  if (!hasHistory) { shallowSkip('v6303 F2 對 BASE 的正對照', 'F1 的等值比對不需要歷史，仍在守'); skipped.push('F2（淺複製）'); return; }
  const A = declSet(ruleBlock(BCARDS, '.modal-nav')), B = declSet(ruleBlock(DECKS, '.pv-nav'));
  assert.notDeepStrictEqual(A, B, '正對照失效：BASE 本來就一樣 ⇒ 這一版沒改到東西，或抽取器抓到同一份');
});
await T('F3 ⭐⭐ 手機版（max-width:600px）那三條也一致：尺寸與位置兩邊逐字相同 ⇒ 箭頭不會位移', () => {
  const grab = (src, pre) => {
    const style = src.slice(src.lastIndexOf('<style'));
    const out = {};
    for (const k of [pre + '-prev {', pre + '-next {', pre + ' {']) {
      const idx = [...style.matchAll(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((m) => m.index);
      assert.ok(idx.length >= 1, '抽不到 ' + k);
      out[k] = idx.map((i) => style.slice(i, style.indexOf('\n', i)).trim());
    }
    return out;
  };
  const c = grab(CARDS, '.modal-nav'), d = grab(DECKS, '.pv-nav');
  const norm = (o, pre) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(pre, 'NAV'), v.map((s) => s.replace(pre, 'NAV'))]));
  assert.deepStrictEqual(norm(c, '.modal-nav'), norm(d, '.pv-nav'),
    '⚠ 兩邊的箭頭規則（含 @media 內那幾條）不一致：\n cards: ' + JSON.stringify(norm(c, '.modal-nav')) + '\n decks: ' + JSON.stringify(norm(d, '.pv-nav')));
});
await T('F4 ⭐ 零位移（靜態）：與 BASE 相比，.modal-nav 的**幾何相關宣告**一個字都沒動（只有配色三項變了）', () => {
  if (!hasHistory) { shallowSkip('v6303 F4 幾何宣告與 BASE 逐字比對', 'F1／F3 仍在守；DOM 量測見【G】'); skipped.push('F4（淺複製）'); return; }
  const GEO = ['position', 'top', 'width', 'height', 'border-radius', 'font-size', 'font-weight', 'display', 'align-items', 'justify-content', 'padding', 'line-height', 'z-index'];
  const pick = (block) => Object.fromEntries(declsOf(block).map((d) => [d.split(':')[0].trim(), d]));
  const now = pick(ruleBlock(CARDS, '.modal-nav')), base = pick(ruleBlock(BCARDS, '.modal-nav'));
  for (const g of GEO) assert.strictEqual(now[g], base[g], '幾何宣告 ' + g + ' 被動到了：' + now[g] + ' vs ' + base[g]);
  const changed = Object.keys(now).filter((k) => now[k] !== base[k]).concat(Object.keys(now).filter((k) => !(k in base)));
  assert.deepStrictEqual([...new Set(changed)].sort(), ['background', 'border', 'box-shadow', 'text-shadow'],
    '這一版應該只動配色四項（background／border／box-shadow／text-shadow），實際：' + changed.join(','));
});
await T('F5 決策查證：牌組編輯器那一組**真的是半透明的**（站長若記錯就該停手 —— 這條是那個判斷的證據）', () => {
  const pv = ruleBlock(DECKS, '.pv-nav');
  const bg = declsOf(pv).find((d) => d.startsWith('background'));
  assert.ok(bg && /rgba\([^)]*,\s*0?\.\d+\s*\)/.test(bg), '牌組編輯器的 .pv-nav 底色不是半透明：' + bg);
  const bd = declsOf(pv).find((d) => d.startsWith('border:'));
  assert.ok(bd && /rgba\([^)]*,\s*0?\.\d+\s*\)/.test(bd), '牌組編輯器的 .pv-nav 邊框不是半透明：' + bd);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】四種尺寸的 DOM 量測（playwright）');
let hasPw = false;
try { createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright'); hasPw = true; } catch { hasPw = false; }
if (!hasPw) {
  console.log('  ⚠⚠ SKIP【G】：這台機器沒有 Playwright，DOM 量測沒有跑（沙盒證據見 scripts/measure-v6303-ui-batch.mjs 的輸出）');
  skipped.push('【G】四種尺寸的 DOM 量測（沒有 playwright 模組）');
} else {
  await T('G1 ⭐⭐ 375×812／390×844／412×915／1366×768：分頁列以上全等、以下位移不為正、四顆同列不折行；色條不推擠內容；箭頭零位移且點得到', () => {
    let out = '';
    try {
      out = execFileSync(process.execPath, [join(ROOT, 'scripts/measure-v6303-ui-batch.mjs')],
        { cwd: ROOT, maxBuffer: 1 << 26, env: { ...process.env, MEASURE_OUT: '/tmp/measure-v6303.json' } }).toString('utf8');
    } catch (e) {
      out = String((e.stdout || '') + (e.stderr || ''));
      assert.fail('版面量測不符：\n' + out.split('\n').filter((l) => l.includes('✗')).join('\n').slice(0, 1500));
    }
    assert.ok(out.includes('全部符合 ✓'), '量測腳本沒有回報全部符合：\n' + out.slice(-1200));
    assert.ok((out.match(/──────────/g) || []).length >= 8, '量測沒有跑滿四種尺寸');
  });
}
await T('G2 量測腳本存在，而且**不**在 npm test chain（需要瀏覽器，CI 沒有）', () => {
  assert.ok(existsSync(P_MEASURE), '缺量測腳本 scripts/measure-v6303-ui-batch.mjs');
  assert.ok(!PKG.includes('measure-v6303-ui-batch.mjs'), '量測腳本不該進 test chain');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【H】test chain ／版本一致 ／不 pin 死版本');
await T('H1 本守衛進了 package.json 的 test chain；version.ts 與 admin.html SITE_VERSION_HINT 一致（不比對字面版本號）', () => {
  assert.ok(PKG.includes('scripts/test-v6303-ui-batch.mjs'), '本守衛沒有進 npm test chain');
  const V = /VERSION = '([\d.]+)'/.exec(rd(join(ROOT, 'src/lib/version.ts')))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(rd(join(ROOT, 'oracle-admin/admin.html')))[1];
  assert.strictEqual(H, V, 'SITE_VERSION_HINT ' + H + ' ≠ version.ts ' + V);
});
await T('H2 ⭐ 本守衛自己沒有 pin 死版本號、也沒有整檔雜湊鎖（第九種安慰劑）', () => {
  const self = rd(P_SELF);
  const body = self.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  // ⚠ 判準用 RegExp 建構式組出來，否則這幾行**自己就會命中自己**（守衛掃自己的經典陷阱）
  const reVerLit = new RegExp("'" + '6' + "\\.\\d+'");
  const reHash = new RegExp('create' + 'Hash');
  assert.ok(!reVerLit.test(body), '守衛裡出現寫死的版本號字面值 ⇒ 出下一版就會靜默停止守護');
  assert.ok(!reHash.test(body), '守衛裡出現整檔雜湊鎖');
  // 正對照：判準真的抓得到
  assert.ok(reVerLit.test('const V = ' + "'" + 6 + ".999';"), '正對照失效：版本字面值判準抓不到東西');
  assert.ok(reHash.test('import { create' + 'Hash } from "node:crypto";'), '正對照失效：雜湊判準抓不到東西');
});
await T('H3 ⭐ 沒有動到不該動的檔：oracle-admin/server_admin_patch.js 與 BASE **逐位元相同**', () => {
  if (!hasHistory) { shallowSkip('v6303 H3 server_admin_patch.js 與 BASE 逐位元比對', '需要歷史 commit'); skipped.push('H3（淺複製）'); return; }
  const b = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  assert.ok(b.ok, '讀不到 BASE 的 server_admin_patch.js');
  assert.strictEqual(rd(join(ROOT, 'oracle-admin/server_admin_patch.js')), b.out.replace(/\r\n/g, '\n'), '⚠⚠ 本版不該動伺服器補丁');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【I】突變（每個都必須紅在預期那一條）');
const withGame = (mutated, run) => { const keep = GAME; GAME = mutated; try { return run(); } finally { GAME = keep; } };
const withCards = (mutated, run) => { const keep = CARDS; CARDS = mutated; try { return run(); } finally { CARDS = keep; } };

await T('I1 突變：把新增的強制展開那一行刪掉 ⇒ D3 紅在「看不到報到鈕」', async () => {
  const m = mutate(GAME, "    if (registered && !dropped && status === 'checkin') return true;           // ⭐v6.303 硬約束：報到鈕不可被摺掉\n", '');
  await mutantMustBreak('刪掉強制展開', () => {
    const f = tsRun(fnSrc(m, 'tEvOpenBy'), 'tEvOpenBy');
    // ⚠ 必須用「手動摺過」那一格 —— 沒有手動偏好時預設規則本來就會展開，驗那一格是安慰劑
    assert.strictEqual(f('e1', true, false, { e1: false }, null, null, 'checkin'), true,
      '⚠⚠ 手動摺疊竟然蓋過了「報到中」的強制展開 ⇒ 玩家看不到報到鈕');
  }, '玩家看不到報到鈕');
});
await T('I2 突變：把新條件搬到「使用者手動偏好」**之後** ⇒ D3 紅在「手動摺疊蓋過」那一條', async () => {
  const line = "    if (registered && !dropped && status === 'checkin') return true;           // ⭐v6.303 硬約束：報到鈕不可被摺掉\n";
  let m = mutate(GAME, line, '');
  m = mutate(m, "    if (typeof p === 'boolean') return p;", "    if (typeof p === 'boolean') return p;\n" + line.replace(/\n$/, ''));
  await mutantMustBreak('優先序反了', () => {
    const f = tsRun(fnSrc(m, 'tEvOpenBy'), 'tEvOpenBy');
    assert.strictEqual(f('e1', true, false, { e1: false }, null, null, 'checkin'), true, '⚠⚠ 手動摺疊竟然蓋過了「報到中」的強制展開');
  }, '手動摺疊竟然蓋過');
});
await T('I3 突變：改寫既有條件（把 fail-open 改成 fail-closed）⇒ D1 的 288 格逐格比對紅在「舊參數下行為改變」', async () => {
  if (!hasHistory) { console.log('    （淺複製：I3 需要 BASE，改以 D2 的 history-free 斷言涵蓋）'); return; }
  const m = mutate(GAME, '    if (!eventId) return true;                                                 // 認不出賽事一律展開（fail-open）',
                        '    if (!eventId) return false;                                                // 認不出賽事一律展開（fail-open）');
  await mutantMustBreak('改寫 fail-open', () => {
    const baseOpenBy = tsRun(fnSrc(BGAME, 'tEvOpenBy'), 'tEvOpenBy');
    const f = tsRun(fnSrc(m, 'tEvOpenBy'), 'tEvOpenBy');
    const diff = oldMatrix().filter((a) => baseOpenBy(...a) !== f(...a)).map((a) => JSON.stringify(a));
    assert.deepStrictEqual(diff, [], '⚠⚠⚠ 舊參數下行為改變了 ' + diff.length + ' 格（＝改寫了既有條件，不是多加一條）');
  }, '舊參數下行為改變');
});
await T('I4 突變：tEvOpen 衍生表忘了把 e.status 傳下去 ⇒ E1 紅在「e.status 沒傳下去」', async () => {
  const m = mutate(GAME, 'pref, mm, mb, e.status);', 'pref, mm, mb);');
  await mutantMustBreak('沒傳 status', () => withGame(m, () => {
    const body = derivedBody(GAME, 'tEvOpen');
    const js = esbuild.transformSync(body, { loader: 'ts', target: 'es2020' }).code;
    const got = new Function('tEvFold', 'tMyMatch', 'tMyBye', 'tEvents', 'tEvOpenBy', js)(
      { a: false }, null, null, [{ _id: 'a', status: 'checkin', registered: true, dropped: false }], nowOpenBy);
    assert.deepStrictEqual(got, { a: true }, '⚠⚠ 已報名＋報到中的那一場沒有被強制展開（e.status 沒傳下去？）');
  }), 'e.status 沒傳下去');
});
await T('I5 突變：tEvForced 忘了把「已報名＋報到中」列進去 ⇒ E2 紅在「鎖標的集合不對」', async () => {
  const m = mutate(GAME, "    for (const e of tEvents) if (e && e._id && e.registered && !e.dropped && e.status === 'checkin') s.add(e._id);\n", '');
  await mutantMustBreak('沒標鎖', () => withGame(m, () => {
    const body = derivedBody(GAME, 'tEvForced');
    const js = esbuild.transformSync(body, { loader: 'ts', target: 'es2020' }).code;
    const s = new Function('tMyMatch', 'tMyBye', 'tEvents', js)(null, null, [{ _id: 'a', status: 'checkin', registered: true, dropped: false }]);
    assert.deepStrictEqual([...s].sort(), ['a'], '鎖標的集合不對：' + JSON.stringify([...s]));
  }), '鎖標的集合不對');
});
await T('I6 突變：色條忘了排除「已報名」（報名了還上色）⇒ C1 紅在「色條判斷錯」', async () => {
  const m = mutate(GAME, "class:ev-open-reg={ev.status === 'registration' && !ev.registered}", "class:ev-open-reg={ev.status === 'registration'}");
  await mutantMustBreak('已報名還上色', () => withGame(m, () => {
    const tag = evCardOpenTag(GAME);
    const gm = /class:ev-open-reg=\{([^}]*)\}/.exec(tag);
    const ev = { status: 'registration', registered: true };
    assert.strictEqual(!!evalExpr(gm[1], { ev }), false, JSON.stringify(ev) + ' 的綠色條判斷錯');
  }), '綠色條判斷錯');
});
await T('I7 突變：色條改用 border-left（會推擠內容）⇒ C2 紅在「不是 inset 陰影」', async () => {
  const m = mutate(GAME, '.tourn-event.ev-open-reg { box-shadow: inset 3px 0 0 0 #6ab87a; }', '.tourn-event.ev-open-reg { border-left: 3px solid #6ab87a; }');
  await mutantMustBreak('改用 border-left', () => withGame(m, () => {
    const d = declsOf(cssBlock(GAME, '.tourn-event.ev-open-reg'));
    assert.ok(/^box-shadow:\s*inset\s/.test(d[0]), '.tourn-event.ev-open-reg 不是 inset 陰影：' + d[0]);
  }), '不是 inset 陰影');
});
await T('I8 突變：分頁文字改回「📊 排行榜」⇒ B1 紅在「分頁文字不對」（且 B2 的 2 字規格也會紅）', async () => {
  const m = mutate(GAME, '>📊 排行</button>', '>📊 排行榜</button>');
  await mutantMustBreak('分頁文字改回三字', () => withGame(m, () => {
    const btns = tabButtons(tabsBlock(GAME));
    assert.deepStrictEqual(btns.map((b) => b.text), WANT_TABS, '分頁文字不對：' + JSON.stringify(btns.map((b) => b.text)));
  }), '分頁文字不對');
});
await T('I9 突變：分頁列 CSS 加上 flex-wrap（改版面規則）⇒ B5 紅在「版面規則被改了」', async () => {
  const m = mutate(GAME, '  .tourn-tabs { display: flex;', '  .tourn-tabs { display: flex; flex-wrap: wrap;');
  await mutantMustBreak('改分頁列版面規則', () => withGame(m, () => {
    const all = CSS_KEYS.map((k) => cssLine(GAME, k)).join('\n');
    for (const k of ['flex-wrap', 'white-space', 'flex: 1 1']) assert.ok(!all.includes(k), '分頁列 CSS 出現了 ' + k + ' ⇒ 版面規則被改了');
  }), '版面規則被改了');
});
await T('I10 突變：卡牌箭頭底色改回不透明白 ⇒ F1 紅在「不是同一套」', async () => {
  const m = mutate(CARDS, '    background: rgba(255, 255, 255, 0.18);', '    background: #fff;');
  await mutantMustBreak('箭頭不透明', () => withCards(m, () => {
    const A = declSet(ruleBlock(CARDS, '.modal-nav')), B = declSet(ruleBlock(DECKS, '.pv-nav'));
    assert.deepStrictEqual(A, B, '⚠⚠ .modal-nav 與 .pv-nav 不是同一套');
  }), '不是同一套');
});
await T('I11 突變：箭頭改大一號（會位移）⇒ F4 紅在「幾何宣告被動到了」', async () => {
  if (!hasHistory) { console.log('    （淺複製：I11 需要 BASE，改由【G】的 DOM 量測涵蓋零位移）'); return; }
  const m = CARDS.replace('  .modal-nav {\n    position: absolute;\n    top: 50%;\n    width: 42px;', '  .modal-nav {\n    position: absolute;\n    top: 50%;\n    width: 52px;');
  assert.notStrictEqual(m, CARDS, '突變錨點不存在');
  await mutantMustBreak('箭頭變大', () => withCards(m, () => {
    const GEO = ['position', 'top', 'width', 'height'];
    const pick = (block) => Object.fromEntries(declsOf(block).map((d) => [d.split(':')[0].trim(), d]));
    const now = pick(ruleBlock(CARDS, '.modal-nav')), base = pick(ruleBlock(BCARDS, '.modal-nav'));
    for (const g of GEO) assert.strictEqual(now[g], base[g], '幾何宣告 ' + g + ' 被動到了：' + now[g] + ' vs ' + base[g]);
  }), '幾何宣告 width 被動到了');
});

console.log('\n══ v6.303 三件 UI 改善守衛：' + pass + ' PASS / ' + fail + ' FAIL'
  + (skipped.length ? '　⚠ 淺複製跳過 ' + skipped.length + ' 段：' + skipped.join('、') : '') + ' ══');
process.exit(fail ? 1 : 0);
