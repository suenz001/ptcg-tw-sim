// v6.304 守衛：錦標賽「賽事卡與該場賽程表排在一起」的版面重構（站長交辦）。
//
// 站長需求：先前是「所有賽事名稱排一區、所有賽程表再排一區」，看起來很割裂；
//   改成「第一個賽事的賽事卡 → 該場的瑞士制積分表與賽程表 → 第二個賽事…」。
// ⭐⭐ 站長裁定：**保持現狀的收折，只把位置搬在一起** ⇒ 摺疊邏輯一行都不准動。
//
// 守什麼（能行為端就行為端；靜態只用在行為端測不到的地方）：
//   【A】HEAD-FAIL 錨點：分組所需的兩個 $derived 與兩個迴圈都在，
//        且**舊的兩個分離迴圈已經不存在**（BASE 一個新東西都沒有 ⇒ A0 必紅並中止）。
//   【B】⭐⭐ 行為端 DOM 順序：把**出貨碼裡真正的那段模板**（含兩個 $derived）抽出來，
//        用 svelte 編譯成 SSR 元件真的 render，對**渲染出來的元素序列**下斷言
//        （不是比字串位置）。三種資料情況各自實跑：
//          ①有賽事卡也有賽程表 ②只有賽事卡 ③⭐⭐只有賽程表（孤兒）
//        並斷言「沒有任何一塊消失」＝ 進去幾場賽事／幾份賽程，出來就有幾塊。
//   【C】⭐⭐ 摺疊邏輯**逐位元未動**：整段摺疊區（T_EVFOLD_KEY／tLoadEvFold／tEvFold／
//        tEvOpenBy／tEvOpen／tEvForced／tToggleEv）與 BASE 逐字相同（sha256 並列印），
//        再加一層不需要歷史的**矩陣回歸**：把現在的 tEvOpenBy 抽出來實跑完整參數矩陣，
//        比對 v6.303 已經釘住的預期表（淺複製時仍然在守）。
//   【D】⭐ v6.177「連線不穩沿用上一份好資料」的既有保護沒被破壞：
//        tBracketLoad 整支與 BASE 逐字相同；mergeKeyedOrKeep 行為端實跑；
//        ⭐ 渲染端回歸：賽事已從 tEvents 消失、tBrackets 還留著那一份好資料時，
//          那一塊**必須仍然畫得出來**（＝孤兒分支），而且空狀態分支逐字未動。
//   【E】框架安全（靜態）：四個 snippet（eventCard／bracketBlock／myMatchBox／myByeBox）、
//        報名中賽事迴圈、進場鈕保底區塊、整段 <style> 都與 BASE 逐字相同。
//   【F】版面量測（playwright；沒有瀏覽器就 SHALLOW-SKIP）：scripts/measure-v6304-tourn-group.mjs。
//   【G】test chain ／版本一致（不 pin 死版本號）／本檔不得整檔 sha256 鎖。
//   【H】突變：每一個都必須紅在**預期那一條**。
//
// ⚠ 守衛安慰劑八種型態逐一避開：只捕 assert.AssertionError；不 pin 死版本號／整檔 sha256；
//   每個抽取器都有下限斷言與正對照；順序斷言走**真的 render 出來的 DOM**。
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_PKG = join(ROOT, 'package.json');
const P_SELF = join(ROOT, 'scripts/test-v6304-tourn-group-layout.mjs');
const P_MEASURE = join(ROOT, 'scripts/measure-v6304-tourn-group.mjs');
const BASE_SHA = 'ae9737c595f0600caa2eb8a9162a80d0a63d89c1';   // v6.303（本版的 BASE）
// ⭐ v6.316：v6.304 自己的 sha。C1／D1／E1／E2／E4 的「本版只動了這些」改成比 BASE..THIS 兩個**固定** commit（永不過期）。
//   原本拿**工作樹**跟 v6.303 比 ⇒ v6.307／v6.309 合法改動後 E4 在完整歷史下誤紅（第九種安慰劑：pin 過期；淺複製 CI 看不到）；
//   C1／D1／E1／E2 只是「還沒被踩到」（那幾段自 v6.303 後恰好沒動；v6.316 在 <style> 加一條 CSS，E2 立刻會紅）。
//   ⚠ 不可以把 BASE_SHA 往前移（守衛會變成「跟自己比」＝恆真）—— T0 擋這件事（H10 突變實證）。
//   現況的守備：C2／C3（矩陣＋結構）、D1 前半（合併保留寫法）、E3（字面）、B 段行為端 —— 全部 history-free、沒有放寬。
const THIS_SHA = '8738219949eacfaa271bdb425baa1021aa08a268';
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const require_ = createRequire(import.meta.url);

let pass = 0, fail = 0;
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

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】HEAD-FAIL 錨點');
let GAME = '', PKG = '';
const NEW_ANCHORS = [
  'const tRunningGroups = $derived.by(() => {',
  'const tOrphanBrackets = $derived.by(() => {',
  '{#each tRunningGroups as g (g.ev._id)}',
  '{@render eventCard(g.ev)}',
  '{#if g.brk}{@render bracketBlock(g.brk)}{/if}',
  '{#each tOrphanBrackets as brk (brk.event._id)}',
];
await T('A0 HEAD-FAIL：分組用的兩個 $derived ＋ 分組迴圈 ＋ 孤兒迴圈都在（BASE v6.303 一個都沒有 ⇒ 這一條必紅）', () => {
  GAME = rd(P_GAME); PKG = rd(P_PKG);
  assert.ok(GAME.length > 900000, 'game/+page.svelte 只讀到 ' + GAME.length + ' 字元 —— 讀錯檔？');
  for (const k of NEW_ANCHORS) assert.ok(GAME.includes(k), 'game/+page.svelte 缺「' + k + '」');
});
await T('A1 ⭐ 舊的兩個**分離**迴圈已經不存在（賽事卡一區、賽程表一區＝站長說的「割裂」）', () => {
  assert.strictEqual(GAME.split('{#each tRunningEvents as ev (ev._id)}').length - 1, 0,
    '還留著「所有進行中賽事卡排一區」的舊迴圈 ⇒ 賽事卡會被畫兩次');
  assert.strictEqual(GAME.split('{#each tBrackets as brk (brk.event._id)}').length - 1, 0,
    '還留著「所有賽程表排一區」的舊迴圈 ⇒ 賽程表會被畫兩次');
});
if (fail) { console.log('\n══ v6.304 賽事分組版面守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：新東西不存在，後續斷言無法進行）══'); process.exit(1); }

