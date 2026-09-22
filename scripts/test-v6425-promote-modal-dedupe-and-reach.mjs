// v6.425 守衛：補位視窗「一個座位只開一個」＋ 一般視窗可以拖到畫面外（把手永遠抓得到）
//
// 站長回報（附圖，桌機＋手機都會）：寶可夢被擊倒後「⚠️ 派出新的戰鬥寶可夢」視窗出現**兩個**
//   （原本疊在一起，拖開後變兩個），上方提示也兩條；手機上以前能把視窗拖到角落看底下的對戰紀錄，
//   現在兩個視窗都卡在畫面中間，看不到紀錄。
// 真因：
//   ① 補位視窗寫了兩份（A 防守方版／B 自 KO 版），我被擊倒時兩個條件同時成立。v6.420 以前全站共用一個
//      拖曳位移、兩個視窗永遠疊在一起一起動，所以看不出來；v6.420 改成各自位移後就露出來了。
//      同型（整體 audit）：招式前置的 stepper 視窗（波盪水｜蜿蜒割裂，H 標）與通用視窗條件重疊 ⇒ 也是兩個。
//   ② v6.420 的夾制是「視窗完整留在畫面內」⇒ 手機上的大視窗幾乎拖不動，也拖不到角落。
// 修法：`src/lib/game/modal-slots.ts`（該開哪個視窗的唯一判準）＋ modal-drag.ts 預設 `reachable` 夾制
//   （可以拖到畫面外，只保證把手留在畫面內；浮動按鈕／面板改用 `contain`）。
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const esbuild = require_('esbuild');
let pass = 0, fail = 0; const failed = [];
const T = async (name, fn) => { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; failed.push(name.split(' ')[0]); console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };

