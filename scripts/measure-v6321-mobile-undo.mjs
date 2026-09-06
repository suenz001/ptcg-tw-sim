// v6.321 版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）—— 手機直式／平板（手機版介面）真元件 DOM 驗證。
//
// 做法：用 svelte/compiler 把**真的** MobilePortraitBattle.svelte 編成 client 元件（esbuild 插件，零新依賴），
//   在 headless Chrome（CDP，node 內建 WebSocket）以 375×812／768×1024 掛載，餵真 createGame 的盤面；
//   `undoAvailable` 用 +page.svelte **逐字抽出**的 undoBtnVisible 述詞算（與守衛 test-v6321 同一支抽取器）。
//   量：setup 階段 `.mp-undo-btn` 必須 0 個；playing＋我的回合必須 1 個且可點（onUndo 被呼叫）；
//       setup 已放戰鬥場時點手牌基礎卡，sheet 必須出現「🔁 換上戰鬥場」（v6.321 D 的手機入口）。
//   桌機／平板（未開手機介面）走 +page.svelte 的桌機分支（兩顆鈕都只讀 undoBtnVisible），由守衛 D1／D2 釘住。
//
// 用法：LD_LIBRARY_PATH=<libXdamage 目錄> CHROME=<chrome-headless-shell 路徑> node scripts/measure-v6321-mobile-undo.mjs
import { build, transformSync } from 'esbuild';
import { compile } from 'svelte/compiler';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME;
if (!CHROME) { console.error('需要 CHROME=<chrome-headless-shell 路徑>'); process.exit(2); }