const baseGame = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
const BGAME = baseGame.ok ? baseGame.out.replace(/\r\n/g, '\n') : null;
const thisGame = readBaseBlob(ROOT, THIS_SHA, 'src/routes/game/+page.svelte');
const TGAME = thisGame.ok ? thisGame.out.replace(/\r\n/g, '\n') : null;
const hasHistory = !!(hasBaseCommit(ROOT, BASE_SHA) && hasBaseCommit(ROOT, THIS_SHA) && BGAME && TGAME);
/** 「跟自己比」防線：THIS 必須真的是 v6.304（有全部新錨點）而 BASE 一個都沒有；兩份 blob 不同。 */
function thisNotBase(tg, bg) {
  assert.notStrictEqual(sha(tg), sha(bg), 'THIS 與 BASE 相同 ⇒ THIS_SHA 抓錯了（守衛會變成恆真）');
  for (const k of NEW_ANCHORS) {
    assert.ok(tg.includes(k), 'THIS(v6.304) 缺「' + k + '」⇒ THIS_SHA 抓錯了');
    assert.ok(!bg.includes(k), 'BASE(v6.303) 竟然有「' + k + '」⇒ BASE_SHA 抓錯了');
  }
}
await T('T0 ⭐ 固定兩 commit 自驗：THIS(v6.304) 含全部新錨點、BASE(v6.303) 一個都沒有、兩份 blob 不同（v6.316）', () => {
  if (!hasHistory) { shallowSkip('v6304 T0 THIS vs BASE 自驗', '需要歷史'); return; }
  thisNotBase(TGAME, BGAME);
});

// ── 共用抽取器（每一個都有下限斷言；壞掉不給假綠）────────────────────────
/** 從 `const NAME = $derived.by(` 起算括號配對，抽出整段宣告。 */
function derivedDecl(src, name) {
  const anchor = 'const ' + name + ' = $derived.by(';
  const i = src.indexOf(anchor);
  assert.ok(i > 0, '抽不到 ' + name + ' 的宣告');
  let d = 0, j = i + anchor.length - 1;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '(') d++;
    else if (c === ')') { d--; if (d === 0) { j++; break; } }
  }
  while (src[j] === ';') j++;
  const out = src.slice(i, j);
  assert.ok(out.length > 120 && out.endsWith(';'), name + ' 抽取器壞了（長度 ' + out.length + '）');
  return out;
}
/** 以前後兩段註解錨點夾出模板區塊（不含結束錨點那一行）。 */
function tplBlock(src, startLine, endLine) {
  const i = src.indexOf(startLine);
  assert.ok(i >= 0, '抽不到模板起點：' + startLine.trim().slice(0, 60));
  const j = src.indexOf(endLine, i);
  assert.ok(j > i, '抽不到模板終點：' + endLine.trim().slice(0, 60));
  const out = src.slice(i, j);
  assert.ok(out.length > 400, '模板區塊抽取器壞了（長度 ' + out.length + '）');
  return out;
}
// ⚠ 模板區塊用**前後兩段註解**當錨點（不是用迴圈本身）——突變體把迴圈拿掉／搬位置之後，
//   抽取器仍然抽得到同一塊，突變才會紅在「順序不對」而不是紅在「抽不到」。
const T_START = '      <!-- ⭐⭐⭐v6.304 依賽事分組渲染：';
const T_END = '      <!-- ⭐v6.177 核心②';
const GROUP_EACH = '      {#each tRunningGroups as g (g.ev._id)}';
const ORPHAN_BLOCK = '      {#each tOrphanBrackets as brk (brk.event._id)}\n        {@render bracketBlock(brk)}\n      {/each}\n';

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐ 行為端：把出貨碼那段模板真的 render 出來，對 DOM 順序下斷言');

