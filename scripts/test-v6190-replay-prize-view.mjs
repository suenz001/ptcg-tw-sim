// ⭐⭐⭐v6.190 守衛：回放才看得到獎賞卡 —— 正式對戰（含觀戰）永遠看不到、也點不到。
//
// ⚠⚠ 這是本站最嚴重的一類 bug（資訊洩漏）的守衛，判準比「有沒有寫某個字串」嚴格得多：
//   獎賞卡在對戰中是蓋著的機密資訊（只有 faceUp 的那幾張才可以看）。而伺服器端的
//   玩家盤面遮蔽（_redactStateForSeat）是**預設關閉的灰度旗標**（v6.150 加、v6.153 改預設關），
//   也就是說「對戰中的 client 手上本來就有對手獎賞的 cardId」
//   ⇒ **client 端這道 isTReplay 閘是唯一防線**，破了就是直接洩漏。
//
// ⚠ 本守衛不是比字串：內建一個 Svelte 區塊樹解析器 + 條件求值器，
//   對「某段 DOM 在某個情境下會不會被渲染」實際求值（含 {:else} 分支的否定）。
//   解析器與剝註解器都先自我驗證（IRON_RULES Rule 25：掃描器自身要先驗）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAME = process.env.V6190_GAME || join(ROOT, 'src/routes/game/+page.svelte');
const MPB  = process.env.V6190_MPB  || join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; } else { fail++; console.log('  ❌', t, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };

// ── 剝註解／剝 script+style（保留字元位移，行號才對得上）＋自我驗證 ────────────
const blankOut = (s, re) => s.replace(re, (m) => m.replace(/[^\n]/g, ' '));
function templateOnly(src) {
  let t = src;
  t = blankOut(t, /<script[\s\S]*?<\/script>/g);
  t = blankOut(t, /<style[\s\S]*?<\/style>/g);
  t = blankOut(t, /<!--[\s\S]*?-->/g);
  return t;
}
{
  const fx = '<script>let a = 1;</script>\nA{#if x}B{/if}\n<!-- {#if y}zz{/if} -->\n<style>.q{color:red}</style>';
  const out = templateOnly(fx);
  chk('自我驗證：剝掉 <script> 內容', !/let a = 1/.test(out), out);
  chk('自我驗證：剝掉 <style> 內容', !/color:red/.test(out), out);
  chk('自我驗證：剝掉 HTML 註解裡的區塊標記', (out.match(/\{#if/g) || []).length === 1, out);
  chk('自我驗證：沒有誤刪正文區塊標記', /\{#if x\}/.test(out) && /\{\/if\}/.test(out), out);
  chk('自我驗證：字元位移完全不變（行號才可信）', out.length === fx.length && out.split('\n').length === fx.split('\n').length, `${out.length}/${fx.length}`);
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
const gameT = templateOnly(gameSrc);
const mpbT  = templateOnly(mpbSrc);
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
    chk('A2 openPrizeView 內有 isTReplay 早退', /isTReplay/.test(body), body.trim().slice(0, 160));
    // 真的把它跑起來：非回放時不可以把 prizeViewOpen 設成 true
    for (const [name, ctx] of Object.entries(SCEN)) {
      const st = { prizeViewOpen: true, isTReplay: ctx.isTReplay };
      // eslint-disable-next-line no-new-func
      const run = new Function('S', `"use strict"; const isTReplay = S.isTReplay; let prizeViewOpen = S.prizeViewOpen;\n(function(){\n${body}\n})();\nS.prizeViewOpen = prizeViewOpen;`);
      run(st);
      if (ctx.isTReplay) chk(`A3 ${name}：openPrizeView 實跑後可開啟`, st.prizeViewOpen === true);
      else chk(`A3 ${name}：openPrizeView 實跑後**強制關閉**（不是只有不開）`, st.prizeViewOpen === false, `prizeViewOpen=${st.prizeViewOpen}`);
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
      if (REPLAY_KEYS.includes(name)) chk(`B2 ${name}：視窗**渲染得出來**`, r === true);
      else chk(`B2 ${name}：視窗**完全不渲染**（DOM 裡根本沒有這段）`, r === false);
    }
    // 視窗裡真的有獎賞卡內容（否則「渲染得出來」等於空殼）
    const body = gameT.slice(modalIdx, node ? node.end : modalIdx + 3000);
    const rawBody = gameSrc.slice(modalIdx, node ? node.end : modalIdx + 3000);
    chk('B3 視窗內容真的在讀「獎賞卡」（prizes）', /\.prizes\b/.test(rawBody), rawBody.slice(0, 120));
    chk('B4 視窗內容真的把卡片畫出來（getCard + <img>）', /getCard\(/.test(rawBody) && /<img\b/.test(rawBody));
    chk('B5 新增的卡圖有掛 use:retryImg（站內統一重試機制）', /use:retryImg=/.test(rawBody));
    chk('B6 視窗同時顯示**雙方**（我方 + 對手）', /myPlayer/.test(rawBody) && /oppPlayer/.test(rawBody));
    chk('B7 卡片可再點開詳情（沿用站內既有 openZoom）', /openZoom\(/.test(rawBody));
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
      if (name === '① 回放中（桌機）') chk(`D2 桌機按鈕 @${h.index} ${name}：出得來`, r === true);
      else if (name === '② 回放中（手機直式）') chk(`D2 桌機按鈕 @${h.index} ${name}：手機版不畫桌機按鈕（手機走自己的 chip）`, r === false);
      else chk(`D2 桌機按鈕 @${h.index} ${name}：**渲染不出來 ⇒ 點不到**`, r === false);
    }
  }
  const mobHits = [...mpbT.matchAll(/onclick=\{onOpenPrizes\}/g)];
  chk('D3 手機直式有獎賞卡檢視的觸發按鈕', mobHits.length >= 1, `${mobHits.length} 個`);
  for (const h of mobHits) {
    for (const [name, ctx] of Object.entries(SCEN)) {
      const r = rendersAt(mpbTree.root, h.index, ctx);
      if (REPLAY_KEYS.includes(name)) chk(`D4 手機按鈕 @${h.index} ${name}：出得來`, r === true);
      else chk(`D4 手機按鈕 @${h.index} ${name}：**渲染不出來 ⇒ 點不到**`, r === false);
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
  const css = (gameSrc.match(/<style[\s\S]*?<\/style>/g) || []).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
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
  const mpbCss = (mpbSrc.match(/<style[\s\S]*?<\/style>/g) || []).join('\n');
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
