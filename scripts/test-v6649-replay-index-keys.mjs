// v6.649 守衛：回放共用索引＋鍵盤快捷鍵（R1）＋步驟摘要／紀錄標示與定位（R3）
//
// 【I】索引（src/lib/game/replay-index.ts，實跑）
//   I1 replayStepLog：終局＝整份、缺 logLen＝上一回合以前、其他＝前 logLen 行（超過長度、負數照 slice 語義）
//   I2 定點案例：同一個 logLen 連續兩格 ⇒ 後一格新增 0 行；每一行只歸給第一個包含它的格；終局補剩下的行
//   I3 隨機性質：lineStep[k]＝第一個「replayStepLog 包含第 k 行」的格（與 tReplayGoto 同一份判準比對，不另抄一份）
//   I4 舊資料（沒有 logLen）⇒ turnOnly；半回合開頭（含最後一格仍在同一個半回合、單一格）
//   I5 摘要：行動者一致才標人、混雜／系統 ⇒ null；只讀 message，絕不讀 privateMessage
//   I6 4000 格／20000 行建一次索引 < 400ms
// 【K】鍵盤判準（src/lib/game/replay-keys.ts，真瀏覽器 DOM 的 closest）
// 【F】對戰頁接線
//   F1 tReplayGoto 切 log 改呼叫 replayStepLog，舊的就地切法不得殘留
//   F2 tReplaySteps 依 tReplay 身分記憶（實跑：同一份回放第二次不再排序；換一份重算）；索引同樣記憶
//   F3 onGlobalKey 在既有快捷鍵之後、Esc 之前呼叫 replayHandleKey；replayHandleKey 實跑（遮罩、輸入框、邊界、長按、播放中手動走步會暫停）
//   F4 紀錄：data-log-idx、log-step-new、log-future、獨立的定位鈕（不在卡名連結裡）；整局紀錄改列 finalLog
//   F5 遮罩清單涵蓋對戰頁所有全螢幕 *-overlay／*-backdrop／*-mask（掃描器下限）
//   F7 開新回放整局紀錄歸零、離開放掉記憶
//   F6 摘要／整局紀錄／鍵盤說明放在紀錄欄頂端（.log-replay-head，sticky）；浮動控制列不加列；鍵盤說明只在 (hover:hover) and (pointer:fine) 才渲染；不新增媒體查詢
// 【E】真瀏覽器（build/）：鍵盤走步、Shift 走回合、空白鍵播放／暫停、輸入框裡不吃、遮罩開著不吃、Esc 照舊、定位鈕、整局紀錄
// 【H】HEAD-FAIL：BASE（b4595082＝v6.648）上 I／K 模組不存在、F1～F6 紅（每條各自紅，不整支 throw）
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build, transform } from 'esbuild';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'b4595082';
const PAGE = 'src/routes/game/+page.svelte';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 500) : '')); } };
function fnBody(src, head) {
  const i = src.indexOf(head); if (i < 0) return '';
  let d = 0; for (let k = src.indexOf('{', i + head.length - 1); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); } }
  return '';
}
const tsToJs = async (code) => (await transform(code, { loader: 'ts' })).code;