/** 把出貨碼的兩個 $derived ＋ 那段模板，包成一個可 SSR 的元件並編譯。 */
async function buildRenderer(gameSrc) {
  const { compile } = await import('svelte/compiler');
  const gDecl = derivedDecl(gameSrc, 'tRunningGroups');
  const oDecl = derivedDecl(gameSrc, 'tOrphanBrackets');
  const TPL = tplBlock(gameSrc, T_START, T_END);
  assert.ok(TPL.includes('{@render eventCard(') && TPL.includes('{@render bracketBlock('),
    '抽出來的模板裡沒有 eventCard／bracketBlock 的 render ⇒ 抽取器壞了');
  // tRunningEvents 的定義也從出貨碼實抽（不是手抄），避免 fixture 與出貨碼漂移。
  const mRun = /const tRunningEvents = \$derived\([^\n]*\);/.exec(gameSrc);
  assert.ok(mRun, '抽不到 tRunningEvents 的定義');
  const mStart = /const _evStart = [^\n]*\n\s*const _byStart = [^\n]*/.exec(gameSrc);
  assert.ok(mStart, '抽不到 _evStart／_byStart');
  const comp = `<script lang="ts">
  let { tEvents = [], tBrackets = [], tMyMatch = null, tMyBye = null } = $props();
  ${mStart[0]}
  ${mRun[0]}
  ${gDecl}
  ${oDecl}
</script>
{#snippet eventCard(ev)}<div class="tourn-event" data-kind="event" data-id={ev._id}></div>{/snippet}
{#snippet bracketBlock(brk)}{#if brk.standings && brk.standings.length}<div class="tourn-bracket" data-kind="standings" data-id={brk.event._id}></div>{/if}{#if brk.matches && brk.matches.length}<div class="tourn-bracket" data-kind="matches" data-id={brk.event._id}></div>{/if}{/snippet}
{#snippet myMatchBox()}<span data-kind="mymatch" data-id="-"></span>{/snippet}
{#snippet myByeBox()}<span data-kind="mybye" data-id="-"></span>{/snippet}
<main>
${TPL}</main>
`;
  const out = compile(comp, { filename: 'v6304-fixture.svelte', generate: 'server' });
  // 產出寫到暫存目錄 ⇒ 把 import 指到絕對路徑，才不必污染 repo。
  const code = out.js.code.replace(/from ['"]([^'"]+)['"]/g,
    (m, spec) => "from '" + pathToFileURL(require_.resolve(spec)).href + "'");
  const dir = mkdtempSync(join(tmpdir(), 'v6304-'));
  const file = join(dir, 'fixture.js');
  writeFileSync(file, code);
  const { render } = await import('svelte/server');
  const Mod = await import(pathToFileURL(file).href + '?t=' + Math.random());
  return {
    dir,
    /** 回傳依 DOM 出現順序排好的 [{kind,id}]（＝真的 render 出來的元素序列）。 */
    seq(props) {
      const html = render(Mod.default, { props }).body;
      const items = [...html.matchAll(/data-kind="([a-z]+)" data-id="([^"]*)"/g)].map((m) => ({ kind: m[1], id: m[2] }));
      return { html, items };
    },
  };
}
const R = await buildRenderer(GAME);
const EV = (id, extra = {}) => ({ _id: id, status: 'running', name: id, ...extra });
const BK = (id) => ({ event: { _id: id, name: id }, standings: [{ rank: 1 }], matches: [{ round: 1, idx: 0 }] });
const kindsOf = (items) => items.map((x) => x.kind + ':' + x.id).join(' → ');