// ── 1. 編譯真元件 ──────────────────────────────────────────────
const sveltePlugin = {
  name: 'svelte',
  setup(b) {
    b.onLoad({ filter: /\.svelte$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      const r = compile(src, { generate: 'client', css: 'injected', filename: args.path, runes: true });
      return { contents: r.js.code, loader: 'js', resolveDir: join(args.path, '..') };
    });
  },
};
const S = join(ROOT, '.m6321-s.js'), E = join(ROOT, '.m6321-e.js'), O = join(ROOT, '.m6321-o.js'), EN = join(ROOT, '.m6321-en.ts'), ON = join(ROOT, '.m6321-on.mjs');
process.on('exit', () => { for (const p of [S, E, O, EN, ON]) { try { unlinkSync(p); } catch { /* ignore */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, `import { mount } from 'svelte';
import MPB from './src/routes/game/MobilePortraitBattle.svelte';
window.__calls = [];
window.__mount = (p) => {
  const pool = new Map(p.poolEntries);
  document.body.innerHTML = '';
  return mount(MPB, { target: document.body, props: { ...p.props, pool,
    onAction: (a) => { window.__calls.push(['action', a.type]); }, onInitiateAttack: () => {}, onOpenZoom: () => {},
    onOpenSettings: () => {}, onLeave: () => {}, onUndo: () => { window.__calls.push(['undo']); } } });
};
`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S, '$app/environment': S }, plugins: [sveltePlugin], logLevel: 'error',
  define: { 'import.meta.env.VITE_BACKEND_MODE': '"oracle"', 'import.meta.env.DEV': 'false', 'import.meta.env.SSR': 'false' } });
const BUNDLE = readFileSync(O, 'utf8');

// ── 2. 引擎（node 端）＋ 卡池 ───────────────────────────────────
writeFileSync(EN, "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';\n");
await build({ entryPoints: [EN], outfile: ON, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(ON).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const LION = '18508', WILLDUN = '14086';
const g = M.createGame({ name: 'P', entries: [{ cardId: WILLDUN, count: 30 }, { cardId: LION, count: 30 }] },
  { name: 'Y', entries: [{ cardId: WILLDUN, count: 60 }] }, pool, { forceLegacyOpening: true });
const first = g.players[0].hand.find(c => pool.get(c.cardId)?.supertype === 'Pokemon');
const setupPlaced = M.applyAction(g, { type: 'PLACE_ACTIVE', iid: first.iid, senderIdx: 0 }, pool);
const playing = { ...setupPlaced, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3, isFirstTurn: false,
  setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
  players: [ { ...setupPlaced.players[0], prizes: [] }, { ...setupPlaced.players[1], active: { iid: 'opp1', cardId: WILLDUN, damage: 0, energyAttached: [] }, prizes: [] } ] };
const usedIds = new Set([...g.players[0].hand, ...g.players[1].hand, ...g.players[0].deck, ...g.players[1].deck].map(c => c.cardId).concat([WILLDUN, LION]));
const poolEntries = [...pool].filter(([id]) => usedIds.has(id));

// ── 3. +page.svelte 的 undoBtnVisible 述詞（逐字抽出）────────────
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
// ⚠ 對 BASE（v6.320）跑時沒有 undoBtnVisible ⇒ 退回手機 prop 原本的表達式（用來重現「setup 也亮」的 bug）
const ownedFn = PAGE.match(/function undoSnapshotOwnedBy\(snap: GameState \| null, g: GameState \| null\): snap is GameState \{[\s\S]*?\n  \}\n/)?.[0] ?? '';
const visExpr = PAGE.match(/const undoBtnVisible = \$derived\(([\s\S]*?)\);\n/)?.[1] ?? PAGE.match(/undoAvailable=\{([^}]+)\}/)[1];
console.log('undoAvailable 述詞來源：' + (ownedFn ? 'undoBtnVisible（v6.321）' : '手機 prop 原式（BASE）：' + visExpr.trim()));
const ts = (s) => transformSync(s, { loader: 'ts', target: 'node18' }).code;
function visibleFor(game, undoSnapshot, mySeatIdx) {
  const pendingSelection = game?.pendingSelection ?? null;
  const isMyTurn = () => !!game && (game.phase === 'setup' ? true : game.activePlayerIndex === mySeatIdx);
  return !!new Function('undoSnapshot', 'game', 'undoAwaitingResponse', 'undoDeniedThisSnapshot', 'pendingSelection', 'mode', 'roomData', 'mySeatIdx', 'isMyTurn', 'aiPlayerIndex',
    ts(ownedFn) + '\nreturn (' + ts(visExpr).replace(/;\s*$/, '') + ');')(undoSnapshot, game, false, false, pendingSelection, 'online', { allowUndo: true }, mySeatIdx, isMyTurn, null);
}

// ── 4. headless Chrome（CDP）──────────────────────────────────
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--no-sandbox', '--headless', '--disable-gpu', '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch { /* ignore */ } });
async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
let targets = null;
for (let i = 0; i < 40 && !targets; i++) { await wait(250); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* retry */ } }
if (!targets) { console.error('Chrome 沒起來'); process.exit(2); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '  OK   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); };
await cdp('Page.enable'); await cdp('Runtime.enable');
for (const vp of [{ label: '手機直式 375×812', w: 375, h: 812 }, { label: '平板直立（手機版介面）768×1024', w: 768, h: 1024 }]) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: 'about:blank' }); await wait(200);
  // 真站的 app.html 有 <meta name=viewport width=device-width>；沒有它，行動裝置模擬會退回 980px 的桌機版面寬
  await evalJs(`const mv = document.createElement('meta'); mv.name = 'viewport'; mv.content = 'width=device-width, initial-scale=1'; document.head.appendChild(mv); true`);
  await evalJs(BUNDLE + '\ntrue');
  const base = (props) => ({ props: { game: null, myIdx: 0, oppIdx: 1, stadiumCard: null, pendingSelection: null, aiThinking: false, isSyncing: false, version: '6.321', ...props }, poolEntries });
  // (a) setup（已放戰鬥場）：↶ 必須不出現；點手牌基礎卡 → sheet 有「🔁 換上戰鬥場」
  {
    const undoAvailable = visibleFor(setupPlaced, { ...setupPlaced }, 0);
    await evalJs(`window.__mount(${JSON.stringify(base({ game: setupPlaced, undoAvailable }))}); true`); await wait(150);
    const n = await evalJs(`document.querySelectorAll('.mp-undo-btn').length`);
    record(`[${vp.label}] setup 階段（快照存在）↶ 鈕不顯示`, undoAvailable === false && n === 0, `undoBtnVisible=${undoAvailable} .mp-undo-btn=${n}`);
    const w = await evalJs(`(() => { const el = document.querySelector('.mp-top'); return el ? el.getBoundingClientRect().width : -1; })()`);
    record(`[${vp.label}] 頂欄寬度 = viewport 寬（沒有爆版）`, w === vp.w, `mp-top=${w}`);
    // 點第一張基礎手牌 → sheet
    const another = setupPlaced.players[0].hand.find(c => pool.get(c.cardId)?.supertype === 'Pokemon');
    const idx = setupPlaced.players[0].hand.findIndex(c => c.iid === another.iid);
    const clicked = await evalJs(`(() => { const cards = [...document.querySelectorAll('.mp-hand-card')]; const el = cards[${idx}]; if (!el) return 'no-el:' + cards.length; if (!el.classList.contains('mp-playable')) return 'not-playable'; el.click(); return 'ok'; })()`);
    await wait(150);
    const labels = await evalJs(`[...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t.includes('戰鬥場') || t.includes('備戰'))`);
    record(`[${vp.label}] setup 已有戰鬥場：點手牌基礎卡 → sheet 有「🔁 換上戰鬥場」與「📥 放到備戰區」`,
      clicked === 'ok' && labels.some(t => t.includes('🔁 換上戰鬥場')) && labels.some(t => t.includes('放到備戰區')), `${clicked} ${JSON.stringify(labels)}`);
    if (labels.some(t => t.includes('🔁 換上戰鬥場'))) {
      await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('🔁 換上戰鬥場')).click(); true`); await wait(100);
      const calls = await evalJs(`JSON.stringify(window.__calls)`);
      record(`[${vp.label}] 按「🔁 換上戰鬥場」→ 送出 PLACE_ACTIVE`, calls.includes('"PLACE_ACTIVE"'), calls);
    }
  }
  // (b) playing＋我的回合＋本局快照：↶ 出現且可點
  {
    const undoAvailable = visibleFor(playing, { ...playing }, 0);
    await evalJs(`window.__calls = []; window.__mount(${JSON.stringify(base({ game: playing, undoAvailable }))}); true`); await wait(150);
    const n = await evalJs(`document.querySelectorAll('.mp-undo-btn').length`);
    record(`[${vp.label}] playing＋我的回合 ↶ 鈕顯示`, undoAvailable === true && n === 1, `undoBtnVisible=${undoAvailable} .mp-undo-btn=${n}`);
    await evalJs(`document.querySelector('.mp-undo-btn')?.click(); true`); await wait(50);
    const calls = await evalJs(`JSON.stringify(window.__calls)`);
    record(`[${vp.label}] 點 ↶ → onUndo 被呼叫`, calls.includes('"undo"'), calls);
    // 快照屬於別局 ⇒ 不顯示（同一個 playing 盤面）
    const undoOther = visibleFor(playing, { ...playing, id: 'OTHER-GAME' }, 0);
    await evalJs(`window.__mount(${JSON.stringify(base({ game: playing, undoAvailable: undoOther }))}); true`); await wait(100);
    const n2 = await evalJs(`document.querySelectorAll('.mp-undo-btn').length`);
    record(`[${vp.label}] playing 但快照屬於別局 ⇒ ↶ 不顯示`, undoOther === false && n2 === 0, `undoBtnVisible=${undoOther} .mp-undo-btn=${n2}`);
    // 對手回合 ⇒ 不顯示
    const oppTurn = { ...playing, activePlayerIndex: 1 };
    const undoOpp = visibleFor(oppTurn, { ...oppTurn }, 0);
    await evalJs(`window.__mount(${JSON.stringify(base({ game: oppTurn, undoAvailable: undoOpp }))}); true`); await wait(100);
    const n3 = await evalJs(`document.querySelectorAll('.mp-undo-btn').length`);
    record(`[${vp.label}] 對手回合 ⇒ ↶ 不顯示`, undoOpp === false && n3 === 0, `undoBtnVisible=${undoOpp} .mp-undo-btn=${n3}`);
  }
}
ws.close(); chrome.kill('SIGKILL');
const bad = results.filter(r => !r.ok).length;
console.log(`\n=== measure-v6321：${results.length - bad} OK / ${bad} FAIL ===`);
process.exit(bad ? 1 : 0);