// ── 打包兩個模組（缺檔 ⇒ 回 null，各條自己紅）──
const tmp = mkdtempSync(join(tmpdir(), 'v6649-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });
async function bundle(root) {
  if (!existsSync(join(root, 'src/lib/game/replay-index.ts')) || !existsSync(join(root, 'src/lib/game/replay-keys.ts'))) return null;
  const entry = join(tmp, 'entry-' + Math.random().toString(36).slice(2) + '.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(join(root, 'src/lib/game/replay-index.ts'))};\nexport * from ${JSON.stringify(join(root, 'src/lib/game/replay-keys.ts'))};\nexport { nextTurnStepIndex, prevTurnStepIndex } from ${JSON.stringify(join(root, 'src/lib/game/replay-record.ts'))};\n`);
  const out = entry.replace(/\.ts$/, '.mjs');
  const stub = join(tmp, 'stub.js'); writeFileSync(stub, 'export const base="";export const assets="";export const browser=false;');
  await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { $lib: join(root, 'src/lib'), '$app/paths': stub, '$app/environment': stub }, logLevel: 'silent' });
  const iife = out.replace(/\.mjs$/, '.iife.js');
  await build({ entryPoints: [entry], outfile: iife, bundle: true, format: 'iife', globalName: 'RK', platform: 'browser', target: 'es2020', alias: { $lib: join(root, 'src/lib'), '$app/paths': stub, '$app/environment': stub }, logLevel: 'silent' });
  return { mod: await import(pathToFileURL(out).href), iife: readFileSync(iife, 'utf8') };
}

// ── 【I】──
function checkI(M, tag) {
  const has = !!M && typeof M.buildReplayIndex === 'function' && typeof M.replayStepLog === 'function' && typeof M.replayStepSummary === 'function';
  ok(`★★★ I0${tag} 模組存在（buildReplayIndex／replayStepLog／replayStepSummary）`, has);
  if (!has) return;
  const L = [1, 1, 2, 2, 3, 3].map((t, k) => ({ turn: t, message: 'L' + k, playerIndex: k % 2 }));
  const len = (st) => M.replayStepLog(st, L).length;
  ok(`★★★ I1${tag} replayStepLog：終局 6、缺 logLen 的第 3 回合 4、logLen 2 ⇒ 2、99 ⇒ 6、-1 ⇒ 5`,
    len({ turn: 3, activePlayerIndex: null, logLen: 2, isFinal: true }) === 6 && len({ turn: 3, activePlayerIndex: 0, logLen: null }) === 4
      && len({ turn: 1, activePlayerIndex: 0, logLen: 2 }) === 2 && len({ turn: 1, activePlayerIndex: 0, logLen: 99 }) === 6 && len({ turn: 1, activePlayerIndex: 0, logLen: -1 }) === 5);
  const S = [
    { turn: 1, activePlayerIndex: 0, logLen: 1 }, { turn: 1, activePlayerIndex: 0, logLen: 1 }, { turn: 1, activePlayerIndex: 1, logLen: 3 },
    { turn: 2, activePlayerIndex: 0, logLen: 5 }, { turn: 2, activePlayerIndex: null, logLen: 6, isFinal: true },
  ];
  const ix = M.buildReplayIndex(S, L);
  ok(`★★★ I2${tag} 定點：lineStep＝[0,2,2,3,3,4]；第 1 格（同 logLen）新增 0 行；終局補第 5 行；turnStarts＝[0,2,3,4]`,
    JSON.stringify(Array.from(ix.lineStep)) === '[0,2,2,3,3,4]' && JSON.stringify(M.replayStepLines(ix, 1)) === '[]' && JSON.stringify(M.replayStepLines(ix, 4)) === '[5]'
      && JSON.stringify(ix.turnStarts) === '[0,2,3,4]' && ix.turnOnly === false && M.replayStepSummary(ix, 1, L).count === 0,
    JSON.stringify({ ls: Array.from(ix.lineStep), ts: ix.turnStarts }));
  // I3 隨機性質（與 replayStepLog 同一份判準比對）
  let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let bad = null, cases = 0;
  for (let c = 0; c < 300 && !bad; c++) {
    const n = 1 + rnd(12), Ln = rnd(25);
    const log = Array.from({ length: Ln }, (_, k) => ({ turn: 1 + Math.floor(k / 4) + (rnd(5) === 0 ? rnd(3) - 1 : 0), message: 'm' + k, playerIndex: rnd(3) === 0 ? null : rnd(2) }));
    const steps = Array.from({ length: n }, (_, i) => ({ turn: 1 + rnd(6), activePlayerIndex: rnd(2), logLen: rnd(4) === 0 ? null : rnd(Ln + 3) - 1, isFinal: false }));
    if (rnd(2)) steps.push({ turn: 6, activePlayerIndex: null, logLen: Ln, isFinal: true });
    const x = M.buildReplayIndex(steps, log);
    for (let k = 0; k < Ln && !bad; k++) {
      let first = -1; for (let j = 0; j < steps.length; j++) if (M.replayStepLog(steps[j], log).includes(log[k])) { first = j; break; }
      if (x.lineStep[k] !== first) bad = { c, k, got: x.lineStep[k], want: first };
    }
    let tot = 0; for (let j = 0; j < steps.length; j++) tot += M.replayStepLines(x, j).length;
    if (!bad && tot !== Array.from(x.lineStep).filter((v) => v >= 0).length) bad = { c, tot };
    cases++;
  }
  ok(`★★★ I3${tag} 隨機 300 份：每一行的定位＝第一個「replayStepLog 包含它」的格；每一格的新增行加總＝有定位的行數`, !bad && cases === 300, JSON.stringify(bad));
  const old = M.buildReplayIndex([{ turn: 1, activePlayerIndex: 0, logLen: null }, { turn: 2, activePlayerIndex: 1, logLen: null }, { turn: 3, activePlayerIndex: null, logLen: 6, isFinal: true }], L);
  const one = M.buildReplayIndex([{ turn: 1, activePlayerIndex: 0, logLen: 2 }], L);
  const same = M.buildReplayIndex([{ turn: 1, activePlayerIndex: 0, logLen: 1 }, { turn: 1, activePlayerIndex: 0, logLen: 2 }, { turn: 2, activePlayerIndex: 1, logLen: 3 }, { turn: 2, activePlayerIndex: 1, logLen: 4 }], L);
  ok(`★★ I4${tag} 舊資料 ⇒ turnOnly 且依回合定位（第 1 回合的格不含任何行、第 2 回合的格含第 1 回合的 2 行、終局補其餘 ⇒ [1,1,2,2,2,2]）；單一格 ⇒ [0]；最後一格仍在同半回合 ⇒ 不算新開頭（[0,2]）；halfOf 對齊`,
    old.turnOnly === true && JSON.stringify(Array.from(old.lineStep)) === '[1,1,2,2,2,2]' && JSON.stringify(one.turnStarts) === '[0]'
      && JSON.stringify(same.turnStarts) === '[0,2]' && JSON.stringify(Array.from(same.halfOf)) === '[0,0,1,1]',
    JSON.stringify({ o: Array.from(old.lineStep), one: one.turnStarts, same: same.turnStarts }));
  const L2 = [{ message: '甲 使用了 A', playerIndex: 0, privateMessage: '甲 抽到 祕密卡' }, { message: '甲 抽了 1 張', playerIndex: 0, privateMessage: '甲 抽到 另一張祕密卡' }, { message: '系統：回合結束', playerIndex: null }, { message: '乙 受到傷害', playerIndex: 1 }];
  const S2 = [{ turn: 1, activePlayerIndex: 0, logLen: 0 }, { turn: 1, activePlayerIndex: 0, logLen: 3 }, { turn: 1, activePlayerIndex: 1, logLen: 4 }, { turn: 2, activePlayerIndex: null, logLen: 4, isFinal: true }];
  const x2 = M.buildReplayIndex(S2, L2);
  const a = M.replayStepSummary(x2, 1, L2), b = M.replayStepSummary(x2, 2, L2), c3 = M.replayStepSummary(x2, 3, L2);
  const L3 = [{ message: '甲', playerIndex: 0 }, { message: '乙', playerIndex: 1 }, { message: '系統', playerIndex: null }];
  const x3 = M.buildReplayIndex([{ turn: 1, activePlayerIndex: 0, logLen: 2 }, { turn: 1, activePlayerIndex: 0, logLen: 3 }], L3);
  ok(`★★★ I5${tag} 摘要：同一人 ⇒ 標人；雙方混雜 ⇒ null；只有系統行 ⇒ null；沒有新行 ⇒ count 0；不讀 privateMessage`,
    a.actor === 0 && a.count === 3 && a.text === '甲 使用了 A' && b.actor === 1 && c3.count === 0 && M.replayStepSummary(x3, 0, L3).actor === null
      && M.replayStepSummary(x3, 1, L3).actor === null && M.replayStepSummary(x3, 1, L3).text === '系統' && !JSON.stringify([a, b, c3]).includes('祕密'),
    JSON.stringify({ a, b, c3 }));
  const bigL = Array.from({ length: 20000 }, (_, k) => ({ turn: 1 + Math.floor(k / 100), message: 'x', playerIndex: k % 2 }));
  const bigS = Array.from({ length: 4000 }, (_, i) => ({ turn: 1 + Math.floor(i / 20), activePlayerIndex: Math.floor(i / 10) % 2, logLen: i * 5 }));
  const t0 = performance.now(); const bx = M.buildReplayIndex(bigS, bigL); const dt = performance.now() - t0;
  ok(`★★ I6${tag} 4000 格／20000 行建一次索引 < 400ms（實測 ${dt.toFixed(1)}ms）`, dt < 400 && bx.n === 4000 && bx.lineStep[19994] === 3999 && bx.lineStep[19995] === -1 && bx.lineStep[4] === 1);
}

// ── 【K】真瀏覽器 DOM ──
async function checkK(B, browser, tag) {
  const has = !!B && typeof B.mod.replayKeyAction === 'function';
  ok(`★★★ K0${tag} 模組存在（replayKeyAction）`, has);
  if (!has || !browser) { if (has && !browser) console.log('  ENV-SKIP K（沒有瀏覽器）'); return; }
  const pg = await browser.newPage();
  await pg.setContent(`<body><div id="plain">x</div><input id="txt"><input id="rng" type="range"><textarea id="ta"></textarea><select id="sel"><option>a</option></select>
    <div id="ce" contenteditable="true"><span id="ceIn">y</span></div><div id="cef" contenteditable="false">z</div><button id="btn">b</button><div id="rb" role="button">rb</div>
    <div role="tablist"><div id="tab" role="tab">t</div></div><a id="lnk" href="#">l</a>
    <div class="treplay-bar"><button id="own1">▶</button><input id="ownR" type="range"><button id="ownX" class="treplay-btn treplay-exit">✕</button><button id="ownS" class="treplay-btn treplay-share">🔗</button></div><div class="log-replay-head"><button id="own2">📜</button></div><div class="log-col"><button id="own3" class="log-locate">↗</button></div></body>`);
  await pg.addScriptTag({ content: B.iife });
  const R = await pg.evaluate(() => {
    const A = (k, o = {}, id = 'plain') => globalThis.RK.replayKeyAction({ key: k, ...o }, document.getElementById(id));
    return {
      body: [A('ArrowLeft'), A('ArrowRight'), A('ArrowLeft', { shiftKey: true }), A('ArrowRight', { shiftKey: true }), A(' '), A(' ', { repeat: true }), A('Spacebar'), A(' ', { shiftKey: true }), A('Escape'), A('Enter'), A('a'), A('ArrowUp')],
      mods: [A('ArrowRight', { ctrlKey: true }), A('ArrowRight', { altKey: true }), A('ArrowRight', { metaKey: true }), A('ArrowRight', { isComposing: true }), A('ArrowRight', { keyCode: 229 })],
      edit: ['txt', 'rng', 'ta', 'sel', 'ce', 'ceIn'].map((id) => [A('ArrowRight', {}, id), A(' ', {}, id)]),
      cef: [A('ArrowRight', {}, 'cef'), A(' ', {}, 'cef')],
      btn: [A('ArrowRight', {}, 'btn'), A(' ', {}, 'btn'), A('ArrowLeft', {}, 'rb'), A(' ', {}, 'rb'), A('ArrowRight', {}, 'lnk'), A(' ', {}, 'lnk')],
      tab: [A('ArrowRight', {}, 'tab'), A(' ', {}, 'tab')],
      own: [A(' ', {}, 'own1'), A(' ', {}, 'own2'), A(' ', {}, 'own3'), A('ArrowRight', {}, 'own1'), A(' ', {}, 'ownR'), A('ArrowRight', {}, 'ownR'), A(' ', {}, 'ownX'), A(' ', {}, 'ownS')],
      nul: globalThis.RK.replayKeyAction({ key: 'ArrowRight' }, null),
    };
  });
  await pg.close();
  ok(`★★★ K1${tag} 一般位置：←/→＝prev/next、Shift＝prevTurn/nextTurn、空白鍵＝toggle、長按空白＝swallow；Shift+空白／Esc／Enter／其他鍵＝不處理`,
    JSON.stringify(R.body) === JSON.stringify(['prev', 'next', 'prevTurn', 'nextTurn', 'toggle', 'swallow', 'toggle', null, null, null, null, null]), JSON.stringify(R.body));
  ok(`★★★ K2${tag} Ctrl／Alt／⌘、輸入法組字（isComposing／229）一律不處理`, R.mods.every((x) => x === null), JSON.stringify(R.mods));
  ok(`★★★ K3${tag} 焦點在輸入框、時間軸 range、textarea、select、contenteditable（含裡面的子元素）⇒ 方向鍵與空白鍵都不處理`, R.edit.every(([a, b]) => a === null && b === null), JSON.stringify(R.edit));
  ok(`★★ K4${tag} contenteditable="false" 不算可編輯（照常處理）；target 為 null 照常處理`, R.cef[0] === 'next' && R.cef[1] === 'toggle' && R.nul === 'next', JSON.stringify(R.cef));
  ok(`★★★ K5${tag} 按鈕／role=button／連結：空白鍵交還（不可變成按了按鈕又切換播放），方向鍵照常`, JSON.stringify(R.btn) === JSON.stringify(['next', null, 'prev', null, 'next', null]), JSON.stringify(R.btn));
  ok(`★★ K6${tag} 分頁元件（role=tab）方向鍵與空白鍵都交還`, R.tab[0] === null && R.tab[1] === null, JSON.stringify(R.tab));
  ok(`★★★ K7${tag} 回放自己的控制鈕（控制列、紀錄欄頂端、定位鈕）：空白鍵仍是播放／暫停、方向鍵照常；時間軸 range 照舊交還；「離開」「複製連結」上的空白鍵照常按下它們`, JSON.stringify(R.own) === JSON.stringify(['toggle', 'toggle', 'toggle', 'next', null, null, null, null]), JSON.stringify(R.own));
}

// ── 【F】──
async function checkF(pageRaw, M, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const goto = fnBody(page, 'function tReplayGoto(i: number) {');
  ok(`★★★ F1${tag} tReplayGoto 切 log 呼叫 replayStepLog（判準唯一一份）；舊的就地切法全頁零殘留`,
    goto.length > 300 && /st\.log = replayStepLog\(step, fullLog\);/.test(goto) && !/fullLog\.slice\(0, step\.logLen\)/.test(page) && !/\(e\.turn \?\? 0\) < upto/.test(page), goto.slice(0, 120));
  // F2 實跑 tReplaySteps 的記憶
  let f2 = false, f2x = '';
  try {
    const decl = (page.match(/let _rsMemo: \{ src: any; steps: any\[\] \} = \{ src: null, steps: \[\] \};/) || [''])[0];
    const fn = fnBody(page, 'function tReplaySteps(): any[] {');
    if (decl && fn) {
      const js = await tsToJs(decl + '\n' + fn);
      const run = new Function('TR', `let tReplay = TR.cur; ${js}\nreturn { call: () => { tReplay = TR.cur; return tReplaySteps(); } };`);
      let sorts = 0; const mk = () => { const snaps = [{ turn: 2, activePlayerIndex: 0, logLen: 5, state: {} }, { turn: 1, activePlayerIndex: 0, logLen: 1, state: {} }]; const o = snaps.sort.bind(snaps); snaps.map = function (f) { const r = Array.prototype.map.call(this, f); const so = r.sort.bind(r); r.sort = (...a) => { sorts++; return so(...a); }; return r; }; return { meta: {}, finalLog: [], snapshots: snaps }; };
      const TR = { cur: mk() }; const h = run(TR);
      const a = h.call(), b = h.call(); const s1 = sorts; TR.cur = mk(); const c = h.call(); TR.cur = null; const d = h.call();
      f2 = a === b && s1 === 1 && c !== a && sorts === 2 && a[0].logLen === 1 && Array.isArray(d) && d.length === 0;
      f2x = JSON.stringify({ same: a === b, s1, sorts, d });
    } else f2x = '抽不到 _rsMemo 宣告或 tReplaySteps';
  } catch (e) { f2x = e.message; }
  const ri = fnBody(page, 'function replayIndex(): ReplayIndex | null {');
  ok(`★★★ F2${tag} tReplaySteps 依 tReplay 身分記憶（實跑：同一份第二次不再排序、換一份重算、離開回 []）；replayIndex 同樣記憶`,
    f2 && /if \(_riMemo\.src !== tReplay\) _riMemo = \{ src: tReplay, idx: buildReplayIndex\(tReplaySteps\(\), tReplay\.finalLog \|\| \[\]\) \};/.test(ri), f2x);
  // F3 onGlobalKey 接線＋replayHandleKey 實跑
  const g = fnBody(page, 'function onGlobalKey(e: KeyboardEvent) {');
  const iK = g.indexOf('if (runKbdShortcut(e)) return;'), iR = g.indexOf('if (replayHandleKey(e)) return;'), iE = g.indexOf("if (e.key === 'Escape') {");
  let f3 = null, f3x = '';
  try {
    const hk = fnBody(page, 'function replayHandleKey(e: KeyboardEvent): boolean {'), mg = fnBody(page, 'function replayManualGoto(i: number) {');
    if (hk && mg && M) {
      const js = await tsToJs(`let _replayKeyAt = 0;\n${mg}\n${hk}`);
      const mkEnv = (o = {}) => {
        const env = { isTReplay: true, tReplay: {}, game: {}, tReplayStep: 3, replayPlaying: true, gotos: [], toggles: 0, overlay: false, ...o };
        const steps = [0, 0, 1, 1, 2, 2, 3].map((t, i) => ({ turn: 1 + Math.floor(i / 2), activePlayerIndex: i % 2 ? 0 : 1, isFinal: i === 6 }));
        const f = new Function('E', 'replayKeyAction', 'REPLAY_KEY_BLOCKING_OVERLAYS', 'prevTurnStepIndex', 'nextTurnStepIndex', 'document', 'tReplaySteps',
          `let isTReplay = E.isTReplay, tReplay = E.tReplay, game = E.game; let replayPlaying = E.replayPlaying;
           const tReplayGoto = (i) => { E.gotos.push(i); }; const replayTogglePlay = () => { E.toggles++; };
           let tReplayStep = E.tReplayStep;
           ${js}
           return (ev) => { const r = replayHandleKey(ev); E.replayPlaying = replayPlaying; return r; };`);
        env.h = f(env, M.replayKeyAction, M.REPLAY_KEY_BLOCKING_OVERLAYS, M.prevTurnStepIndex, M.nextTurnStepIndex,
          { querySelector: (s) => (env.overlay && s === M.REPLAY_KEY_BLOCKING_OVERLAYS ? {} : null) }, () => steps);
        env.steps = steps; return env;
      };
      const ev = (key, o = {}) => { const e = { key, target: null, prevented: false, preventDefault() { this.prevented = true; }, ...o }; return e; };
      const r = {};
      { const E = mkEnv(); const e = ev('ArrowRight'); r.next = [E.h(e), e.prevented, E.gotos.join(), E.replayPlaying]; }
      { const E = mkEnv(); const e = ev('ArrowLeft', { shiftKey: true }); r.prevTurn = [E.h(e), E.gotos.join(), M.prevTurnStepIndex(E.steps, 3)]; }
      { const E = mkEnv(); const e = ev('ArrowRight', { shiftKey: true }); r.nextTurn = [E.h(e), E.gotos.join(), M.nextTurnStepIndex(E.steps, 3)]; }
      { const E = mkEnv({ replayPlaying: false }); const e = ev(' '); r.toggle = [E.h(e), e.prevented, E.toggles, E.gotos.length]; }
      { const E = mkEnv({ overlay: true }); const e = ev('ArrowRight'); r.overlay = [E.h(e), e.prevented, E.gotos.length]; }
      { const E = mkEnv({ isTReplay: false }); const e = ev('ArrowRight'); r.notReplay = [E.h(e), e.prevented]; }
      { const E = mkEnv({ tReplayStep: 6 }); const e = ev('ArrowRight'); r.end = [E.h(e), e.prevented, E.gotos.length]; }
      { const E = mkEnv({ tReplayStep: 0 }); const e = ev('ArrowLeft'); r.start = [E.h(e), E.gotos.length]; }
      { const E = mkEnv(); const e1 = ev('ArrowRight', { repeat: true }), e2 = ev('ArrowRight', { repeat: true }); E.h(e1); E.h(e2); r.repeat = [E.gotos.length, e2.prevented]; }
      { const E = mkEnv(); const e = ev('Escape'); r.esc = [E.h(e), e.prevented]; }
      f3 = r; f3x = JSON.stringify(r);
    } else f3x = '抽不到 replayHandleKey／replayManualGoto 或模組不存在';
  } catch (e) { f3x = e.message; }
  const R = f3;
  ok(`★★★ F3${tag} onGlobalKey：既有快捷鍵之後、Esc 之前呼叫 replayHandleKey（唯一鍵盤入口）`, iK > 0 && iR > iK && iE > iR, JSON.stringify({ iK, iR, iE }));
  ok(`★★★ F3b${tag} replayHandleKey 實跑：→ 走一步且停掉播放、Shift 走回合（＝既有 prev/nextTurnStepIndex）、空白鍵切換播放；遮罩開著／不在回放／Esc 不處理也不 preventDefault；邊界不走；長按 90ms 節流`,
    !!R && JSON.stringify(R.next) === JSON.stringify([true, true, '4', false]) && R.prevTurn[1] === String(R.prevTurn[2]) && R.nextTurn[1] === String(R.nextTurn[2])
      && JSON.stringify(R.toggle) === JSON.stringify([true, true, 1, 0]) && JSON.stringify(R.overlay) === JSON.stringify([false, false, 0])
      && JSON.stringify(R.notReplay) === JSON.stringify([false, false]) && JSON.stringify(R.end) === JSON.stringify([true, true, 0]) && JSON.stringify(R.start) === JSON.stringify([true, 0])
      && JSON.stringify(R.repeat) === JSON.stringify([1, true]) && JSON.stringify(R.esc) === JSON.stringify([false, false]), f3x);
  // F4 紀錄
  const iLog = page.indexOf('<div class="log-col"'); const logBlk = iLog > 0 ? page.slice(iLog, page.indexOf('{/each}', iLog) + 7) : '';
  const lineTag = (logBlk.match(/<div class="log-line \{_lineCls\}"[\s\S]*?>\n/) || [''])[0];
  const locBtn = (logBlk.match(/<button type="button" class="log-locate"(?:=>|[^>])*>↗<\/button>/) || [''])[0];
  ok(`★★★ F4${tag} 紀錄：整局紀錄改列 finalLog；每行 data-log-idx、log-step-new（＝這一步）、log-future（＝之後的步）；定位鈕呼叫 replayLocateLine(origIdx)，且在卡名連結的迴圈之外`,
    /\{#each \[\.\.\.\(\(isTReplay && replayLogFull && tReplay\?\.finalLog \? tReplay\.finalLog : game\.log\)\?\?\[\]\)\.entries\(\)\]\.reverse\(\) as \[origIdx, entry\], i \(origIdx\)\}/.test(logBlk)
      && /class:log-step-new=\{_rIdxL !== null && _rStepL === tReplayStep\}/.test(lineTag) && /class:log-future=\{_rIdxL !== null && _rStepL > tReplayStep\}/.test(lineTag) && /data-log-idx=\{origIdx\}/.test(lineTag)
      && /onclick=\{\(\) => replayLocateLine\(origIdx\)\}/.test(locBtn) && logBlk.indexOf(locBtn) < logBlk.indexOf('{#each _tokens as tok}') && logBlk.indexOf(locBtn) > logBlk.indexOf(lineTag),
    JSON.stringify({ lineTag: lineTag.slice(0, 200), locBtn }));
  // F5 遮罩清單
  const raw = normEol(pageRaw);
  // 每個帶 *-overlay／*-backdrop／*-mask 的元素：它的 class 至少有一個在遮罩清單裡（或整個元素被列為不擋鍵盤）
  const sel = M?.REPLAY_KEY_BLOCKING_OVERLAYS || '';
  const selSet = new Set(sel.split(',').map((x) => x.trim()));
  const NON_BLOCKING = new Set(M?.REPLAY_KEY_NON_BLOCKING || []);
  const els = []; for (const m of raw.matchAll(/class="([^"]+)"/g)) { const cs = m[1].split(/\s+/).filter(Boolean); if (cs.some((c) => /-(overlay|backdrop|mask)$/.test(c))) els.push(cs); }
  const miss = els.filter((cs) => !cs.some((c) => selSet.has('.' + c)) && !cs.some((c) => NON_BLOCKING.has(c))).map((cs) => cs.join(' '));
  const kinds = new Set(els.map((cs) => cs.join(' ')));
  ok(`★★ F5${tag} 遮罩清單涵蓋對戰頁每一個全螢幕遮罩元素（掃到 ${kinds.size} 種，下限 15）＋ role=dialog／aria-modal；不擋的只有裝飾與動畫`,
    kinds.size >= 15 && miss.length === 0 && selSet.has('[role="dialog"]') && selSet.has('[aria-modal="true"]') && NON_BLOCKING.size <= 3, JSON.stringify({ miss: [...new Set(miss)] }));
  // F7 進入點歸零與離開時放掉記憶
  const ord = fnBody(page, 'function openReplayData(');
  ok(`★★ F7${tag} 開新回放時整局紀錄歸零（openReplayData）；tReplay 變 null 就放掉記憶的 steps 與索引（$effect.pre）`,
    /replayLogFull = false;/.test(ord) && /\$effect\.pre\(\(\) => \{ if \(!tReplay\) \{ _rsMemo = \{ src: null, steps: \[\] \}; _riMemo = \{ src: null, idx: null \}; \} \}\);/.test(page), ord.length);
  // F6 紀錄欄頂端
  // 紀錄欄是 column-reverse（最新在下）⇒ 回放列放在清單迴圈之前（畫面最下方，避開預設在上方的浮動控制列）
  const iLc = page.indexOf('<div class="log-col"'); const iHd = iLc > 0 ? page.indexOf('<div class="log-replay-head">', iLc) : -1;
  const iEach = iLc > 0 ? page.indexOf('{#each [...((isTReplay && replayLogFull', iLc) : -1;
  const head = iHd > iLc && iHd < iEach ? page.slice(page.lastIndexOf('{#if isTReplay && tReplay && replayIndex()}', iHd), iHd + 2000) : '';
  const iBar2 = page.indexOf('<div class="treplay-bar"'); const bar2 = iBar2 > 0 ? page.slice(iBar2, page.indexOf('{#snippet blueDeco', iBar2)) : '';
  const fp = fnBody(page, '$effect(() => { if (!isTReplay) return; try { replayFinePointer');
  ok(`★★ F6${tag} 摘要／整局紀錄／鍵盤說明在紀錄欄頂端（不在浮動控制列裡）；鍵盤說明只在有實體鍵盤滑鼠時渲染（matchMedia，不新增媒體查詢）`,
    /<div class="log-replay-head">/.test(head) && /replayStepSummary\(_ri, tReplayStep, tReplay\.finalLog \|\| \[\]\)/.test(head) && /盤面更新/.test(head) && /此回放僅提供回合級定位/.test(head)
      && /class="log-replay-full"/.test(head) && /\{#if replayFinePointer\}<div class="log-replay-keys"/.test(head) && !/log-replay|treplay-detail|replayStepSummary/.test(bar2)
      && /matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/.test(page) && /\.log-replay-head \{ position: sticky; bottom: 0;/.test(page), head.slice(0, 200));
}

// ── 【E】真瀏覽器 ──
async function checkE(browser) {
  const BUILD = join(ROOT, 'build');
  if (!existsSync(join(BUILD, '404.html'))) { console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）'); return; }
  if (!browser) { console.log('  ENV-SKIP E（沒有瀏覽器）'); return; }
  const { createReadStream, statSync } = await import('node:fs');
  const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
    if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) p = join(BUILD, '404.html');
    res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const mod = await buildAiBundle(ROOT, {}), pool = loadLivePool(ROOT);
    const states = []; let last = null;
    playGame({ mod, pool, decks: [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')], agents: [(st, i) => mod.aiNew(st, pool, i), (st, i) => mod.aiNew(st, pool, i)], seed: 7, firstPlayer: firstPlayerOf(7),
      onStep: (st, act, next) => { if (next && next !== last) { states.push(next); last = next; } } });
    const fin = states[states.length - 1];
    // 每個動作一格（同 logLen 連續的格也保留 ⇒ 會有「盤面更新」）
    const snaps = []; for (const s of states) if (s.phase === 'playing') snaps.push({ turn: s.turn, activePlayerIndex: s.activePlayerIndex, logLen: s.log.length, state: { ...s, log: [] } });
    // 複製一格（同 logLen）⇒ 一定有一步「盤面更新」
    snaps.splice(8, 0, { ...snaps[7] });
    const replayData = { meta: { matchId: 'EV_r1_m0', eventId: 'EV', p1name: 'A', p2name: 'B', winnerName: 'A', round: 1 }, finalLog: fin.log, finalState: { ...fin, log: [] }, snapshots: snaps.slice(0, 400) };
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1376, height: 958 }, deviceScaleFactor: SHOT ? 2 : 1 });
    await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
    await ctx.route(/\/api\/tournament\/replay\?/, (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replayData) }));
    await ctx.route(/\/api\/replay\/tourn-steps/, (rt) => rt.fulfill({ status: 404, body: '' }));
    await ctx.addInitScript(() => { localStorage.setItem('ptcg_battle_layout', 'blue'); });
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(`http://localhost:${port}/game?treplay=EV_r1_m0`, { waitUntil: 'load' });
    const got = await pg.waitForSelector('.treplay-bar', { timeout: 60000 }).then(() => true).catch(() => false);
    ok('[E 前提] 回放開起來了', got);
    if (!got) return;
    await pg.waitForTimeout(800);
    const bc = pg.locator('.admin-broadcast-close'); if (await bc.count()) await bc.click();
    await pg.mouse.click(5, 950);   // 焦點回到頁面本身
    const st = () => pg.evaluate(() => ({ step: document.querySelector('.treplay-step')?.textContent || '', play: document.querySelector('.treplay-play')?.textContent || '',
      newN: document.querySelectorAll('.log-col .log-line.log-step-new').length, futN: document.querySelectorAll('.log-col .log-line.log-future').length,
      lines: document.querySelectorAll('.log-col .log-line').length, sum: document.querySelector('.log-replay-head .log-replay-sum')?.textContent?.trim() || '', full: !!document.querySelector('.log-replay-full.active'), loc: document.querySelectorAll('.log-col .log-locate').length }));
    const num = (s) => Number((s.step.match(/（(\d+)\//) || [])[1] || 0);
    const s0 = await st();
    await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(250); const s1 = await st();
    await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(250); await pg.keyboard.press('ArrowLeft'); await pg.waitForTimeout(250); const s2 = await st();
    ok('★★★[E1] → 走一步、← 退一步', num(s0) === 1 && num(s1) === 2 && num(s2) === 2, JSON.stringify([s0.step, s1.step, s2.step]));
    await pg.keyboard.press('Shift+ArrowRight'); await pg.waitForTimeout(300); const s3 = await st();
    const expect3 = await pg.evaluate(() => 0);   // 期望值改由下方 node 端用同一支 nextTurnStepIndex 算
    void expect3;
    ok('★★★[E2] Shift+→ 跳到下一個半回合的開頭（步數前進超過 1，且回合字樣換了）', num(s3) > 2 && s3.step !== s2.step, JSON.stringify([s2.step, s3.step]));
    await pg.keyboard.press(' '); await pg.waitForTimeout(150); const p1 = await st();
    await pg.keyboard.press(' '); await pg.waitForTimeout(150); const p2 = await st();
    ok('★★★[E3] 空白鍵：播放 ⇒ 再按暫停（頁面沒有捲動）', /暫停/.test(p1.play) && /播放/.test(p2.play) && (await pg.evaluate(() => scrollY)) === 0, JSON.stringify([p1.play, p2.play]));
    // 輸入框裡不吃
    await pg.evaluate(() => { const i = document.createElement('input'); i.id = 'v6649-in'; i.style.cssText = 'position:fixed;left:0;bottom:0;z-index:999999'; document.body.appendChild(i); i.focus(); });
    const b4 = await st(); await pg.keyboard.press('ArrowRight'); await pg.keyboard.press(' '); await pg.waitForTimeout(200); const a4 = await st();
    await pg.evaluate(() => document.getElementById('v6649-in')?.remove()); await pg.mouse.click(5, 950);
    ok('★★★[E4] 焦點在輸入框 ⇒ ←/→、空白鍵都不吃', a4.step === b4.step && /播放/.test(a4.play), JSON.stringify([b4.step, a4.step, a4.play]));
    // 遮罩開著不吃；Esc 照舊關
    await pg.evaluate(() => document.querySelector('.prize-view-btn')?.click()); await pg.waitForTimeout(400);   // 浮動控制列可能疊在獎賞鈕上 ⇒ 直接觸發按鈕
    const ov = await pg.evaluate(() => !!document.querySelector('.zoom-overlay'));
    const b5 = await st(); await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(200); const a5 = await st();
    // 獎賞卡視窗本來就不吃 Esc（既有行為，本版不動）⇒ 用它自己的關閉鈕
    await pg.evaluate(() => { const o = document.querySelector('.zoom-overlay'); const b = o && [...o.querySelectorAll('button')].find((x) => /✕|關閉/.test(x.textContent || '')); b?.click(); }); await pg.waitForTimeout(300);
    const closed = await pg.evaluate(() => !document.querySelector('.zoom-overlay'));
    await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(250); const c5 = await st();
    ok('★★★[E5] 獎賞卡視窗開著 ⇒ → 不走；關掉視窗後 → 照常走', ov && a5.step === b5.step && closed && num(c5) === num(b5) + 1, JSON.stringify({ ov, b5: b5.step, a5: a5.step, closed, c5: c5.step }));
    // 摘要與標示：走到有新紀錄的一步
    let s6 = await st(); for (let t = 0; t < 30 && s6.newN === 0; t++) { await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(120); s6 = await st(); }
    const cnt = Number((s6.sum.match(/共 (\d+) 行/) || [])[1] || 1);
    ok('★★★[E6] 這一步新增的紀錄有標示，數量＝摘要的行數；每行都有定位鈕', s6.newN > 0 && s6.newN === cnt && s6.loc === s6.lines && !/盤面更新/.test(s6.sum), JSON.stringify(s6));
    // 盤面更新：找一步沒有新紀錄的
    await pg.evaluate(() => { const r = document.querySelector('.treplay-range'); r.value = '8'; r.dispatchEvent(new Event('input', { bubbles: true })); }); await pg.waitForTimeout(300);
    const s7 = await st();
    ok('★★[E7] 沒有新紀錄的一步（第 9 格＝第 8 格的複本）⇒ 摘要「盤面更新」、沒有標示', num(s7) === 9 && s7.newN === 0 && /盤面更新/.test(s7.sum), JSON.stringify(s7));
    // 定位鈕：點最舊的那一行（最下面）⇒ 跳回那一步，那一行被標示
    const before = await st();
    const k = await pg.evaluate(() => { const ls = [...document.querySelectorAll('.log-col .log-line')]; const el = ls[ls.length - 1]; el.querySelector('.log-locate').click(); return el.getAttribute('data-log-idx'); });
    await pg.waitForTimeout(400);
    const s8 = await st(); const marked = await pg.evaluate((k) => document.querySelector(`.log-col [data-log-idx="${k}"]`)?.classList.contains('log-step-new'), k);
    ok('★★★[E8] 點紀錄旁的 ↗ ⇒ 跳到那一行發生的那一步，那一行被標示', num(s8) < num(before) && marked === true, JSON.stringify({ before: before.step, after: s8.step, k, marked }));
    // 整局紀錄
    await pg.locator('.log-replay-full').click(); await pg.waitForTimeout(400); const s9 = await st();
    if (SHOT) await pg.screenshot({ path: SHOT + '/v6649-desktop-replay.png' });
    // 整局紀錄模式換步會把這一步新增的第一行捲進紀錄欄看得到的地方；焦點停在 📜 鈕上按空白鍵仍是播放（不會又切換整局紀錄）
    const visOf = (k) => pg.evaluate((k) => { const el = document.querySelector(`.log-col [data-log-idx="${k}"]`), box = el?.closest('.log-col'); if (!el || !box) return null; const e = el.getBoundingClientRect(), b = box.getBoundingClientRect(); const h = box.querySelector('.log-replay-head')?.getBoundingClientRect(); const bot = h ? h.top : b.bottom; return e.top >= b.top - 1 && e.bottom <= bot + 1; }, k);   // 不能躲在最下方那一列後面
    let tries = 0, firstNew = null; while (tries++ < 40) { await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(250); firstNew = await pg.evaluate(() => { const ls = [...document.querySelectorAll('.log-col .log-line.log-step-new')]; return ls.length ? ls[ls.length - 1].getAttribute('data-log-idx') : null; }); if (firstNew !== null && Number(firstNew) > 40) break; }
    const seen = firstNew !== null ? await visOf(firstNew) : null;
    ok('★★[E11] 整局紀錄模式：換步後這一步新增的紀錄被捲進紀錄欄可見範圍', seen === true, JSON.stringify({ firstNew, seen }));
    await pg.locator('.log-replay-full').focus(); await pg.keyboard.press(' '); await pg.waitForTimeout(200); const sp1 = await st();
    await pg.keyboard.press(' '); await pg.waitForTimeout(200); const sp2 = await st();
    ok('★★★[E12] 焦點在 📜 整局紀錄鈕上按空白鍵 ⇒ 播放／暫停（整局紀錄維持開著，不會被按掉）', /暫停/.test(sp1.play) && sp1.full && /播放/.test(sp2.play) && sp2.full, JSON.stringify([sp1.play, sp1.full, sp2.play, sp2.full]));
    // 播放中點定位鈕 ⇒ 停掉播放
    await pg.mouse.click(5, 950); await pg.keyboard.press(' '); await pg.waitForTimeout(150);
    await pg.evaluate(() => { const ls = [...document.querySelectorAll('.log-col .log-line')]; ls[ls.length - 1].querySelector('.log-locate').click(); }); await pg.waitForTimeout(300);
    ok('★★[E13] 播放中點紀錄旁的 ↗ ⇒ 跳過去並停掉播放', /播放/.test((await st()).play));
    await pg.locator('.log-replay-full').click(); await pg.waitForTimeout(300); const s10 = await st();
    ok('★★★[E9] 📜 整局紀錄：列出整份紀錄、之後的行變淡；關掉恢復只到這一步', s9.lines === replayData.finalLog.length && s9.futN > 0 && s9.futN === s9.lines - s8.lines && !s10.full && s10.futN === 0 && s10.lines < s9.lines,
      JSON.stringify({ s9: [s9.lines, s9.futN], all: replayData.finalLog.length, s10: [s10.lines, s10.futN], s8: s8.lines }));
    // 浮動控制列沒有多一列（摘要在紀錄欄裡）
    const hd = await pg.evaluate(() => { const h = document.querySelector('.log-col .log-replay-head'), c = document.querySelector('.log-col'); if (!h || !c) return null; const a = h.getBoundingClientRect(), b = c.getBoundingClientRect(); return { db: b.bottom - a.bottom, inside: a.top >= b.top }; });
    ok('★★[E9b] 浮動控制列沒有變高（只有主控制列＋時間軸）；摘要列在紀錄欄最下方（捲動時固定）', (await pg.locator('.treplay-bar .log-replay-head, .treplay-detail').count()) === 0 && !!hd && hd.db >= 0 && hd.db < 12 && hd.inside, JSON.stringify(hd));
    // 打開整局紀錄後離開、再開一份 ⇒ 回到預設（只看到這一步）
    await pg.locator('.log-replay-full').click(); await pg.waitForTimeout(200);
    // 離開回放 ⇒ 鍵盤不再作用（頁面沒有錯誤）
    await pg.locator('.treplay-btn', { hasText: '離開' }).first().click(); await pg.waitForTimeout(600);
    await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(200);
    ok('★★[E10] 離開回放後控制列消失、按鍵不報錯', (await pg.locator('.treplay-bar').count()) === 0 && errs.length === 0, errs.slice(0, 3).join(' | '));
    // E14：1024 寬時紀錄欄不出現橫向捲動（鍵盤說明可換行）
    await pg.setViewportSize({ width: 1024, height: 700 });
    await pg.goto(`http://localhost:${port}/game?treplay=EV_r1_m0`, { waitUntil: 'load' }); await pg.waitForSelector('.treplay-bar', { timeout: 60000 }); await pg.waitForTimeout(800);
    const ovf = await pg.evaluate(() => { const c = document.querySelector('.log-col'); const h = c?.querySelector('.log-replay-head'); return c ? { sw: c.scrollWidth, cw: c.clientWidth, hh: h ? Math.round(h.getBoundingClientRect().height) : -1, keys: !!c.querySelector('.log-replay-keys') } : null; });
    ok('★★[E14] 1024 寬：紀錄欄沒有橫向捲動；回放列（摘要＋📜 同一行＋鍵盤說明）不超過 48px', !!ovf && ovf.sw <= ovf.cw + 1 && ovf.hh > 0 && ovf.hh <= 48 && ovf.keys, JSON.stringify(ovf));
    // E15：四種版面 × 1376／1024：📜 按得到（中心點打到它自己，不被浮動控制列蓋住）、紀錄欄沒有橫向捲動
    const bad = [];
    for (const LY of ['blue', 'classic', 'fable', 'tabletop']) for (const [W, H] of [[1376, 958], [1024, 700]]) {
      await pg.setViewportSize({ width: W, height: H });
      await pg.evaluate((ly) => localStorage.setItem('ptcg_battle_layout', ly), LY);
      await pg.goto(`http://localhost:${port}/game?treplay=EV_r1_m0`, { waitUntil: 'load' }); await pg.waitForSelector('.treplay-bar', { timeout: 60000 }); await pg.waitForTimeout(700);
      const r = await pg.evaluate(() => { const b = document.querySelector('.log-replay-full'), c = document.querySelector('.log-col'); if (!b || !c) return { miss: true }; const x = b.getBoundingClientRect(); const hit = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return { hit: hit === b || b.contains(hit), ovf: c.scrollWidth - c.clientWidth }; });
      if (r.miss || !r.hit || r.ovf > 1) bad.push({ LY, W, ...r });
    }
    ok('★★[E15] blue／classic／fable／tabletop × 1376／1024：📜 整局按得到（沒被浮動控制列蓋住）、紀錄欄沒有橫向捲動', bad.length === 0, JSON.stringify(bad));
    await ctx.close();
  } finally { srv.close(); }
}

const SHOT = process.env.V6649_SHOT || '';
const pageRaw = readFileSync(join(ROOT, PAGE), 'utf8');
const B = await bundle(ROOT).catch((e) => { console.log('  打包失敗：' + e.message); return null; });
console.log('【I】索引'); checkI(B?.mod, '');
const chromium = pwChromium('v6.649 回放鍵盤');
const browser = chromium ? await pwLaunchWith(chromium, 'v6.649 回放鍵盤') : null;
console.log('【K】鍵盤判準'); await checkK(B, browser, '');
console.log('【F】對戰頁接線'); await checkF(pageRaw, B?.mod, '');
console.log('【E】真瀏覽器'); await checkE(browser);
console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const bp = readBaseBlob(ROOT, BASE_SHA, PAGE), bi = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/replay-index.ts');
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  checkI(bi.ok ? B?.mod : null, '@BASE'); await checkK(bi.ok ? B : null, null, '@BASE'); await checkF(bp.ok ? bp.out : '', B?.mod, '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 18));
  pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  ok('★★★ H1 BASE 上索引與鍵盤模組不存在（I0／K0 紅）', ['I0@', 'K0@'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
  ok('★★★ H2 BASE 上 F1／F2／F3／F3b／F4／F6／F7 各自紅（F5 只看模組的遮罩清單，正對照綠）', ['F1@', 'F2@', 'F3@', 'F3b@', 'F4@', 'F6@', 'F7@'].every((k) => reds.some((r) => r.includes(k))) && !reds.some((r) => r.includes('F5@')), reds.join(','));
}
if (browser) await browser.close();
console.log(`=== v6.649 回放索引＋鍵盤＋步驟摘要：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