await T('B0 抽取器下限：render 出來至少要有東西（抽壞了就不給假綠）', () => {
  const { items } = R.seq({ tEvents: [EV('E1')], tBrackets: [BK('E1')] });
  assert.ok(items.length >= 3, '只 render 出 ' + items.length + ' 塊 ⇒ 抽取器或 fixture 壞了');
});
await T('B1 ⭐⭐ 情況①（有賽事卡也有賽程表）：賽事卡**緊接著**自己的積分表與賽程表', () => {
  const { items } = R.seq({ tEvents: [EV('A'), EV('B')], tBrackets: [BK('A'), BK('B')] });
  assert.strictEqual(kindsOf(items),
    'event:A → standings:A → matches:A → event:B → standings:B → matches:B',
    '實際 DOM 順序：' + kindsOf(items));
});
await T('B2 ⭐ 情況②（有賽事卡、沒有賽程表）：只畫賽事卡，不畫殼也不留空位', () => {
  const { items } = R.seq({ tEvents: [EV('A'), EV('B')], tBrackets: [BK('B')] });
  assert.strictEqual(kindsOf(items), 'event:A → event:B → standings:B → matches:B',
    '實際 DOM 順序：' + kindsOf(items));
});
await T('B3 ⭐⭐ 情況③（只有賽程表＝孤兒）：**絕不可以消失**，補畫在所有配對成功的之後', () => {
  const { items } = R.seq({ tEvents: [EV('A')], tBrackets: [BK('Z')] });
  assert.strictEqual(kindsOf(items), 'event:A → standings:Z → matches:Z',
    '孤兒賽程被丟掉或排錯位置。實際 DOM 順序：' + kindsOf(items));
});
await T('B3b ⭐ 孤兒完全沒有賽事卡時（tEvents 全空）也要畫得出來', () => {
  const { items } = R.seq({ tEvents: [], tBrackets: [BK('Z1'), BK('Z2')] });
  assert.strictEqual(kindsOf(items), 'standings:Z1 → matches:Z1 → standings:Z2 → matches:Z2',
    '實際 DOM 順序：' + kindsOf(items));
});
await T('B4 ⭐⭐ 三種情況混在一起：配對成功的依序在前、孤兒在後，順序完全可預期', () => {
  const { items } = R.seq({ tEvents: [EV('A'), EV('B'), EV('C')], tBrackets: [BK('B'), BK('Z')] });
  assert.strictEqual(kindsOf(items),
    'event:A → event:B → standings:B → matches:B → event:C → standings:Z → matches:Z',
    '實際 DOM 順序：' + kindsOf(items));
});
await T('B5 ⭐⭐ 沒有任何一塊消失：進去幾場賽事／幾份賽程，出來就有幾塊（集合相等）', () => {
  const evs = [EV('A'), EV('B'), EV('C')], bks = [BK('B'), BK('C'), BK('Z')];
  const { items } = R.seq({ tEvents: evs, tBrackets: bks });
  const gotEv = items.filter((x) => x.kind === 'event').map((x) => x.id).sort();
  const gotBk = [...new Set(items.filter((x) => x.kind !== 'event').map((x) => x.id))].sort();
  assert.deepStrictEqual(gotEv, ['A', 'B', 'C'], '賽事卡少畫了：' + gotEv.join(','));
  assert.deepStrictEqual(gotBk, ['B', 'C', 'Z'], '賽程表少畫了（含孤兒 Z）：' + gotBk.join(','));
});
await T('B6 ⭐ 相鄰性：每一張賽事卡與自己的賽程之間，不可以插進別場的東西', () => {
  const { items } = R.seq({ tEvents: [EV('A'), EV('B')], tBrackets: [BK('A'), BK('B')] });
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind !== 'event') continue;
    // 這張賽事卡之後、下一張賽事卡之前，出現的賽程 id 只能是自己
    for (let j = i + 1; j < items.length && items[j].kind !== 'event'; j++) {
      assert.strictEqual(items[j].id, items[i].id,
        '賽事卡 ' + items[i].id + ' 後面接到了別場的 ' + items[j].kind + ':' + items[j].id);
    }
  }
});
await T('B7 ⭐ 報名中／籌備中的賽事（tUpcomingEvents）不會被分組迴圈重複畫', () => {
  const { items } = R.seq({ tEvents: [EV('A'), { _id: 'U', status: 'registration', name: 'U' }], tBrackets: [] });
  assert.strictEqual(kindsOf(items), 'event:A', '分組迴圈只該畫進行中賽事，實際：' + kindsOf(items));
});
await T('B8 ⭐ 進場鈕保底（判負攸關）：tMyMatch 對不到任何賽程時仍然畫得出來', () => {
  const a = R.seq({ tEvents: [EV('A')], tBrackets: [], tMyMatch: { eventId: 'A', round: 1 } });
  assert.ok(a.items.some((x) => x.kind === 'mymatch'), '進場鈕保底沒畫出來 ⇒ 玩家會吃未進場判負');
  const b = R.seq({ tEvents: [EV('A')], tBrackets: [BK('A')], tMyMatch: { eventId: 'A', round: 1 } });
  assert.ok(!b.items.some((x) => x.kind === 'mymatch'), '賽程已載到時保底不該重複出現');
  const c = R.seq({ tEvents: [EV('A')], tBrackets: [], tMyBye: { eventId: 'A', round: 1 } });
  assert.ok(c.items.some((x) => x.kind === 'mybye'), '輪空提示保底沒畫出來');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐⭐ 摺疊邏輯逐位元未動');
const FOLD_START = "  const T_EVFOLD_KEY = 'ptcg_tourn_evfold_v1';";
const FOLD_END = "  function tToggleEv(eventId: string): void {\n    if (!eventId) return;\n    const cur = tEvOpen[eventId] !== false;\n    tEvFold = { ...tEvFold, [eventId]: !cur };\n    try { localStorage.setItem(T_EVFOLD_KEY, JSON.stringify(tEvFold)); } catch { /* 隱私模式會 throw */ }\n  }\n";
function foldRegion(src) {
  const i = src.indexOf(FOLD_START);
  assert.ok(i > 0, '抽不到摺疊區起點 T_EVFOLD_KEY');
  const j = src.indexOf(FOLD_END, i);
  assert.ok(j > i, '抽不到摺疊區終點 tToggleEv');
  const out = src.slice(i, j + FOLD_END.length);
  assert.ok(out.includes('function tEvOpenBy(') && out.includes('const tEvOpen = $derived.by(')
    && out.includes('const tEvForced = $derived.by(') && out.length > 2000,
    '摺疊區抽取器壞了（長度 ' + out.length + '）');
  return out;
}
const FOLD_NOW = foldRegion(GAME);
console.log('   摺疊區 sha256（現在）＝ ' + sha(FOLD_NOW) + '　長度 ' + FOLD_NOW.length);
await T('C1 ⭐⭐ 整段摺疊區（tLoadEvFold／tEvFold／tEvOpenBy／tEvOpen／tEvForced／tToggleEv）v6.304 與 v6.303 **逐位元相同**（固定兩 commit）', () => {
  if (!hasHistory) { shallowSkip('v6304 C1 摺疊區 THIS vs BASE 逐位元', '由 C2 的矩陣回歸與 C3 的結構斷言補上'); return; }
  const b = foldRegion(BGAME), t = foldRegion(TGAME);
  console.log('   摺疊區 sha256（BASE）＝ ' + sha(b) + '　長度 ' + b.length);
  assert.strictEqual(sha(t), sha(b),
    'v6.304 改到了摺疊區（站長裁定：只搬位置，收折照舊）\n      THIS ' + sha(t) + '\n      BASE ' + sha(b));
});
/** 把 tEvOpenBy 抽出來真的跑（不需要歷史，淺複製也在守）。 */
async function evOpenByOf(src) {
  const esbuild = await import('esbuild');
  const i = src.indexOf('  function tEvOpenBy(');
  assert.ok(i > 0, '抽不到 tEvOpenBy');
  const j = src.indexOf('\n  }\n', i);
  assert.ok(j > i, '抽不到 tEvOpenBy 的結尾');
  const code = src.slice(i, j + 5);
  assert.ok(code.split('return').length - 1 >= 5, 'tEvOpenBy 抽取器壞了（return 太少）');
  const js = esbuild.transformSync(code, { loader: 'ts', target: 'es2020' }).code;
  return new Function(js + '\nreturn tEvOpenBy;')();
}
const evOpenBy = await evOpenByOf(GAME);
await T('C2 ⭐⭐ 矩陣回歸：tEvOpenBy 在完整參數矩陣上與 v6.303 釘住的預期表逐格相同', () => {
  const IDS = ['', 'E1'];
  const BOOLS = [false, true];
  const PREFS = [null, {}, { E1: true }, { E1: false }];
  const MMS = [null, 'E1', 'E2'];
  const STATUS = [undefined, 'registration', 'checkin', 'running'];
  let n = 0, diffs = [];
  for (const id of IDS) for (const reg of BOOLS) for (const dr of BOOLS)
    for (const pref of PREFS) for (const mm of MMS) for (const mb of MMS) for (const st of STATUS) {
      // 預期表 ＝ v6.303 定案的四段優先序（逐字照抄卡在程式碼裡的規則，獨立實作一次）
      let want;
      if (!id) want = true;
      else if (id === mm || id === mb) want = true;
      else if (reg && !dr && st === 'checkin') want = true;
      else { const p = pref ? pref[id] : undefined; want = (typeof p === 'boolean') ? p : (!!reg && !dr); }
      const got = evOpenBy(id, reg, dr, pref, mm, mb, st);
      n++;
      if (got !== want) diffs.push(JSON.stringify({ id, reg, dr, pref, mm, mb, st, got, want }));
    }
  assert.ok(n >= 1000, '矩陣只跑了 ' + n + ' 格 ⇒ 矩陣產生器壞了');
  assert.strictEqual(diffs.length, 0, n + ' 格中有 ' + diffs.length + ' 格不符：\n      ' + diffs.slice(0, 6).join('\n      '));
  console.log('   矩陣回歸：' + n + ' 格全等 ✓');
});
await T('C2b ⭐⭐ 矩陣回歸（BASE 對照）：BASE 與現在的 tEvOpenBy 在同一組矩陣上**逐格全等**', async () => {
  if (!hasHistory) { shallowSkip('v6304 C2b BASE vs 現在的矩陣對照', '由 C2 的獨立預期表涵蓋同一件事'); return; }
  const bFn = await evOpenByOf(BGAME);
  const IDS = ['', 'E1'];
  const BOOLS = [false, true];
  const PREFS = [null, {}, { E1: true }, { E1: false }];
  const MMS = [null, 'E1', 'E2'];
  const STATUS = [undefined, 'registration', 'checkin', 'running'];
  let n = 0, diffs = 0;
  for (const id of IDS) for (const reg of BOOLS) for (const dr of BOOLS)
    for (const pref of PREFS) for (const mm of MMS) for (const mb of MMS) for (const st of STATUS) {
      n++;
      if (evOpenBy(id, reg, dr, pref, mm, mb, st) !== bFn(id, reg, dr, pref, mm, mb, st)) diffs++;
    }
  assert.ok(n >= 1000, '矩陣只跑了 ' + n + ' 格');
  assert.strictEqual(diffs, 0, n + ' 格中有 ' + diffs + ' 格與 BASE 不同 ⇒ 摺疊行為被改了');
  console.log('   BASE 對照矩陣：' + n + ' 格全等 ✓');
});
await T('C3 ⭐ 接線：賽事卡看 tEvOpen[ev._id]、積分表與賽程表看 tEvOpen[_bkId]（三塊各自獨立收折照舊）', () => {
  assert.ok(GAME.includes('{@const _evOpen = tEvOpen[ev._id] !== false}'), 'eventCard 的 _evOpen 沒接 tEvOpen');
  assert.ok(GAME.includes('{@const _bkOpen = tEvOpen[_bkId] !== false}'), 'bracketBlock 的 _bkOpen 沒接 tEvOpen');
  assert.strictEqual(GAME.split('onclick={() => tToggleEv(').length - 1, 3,
    '三個可收折的標題列（賽事卡／積分表／賽程表）應各有一個 tToggleEv 的 onclick');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】v6.177「連線不穩沿用上一份好資料」的既有保護沒被破壞');
function fnBlock(src, header) {
  const i = src.indexOf(header);
  assert.ok(i > 0, '抽不到 ' + header.trim().slice(0, 50));
  const j = src.indexOf('\n  }\n', i);
  assert.ok(j > i, header.trim().slice(0, 40) + ' 的結尾抽不到');
  const out = src.slice(i, j + 5);
  assert.ok(out.length > 400, header.trim().slice(0, 40) + ' 抽取器壞了（長度 ' + out.length + '）');
  return out;
}
await T('D1 ⭐ tBracketLoad（逐 eventId 合併、失敗沿用舊資料）與 BASE **逐位元相同**', () => {
  const now = fnBlock(GAME, '  async function tBracketLoad() {');
  assert.ok(now.includes('mergeKeyedOrKeep<any>(tBrackets,') && now.includes('tBrackets = merged.list;')
    && now.includes('tBracketsStale = merged.stale;'), 'tBracketLoad 已經不是「合併保留」的寫法');
  console.log('   tBracketLoad sha256 ＝ ' + sha(now));
  if (!hasHistory) { shallowSkip('v6304 D1 tBracketLoad THIS vs BASE', '上一行的結構斷言仍在守'); return; }
  assert.strictEqual(sha(fnBlock(TGAME, '  async function tBracketLoad() {')), sha(fnBlock(BGAME, '  async function tBracketLoad() {')), 'v6.304 改到了 tBracketLoad');
});
await T('D2 ⭐ 行為端：mergeKeyedOrKeep 真的「成功的用新的、失敗的沿用舊的」', async () => {
  const esbuild = await import('esbuild');
  const ts = rd(join(ROOT, 'src/lib/ui/stale-keep.ts'));
  const js = esbuild.transformSync(ts, { loader: 'ts', target: 'es2020', format: 'cjs' }).code;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  const prev = [{ event: { _id: 'A' }, matches: ['舊'] }, { event: { _id: 'B' }, matches: ['舊'] }];
  const r = mod.exports.mergeKeyedOrKeep(prev, (b) => String(b.event._id),
    [{ key: 'A', value: { event: { _id: 'A' }, matches: ['新'] } }, { key: 'B', value: null }]);
  assert.strictEqual(r.list.length, 2, '合併後應該還是兩場');
  assert.strictEqual(r.list[1].matches[0], '舊', 'B 抓失敗時沒有沿用上一份好資料');
  assert.strictEqual(r.stale, true, 'stale 旗標沒有被標起來');
});
await T('D3 ⭐⭐ 渲染端回歸：賽事已從 tEvents 消失、tBrackets 還留著那一份好資料 ⇒ 那一區**仍然畫得出來**', () => {
  // 這正是 v6.177 的症狀重現：/event 比 /bracket 快，賽事先從清單消失。
  // 分組迴圈只走賽事卡 ⇒ 沒有孤兒分支的話這一塊會憑空消失。
  const { items } = R.seq({ tEvents: [], tBrackets: [BK('GONE')] });
  assert.ok(items.some((x) => x.kind === 'standings' && x.id === 'GONE'), '沿用中的積分表消失了');
  assert.ok(items.some((x) => x.kind === 'matches' && x.id === 'GONE'), '沿用中的賽程表消失了');
});
await T('D4 ⭐ v6.177 的空狀態分支（「賽程更新中…／賽程載入中…」）逐字未動', () => {
  const need = "{#if tBrackets.length === 0 && tRunningEvents.length > 0}";
  assert.ok(GAME.includes(need), '空狀態的判斷式被改了');
  assert.ok(GAME.includes("{tBracketsEverOk ? '賽程更新中…（連線不穩，正在重新取得）' : '賽程載入中…'}"),
    '空狀態的文案被改了');
  assert.ok(GAME.includes('let tBracketsStale = $state(false);') && GAME.includes('let tBracketsEverOk = $state(false);'),
    'stale／everOk 兩個旗標被動到了');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】框架安全：只搬位置，其他逐字未動');
function snippetOf(src, name) {
  const a = '{#snippet ' + name + '(';
  const i = src.indexOf(a);
  assert.ok(i > 0, '抽不到 snippet ' + name);
  const j = src.indexOf('\n      {/snippet}', i);
  assert.ok(j > i, 'snippet ' + name + ' 的結尾抽不到');
  const out = src.slice(i, j + 17);
  assert.ok(out.length > 100, 'snippet ' + name + ' 抽取器壞了（長度 ' + out.length + '）');
  return out;
}
await T('E1 ⭐⭐ 四個 snippet（eventCard／bracketBlock／myMatchBox／myByeBox）v6.304 與 v6.303 **逐位元相同**（固定兩 commit）', () => {
  for (const n of ['eventCard', 'bracketBlock', 'myMatchBox', 'myByeBox']) snippetOf(GAME, n);   // 現況：四個 snippet 都還在（抽取器有下限）
  if (!hasHistory) { shallowSkip('v6304 E1 四個 snippet THIS vs BASE', '本版只搬 each 的位置，snippet 內容由 B 段行為端間接涵蓋'); return; }
  for (const n of ['eventCard', 'bracketBlock', 'myMatchBox', 'myByeBox']) {
    const t = snippetOf(TGAME, n), b = snippetOf(BGAME, n);
    assert.strictEqual(sha(t), sha(b), 'v6.304 改到了 snippet ' + n + '（' + sha(t).slice(0, 12) + ' vs ' + sha(b).slice(0, 12) + '）');
  }
});
await T('E2 ⭐⭐ 整段 <style> 與 BASE **逐位元相同**（版面重構不得靠改 CSS 達成）', () => {
  const cssOf = (s) => {
    const i = s.lastIndexOf('<style');
    assert.ok(i > 0, '抽不到 <style>');
    const out = s.slice(s.indexOf('>', i) + 1, s.lastIndexOf('</style>'));
    assert.ok(out.length > 50000, '<style> 抽取器壞了（長度 ' + out.length + '）');
    return out;
  };
  const now = cssOf(GAME);
  console.log('   <style> sha256 ＝ ' + sha(now) + '　長度 ' + now.length);
  if (!hasHistory) { shallowSkip('v6304 E2 <style> THIS vs BASE', '長度下限斷言仍在'); return; }
  assert.strictEqual(sha(cssOf(TGAME)), sha(cssOf(BGAME)), 'v6.304 改到了 <style>');
});
await T('E3 ⭐ 進場鈕保底區塊與報名中賽事迴圈逐字未動', () => {
  assert.ok(GAME.includes('{#if tMyMatch && !tBrackets.some((b) => b.event?._id === tMyMatch.eventId)}'), '保底條件被改了');
  assert.ok(GAME.includes('{:else if tMyBye && !tBrackets.some((b) => b.event?._id === tMyBye.eventId)}'), '輪空保底條件被改了');
  assert.ok(GAME.includes('{#each tUpcomingEvents as ev (ev._id)}{@render eventCard(ev)}{/each}'), '報名中賽事迴圈被改了');
});
function e4LineDiff(bg, tg) {
  const a = bg.split('\n'), b = tg.split('\n');
  const setA = new Map(); for (const l of a) setA.set(l, (setA.get(l) ?? 0) + 1);
  const setB = new Map(); for (const l of b) setB.set(l, (setB.get(l) ?? 0) + 1);
  const removed = [], added = [];
  for (const [l, n] of setA) { const d = n - (setB.get(l) ?? 0); for (let i = 0; i < d; i++) removed.push(l.trim()); }
  for (const [l, n] of setB) { const d = n - (setA.get(l) ?? 0); for (let i = 0; i < d; i++) added.push(l.trim()); }
  const REMOVED_OK = [
    '{#each tRunningEvents as ev (ev._id)}{@render eventCard(ev)}{/each}',
    '{#each tBrackets as brk (brk.event._id)}',
    '<!-- v5.620：進行中／即將開始的賽事優先（其賽程表、觀戰選單排在「下一場報名」視窗之上）-->',
  ];
  const bad = removed.filter((l) => l !== '' && !REMOVED_OK.includes(l));
  assert.deepStrictEqual(bad, [], '本版刪掉了未申報的行：\n      ' + bad.slice(0, 8).join('\n      '));
  assert.ok(added.length >= 10 && added.length <= 60, '新增行數 ' + added.length + ' 不在預期範圍（只該是兩個 $derived ＋ 迴圈與註解）');
  return { removed, added };
}
await T('E4 ⭐ v6.304 **只**動了模板的 each 位置與新增兩個 $derived —— v6.303..v6.304 逐行 diff 只有這些（固定兩 commit，永不過期）', () => {
  if (!hasHistory) { shallowSkip('v6304 E4 逐行 diff 白名單', 'E1～E3 的逐位元比對已涵蓋主要面積'); return; }
  const { removed, added } = e4LineDiff(BGAME, TGAME);
  console.log('   v6.303..v6.304 逐行 diff：刪 ' + removed.length + ' 行（全在白名單）、增 ' + added.length + ' 行');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】版面量測（playwright）');
await T('F1 三尺寸量測 ＋ 三塊左右邊界對齊（沒有瀏覽器就 SHALLOW-SKIP）', () => {
  assert.ok(existsSync(P_MEASURE), 'scripts/measure-v6304-tourn-group.mjs 必須存在');
  let pw = null;
  try { pw = require_.resolve(process.env.PLAYWRIGHT_MODULE || 'playwright'); } catch { pw = null; }
  if (!pw) { shallowSkip('v6304 F1 三尺寸版面量測', '這台機器沒有 playwright；量測腳本仍在 repo 內，可手動跑'); return; }
  const out = execFileSync(process.execPath, [P_MEASURE], { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8');
  console.log(out.split('\n').slice(-3).join('\n'));
  assert.ok(/全部符合/.test(out), '量測不通過：\n' + out.slice(-1500));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】test chain ／版本 ／不 pin 死版本');
await T('G1 本檔與量測腳本都在 repo，且本檔已加進 npm test chain', () => {
  const pkg = JSON.parse(PKG);
  assert.ok(pkg.scripts.test.includes('scripts/test-v6304-tourn-group-layout.mjs'), '本檔沒有加進 npm test');
});
await T('G2 版本一致：src/lib/version.ts = admin.html SITE_VERSION_HINT（不 pin 死數字）', () => {
  const V = /VERSION = '([\d.]+)'/.exec(rd(join(ROOT, 'src/lib/version.ts')))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(rd(join(ROOT, 'oracle-admin/admin.html')))[1];
  assert.strictEqual(V, H, 'version.ts=' + V + ' 但 admin.html=' + H);
});
await T('G3 本檔不得整檔 sha256 鎖、也不得 pin 死版本號（第九種安慰劑）', () => {
  const self = rd(P_SELF);
  assert.ok(!/VERSION\s*===?\s*'6\.\d+'/.test(self), '本檔 pin 死了版本號');
  const m = /const BASE_SHA = '([0-9a-f]{40})'/.exec(self);
  assert.ok(m, 'BASE_SHA 要寫清楚（可供 revert-diff 追溯）');
  assert.ok(!/sha\(GAME\)\s*===?/.test(self), '不可以整檔 sha256 鎖 game/+page.svelte');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【H】突變：每一個都必須紅在預期那一條');
async function mutantSeq(mutatedGame) {
  const RM = await buildRenderer(mutatedGame);
  return RM;
}
await T('H1 突變：孤兒賽程被丟掉（拿掉孤兒迴圈）⇒ B3 必紅', async () => {
  await mutantMustBreak('丟掉孤兒迴圈', async () => {
    const g = mutate(GAME, ORPHAN_BLOCK, '');
    const RM = await mutantSeq(g);
    const { items } = RM.seq({ tEvents: [EV('A')], tBrackets: [BK('Z')] });
    assert.strictEqual(kindsOf(items), 'event:A → standings:Z → matches:Z', '孤兒賽程被丟掉。實際 DOM 順序：' + kindsOf(items));
  }, '孤兒賽程被丟掉');
});
await T('H2 突變：孤兒的定義寫反（filter 少了 !）⇒ 孤兒消失且配對成功的被重畫', async () => {
  await mutantMustBreak('孤兒定義寫反', async () => {
    const g = mutate(GAME, "return tBrackets.filter((b: any) => !evIds.has(String(b && b.event && b.event._id)));",
      "return tBrackets.filter((b: any) => evIds.has(String(b && b.event && b.event._id)));");
    const RM = await mutantSeq(g);
    const { items } = RM.seq({ tEvents: [EV('A')], tBrackets: [BK('A'), BK('Z')] });
    assert.strictEqual(kindsOf(items), 'event:A → standings:A → matches:A → standings:Z → matches:Z',
      '孤兒／配對的分流錯了。實際 DOM 順序：' + kindsOf(items));
  }, '孤兒／配對的分流錯了');
});
await T('H3 突變：排序錯（孤兒排到分組迴圈之前）⇒ B4 的順序斷言必紅', async () => {
  await mutantMustBreak('孤兒排到最前面', async () => {
    let g = mutate(GAME, ORPHAN_BLOCK, '');
    g = mutate(g, GROUP_EACH, ORPHAN_BLOCK + GROUP_EACH);
    const RM = await mutantSeq(g);
    const { items } = RM.seq({ tEvents: [EV('A'), EV('B'), EV('C')], tBrackets: [BK('B'), BK('Z')] });
    assert.strictEqual(kindsOf(items),
      'event:A → event:B → standings:B → matches:B → event:C → standings:Z → matches:Z',
      '孤兒排錯位置。實際 DOM 順序：' + kindsOf(items));
  }, '孤兒排錯位置');
});
await T('H4 突變：分組時把賽程接到「下一場」（索引錯位）⇒ B6 相鄰性必紅', async () => {
  await mutantMustBreak('賽程接錯賽事', async () => {
    const g = mutate(GAME, "return tRunningEvents.map((ev: any) => ({ ev, brk: byEv.get(String(ev && ev._id)) ?? null }));",
      "return tRunningEvents.map((ev: any, i: number) => ({ ev, brk: [...byEv.values()][i] ?? null }));");
    const RM = await mutantSeq(g);
    const { items } = RM.seq({ tEvents: [EV('A'), EV('B')], tBrackets: [BK('B'), BK('A')] });
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== 'event') continue;
      for (let j = i + 1; j < items.length && items[j].kind !== 'event'; j++) {
        assert.strictEqual(items[j].id, items[i].id,
          '賽事卡 ' + items[i].id + ' 後面接到了別場的 ' + items[j].kind + ':' + items[j].id);
      }
    }
  }, '後面接到了別場的');
});
await T('H5 突變：情況②漏掉（沒有賽程的賽事連賽事卡都不畫）⇒ B2 必紅', async () => {
  await mutantMustBreak('沒賽程的賽事整張不畫', async () => {
    const g = mutate(GAME, '        {@render eventCard(g.ev)}\n        {#if g.brk}{@render bracketBlock(g.brk)}{/if}',
      '        {#if g.brk}{@render eventCard(g.ev)}{@render bracketBlock(g.brk)}{/if}');
    const RM = await mutantSeq(g);
    const { items } = RM.seq({ tEvents: [EV('A'), EV('B')], tBrackets: [BK('B')] });
    assert.strictEqual(kindsOf(items), 'event:A → event:B → standings:B → matches:B', '實際 DOM 順序：' + kindsOf(items));
  }, '實際 DOM 順序');
});
await T('H6 突變：摺疊 key 接錯（bracketBlock 改用別的 key）⇒ C3 必紅', async () => {
  await mutantMustBreak('摺疊 key 接錯', () => {
    const g = mutate(GAME, '{@const _bkOpen = tEvOpen[_bkId] !== false}', '{@const _bkOpen = true}');
    assert.ok(g.includes('{@const _bkOpen = tEvOpen[_bkId] !== false}'), 'bracketBlock 的 _bkOpen 沒接 tEvOpen');
  }, 'bracketBlock 的 _bkOpen 沒接 tEvOpen');
});
await T('H7 突變：摺疊邏輯被動一個字（tEvOpenBy 的預設規則）⇒ C1／C2 必紅', async () => {
  await mutantMustBreak('動到摺疊邏輯', async () => {
    const g = mutate(GAME, '    return !!registered && !dropped;                                           // 預設：有報名（且未棄賽）就展開',
      '    return true;                                           // 預設：有報名（且未棄賽）就展開');
    const fn = await evOpenByOf(g);
    const diffs = [];
    for (const reg of [false, true]) for (const dr of [false, true]) {
      const want = (reg && !dr);
      if (fn('E1', reg, dr, null, null, null, 'running') !== want) diffs.push(JSON.stringify({ reg, dr }));
    }
    assert.strictEqual(diffs.length, 0, '格不符：' + diffs.join(','));
  }, '格不符');
});
await T('H8 突變：把「保留舊資料」的合併換回清空型 ⇒ D1 必紅', async () => {
  await mutantMustBreak('合併換成清空型', () => {
    const g = mutate(GAME, '      const merged = mergeKeyedOrKeep<any>(tBrackets, (b: any) => String(b && b.event && b.event._id), incoming);',
      '      const merged = { list: incoming.map((x: any) => x.value).filter(Boolean), stale: false };');
    const now = fnBlock(g, '  async function tBracketLoad() {');
    assert.ok(now.includes('mergeKeyedOrKeep<any>(tBrackets,') && now.includes('tBrackets = merged.list;')
      && now.includes('tBracketsStale = merged.stale;'), 'tBracketLoad 已經不是「合併保留」的寫法');
  }, '已經不是「合併保留」的寫法');
});
await T('H9 突變：兩個舊的分離迴圈其中一個沒刪乾淨 ⇒ A1 必紅', () => {
  const g = GAME.replace(GROUP_EACH, '{#each tRunningEvents as ev (ev._id)}{@render eventCard(ev)}{/each}\n' + GROUP_EACH);
  assert.throws(() => {
    assert.strictEqual(g.split('{#each tRunningEvents as ev (ev._id)}').length - 1, 0,
      '還留著「所有進行中賽事卡排一區」的舊迴圈 ⇒ 賽事卡會被畫兩次');
  }, (e) => e instanceof assert.AssertionError && /賽事卡會被畫兩次/.test(e.message));
});

if (hasHistory) {
  await T('H10 突變：THIS_SHA 指到 BASE（「跟自己比」）⇒ T0 必紅（v6.316）', () => {
    assert.throws(() => thisNotBase(BGAME, BGAME), (e) => e instanceof assert.AssertionError && /THIS_SHA 抓錯了/.test(e.message), '「跟自己比」沒有被擋下');
  });
  await T('H11 突變：v6.304 若多刪了一行（未申報）⇒ E4 必紅在「未申報的行」（v6.316）', () => {
    const g = mutate(TGAME, '\n  let tBracketsStale = $state(false);', '');
    assert.throws(() => e4LineDiff(BGAME, g), (e) => e instanceof assert.AssertionError && /未申報的行/.test(e.message), '多刪一行沒有被抓到');
  });
  await T('H12 突變：v6.304 若改了 <style> 一個字 ⇒ E2 必紅（v6.316）', () => {
    const g = mutate(TGAME, '  .rotate-prompt{ display:none; }', '  .rotate-prompt{ display:block; }');
    const cssOf2 = (x) => x.slice(x.indexOf('>', x.lastIndexOf('<style')) + 1, x.lastIndexOf('</style>'));
    assert.notStrictEqual(sha(cssOf2(g)), sha(cssOf2(BGAME)), '<style> 突變沒被抓到');
  });
} else {
  shallowSkip('v6304 H10～H12 固定兩 commit 的突變', '需要歷史');
}

try { rmSync(R.dir, { recursive: true, force: true }); } catch { /* 清不掉無所謂 */ }
console.log('\n══ v6.304 賽事分組版面守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
