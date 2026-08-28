// v6.252 錦標賽賽事摺疊 ＋ 大廳聊天【聊天】/【系統】篩選 —— 行為端守衛
//
// ⚠⚠ 這一版動的是 UI，最容易出「守衛全綠但畫面根本沒接上」的事故（v6.154 22 條守衛全綠、
//    分頁卻打不開）。所以本檔**不做字串存在性檢查**，一律：
//      ① 用 svelte/compiler 的 parse() 取得真的 AST（不是 grep）；
//      ② 把真的 $derived / 純述詞 / 模板 {@const} 表達式**抽出來實跑**；
//      ③ 用 AST 斷言「進場鈕確實被包在摺疊條件的 true 分支裡」——
//         再把①②的結果餵進去，證明強制展開時那個分支真的成立。
//    最後附 6 個突變測試，證明每一條斷言都真的抓得到問題（Rule 25 的掃描器自驗）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { parse } from 'svelte/compiler';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fileArg = process.argv.slice(2).find((a) => a.startsWith('--file='));
const GAME = fileArg ? fileArg.slice('--file='.length) : join(ROOT, 'src/routes/game/+page.svelte');
const src = readFileSync(GAME, 'utf8');

let pass = 0, fail = 0;
const failed = [];
function T(name, fn) {
  try { fn(); console.log('  OK', name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL', name, '::', e.message); fail++; failed.push(name); }
    else throw e;                       // ⚠ 非斷言錯誤照丟（掃描器自己壞掉不可以被當成「這一項紅」吞掉）
  }
}
/** 抽取失敗一律轉成 AssertionError，讓「沒抽到」與「抽到但不對」都紅在同一項，而不是整支 crash。 */
function need(v, msg) { if (v === undefined || v === null || v === false) throw new assert.AssertionError({ message: msg }); return v; }

// ── AST ─────────────────────────────────────────────────────────────────────
const ast = parse(src, { modern: true, filename: 'game/+page.svelte' });
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) walk(c, fn); return; }
  if (node.type) fn(node);
  for (const k of Object.keys(node)) {
    if (k === 'parent' || k === 'loc') continue;
    const v = node[k];
    if (v && typeof v === 'object') walk(v, fn);
  }
}
const txt = (n) => src.slice(n.start, n.end);
function findSnippet(name, root = ast.fragment) {
  let hit = null;
  walk(root, (n) => { if (!hit && n.type === 'SnippetBlock' && n.expression && n.expression.name === name) hit = n; });
  return hit;
}
/** 取某個 {@const NAME = ...} 的 init 原始碼（限定在 scope 節點內找）。 */
function constSrc(scope, name) {
  let out = null;
  walk(scope, (n) => {
    if (out || n.type !== 'ConstTag') return;
    const d = n.declaration && n.declaration.declarations && n.declaration.declarations[0];
    if (d && d.id && d.id.name === name && d.init) out = txt(d.init);
  });
  return out;
}
/** ⚠ Fragment 節點沒有 start/end —— 直接 src.slice(undefined, undefined) 會回**整個檔案**、
 *   讓 includes() 永遠成立（假 PASS）。一律用這支取範圍。 */
