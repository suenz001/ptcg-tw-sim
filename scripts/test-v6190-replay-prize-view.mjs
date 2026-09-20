// ⭐⭐⭐v6.190 守衛：獎賞卡的資訊洩漏防線。
//
// ⚠⚠ 這是本站最嚴重的一類 bug（資訊洩漏）的守衛，判準比「有沒有寫某個字串」嚴格得多：
//   獎賞卡在對戰中是蓋著的機密資訊（只有 faceUp 的那幾張才可以看）。而伺服器端的
//   玩家盤面遮蔽（_redactStateForSeat）是**預設關閉的灰度旗標**（v6.150 加、v6.153 改預設關），
//   也就是說「對戰中的 client 手上本來就有對手獎賞的 cardId」
//   ⇒ **client 端的閘是唯一防線**，破了就是直接洩漏。
//
// ⭐⭐⭐v6.418（站長需求，IRON_RULES Rule 40）：對戰中**也要**能點開獎賞檢視
//   —— 因為克雷色利亞｜弦月光芒的卡面明說「（在對戰結束前，那張獎賞卡維持正面朝上。）」
//   ⇒ 雙方本來就該隨時查得到它是哪一張。
//   **意圖完全沒有變**（蓋著的不得洩漏），變的是防線的位置：
//     ・v6.190～v6.417：整個視窗／按鈕用 `isTReplay` 擋掉（粗但有效）
//     ・v6.418 起：視窗與按鈕一律可開，**改由「取 cardId 的那道三元式」擋**
//       —— 非回放時，非 `faceUp` 的獎賞連 `getCard` 都不呼叫。
//   ⇒ 本檔的 A／B／D 段從「不得渲染」改成「渲染得出來」，
//     而真正的防線移到新的 **B8**（`faceUp` 閘）與 **B9**（反安慰劑）。
//
// ⚠ 本守衛不是比字串：內建一個 Svelte 區塊樹解析器 + 條件求值器，
//   對「某段 DOM 在某個情境下會不會被渲染」實際求值（含 {:else} 分支的否定）。
//   解析器與剝註解器都先自我驗證（IRON_RULES Rule 25：掃描器自身要先驗）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { templateOnly as templateOnlyChecked, sectionInner, GAME_INLINE_STYLE } from './lib/strip-markup-sections.mjs';   // v6.319：game 的 {@html '<style>'} 是唯一宣告的殘留字面

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAME = process.env.V6190_GAME || join(ROOT, 'src/routes/game/+page.svelte');
const MPB  = process.env.V6190_MPB  || join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; } else { fail++; console.log('  ❌', t, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };

// ── 剝註解／剝 script+style（保留字元位移，行號才對得上）＋自我驗證 ────────────
//   ⭐ v6.317：改走中央 helper scripts/lib/strip-markup-sections.mjs（v6.318 起是單趟行級狀態機：註解只在模板層認、區段只在行首開／收）。
//   ⚠ v6.318：反對照 mustDrop 原本寫 '.prize-view-modal {'（有空格），原檔是 '.prize-view-modal{' ⇒ 那條反對照恆真；helper 現在會先斷言對照字串在原檔存在。
//   ⚠ 本檔原本的順序是「先區段、最後才剝註解」：註解裡一提到樣式標籤的字面，非貪婪正則就從那段註解
//     一路吃到真正的樣式收尾 ⇒ 模板清空（實測 game 從 184,279 個非空白字元剩 30、MPB 從 22,587 剩 8），
//     後面 B～G 所有「某段 DOM 在某情境會不會渲染」的斷言全變恆真。helper 自帶護欄與已知答案表
//     （scripts/test-lib-strip-markup-sections.mjs）；這裡另外給正對照 mustKeep／mustDrop。
const templateOnly = (src, opt = {}) => templateOnlyChecked(src, { minSections: 1, ...opt });
{
  const fx = '<script>let a = 1;</script>\nA{#if x}B{/if}\n<!-- {#if y}zz{/if} -->\n<style>.q{color:red}</style>';
  const out = templateOnly(fx);
  chk('自我驗證：剝掉 <script> 內容', !/let a = 1/.test(out), out);
  chk('自我驗證：剝掉 <style> 內容', !/color:red/.test(out), out);
  chk('自我驗證：剝掉 HTML 註解裡的區塊標記', (out.match(/\{#if/g) || []).length === 1, out);
  chk('自我驗證：沒有誤刪正文區塊標記', /\{#if x\}/.test(out) && /\{\/if\}/.test(out), out);
  chk('自我驗證：字元位移完全不變（行號才可信）', out.length === fx.length && out.split('\n').length === fx.split('\n').length, `${out.length}/${fx.length}`);
  // ⭐ v6.317 事故形狀：註解在真樣式之前、而且提到樣式標籤的字面 ⇒ 模板必須一個字都不少
  const fx2 = '<script>let a = 1;</script>\n<!-- 提到 <' + 'style> 字面 -->\n<div>{#if x}BIG{/if}</div>\n<style>.q{color:red}</style>';
  const out2 = templateOnly(fx2);
  chk('自我驗證：註解提到樣式標籤字面時，模板不會被吃掉（v6.317）', /\{#if x\}BIG\{\/if\}/.test(out2) && !/color:red/.test(out2), out2);
}

// ── 讀到 `{#if ` 之後的平衡大括號，取出條件字串 ──────────────────────────────
function readExpr(t, from) {
  let depth = 1, i = from;
  while (i < t.length) {
    const c = t[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { expr: t.slice(from, i).trim(), end: i }; }
    i++;
  }
  return null;
}

// ── Svelte 區塊樹（只認 template；{:else if} 的否定語意有處理） ────────────────
const OPEN = /\{#(if|each|key|await|snippet)\b/g;
function parseBlocks(t) {
  const tags = [];
  const re = /\{#(if|each|key|await|snippet)\b|\{:(else if|else|then|catch)\b|\{\/(if|each|key|await|snippet)\}/g;
  let m;
  while ((m = re.exec(t))) {
    if (m[1]) {
      const r = readExpr(t, m.index + m[0].length);
      tags.push({ kind: 'open', tag: m[1], expr: r ? r.expr : '', idx: m.index, end: r ? r.end : m.index });
    } else if (m[2]) {
      const r = m[2] === 'else if' ? readExpr(t, m.index + m[0].length) : null;
      tags.push({ kind: 'branch', branch: m[2], expr: r ? r.expr : '', idx: m.index });
    } else {
      tags.push({ kind: 'close', tag: m[3], idx: m.index });
    }
  }
  // 建樹
  const root = { tag: 'root', children: [], start: 0, end: t.length, branches: [] };
  const stack = [root];
  const errs = [];
  for (const tg of tags) {
    const top = stack[stack.length - 1];
    if (tg.kind === 'open') {
      const node = { tag: tg.tag, expr: tg.expr, start: tg.idx, branches: [{ kind: 'primary', expr: tg.expr, start: tg.end }], children: [], parent: top };
      top.children.push(node); stack.push(node);
    } else if (tg.kind === 'branch') {
      if (top === root) { errs.push(`branch ${tg.branch} @${tg.idx} 無所屬區塊`); continue; }
      top.branches[top.branches.length - 1].end = tg.idx;
      top.branches.push({ kind: tg.branch, expr: tg.expr, start: tg.idx });
    } else {
      if (top === root) { errs.push(`close ${tg.tag} @${tg.idx} 無所屬區塊`); continue; }
      if (top.tag !== tg.tag) errs.push(`close ${tg.tag} @${tg.idx} 與 open ${top.tag} 不符`);
      top.branches[top.branches.length - 1].end = tg.idx;
      top.end = tg.idx;
      stack.pop();
    }
  }
  if (stack.length !== 1) errs.push(`收尾殘留 ${stack.length - 1} 個未關閉區塊`);
  return { root, errs };
}
// 求值：某個位置在給定情境下會不會被渲染
const UNKNOWN_IDS = new Set();
function evalExpr(expr, ctx, label) {
  const extra = {};
  for (let round = 0; round < 40; round++) {
    const bag = { ...ctx, ...extra };
    const keys = Object.keys(bag);
    try {
      // eslint-disable-next-line no-new-func
      const f = new Function(...keys, `"use strict"; return (${expr});`);
      return !!f(...keys.map(k => bag[k]));
    } catch (e) {
      // 這個掃描器只認識自己關心的變數；其餘一律當 undefined（＝falsy），
      // 並記錄下來。⚠ 這個方向對「不可以渲染」的斷言是安全的（更容易 false），
      // 對「必須渲染得出來」的斷言則會直接紅燈，不會被靜默放過。
      const mm = /(\w+) is not defined/.exec(e.message || '');
      if (mm) { UNKNOWN_IDS.add(mm[1]); extra[mm[1]] = undefined; continue; }
      throw new Error(`求值失敗（${label}）：${expr} → ${e.message}`);
    }
  }
  throw new Error(`求值放棄（${label}）：${expr}`);
}
function pathTo(node, idx, acc = []) {
  for (const c of node.children) {
    if (idx > c.start && idx < c.end) { acc.push(c); return pathTo(c, idx, acc); }
  }
  return acc;
}
function rendersAt(root, idx, ctx) {
  for (const node of pathTo(root, idx)) {
    if (node.tag !== 'if') continue;
    let bi = node.branches.findIndex(b => idx > b.start && idx < (b.end ?? node.end));
    if (bi < 0) continue;
    const seen = [];
    for (let k = 0; k < bi; k++) if (node.branches[k].kind !== 'else') seen.push(node.branches[k].expr);
    const b = node.branches[bi];
    const prevFalse = seen.every(e => !evalExpr(e, ctx, 'prev-branch'));
    if (!prevFalse) return false;
    if (b.kind !== 'else' && !evalExpr(b.expr, ctx, 'branch')) return false;
  }
  return true;
}
// ── 解析器自我驗證 ────────────────────────────────────────────────────────
{
  const fx = 'X{#if a}P{:else if b}Q{:else}R{/if}Y{#each z as w}{#if c}S{/if}{/each}';
  const { root, errs } = parseBlocks(fx);
  chk('自我驗證：解析器把 fixture 解乾淨（無錯誤）', errs.length === 0, errs.join('; '));
  const at = (ch) => fx.indexOf(ch);
  chk('自我驗證：{#if a} 主分支求值', rendersAt(root, at('P'), { a: 1, b: 0, c: 1 }) === true && rendersAt(root, at('P'), { a: 0, b: 1, c: 1 }) === false);
  chk('自我驗證：{:else if b} 帶前分支否定', rendersAt(root, at('Q'), { a: 0, b: 1, c: 1 }) === true && rendersAt(root, at('Q'), { a: 1, b: 1, c: 1 }) === false);
  chk('自我驗證：{:else} 是所有條件的否定', rendersAt(root, at('R'), { a: 0, b: 0, c: 1 }) === true && rendersAt(root, at('R'), { a: 0, b: 1, c: 1 }) === false);
  chk('自我驗證：巢狀 each 內的 if 也算', rendersAt(root, at('S'), { a: 1, b: 1, c: 0 }) === false && rendersAt(root, at('S'), { a: 1, b: 1, c: 1 }) === true);
  chk('自我驗證：區塊外的位置一律渲染', rendersAt(root, at('Y'), { a: 0, b: 0, c: 0 }) === true);
  chk('自我驗證：未知識別字一律當 undefined（falsy），不會讓掃描器炸掉', evalExpr('zzUnknownVar && 1', {}, 'self') === false);
  chk('自我驗證：求值器真的在算而不是永遠回 false', evalExpr("a === 1 && b !== 'x'", { a: 1, b: 'y' }, 'self') === true);
}

// ── 情境表（⚠ 每個情境都是真的會發生的狀態組合） ──────────────────────────
const base = { game: { phase: 'playing' }, onOpenPrizes: () => {}, isPortraitMobile: false, _pz: { faceUp: false }, isTournament: false, tStep: 'lobby' };
const SCEN = {
  '① 回放中（桌機）':        { ...base, isTReplay: true,  isTournSpectator: true,  isSpectator: true,  prizeViewOpen: true, isPortraitMobile: false, isTournament: true, tStep: 'playing' },
  '② 回放中（手機直式）':    { ...base, isTReplay: true,  isTournSpectator: true,  isSpectator: true,  prizeViewOpen: true, isPortraitMobile: true,  isTournament: true, tStep: 'playing' },
  '③ 正式對戰：輪到自己':    { ...base, isTReplay: false, isTournSpectator: false, isSpectator: false, prizeViewOpen: true },
  '④ 正式對戰：輪到對手':    { ...base, isTReplay: false, isTournSpectator: false, isSpectator: false, prizeViewOpen: true, game: { phase: 'playing', activePlayerIndex: 1 } },
  '⑤ 錦標賽觀戰中':          { ...base, isTReplay: false, isTournSpectator: true,  isSpectator: true,  prizeViewOpen: true, isTournament: true, tStep: 'playing' },
  '⑥ 錦標賽觀戰中（手機）':  { ...base, isTReplay: false, isTournSpectator: true,  isSpectator: true,  prizeViewOpen: true, isPortraitMobile: true, isTournament: true, tStep: 'playing' },
  '⑦ 對戰結束但未進回放':    { ...base, isTReplay: false, isTournSpectator: false, isSpectator: false, prizeViewOpen: true, game: { phase: 'game-over' } },
  '⑧ setup 開局階段':        { ...base, isTReplay: false, isTournSpectator: false, isSpectator: false, prizeViewOpen: true, game: { phase: 'setup' } },
  '⑨ 錦標賽對戰中（自己在打）': { ...base, isTReplay: false, isTournSpectator: false, isSpectator: false, prizeViewOpen: true, isTournament: true, tStep: 'playing' },
  '⑩ 錦標賽對戰中（手機直式）': { ...base, isTReplay: false, isTournSpectator: false, isSpectator: false, prizeViewOpen: true, isTournament: true, tStep: 'playing', isPortraitMobile: true },
};
const REPLAY_KEYS = ['① 回放中（桌機）', '② 回放中（手機直式）'];
const BATTLE_KEYS = Object.keys(SCEN).filter(k => !REPLAY_KEYS.includes(k));

const gameSrc = readFileSync(GAME, 'utf8');
const mpbSrc  = readFileSync(MPB, 'utf8');
// 正對照：模板錨點必須還在、腳本／樣式錨點必須不見（helper 內建斷言，抓到就直接炸 —— 這時後面的結論全不可信）
const gameT = templateOnly(gameSrc, { label: 'game', mustKeep: ['prizeViewOpen'], mustDrop: ['function openPrizeView', '.prize-view-modal{'], allowResidual: [GAME_INLINE_STYLE] });
const mpbT  = templateOnly(mpbSrc, { label: 'mpb', mustKeep: ['mp-clickable'], mustDrop: ['.mp-chip {'] });
const gameTree = parseBlocks(gameT);
const mpbTree  = parseBlocks(mpbT);
chk('桌機檔區塊解析無誤（解析錯就代表下面所有結論不可信）', gameTree.errs.length === 0, gameTree.errs.slice(0, 3).join('; '));
chk('手機檔區塊解析無誤', mpbTree.errs.length === 0, mpbTree.errs.slice(0, 3).join('; '));

// ═══ A. 中央開啟述詞 openPrizeView 的行為端求值 ═══════════════════════════
{
  const m = gameSrc.match(/function openPrizeView\(\)\s*\{([\s\S]*?)\n  \}/);
  chk('A1 桌機檔有中央開啟述詞 openPrizeView()', !!m);
  if (m) {
    const body = m[1].replace(/\/\/[^\n]*/g, '');
    // ⭐v6.418：不再要求「isTReplay 早退」——改成要求有 `prizeViewMode` 這個模式旗標，
    //   而且它必須是從 `isTReplay` 推出來的（'replay' ＝攤開；其餘一律 'battle' ＝只看 faceUp）。
    const modeM = gameSrc.match(/let prizeViewMode = \$derived\(([^\n]*)\);/);
    chk('A2 有 prizeViewMode 模式旗標，且由 isTReplay 推導', !!modeM && /isTReplay/.test(modeM[1]),
      modeM ? modeM[1].slice(0, 120) : '(找不到 prizeViewMode)');
    // 真的把它跑起來：回放 ⇒ 'replay'；其餘每一種情境都必須是 'battle'
    if (modeM) {
      for (const [name, ctx] of Object.entries(SCEN)) {
        // eslint-disable-next-line no-new-func
        const mode = new Function('S', `"use strict"; const isTReplay = S.isTReplay; return (${modeM[1]});`)({ isTReplay: ctx.isTReplay });
        if (ctx.isTReplay) chk(`A3 ${name}：prizeViewMode === 'replay'（攤開全部）`, mode === 'replay', String(mode));
        else chk(`A3 ${name}：prizeViewMode === 'battle'（只看得到翻正面的）`, mode === 'battle', String(mode));
      }
    }
    // ⭐ 一併釘住：openPrizeView 本身一律可開（v6.418 起不再早退）
    for (const [name, ctx] of Object.entries(SCEN)) {
      const st = { prizeViewOpen: false, isTReplay: ctx.isTReplay };
      // eslint-disable-next-line no-new-func
      const run = new Function('S', `"use strict"; const isTReplay = S.isTReplay; let prizeViewOpen = S.prizeViewOpen;\n(function(){\n${body}\n})();\nS.prizeViewOpen = prizeViewOpen;`);
      run(st);
      chk(`A3b ${name}：openPrizeView 實跑後可開啟（內容由 faceUp 閘把關，見 B8）`, st.prizeViewOpen === true, `prizeViewOpen=${st.prizeViewOpen}`);
    }
  }
}

// ═══ B. 視窗本體：渲染閘的行為端求值 ═════════════════════════════════════
let modalIdx = -1, modalNode = null;
{
  const re = /\{#if\s+([^}]*prizeViewOpen[^}]*)\}/g;
  const hits = [...gameT.matchAll(re)];
  chk('B1 桌機檔有且只有一個「獎賞卡檢視視窗」的渲染閘', hits.length === 1, `找到 ${hits.length} 個`);
  if (hits.length === 1) {
    modalIdx = hits[0].index;
    const node = pathTo(gameTree.root, modalIdx + 5).pop();
    modalNode = node;
    const inner = modalIdx + hits[0][0].length + 5;
    for (const [name, ctx] of Object.entries(SCEN)) {
      const r = rendersAt(gameTree.root, inner, ctx);
      // ⭐v6.418：所有情境都渲染得出來（防線移到 B5 的 faceUp 閘）
      chk(`B2 ${name}：視窗渲染得出來（內容由 faceUp 閘把關，見 B8）`, r === true);
    }
    // 視窗裡真的有獎賞卡內容（否則「渲染得出來」等於空殼）
    const body = gameT.slice(modalIdx, node ? node.end : modalIdx + 3000);
    const rawBody = gameSrc.slice(modalIdx, node ? node.end : modalIdx + 3000);
    chk('B3 視窗內容真的在讀「獎賞卡」（prizes）', /\.prizes\b/.test(rawBody), rawBody.slice(0, 120));
    chk('B4 視窗內容真的把卡片畫出來（getCard + <img>）', /getCard\(/.test(rawBody) && /<img\b/.test(rawBody));
    chk('B5 新增的卡圖有掛 use:retryImg（站內統一重試機制）', /use:retryImg=/.test(rawBody));
    chk('B6 視窗同時顯示**雙方**（我方 + 對手）', /myPlayer/.test(rawBody) && /oppPlayer/.test(rawBody));
    chk('B7 卡片可再點開詳情（沿用站內既有 openZoom）', /openZoom\(/.test(rawBody));

    // ═══ ⭐⭐⭐ B8：v6.418 起**唯一的公平性防線** ═══════════════════════════
    //   對戰中（prizeViewMode !== 'replay'）非 faceUp 的獎賞，連 getCard 都不可以呼叫。
    //   ⚠ 判準只寫**一份**（prizeGateProbe），B8（正式斷言）與 B9（反安慰劑）共用同一個函式
    //     —— IRON_RULES Rule 38 / 安慰劑型態 11：判準抄成兩份，突變只改得到其中一份。
    //   ⚠ 不是比字串：真的把那道三元式跑起來，並**數 getCard 被呼叫幾次**。
    const prizeGateProbe = (tpl) => {
      const m = tpl.match(/\{@const\s+_pvcard\s*=\s*([^{}\n]*)\}/);
      if (!m || !m[1].trim()) return { found: false };
      const expr = m[1].trim();
      const run = (mode, faceUp) => {
        let calls = 0;
        // eslint-disable-next-line no-new-func
        const f = new Function('prizeViewMode', '_pvc', 'getCard',
          `"use strict"; return (${expr});`);
        const ret = f(mode, { faceUp, cardId: 'SECRET' },
          (id) => { calls++; return { id, imageUrl: 'u', name: 'n' }; });
        return { ret, calls };
      };
      const shut  = run('battle', false);   // 對戰中＋蓋著   ⇒ 必須什麼都查不到
      const up    = run('battle', true);    // 對戰中＋已翻正面 ⇒ 必須看得到（弦月光芒）
      const rep   = run('replay', false);   // 回放           ⇒ 全部攤開
      return {
        found: true, expr,
        leaks: !(shut.ret == null && shut.calls === 0),   // 洩漏＝有回傳值 或 查了卡
        shows: !!up.ret && up.calls === 1,
        replay: !!rep.ret && rep.calls === 1,
      };
    };
    const gate = prizeGateProbe(body);
    // ⚠ 找不到那道三元式一律當 FAIL（不是空真）——掃描器漏掉與「真的乾淨」長得一樣（型態 4）
    chk('B8a 視窗內取卡的三元式找得到（找不到＝掃描器過期或寫法被改掉）', gate.found === true, JSON.stringify(gate));
    if (gate.found) {
      chk('B8b ⭐ 對戰中、蓋著的獎賞：連 getCard 都不呼叫（唯一防線）', gate.leaks === false, gate.expr);
      chk('B8c 對戰中、已翻正面的獎賞：看得到（弦月光芒的卡面要求）', gate.shows === true, gate.expr);
      chk('B8d 回放：全部攤開（v6.190 既有行為零回歸）', gate.replay === true, gate.expr);
    }
    // ⭐ B9 反安慰劑：餵一個「拿掉 faceUp 閘」的樣本，B8b 的判準必須抓得到；
    //   同時餵一個正確樣本，確認判準不是恆真（兩邊都走同一個 prizeGateProbe）。
    {
      const MUT  = '{#each x as _pvc (_pvc.iid)}{@const _pvcard = getCard(_pvc.cardId)}';
      const GOOD = "{@const _pvcard = (prizeViewMode === 'replay' || _pvc.faceUp) ? getCard(_pvc.cardId) : null}";
      const mut = prizeGateProbe(MUT), good = prizeGateProbe(GOOD);
      chk('B9a 反安慰劑：拿掉 faceUp 閘的樣本會被判成洩漏', mut.found === true && mut.leaks === true, JSON.stringify(mut));
      chk('B9b 正對照：正確寫法不會被誤判成洩漏', good.found === true && good.leaks === false && good.shows === true && good.replay === true, JSON.stringify(good));
    }
    // ═══ ⭐⭐⭐ B8e：防線的**邊界** —— 三元式以外的地方一律不准碰 cardId ═════════
    //   ⚠⚠ 為什麼一定要有這一條（審查者實測抓到的洞，已自行查證屬實）：
    //   v6.417 以前的防線是「整段 DOM 在對戰中根本不存在」——粗，但**全面**。
    //   v6.418 改成「只有取 cardId 的那道三元式擋」之後，**視窗裡其餘任何節點**
    //   只要自己去讀 `_pvc.cardId`，就是實洩漏，而 B8 只求值那一行、抓不到。
    //   實測：把 `{:else}` 卡背格的 title 改成 `getCard(_pvc.cardId)?.name`
    //   ⇒ B8 全綠（175 PASS / 0 FAIL）＝ 那一整塊是無人看守區。
    //   ⇒ 這裡把「邊界」也守起來：each 區塊內，除了三元式本身與
    //     `{#if _pvcard}` … `{:else}` 的 then 段（那裡拿到的是已通過閘的 `_pvcard`），
    //     一律不得出現 `_pvc.cardId` / `getCard(` / `openZoom(` / `imageUrl`。
    //   ⚠ 判準只寫一份（prizeEachLeaks），B8e（正式）與 B9c（反安慰劑）共用。
    const LEAK_TOKENS = ['_pvc.cardId', 'getCard(', 'openZoom(', 'imageUrl'];
    const prizeEachLeaks = (tpl) => {
      const i = tpl.indexOf('{#each dedupeByIid(');
      if (i < 0) return { found: false, leaks: [] };
      const j = tpl.indexOf('{/each}', i);
      if (j < 0) return { found: false, leaks: [] };
      let seg = tpl.slice(i, j);
      // ① 拿掉三元式本身（它是被守的那一行，由 B8 求值）
      seg = seg.replace(/\{@const\s+_pvcard\s*=\s*[^{}\n]*\}/, '');
      // ② 拿掉 then 段（`{#if _pvcard}` … `{:else}`）——那裡用的是已通過閘的 _pvcard
      const a = seg.indexOf('{#if _pvcard}');
      const b = seg.indexOf('{:else}', a);
      if (a >= 0 && b > a) seg = seg.slice(0, a) + seg.slice(b);
      return { found: true, leaks: LEAK_TOKENS.filter((t) => seg.includes(t)), rest: seg };
    };
    {
      const g = prizeEachLeaks(body);
      chk('B8e0 獎賞 each 區塊抓得到（抓不到＝掃描器過期）', g.found === true, JSON.stringify(g).slice(0, 200));
      chk('B8e ⭐⭐⭐ 三元式與 then 段以外，一律不得碰 cardId／getCard／openZoom／imageUrl',
        g.found && g.leaks.length === 0, '洩漏：' + g.leaks.join('、') + ' @ ' + String(g.rest || '').slice(0, 200));
    }
    // ⭐ B9c 反安慰劑：餵「卡背格的 title 改讀 getCard(_pvc.cardId)」的樣本（審查者實測會存活的那個突變）
    {
      const MUT = '{#each dedupeByIid(_pvp?.prizes) as _pvc (_pvc.iid)}{@const _pvcard = (prizeViewMode === \'replay\' || _pvc.faceUp) ? getCard(_pvc.cardId) : null}\n'
        + '{#if _pvcard}<button onclick={() => openZoom(_pvc.cardId, _pvc)}><img src={_pvcard.imageUrl}/></button>\n'
        + '{:else}<div title={getCard(_pvc.cardId)?.name}>蓋著</div>{/if}\n{/each}';
      const GOOD = MUT.replace('title={getCard(_pvc.cardId)?.name}', 'title="蓋著的獎賞卡"');
      const m = prizeEachLeaks(MUT), gd = prizeEachLeaks(GOOD);
      chk('B9c 反安慰劑：卡背格偷讀 getCard(_pvc.cardId) 會被 B8e 抓到', m.found === true && m.leaks.length > 0, JSON.stringify(m.leaks));
      chk('B9d 正對照：正確寫法不會被 B8e 誤判', gd.found === true && gd.leaks.length === 0, JSON.stringify(gd.leaks));
    }
    // ⭐ B10：閘擋掉之後必須畫得出「蓋著」的替代 DOM（否則玩家看到一片空白）
    chk('B10 蓋著的獎賞有替代顯示（卡背，不是空白）',
      /\{:else\}/.test(body) && /prize-view-back/.test(rawBody), rawBody.slice(-200));
    void body;
  }
}

// ═══ C. ⚠⚠ 視窗必須在**所有版面分支之外**（v6.167 教訓） ═════════════════
{
  const mobHits = [...gameT.matchAll(/\{#if\s+isPortraitMobile[^}]*\}/g)];
  chk('C1 找得到手機直式／桌機的版面分支', mobHits.length === 1, `找到 ${mobHits.length} 個`);
  if (mobHits.length === 1 && modalIdx >= 0) {
    const mobNode = pathTo(gameTree.root, mobHits[0].index + 5).pop();
    chk('C2 版面分支的區塊範圍抓得到', !!mobNode && mobNode.end > mobNode.start);
    if (mobNode) {
      const inside = modalIdx > mobNode.start && modalIdx < mobNode.end;
      chk('C3 ⚠ 視窗**不在**手機/桌機版面分支之內', inside === false,
        `modal@${modalIdx} branch=[${mobNode.start},${mobNode.end}]`);
    }
    // 行為端：isPortraitMobile 兩種值都要渲染得出來
    if (modalNode) {
      const inner = modalIdx + 60;
      chk('C4 手機直式（isPortraitMobile=true）開得出視窗', rendersAt(gameTree.root, inner, SCEN['② 回放中（手機直式）']) === true);
      chk('C5 桌機（isPortraitMobile=false）也開得出同一個視窗', rendersAt(gameTree.root, inner, SCEN['① 回放中（桌機）']) === true);
    }
  }
  // 視窗也不可以被關進任何 battleLayout（classic/tabletop/fable）分支
  if (modalIdx >= 0) {
    const encl = pathTo(gameTree.root, modalIdx + 5).slice(0, -1);
    chk('C6 視窗不在任何 battleLayout（classic/tabletop/fable）分支內',
      !encl.some(n => /battleLayout/.test(n.expr || '')), encl.map(n => (n.expr || '').slice(0, 40)).join(' | '));
  }
}

// ═══ D. 觸發點：桌機 + 手機，兩邊都只在回放時點得到 ═══════════════════════
{
  const deskHits = [...gameT.matchAll(/onclick=\{openPrizeView\}/g)];
  chk('D1 桌機有獎賞卡檢視的觸發按鈕', deskHits.length >= 1, `${deskHits.length} 個`);
  for (const h of deskHits) {
    for (const [name, ctx] of Object.entries(SCEN)) {
      const r = rendersAt(gameTree.root, h.index, ctx);
      // 桌機按鈕畫在桌機分支（{:else} of isPortraitMobile）⇒ 只在「回放中（桌機）」該出現。
      // ⭐v6.418：桌機按鈕在**所有桌機情境**都出得來（手機直式仍走自己的 chip）
      if (ctx.isPortraitMobile) chk(`D2 桌機按鈕 @${h.index} ${name}：手機版不畫桌機按鈕（手機走自己的 chip）`, r === false);
      else chk(`D2 桌機按鈕 @${h.index} ${name}：出得來`, r === true);
    }
  }
  const mobHits = [...mpbT.matchAll(/onclick=\{onOpenPrizes\}/g)];
  chk('D3 手機直式有獎賞卡檢視的觸發按鈕', mobHits.length >= 1, `${mobHits.length} 個`);
  for (const h of mobHits) {
    for (const [name, ctx] of Object.entries(SCEN)) {
      const r = rendersAt(mpbTree.root, h.index, ctx);
      // ⭐v6.418：手機 chip 也改成一律可點（內容一樣由 B8 的 faceUp 閘把關）
      void name;
      chk(`D4 手機按鈕 @${h.index} ${name}：出得來`, r === true);
    }
  }
}

// ═══ E. ⚠ 手機是子元件：prop 沒傳＝靜默失效 ═════════════════════════════
{
  chk('E1 手機元件的 Props 介面宣告了 onOpenPrizes', /onOpenPrizes\?\:\s*\(\)\s*=>\s*void/.test(mpbSrc));
  const destructure = mpbSrc.match(/\}:\s*Props\s*=\s*\$props\(\)/) ? mpbSrc.slice(0, mpbSrc.indexOf('}: Props = $props()')) : '';
  chk('E2 手機元件真的把 onOpenPrizes 解構出來（沒解構＝永遠 undefined）', /\bonOpenPrizes\b\s*[,\n]/.test(destructure.slice(-2000)), destructure.slice(-260));
  const tag = gameSrc.match(/<MobilePortraitBattle[\s\S]*?\/>/);
  chk('E3 父層有渲染 MobilePortraitBattle', !!tag);
  chk('E4 ⚠ 父層真的把 onOpenPrizes 傳進手機元件（不傳＝按鈕根本不出現）',
    !!tag && /onOpenPrizes=\{openPrizeView\}/.test(tag[0]), tag ? tag[0].slice(0, 200) : '');
}

// ═══ F. 手機子元件自己不可以另外畫獎賞卡內容（只准顯示張數） ═══════════════
{
  const bad = [...mpbSrc.matchAll(/\.prizes\b(?!\.length)/g)].map(m => mpbSrc.slice(Math.max(0, m.index - 60), m.index + 30));
  chk('F1 手機子元件只讀 prizes.length（不自己解卡片內容）', bad.length === 0, bad.slice(0, 2).join(' ||| '));
}

// ═══ G. 既有洩漏面回歸：桌機獎賞縮圖翻正面仍受 isTReplay 閘 ═══════════════
{
  // ⚠ 先剝掉註解再掃：本版的說明註解裡就有這個條件的字面，不剝會多算（掃描器自己要先乾淨）
  const gameNoComment = gameSrc.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const faceHits = [...gameNoComment.matchAll(/\(\s*(!!)?_pz\.faceUp\s*\|\|\s*isTReplay\s*\)/g)];
  // 對手側 + 我方側各 2 處（一處決定要不要查卡、一處決定 prize-faceup 樣式）
  chk('G1 桌機獎賞縮圖的翻面條件仍是「faceUp 或 回放」', faceHits.length === 4, `${faceHits.length} 處`);
  for (const h of faceHits) {
    for (const [name, ctx] of Object.entries(SCEN)) {
      const v = evalExpr(h[0], { ...ctx, _pz: { faceUp: false } }, 'faceup');
      if (REPLAY_KEYS.includes(name)) chk(`G2 ${name}：蓋著的獎賞在回放會翻正面`, v === true);
      else chk(`G2 ${name}：蓋著的獎賞**不翻正面**`, v === false);
    }
    const up = evalExpr(h[0], { ...SCEN['③ 正式對戰：輪到自己'], _pz: { faceUp: true } }, 'faceup');
    chk('G3 對戰中「卡效果翻開過」的獎賞仍看得到（沒有把既有規則改壞）', up === true);
  }
}

// ═══ H. 沒有用 @media 當手機開關；安全區走單一來源 ══════════════════════
{
  // ⭐ v6.317：走 helper（先剝 HTML 註解、開頭標籤限行首）⇒ 模板裡 {@html '…'} 字串字面內的樣式標籤不再被算進 CSS
  const css = sectionInner(gameSrc, 'style', { label: 'game css', minSections: 1, mustKeep: ['.prize-view-modal'], allowResidual: [GAME_INLINE_STYLE] }).replace(/\/\*[\s\S]*?\*\//g, '');
  const NEW_SEL = ['.prize-view-modal', '.prize-view-btn', '.prize-view-side'];
  // 找出所有 @media 區塊的字元範圍
  const mediaRanges = [];
  const mre = /@media[^{]*\{/g; let mm;
  while ((mm = mre.exec(css))) {
    let d = 1, i = mre.lastIndex;
    while (i < css.length && d > 0) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++; }
    mediaRanges.push([mm.index, i]);
  }
  for (const sel of NEW_SEL) {
    const occ = [...css.matchAll(new RegExp(sel.replace('.', '\\.') + '\\b', 'g'))].map(x => x.index);
    chk(`H1 ${sel} 有實際樣式`, occ.length >= 1);
    chk(`H2 ${sel} 完全不出現在任何 @media 內（禁用 @media 當手機開關）`,
      occ.every(i => !mediaRanges.some(([a, b]) => i > a && i < b)));
  }
  const rule = css.match(/\.prize-view-modal\s*\{[\s\S]*?\}/);
  chk('H3 視窗的安全區讀單一來源 --safe-top / --safe-bottom（v6.187）',
    !!rule && /var\(--safe-bottom/.test(rule[0]) && /var\(--safe-top/.test(rule[0]), rule ? rule[0].slice(0, 200) : '');
  chk('H4 視窗沒有自己寫死 env(safe-area-inset-*)（那就不是單一來源了）',
    !!rule && !/env\(\s*safe-area-inset/.test(rule[0]));
  const mpbCss = sectionInner(mpbSrc, 'style', { label: 'mpb css', minSections: 1, mustKeep: ['mp-clickable'] });
  chk('H5 手機端沿用既有 .mp-chip / .mp-clickable 樣式，沒有為此新增 @media',
    /mp-clickable/.test(mpbSrc) && !/@media[^{]*\{[^}]*prize-view/.test(mpbCss));
}

if (UNKNOWN_IDS.size) console.log('  （掃描器未建模的識別字，一律當 undefined 處理）:', [...UNKNOWN_IDS].join(', '));
// ═══ I. 回放進入點：旗標打開前先清盤面 + 歸零視窗（Fable 5 審查） ══════════
{
  const fn = gameSrc.match(/async function tStartReplay\(matchId: string\)[\s\S]*?\n  \}/);
  chk('I1 找得到 tStartReplay()', !!fn);
  if (fn) {
    const body = fn[0].replace(/\/\/[^\n]*/g, '');
    const iFlag = body.indexOf('isTReplay = true');
    const iGame = body.indexOf('game = null');
    const iOpen = body.indexOf('prizeViewOpen = false');
    chk('I2 tStartReplay 內有把 isTReplay 打開', iFlag >= 0);
    chk('I3 ⚠ 開回放旗標**之前**先把上一份盤面清掉（否則 await 期間會把現役盤面的獎賞翻正面）',
      iGame >= 0 && iGame < iFlag, `game@${iGame} flag@${iFlag}`);
    chk('I4 進入點歸零獎賞卡視窗（離開回放有多條路徑，進入點才是單一來源）',
      iOpen >= 0 && iOpen < iFlag, `open@${iOpen} flag@${iFlag}`);
    // 沒有第二個地方把 isTReplay 設成 true
    const allTrue = [...gameSrc.matchAll(/isTReplay\s*=\s*true/g)];
    chk('I5 全檔只有一個地方把 isTReplay 設成 true（回放判定沒有第二條路）', allTrue.length === 1, `${allTrue.length} 處`);
    // 觀戰的進入點不可以碰 isTReplay=true
    const spec = gameSrc.match(/async function tSpectate\(roomId: string\)[\s\S]*?\n  \}/);
    chk('I6 找得到 tSpectate()', !!spec);
    chk('I7 ⚠⚠ 觀戰進入點**不會**把 isTReplay 打開（回放與觀戰是兩個獨立旗標）',
      !!spec && !/isTReplay\s*=\s*true/.test(spec[0]));
  }
}

console.log(`v6.190 回放獎賞卡檢視守衛：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