const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
const tmp = mkdtempSync(join(tmpdir(), 'v6425p-'));
async function load(rel) {
  if (!existsSync(join(ROOT, rel))) return {};
  const out = join(tmp, rel.replace(/[\/.]/g, '_') + '.mjs');
  await esbuild.build({ entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent' });
  return import(pathToFileURL(out).href);
}
// ⚠ Rule 41：BASE 上 modal-slots.ts 不存在 ⇒ 用哨兵，每一條各自紅
const SL = await load('src/lib/game/modal-slots.ts');
const MD = await load('src/lib/modal-drag.ts');
const MISSING = () => { throw new Error('（BASE 上沒有這支函式）'); };
const F = (m, n) => (typeof m[n] === 'function' ? m[n] : MISSING);
const promoteModalSeats = F(SL, 'promoteModalSeats'), promoteAlerts = F(SL, 'promoteAlerts'), preDiscardModalKind = F(SL, 'preDiscardModalKind');
const clamp = F(MD, 'clampModalOffset');

const P = (active, bench = 1) => ({ active: active ? { iid: 'a' } : null, bench: Array.from({ length: bench }, (_, i) => ({ iid: 'b' + i })) });
const base = (o) => ({ phase: 'playing', hasPendingSelection: false, isSpectator: false, ...o });
// 舊碼兩個 modal 的條件（逐字搬過來當正對照：證明情境真的會同時成立）
const oldA = (v) => v.phase === 'playing' && v.players[v.defenderIdx].active === null && v.defenderTurnMine && !v.hasPendingSelection && !v.isSpectator;
const oldB = (v) => v.phase === 'playing' && v.players[v.myIdx].active === null && v.players[v.myIdx].bench.length > 0 && !v.hasPendingSelection && !v.isSpectator;

console.log('【A】補位視窗：一個座位只開一個');
await T('A1 ⭐⭐⭐【HEAD-FAIL】線上：我被對手擊倒（防守方＝我）⇒ 只開一個視窗（舊碼 A、B 同時成立＝兩個）', () => {
  const v = base({ players: [P(false, 4), P(true)], defenderIdx: 0, myIdx: 0, defenderTurnMine: true });
  assert.ok(oldA(v) && oldB(v), '正對照失效：這個情境在舊碼下應該兩個條件都成立');
  assert.deepStrictEqual(promoteModalSeats(v), [0]);
});
await T('A2 自 KO（中毒於我的回合結束／咒詛炸彈）⇒ 我的座位一個視窗', () => {
  const v = base({ players: [P(false, 2), P(true)], defenderIdx: 1, myIdx: 0, defenderTurnMine: false });
  assert.deepStrictEqual(promoteModalSeats(v), [0]);
});
await T('A3 本機雙人：雙方同時被擊倒 ⇒ 兩個**不同**座位（兩份不同備戰區，兩個視窗是對的）', () => {
  const v = base({ players: [P(false, 2), P(false, 3)], defenderIdx: 1, myIdx: 0, defenderTurnMine: true });
  assert.deepStrictEqual(promoteModalSeats(v), [1, 0]);
});
await T('A4 觀戰者／攻擊方還在處理效果／非對戰階段 ⇒ 不開', () => {
  const v = { players: [P(false, 2), P(true)], defenderIdx: 0, myIdx: 0, defenderTurnMine: true };
  assert.deepStrictEqual(promoteModalSeats(base({ ...v, isSpectator: true })), []);
  assert.deepStrictEqual(promoteModalSeats(base({ ...v, hasPendingSelection: true })), []);
  assert.deepStrictEqual(promoteModalSeats(base({ ...v, phase: 'game-over' })), []);
});
await T('A5 ⭐⭐【HEAD-FAIL】提示列：「請派出」最多一條；特性擊倒對手（主要階段）時「等待對手」也只一條', () => {
  const me = promoteAlerts(base({ players: [P(false, 4), P(true)], defenderIdx: 0, myIdx: 0, oppIdx: 1, defenderTurnMine: true, isMyTurn: false, turnPhase: 'end' }));
  assert.deepStrictEqual(me, { mine: true, waitSeat: null });
  // 我在主要階段用特性擊倒對手：舊碼「等待 X 送出寶可夢」＋「等待 X 送出新戰鬥寶可夢」兩條
  const v = base({ players: [P(true), P(false, 2)], defenderIdx: 1, myIdx: 0, oppIdx: 1, defenderTurnMine: false, isMyTurn: true, turnPhase: 'main' });
  assert.deepStrictEqual(promoteAlerts(v), { mine: false, waitSeat: 1 });
});
await T('A6 ⭐⭐【HEAD-FAIL】對戰頁：補位視窗只剩一個 {#each}、「請派出」提示文字只出現一次', () => {
  assert.strictEqual((PAGE.match(/\{#each promoteSeatsList as _ps \(_ps\)\}/g) || []).length, 1, '補位視窗不是單一 {#each}');
  assert.strictEqual((PAGE.match(/請從備戰區派出新的戰鬥寶可夢（下方視窗選擇）/g) || []).length, 1, '「請派出」提示仍有多份');
  assert.strictEqual((PAGE.match(/<h3>⚠️ 派出新的戰鬥寶可夢/g) || []).length, 1, '補位視窗標題仍有多份');
  assert.ok(/promoteModalSeats\(\{/.test(PAGE) && /promoteAlerts\(\{/.test(PAGE), '對戰頁沒有走中央判準');
});

console.log('【B】招式前置三種視窗互斥（波盪水｜蜿蜒割裂）');
await T('B1 ⭐⭐【HEAD-FAIL】preDiscardModalKind 三分類', () => {
  assert.strictEqual(preDiscardModalKind('self-counter-stepper'), 'stepper');
  assert.strictEqual(preDiscardModalKind('binary-yes-no'), 'binary');
  for (const s of ['attacker', 'any-own', 'own-bench', 'hand-tool', 'hand-energy', undefined]) assert.strictEqual(preDiscardModalKind(s), 'picker', String(s));
});
await T('B2 ⭐⭐【HEAD-FAIL】對戰頁三個 {#if preAttackDiscard} 視窗都用 preDiscardModalKind、三個值各一次，不再有 scope 直接比較', () => {
  const heads = [...PAGE.matchAll(/\{#if preAttackDiscard && game && ([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(heads.length >= 3, '只掃到 ' + heads.length + ' 個視窗（掃描器壞了？）');
  const kinds = heads.map((h) => (/preDiscardModalKind\(preAttackDiscard\.spec\.scope\) === '(\w+)'/.exec(h) || [])[1]);
  assert.ok(kinds.every(Boolean), '有視窗沒走 preDiscardModalKind：' + JSON.stringify(heads));
  assert.deepStrictEqual([...kinds].sort(), ['binary', 'picker', 'stepper'], '三種各一次：' + JSON.stringify(kinds));
  assert.ok(!heads.some((h) => /spec\.scope [!=]==/.test(h)), '還有 scope 直接比較');
});

console.log('【C】夾制：一般視窗可以拖到畫面外，把手永遠抓得到');
const vis = (b, o, vw, vh, mode) => {
  const off = clamp(b, o, vw, vh, mode);
  const l = b.left + off.x, t = b.top + off.y;
  return { l, t, visW: Math.min(l + b.width, vw) - Math.max(l, 0), visH: Math.min(t + b.height, vh) - Math.max(t, 0) };
};
const B = { left: 10, top: 120, width: 355, height: 430 };   // 手機直式的補位視窗量級
await T('C1 ⭐⭐⭐【HEAD-FAIL】手機 375×667：往右下拖 ⇒ 大半個視窗可以出畫面（看得到底下的紀錄）', () => {
  const r = vis(B, { x: 9999, y: 9999 }, 375, 667);
  assert.ok(r.visW < B.width / 2 && r.visH < B.height / 2, '視窗仍被鎖在畫面內：可見 ' + r.visW.toFixed(0) + '×' + r.visH.toFixed(0));
});
for (const [dx, dy, dir] of [[9999, 0, '右'], [-9999, 0, '左'], [0, 9999, '下'], [9999, 9999, '右下'], [-9999, 9999, '左下'], [0, -9999, '上']]) {
  await T(`C2 往${dir}拖到底：把手仍抓得到（水平 ≥ 72px、上緣 ∈ [0, 畫面高 − 56]）`, () => {
    for (const [vw, vh] of [[375, 667], [320, 568], [1280, 800]]) {
      const r = vis(B, { x: dx, y: dy }, vw, vh);
      assert.ok(r.visW >= 72 - 0.01, `@${vw}x${vh} 水平只剩 ${r.visW}`);
      assert.ok(r.t >= -0.01 && r.t <= vh - 56 + 0.01, `@${vw}x${vh} 上緣 ${r.t}`);
    }
  });
}
await T('C3 contain 模式（浮動按鈕／面板）仍然完整留在畫面內', () => {
  const r = vis(B, { x: 9999, y: 9999 }, 375, 667, 'contain');
  assert.ok(r.visW >= B.width - 0.01 && r.visH >= B.height - 0.01, JSON.stringify(r));
});
await T('C5 ⭐手機底部系統手勢區（safeBottom）：把手露出量要再加上它', () => {
  const off0 = clamp(B, { x: 0, y: 9999 }, 375, 667, 'reachable', 0);
  const off34 = clamp(B, { x: 0, y: 9999 }, 375, 667, 'reachable', 34);
  assert.strictEqual(B.top + off0.y, 667 - 56);
  assert.strictEqual(B.top + off34.y, 667 - 56 - 34, '沒有把 safeBottom 算進去');
});
await T('C4 ⭐五個浮動元件（聊天鈕／聊天面板／對手回合鈕與面板／進化選單）明確帶 contain', () => {
  const n = (PAGE.match(/use:modalDrag=\{\{ clamp: 'contain',/g) || []).length;
  assert.strictEqual(n, 5, '實得 ' + n);
  for (const cls of ['float-evo-menu', 'opp-turn-panel-header', 'chat-panel-header']) assert.ok(PAGE.includes(cls), cls);
});

console.log('【D】Playwright：真的拖一次（預設 reachable）');
const chromium = MD.modalDrag ? pwChromium('v6.425 【D】reachable 夾制實測') : null;
if (!MD.modalDrag) await T('D0 ⭐【HEAD-FAIL】中央拖曳模組可載入', () => assert.fail('modal-drag 不存在'));
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.425 【D】reachable 夾制實測');
  if (browser) {
    try {
      const bundle = join(tmp, 'md-iife.js');
      await esbuild.build({ entryPoints: [join(ROOT, 'src/lib/modal-drag.ts')], bundle: true, format: 'iife', globalName: 'MDRAG', outfile: bundle, logLevel: 'silent' });
      const md = readFileSync(bundle, 'utf8');
      const HTML = `<!doctype html><html><head><style>
        html,body{margin:0;height:100%;}
        #log{position:fixed;left:0;right:0;bottom:0;height:200px;background:#050;}
        .selection-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;}
        .selection-overlay.dragged{background:transparent;pointer-events:none;}
        .selection-overlay.dragged .selection-modal{pointer-events:auto;}
        .selection-modal{background:#123;width:355px;height:430px;position:relative;padding:.6rem;box-sizing:border-box;}
        .sel-header{height:40px;background:#245;color:#fff;touch-action:none;}   /* 手機直式正式數值：modal padding .6rem＋把手約 40px */
        .x{position:absolute;right:4px;top:8px;}
      </style></head><body>
        <div id="log">對戰紀錄</div>
        <div class="selection-overlay"><div class="selection-modal" id="m">
          <div class="sel-header" id="h">把手<button class="x" id="x">✕</button></div>
        </div></div></body></html>`;
      const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
      const pg = await ctx.newPage();
      await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: HTML }));
      await pg.goto('https://t.local/');
      await pg.addScriptTag({ content: md });
      await pg.evaluate(() => { window.__x = 0; document.getElementById('x').onclick = () => { window.__x++; }; window.MDRAG.modalDrag(document.getElementById('m')); });
      const h = await pg.locator('#h').boundingBox();
      await pg.mouse.move(h.x + 40, h.y + 20); await pg.mouse.down();
      await pg.mouse.move(h.x + 40 + 2000, h.y + 20 + 2000, { steps: 8 }); await pg.mouse.up();
      const st = await pg.evaluate(() => {
        const r = document.getElementById('m').getBoundingClientRect();
        const hit = document.elementFromPoint(60, 600);   // 左下角：紀錄區
        const btn = document.querySelector('#m .modal-collapse-btn');
        const hr = document.getElementById('h').getBoundingClientRect();
        const lead = btn ? btn.getBoundingClientRect().right : hr.left;
        return { l: r.left, t: r.top, logHit: !!hit && hit.id === 'log', grabW: Math.min(hr.right, innerWidth) - Math.max(lead, hr.left, 0) };
      });
      await T('D1 ⭐⭐⭐【HEAD-FAIL】手機：往右下拖之後，左下的對戰紀錄**看得到也點得到**', () => {
        assert.ok(st.logHit, '紀錄區仍被視窗或遮罩蓋住：' + JSON.stringify(st));
      });
      await T('D2 ⭐⭐ 把手一角仍在畫面內（≥ 72px 寬、上緣 ≤ 畫面高 − 56）', () => {
        assert.ok(st.l <= 375 - 72 + 0.5 && st.t <= 667 - 56 + 0.5 && st.t >= 0, JSON.stringify(st));
        // ⭐v6.426（fable 審查）：露出區扣掉 padding 與折疊鈕之後，**真正能拖的把手**至少要 47px 寬
        assert.ok(st.grabW >= 47, '往右拖到底後能拖的把手只剩 ' + st.grabW.toFixed(1) + 'px（手機上抓不回來）');
      });
      // 從露在畫面內的把手一角拖回來 ⇒ 關閉鈕點得到（「拖走之後永遠拖得回來」＝v6.420 真正要防的事）
      // ⭐v6.426（fable 審查）：抓把手露出區的**最右邊**（畫面右緣內 6px）——證明整條露出區裡真的有能拖的把手，
      //   不是只靠抓在某個幸運座標（v6.426 起把手最前面是折疊鈕，按下去不拖曳）。
      await pg.mouse.move(375 - 6, st.t + 20); await pg.mouse.down();
      await pg.mouse.move(375 - 6 - 2000, st.t + 20 - 2000, { steps: 8 }); await pg.mouse.up();
      const xb = await pg.locator('#x').boundingBox();
      await pg.mouse.click(xb.x + xb.width / 2, xb.y + xb.height / 2);
      const clicked = await pg.evaluate(() => window.__x);
      await T('D3 ⭐⭐⭐ 拖出去之後，從露出的把手拖回來 ⇒ 關閉鈕按得到（不會卡死）', () => {
        assert.strictEqual(clicked, 1, '關閉鈕沒被按到');
      });
      // D4：拖到底之後視窗內容變矮（置中容器會讓視窗自己往下滑）⇒ ResizeObserver 重夾，把手仍在畫面內
      const h2 = await pg.locator('#h').boundingBox();
      await pg.mouse.move(h2.x + 30, h2.y + 15); await pg.mouse.down();
      await pg.mouse.move(h2.x + 30, h2.y + 15 + 2000, { steps: 8 }); await pg.mouse.up();
      await pg.evaluate(() => { document.getElementById('m').style.height = '230px'; });
      await pg.waitForTimeout(120);
      const t4 = await pg.evaluate(() => document.getElementById('h').getBoundingClientRect().top);
      await T('D4 ⭐⭐【fable 審查】拖到底後視窗內容變矮 ⇒ 自動重夾，把手仍在畫面內（不會滑出去抓不回來）', () => {
        assert.ok(t4 >= 0 && t4 <= 667 - 20, '把手滑到 top=' + t4);
      });
      await ctx.close();
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.425 補位視窗去重＋視窗可拖出畫面：PASS ${pass} / FAIL ${fail} ===` + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail) process.exit(1);