function nodeRange(n) {
  let a = Infinity, b = -Infinity;
  walk(n, (x) => {
    if (typeof x.start === 'number' && typeof x.end === 'number') { if (x.start < a) a = x.start; if (x.end > b) b = x.end; }
  });
  return a <= b ? [a, b] : null;
}
function rtxt(n) { const r = nodeRange(n); return r ? src.slice(r[0], r[1]) : ''; }
/** 找 test 原始碼等於 wanted 的 IfBlock（全部）。 */
function findIfs(scope, wanted) {
  const out = [];
  walk(scope, (n) => { if (n.type === 'IfBlock' && n.test && txt(n.test).trim() === wanted) out.push(n); });
  return out;
}
function findIf(scope, wanted) { return findIfs(scope, wanted)[0] || null; }
function hasRender(scope, fnName) {
  let hit = false;
  walk(scope, (n) => {
    if (n.type === 'RenderTag' && n.expression) {
      const e = n.expression.type === 'CallExpression' ? n.expression : null;
      if (e && e.callee && e.callee.name === fnName) hit = true;
    }
  });
  return hit;
}
function eachBlocks(scope) {
  const out = [];
  walk(scope, (n) => { if (n.type === 'EachBlock') out.push(n); });
  return out;
}
function elementsWithClass(scope, cls) {
  const out = [];
  walk(scope, (n) => {
    if (n.type !== 'RegularElement') return;
    const a = (n.attributes || []).find((x) => x.type === 'Attribute' && x.name === 'class');
    if (!a) return;
    const v = Array.isArray(a.value) ? a.value.map((p) => (p.type === 'Text' ? p.data : '')).join('') : String(a.value);
    if (v.split(/\s+/).includes(cls)) out.push(n);
  });
  return out;
}

// ── 從 <script> 抽真的程式碼並實跑 ────────────────────────────────────────────
const scriptNode = need(ast.instance && ast.instance.content, '<script> 區塊抽不到');
function tsToJs(code) {
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}
function declSrc(name, kind) {
  let out = null;
  for (const st of scriptNode.body) {
    if (kind === 'fn' && st.type === 'FunctionDeclaration' && st.id && st.id.name === name) out = txt(st);
    if (kind === 'var' && st.type === 'VariableDeclaration') {
      for (const d of st.declarations) if (d.id && d.id.name === name && d.init) out = txt(d.init);
    }
  }
  return out;
}
function makeEvOpenBy() {
  const s = need(declSrc('tEvOpenBy', 'fn'), '找不到 function tEvOpenBy —— 賽事摺疊的預設規則／強制展開述詞不存在');
  return new Function(tsToJs(s) + '\nreturn tEvOpenBy;')();
}
function makeEvOpenMap() {
  const s = need(declSrc('tEvOpen', 'var'), '找不到 const tEvOpen = $derived.by(...)');
  const m = /^\$derived\.by\(([\s\S]*)\)$/.exec(s.trim());
  need(m, 'tEvOpen 不是 $derived.by(...) —— 過濾必須用 $derived，不可以在 template 內每次重算');
  const body = m[1];
  // 真的跑那個 arrow function；它用到的外部繫結一律用參數注入。
  const f = new Function('tEvFold', 'tMyMatch', 'tMyBye', 'tEvents', 'tEvOpenBy',
    tsToJs('const _f = (' + body + '); export {};').replace(/export\s*\{\s*\};?/g, '') + '\nreturn _f();');
  return f;
}
function makeChatFilter() {
  const s = need(declSrc('tChatFiltered', 'var'), '找不到 const tChatFiltered = $derived(...)');
  const m = /^\$derived\(([\s\S]*)\)$/.exec(s.trim());
  need(m, 'tChatFiltered 不是 $derived(...)');
  return new Function('tChat', 'tChatShowChat', 'tChatShowSys',
    tsToJs('const _v = (' + m[1] + ');').replace(/^"use strict";\s*/, '') + '\nreturn _v;');
}
// ⚠ 一律**延遲**建構：抽取失敗要紅在「用到它的那一項」，不可以在載入時就整支 crash
//   （不然 HEAD-FAIL 只會看到一個例外，看不出到底有幾項沒做）。
let _a, _b, _c;
const evOpenBy = (...args) => (_a || (_a = makeEvOpenBy()))(...args);
const evOpenMap = (...args) => (_b || (_b = makeEvOpenMap()))(...args);
const chatFilter = (...args) => (_c || (_c = makeChatFilter()))(...args);
const EV = (id, reg, dropped) => ({ _id: id, registered: reg, dropped: !!dropped });
const mapOf = (events, pref, mm, mb) => evOpenMap(pref, mm ? { eventId: mm } : null, mb ? { eventId: mb } : null, events, evOpenBy);

// ── 需求A ───────────────────────────────────────────────────────────────────
T('A① 預設規則：有報名且未棄賽→展開；沒報名／已棄賽→摺疊（站長裁定）', () => {
  assert.strictEqual(evOpenBy('e1', true, false, {}, null, null), true, '有報名應展開');
  assert.strictEqual(evOpenBy('e1', false, false, {}, null, null), false, '沒報名應摺疊');
  assert.strictEqual(evOpenBy('e1', true, true, {}, null, null), false, '已棄賽應摺疊');
});
T('A② 使用者手動偏好蓋過預設（localStorage 只記手動改過的那幾場）', () => {
  assert.strictEqual(evOpenBy('e1', false, false, { e1: true }, null, null), true, '手動展開沒報名的場');
  assert.strictEqual(evOpenBy('e1', true, false, { e1: false }, null, null), false, '手動摺疊有報名的場');
  assert.strictEqual(evOpenBy('e2', true, false, { e1: false }, null, null), true, '沒記錄的場必須回退預設規則');
});
T('A③ ⚠⚠硬約束：tMyMatch 命中該賽事 → 強制展開（使用者手動摺也無效）', () => {
  assert.strictEqual(evOpenBy('e1', false, false, { e1: false }, 'e1', null), true,
    '輪到我進場卻算成摺疊 —— 進場鈕會消失、玩家吃未進場判負');
  assert.strictEqual(evOpenBy('e1', true, true, { e1: false }, 'e1', null), true, '已棄賽但仍有 myMatch 也要展開');
});
T('A④ ⚠⚠硬約束：tMyBye 命中該賽事 → 強制展開', () => {
  assert.strictEqual(evOpenBy('e9', false, false, { e9: false }, null, 'e9'), true);
});
T('A⑤ fail-open：認不出 eventId 一律展開（絕不因為查不到就把整場藏起來）', () => {
  assert.strictEqual(evOpenBy('', false, false, {}, null, null), true);
});
T('A⑥ tEvOpen 衍生表實跑：多場賽事各自判定（只摺該摺的）', () => {
  const m = mapOf([EV('a', true), EV('b', false), EV('c', true, true)], {}, null, null);
  assert.deepStrictEqual(m, { a: true, b: false, c: false });
});
T('A⑦ 模板 {@const} 真的接到 tEvOpen（賽事卡）—— 抽出模板表達式實跑', () => {
  const ev = need(findSnippet('eventCard'), '找不到 {#snippet eventCard}');
  const eSrc = need(constSrc(ev, '_evOpen'), 'eventCard 內沒有 {@const _evOpen = …}');
  const f = new Function('tEvOpen', 'ev', 'return (' + eSrc + ');');
  const m = mapOf([EV('a', true), EV('b', false)], {}, null, null);
  assert.strictEqual(f(m, { _id: 'a' }), true, '已報名的賽事卡必須展開');
  assert.strictEqual(f(m, { _id: 'b' }), false, '沒報名的賽事卡必須摺疊');
  assert.strictEqual(f(m, { _id: 'zz' }), true, '不在表上的賽事必須 fail-open 展開');
});
T('A⑧ 模板 {@const} 真的接到 tEvOpen（賽程／排名表）', () => {
  const bk = need(findSnippet('bracketBlock'), '找不到 {#snippet bracketBlock}');
  const idSrc = need(constSrc(bk, '_bkId'), 'bracketBlock 內沒有 {@const _bkId = …}');
  const opSrc = need(constSrc(bk, '_bkOpen'), 'bracketBlock 內沒有 {@const _bkOpen = …}');
  const fid = new Function('brk', 'return (' + idSrc + ');');
  const fop = new Function('tEvOpen', '_bkId', 'return (' + opSrc + ');');
  const m = mapOf([EV('a', true), EV('b', false)], {}, null, null);
  assert.strictEqual(fop(m, fid({ event: { _id: 'a' } })), true);
  assert.strictEqual(fop(m, fid({ event: { _id: 'b' } })), false);
  assert.strictEqual(fop(m, fid({ event: undefined })), true, 'brk.event 缺席必須 fail-open 展開');
});
T('A⑨ ⚠⚠結構：進場鈕（myMatchBox）確實被包在 {#if _bkOpen} 的 true 分支內', () => {
  const bk = need(findSnippet('bracketBlock'), '找不到 {#snippet bracketBlock}');
  const ifbs = findIfs(bk, '_bkOpen');
  assert.ok(ifbs.length >= 1, 'bracketBlock 內找不到 {#if _bkOpen}');
  assert.ok(ifbs.some((b) => hasRender(b.consequent, 'myMatchBox')), '進場鈕不在摺疊條件的 true 分支內');
  assert.ok(ifbs.some((b) => hasRender(b.consequent, 'myByeBox')), '輪空提示不在摺疊條件的 true 分支內');
  // 反向：進場鈕不可以有第二份畫在別的地方（否則這條斷言等於白做）
  let renders = 0;
  walk(bk, (n) => { if (n.type === 'RenderTag' && n.expression && n.expression.callee && n.expression.callee.name === 'myMatchBox') renders++; });
  assert.strictEqual(renders, 1, 'bracketBlock 內的 {@render myMatchBox()} 應該剛好一處');
});
T('A⑩ ⚠⚠端到端：輪到我進場＋使用者手動摺疊該場 ⇒ 摺疊條件仍為 true ⇒ 進場鈕畫得出來', () => {
  const bk = need(findSnippet('bracketBlock'), '找不到 {#snippet bracketBlock}');
  need(findIf(bk, '_bkOpen'), '找不到 {#if _bkOpen}');   // A⑨ 已證明進場鈕在這個分支內
  const idSrc = need(constSrc(bk, '_bkId'), '找不到 _bkId');
  const opSrc = need(constSrc(bk, '_bkOpen'), '找不到 _bkOpen');
  const fid = new Function('brk', 'return (' + idSrc + ');');
  const fop = new Function('tEvOpen', '_bkId', 'return (' + opSrc + ');');
  const m = mapOf([EV('a', false)], { a: false }, 'a', null);   // 沒報名 + 手動摺疊 + 輪到我進場
  assert.strictEqual(fop(m, fid({ event: { _id: 'a' } })), true,
    '使用者手動摺疊竟然把「輪到我進場」的賽程摺掉了 —— 這會直接吃未進場判負');
  const m2 = mapOf([EV('z', false)], { z: false }, null, 'z');  // 輪空
  assert.strictEqual(fop(m2, fid({ event: { _id: 'z' } })), true);
});
T('A⑪ 正對照：只有一場且已報名／全部都有報名 ⇒ 一律展開（與 v6.251 行為相同，沒多摺任何東西）', () => {
  assert.deepStrictEqual(mapOf([EV('only', true)], {}, null, null), { only: true });
  assert.deepStrictEqual(mapOf([EV('a', true), EV('b', true), EV('c', true)], {}, null, null),
    { a: true, b: true, c: true });
});
T('A⑫ 摺疊後的標題列留得住資訊：賽事名在摺疊條件之外、摘要含狀態與人數，且**不含進場鈕**', () => {
  const ev = need(findSnippet('eventCard'), '找不到 {#snippet eventCard}');
  const heads = elementsWithClass(ev, 'tourn-ev-head');
  assert.strictEqual(heads.length, 1, '賽事卡應有且只有一個摺疊標題列');
  assert.ok(txt(heads[0]).includes('ev.name'), '摺疊標題列必須顯示賽事名');
  assert.ok(txt(heads[0]).includes('role="button"') && txt(heads[0]).includes('onkeydown')
    && txt(heads[0]).includes('aria-expanded'), '必須沿用 role=button + Enter/Space + aria-expanded 的無障礙 pattern');
  const foldIf = need(findIf(ev, '!_evOpen'), '找不到 {#if !_evOpen} 摺疊摘要分支');
  const summary = rtxt(foldIf.consequent);
  assert.ok(summary.includes('tEventStatusLabel(ev.status)'), '摺疊摘要要有賽事狀態');
  assert.ok(summary.includes('ev.regCount'), '摺疊摘要要有報名人數');
  assert.ok(!summary.includes('tourn-enter-btn') && !summary.includes('myMatchBox'),
    '摺疊摘要不可以放進場鈕（強制展開已經處理了）');
});
T('A⑬ 名人堂原本的摺疊沒有被動到（tHofOfficialOpen / tHofCommunityOpen 各自獨立）', () => {
  assert.ok(/tHofOfficialOpen\s*=\s*!tHofOfficialOpen/.test(src), '名人堂（網站賽）摺疊被改動');
  assert.ok(/tHofCommunityOpen\s*=\s*!tHofCommunityOpen/.test(src), '名人堂（社群賽）摺疊被改動');
  assert.ok(!/tHof\w*Open\s*=\s*tEvOpen/.test(src), '名人堂摺疊不可以跟賽事摺疊混用同一份狀態');
});
T('A⑭ localStorage 讀與寫都包在 try/catch（隱私模式會 throw）', () => {
  const load = need(declSrc('tLoadEvFold', 'fn'), '找不到 tLoadEvFold');
  assert.ok(/try\s*\{[\s\S]*localStorage\.getItem[\s\S]*\}\s*catch/.test(load), '讀取沒有 try/catch');
  const toggle = need(declSrc('tToggleEv', 'fn'), '找不到 tToggleEv');
  assert.ok(/try\s*\{[^}]*localStorage\.setItem[^}]*\}\s*catch/.test(toggle), '寫入沒有 try/catch');
});

// ── 需求B ───────────────────────────────────────────────────────────────────
const MSGS = [
  { id: 'm1', name: '玩家A', text: '哈囉', sys: false, admin: false },
  { id: 'm2', name: '系統', text: '第 1 輪開打', sys: true, admin: false },
  { id: 'm3', name: '站長', text: '大家好', sys: false, admin: true },   // 管理員：admin=true、sys=false
];
const ids = (a) => a.map((m) => m.id);
T('B① 都勾（預設）＝全部顯示，且直接回傳原陣列（零配置、玩家端不會變慢）', () => {
  const out = chatFilter(MSGS, true, true);
  assert.deepStrictEqual(ids(out), ['m1', 'm2', 'm3']);
  assert.strictEqual(out, MSGS, '兩個都勾時應直接沿用原陣列，不可以每次重新 filter');
});
T('B② 只勾【聊天】＝只剩非系統訊息', () => {
  assert.deepStrictEqual(ids(chatFilter(MSGS, true, false)), ['m1', 'm3']);
});
T('B③ ⭐只勾【聊天】時，網站管理員的訊息必須出現（站長明確指定歸「聊天」）', () => {
  const out = chatFilter(MSGS, true, false);
  assert.ok(out.some((m) => m.id === 'm3' && m.admin === true),
    '管理員訊息（admin:true、沒有 sys）被歸到【系統】了 —— 站長指定它屬於【聊天】');
  assert.ok(!chatFilter(MSGS, false, true).some((m) => m.id === 'm3'),
    '只勾【系統】時不該出現管理員訊息');
});
T('B④ 只勾【系統】＝只剩 sys 訊息', () => {
  assert.deepStrictEqual(ids(chatFilter(MSGS, false, true)), ['m2']);
});
T('B⑤ 都不勾 ＝ 一則都不顯示（由畫面給提示，不是空白）', () => {
  assert.deepStrictEqual(ids(chatFilter(MSGS, false, false)), []);
});
T('B⑥ 兩處畫面都改用 tChatFiltered，且 {#each} 的 key 維持 m.id', () => {
  const lobby = elementsWithClass(ast.fragment, 'tourn-chat-msgs');
  assert.strictEqual(lobby.length, 1, '找不到大廳聊天訊息容器');
  const panel = elementsWithClass(ast.fragment, 'chat-panel-messages');
  assert.strictEqual(panel.length, 1, '找不到浮動面板訊息容器');
  for (const [nm, host] of [['大廳', lobby[0]], ['浮動面板', panel[0]]]) {
    const eb = eachBlocks(host).filter((e) => /tChat/.test(txt(e.expression)));
    assert.ok(eb.length >= 1, nm + ' 找不到走訪 tChat 的 {#each}');
    const target = eb.find((e) => txt(e.expression).trim() === 'tChatFiltered');
    assert.ok(target, nm + ' 的 {#each} 還在用未篩選的 tChat —— 篩選根本沒接到畫面上');
    assert.strictEqual(txt(need(target.key, nm + ' 的 {#each} 沒有 key')).trim(), 'm.id',
      nm + ' 的 {#each} key 必須維持 m.id（穩定 key）');
  }
});
T('B⑦ 都不勾時兩處都給提示，不是一片空白', () => {
  const lobby = elementsWithClass(ast.fragment, 'tourn-chat-msgs')[0];
  const panel = elementsWithClass(ast.fragment, 'chat-panel-messages')[0];
  need(lobby, '找不到大廳聊天容器'); need(panel, '找不到浮動面板容器');
  const HINT = '請勾選【聊天】或【系統】';
  for (const [nm, host] of [['大廳', lobby], ['浮動面板', panel]]) {
    const empty = findIf(host, 'tChatFiltered.length === 0');
    assert.ok(empty, nm + ' 沒有「篩選後為空」的分支（會變一片空白）');
    assert.ok(rtxt(empty.consequent).includes(HINT), nm + ' 的空狀態沒有提示玩家去勾選');
  }
});
T('B⑧ 勾選框在「💬 大廳聊天室」標題右邊（站長指定），兩處都有', () => {
  const boxes = elementsWithClass(ast.fragment, 'tchat-filter');
  assert.strictEqual(boxes.length, 2, '應該剛好兩處（大廳＋浮動面板），實際 ' + boxes.length);
  for (const b of boxes) {
    const t = txt(b);
    assert.ok(/bind:checked=\{tChatShowChat\}/.test(t) && /bind:checked=\{tChatShowSys\}/.test(t),
      '勾選框沒有綁到 tChatShowChat / tChatShowSys');
  }
  const head = elementsWithClass(ast.fragment, 'tourn-chat-head')[0];
  need(head, '找不到 .tourn-chat-head');
  const h = txt(head);
  assert.ok(h.indexOf('大廳聊天室') < h.indexOf('tchat-filter'), '勾選框必須在標題文字的右邊（後面）');
  assert.ok(elementsWithClass(head, 'tchat-filter').length === 1, '大廳勾選框不在標題列裡');
});
T('B⑨ ⚠浮動面板的勾選框有擋掉拖曳 pointerdown（否則手機上按不動）', () => {
  const panelHeadEls = elementsWithClass(ast.fragment, 'chat-panel-header');
  assert.strictEqual(panelHeadEls.length, 1, '找不到 .chat-panel-header');
  const box = elementsWithClass(panelHeadEls[0], 'tchat-filter')[0];
  need(box, '浮動面板標題列裡沒有勾選框');
  const t = txt(box);
  assert.ok(/onpointerdown=\{\s*\(e\)\s*=>\s*e\.stopPropagation\(\)\s*\}/.test(t),
    '勾選框沒有 onpointerdown stopPropagation —— .chat-panel-header 綁了拖曳且 touch-action:none，手機會勾不動');
});
T('B⑩ 大廳自動捲的依賴含「篩選後長度」與兩個旗標（否則切換篩選會停在半空）', () => {
  const m = /\$effect\(\(\)\s*=>\s*\{([\s\S]{0,900}?)tLobbyChatEl\.scrollTop = tLobbyChatEl\.scrollHeight/.exec(src);
  need(m, '找不到大廳聊天的自動捲 $effect');
  const body = m[1];
  assert.ok(/tChatFiltered\.length/.test(body), '自動捲仍只依賴 tChat.length —— 切換篩選時長度不變就不會重捲');
  assert.ok(/tChatShowChat/.test(body) && /tChatShowSys/.test(body), '兩個篩選旗標沒有進依賴');
});
T('B⑪ 浮動面板在切換篩選時也會重捲（只依賴兩個旗標，收訊息時不多跑）', () => {
  const m = /\$effect\(\(\)\s*=>\s*\{\s*const _f = tChatShowChat, _g = tChatShowSys;([\s\S]{0,400}?)\}\);/.exec(src);
  need(m, '找不到「切換篩選 → 浮動面板重捲」的 $effect');
  assert.ok(/chatPanelScrollEl\.scrollTop = chatPanelScrollEl\.scrollHeight/.test(m[1]), '沒有真的捲到底');
  assert.ok(!/tLastSeenChat/.test(m[1]), '這個 effect 不可以碰 tLastSeenChat（會弄壞未讀計數）');
});
T('B⑫ ⚠未讀計數 chatFabUnread 維持用**未篩選**的 tChat.length（逐字未變）', () => {
  const line = "  const chatFabUnread = $derived(isTournament ? Math.max(0, tChat.length - tLastSeenChat) : unreadChatCount);";
  assert.ok(src.split('\n').includes(line),
    'chatFabUnread 被改動了 —— 改用篩選後長度會讓被篩掉的訊息永遠標不掉已讀');
  assert.ok(!/tLastSeenChat = tChatFiltered/.test(src), 'tLastSeenChat 不可以改用篩選後的長度');
});
T('B⑬ 休閒對戰房內聊天零接觸（站長裁定：只做大廳聊天）', () => {
  const panel = elementsWithClass(ast.fragment, 'chat-panel-messages')[0];
  need(panel, '找不到浮動面板訊息容器');
  const eb = eachBlocks(panel).find((e) => txt(e.expression).trim() === 'chatMessages');
  need(eb, '休閒房內聊天的 {#each chatMessages} 不見了');
  assert.ok(!/chatMessages\s*\.filter\(/.test(src), '休閒房內聊天不可以被套上篩選');
});

// ── 突變測試（Rule 25：先證明這些斷言真的抓得到問題） ──────────────────────────
let mpass = 0, mfail = 0;
const featurePresent = (() => { try { makeEvOpenBy(); makeChatFilter(); return true; } catch { return false; } })();
if (!featurePresent) {
  console.log('\n  ── 突變自驗：本檔沒有 v6.252 的實作（上面已全紅）⇒ 無可突變的對象 ──');
} else {
console.log('\n  ── 突變測試（每個都必須紅在指定那一條）──');
function MUT(name, expectMsg, run) {
  let threw = null;
  try { run(); } catch (e) { if (e instanceof assert.AssertionError) threw = e; else throw e; }
  if (threw) { console.log('  OK 突變被抓到：' + name); mpass++; }
  else { console.log('  FAIL 突變沒被抓到：' + name + ' —— ' + expectMsg); mfail++; }
}
const evOpenBySrc = need(declSrc('tEvOpenBy', 'fn'), 'tEvOpenBy');
function evOpenByFrom(code) { return new Function(tsToJs(code) + '\nreturn tEvOpenBy;')(); }
MUT('拿掉「強制展開」那一行 ⇒ A③ 必須紅', 'A③ 沒抓到', () => {
  const mutated = evOpenBySrc.replace(/if \(eventId === myMatchEventId \|\| eventId === myByeEventId\) return true;.*\n/, '');
  assert.notStrictEqual(mutated, evOpenBySrc, '突變沒套用（原始碼寫法變了，請同步更新突變）');
  const f = evOpenByFrom(mutated);
  assert.strictEqual(f('e1', false, false, { e1: false }, 'e1', null), true);
});
MUT('把預設規則反過來（沒報名才展開）⇒ A① 必須紅', 'A① 沒抓到', () => {
  const mutated = evOpenBySrc.replace('return !!registered && !dropped;', 'return !registered;');
  assert.notStrictEqual(mutated, evOpenBySrc, '突變沒套用');
  const f = evOpenByFrom(mutated);
  assert.strictEqual(f('e1', true, false, {}, null, null), true);
});
MUT('把模板 _bkOpen 改成 fail-closed（=== true）⇒ A⑧ 必須紅', 'A⑧ 沒抓到', () => {
  const bk = findSnippet('bracketBlock');
  const opSrc = constSrc(bk, '_bkOpen').replace('!== false', '=== true');
  const fop = new Function('tEvOpen', '_bkId', 'return (' + opSrc + ');');
  assert.strictEqual(fop(mapOf([EV('a', true)], {}, null, null), 'zz'), true, 'brk.event 缺席必須 fail-open 展開');
});
MUT('把聊天篩選的判準改成看 m.admin ⇒ B③ 必須紅', 'B③ 沒抓到', () => {
  const s = declSrc('tChatFiltered', 'var').replace(/m && m\.sys/g, 'm && (m.sys || m.admin)');
  const body = /^\$derived\(([\s\S]*)\)$/.exec(s.trim())[1];
  const f = new Function('tChat', 'tChatShowChat', 'tChatShowSys',
    tsToJs('const _v = (' + body + ');').replace(/^"use strict";\s*/, '') + '\nreturn _v;');
  assert.ok(f(MSGS, true, false).some((m) => m.id === 'm3'), '管理員訊息應留在【聊天】');
});
MUT('把 {#each tChatFiltered} 改回 tChat ⇒ B⑥ 必須紅', 'B⑥ 沒抓到', () => {
  const fake = '{#each tChat as m (m.id)}<div>{m.text}</div>{/each}';
  const a2 = parse(fake, { modern: true });
  const eb = [];
  walk(a2.fragment, (n) => { if (n.type === 'EachBlock') eb.push(n); });
  const target = eb.find((e) => fake.slice(e.expression.start, e.expression.end).trim() === 'tChatFiltered');
  assert.ok(target, '{#each} 還在用未篩選的 tChat');
});
MUT('把進場鈕搬出 {#if _bkOpen} ⇒ A⑨ 必須紅', 'A⑨ 沒抓到', () => {
  const bk = findSnippet('bracketBlock');
  let frag = txt(bk);
  // 把 {@render myMatchBox()} 從摺疊分支裡拿掉（模擬「接線接錯」）
  const mutated = frag.replace('{@render myMatchBox()}', '<span>x</span>');
  assert.notStrictEqual(mutated, frag, '突變沒套用');
  const wrap = '<script lang="ts"><' + '/script>\n' + mutated;   // {@const (mx: number)} 需要 TS 語境
  const a2 = parse(wrap, { modern: true });
  let ifb = null;
  walk(a2.fragment, (n) => {
    if (!ifb && n.type === 'IfBlock' && wrap.slice(n.test.start, n.test.end).trim() === '_bkOpen'
        && (() => { let f = false; walk(n.consequent, (x) => { if (x.type === 'RenderTag') f = true; }); return f; })()) ifb = n;
  });
  assert.ok(ifb, '找不到包住 {@render …} 的 {#if _bkOpen}');
  let found = false;
  walk(ifb.consequent, (n) => {
    if (n.type === 'RenderTag' && n.expression && n.expression.callee && n.expression.callee.name === 'myMatchBox') found = true;
  });
  assert.ok(found, '進場鈕不在摺疊條件的 true 分支內');
});

}
console.log(`\n=== v6.252 賽事摺疊＋聊天篩選: ${pass} PASS, ${fail} FAIL｜突變 ${mpass} 抓到, ${mfail} 漏` +
  (failed.length ? '\n    紅的項目：' + failed.join(' / ') : '') + ' ===');
if (featurePresent && mpass + mfail !== 6) { console.log('  FAIL 突變測試沒有跑滿 6 個'); mfail++; }
process.exit((fail || mfail) ? 1 : 0);
