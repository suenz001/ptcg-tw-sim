/**
 * v6.423 守衛：對戰畫面四個浮動元件（聊天 FAB、聊天面板、對手回合按鈕、對手回合面板）
 *   的拖曳收斂到中央 `src/lib/modal-drag.ts`（v6.420 列管項目）。
 *
 * 【為什麼】v6.420 把所有「會蓋住畫面的視窗」收斂進中央 action 並加上邊界夾制，但這四個
 *   浮動元件各自還有一份 pointer 數學：對手回合按鈕／面板**完全沒有夾制**（拖出畫面就找不回來），
 *   聊天面板在桌機也沒有夾制，四份寫法彼此不同（Rule 38：判準只能有一份）。
 * 【中央 action 為此新增的選項】wholeNode（元素本身就是把手，給 <button> 用）、threshold（輕觸不算拖）、
 *   拖曳後吃掉緊接著的 click、stopPropagation（v5.231 防穿透）、overlay:false、initial／onEnd（保存位置）、
 *   mode:'margin'（v5.626：iOS 上 fixed＋transform 會破壞聊天面板內部捲動）。
 *
 * 【HEAD-FAIL】BASE（v6.422）實測 PASS 10 / FAIL 9（S1～S4、H1、H3、H4、H9、H10）。BASE 也綠的是刻意的：
 *   S0（anchor）、S5（反安慰劑）、H5～H8、H11～H13（零回歸／對照；H2 在 BASE 因為拖不動而不成立前置，已改成先斷言有拖動）。
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { build } from 'esbuild';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { templateOnly as templateOnlyChecked, GAME_INLINE_STYLE } from './lib/strip-markup-sections.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0; const failed = [];
const T = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; failed.push(name.split(' ')[0]); console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };
const TA = async (name, fn) => { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; failed.push(name.split(' ')[0]); console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };

const GAME = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const gameT = templateOnlyChecked(GAME, { label: 'game', minSections: 1, mustKeep: ['chat-fab'], allowResidual: [GAME_INLINE_STYLE] });

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【S】靜態：四個浮動元件都走中央 action，舊的四份實作不在了');
// 取出某個元素的開始標籤（到第一個不在 {…} 內的 `>` 為止）
function openTag(tpl, needle) {
  const i = tpl.indexOf(needle);
  if (i < 0) return '';
  let depth = 0;
  for (let k = i; k < Math.min(tpl.length, i + 1500); k++) {
    const ch = tpl[k];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return tpl.slice(i, k + 1);
  }
  return '';
}
const TAGS = {
  fab: openTag(gameT, '<button class="chat-fab"'),
  oppBtn: openTag(gameT, '<button class="opp-turn-toggle-btn"'),
  oppPanel: openTag(gameT, '<div class="opp-turn-panel"'),
  chatPanel: openTag(gameT, '<div class="chat-panel"'),
};
T('S0 ⭐四個元件的開始標籤都抓得到（anchor 自檢，否則下面全是空真）', () => {
  for (const [k, v] of Object.entries(TAGS)) assert.ok(v.length > 20 && v.length < 1400, `${k} 抓不到（${v.length}）`);
});
T('S1 ⭐⭐⭐【HEAD-FAIL】四個元件都掛 use:modalDrag、而且不再用 inline transform 自己定位', () => {
  for (const [k, v] of Object.entries(TAGS)) {
    assert.ok(v.includes('use:modalDrag'), `${k} 沒有掛中央 action`);
    assert.ok(!/style:transform|style:margin-(left|top)/.test(v), `${k} 還在用 inline style 自己定位（會和中央 action 打架）`);
  }
});
T('S2 ⭐⭐【HEAD-FAIL】兩顆浮動按鈕：wholeNode（按鈕本身是把手）＋門檻＋防穿透＋不動 overlay；FAB 門檻沿用 v5.591 的 12px', () => {
  for (const k of ['fab', 'oppBtn']) {
    assert.ok(/wholeNode:\s*true/.test(TAGS[k]) && /stopPropagation:\s*true/.test(TAGS[k]) && /overlay:\s*false/.test(TAGS[k]), `${k} 選項不齊`);
  }
  assert.ok(/threshold:\s*12\b/.test(TAGS.fab), 'FAB 的輕觸門檻不是 12px（手機輕觸會被當成拖曳而打不開聊天室）');
  assert.ok(/threshold:\s*5\b/.test(TAGS.oppBtn), '對手回合按鈕的門檻不是 5px（v5.057）');
  assert.ok(/onclick=\{toggleChatPanel\}/.test(TAGS.fab), 'FAB 沒有改用 onclick 開面板（拖曳後的 click 由中央吃掉）');
  assert.ok(/onEnd:\s*saveChatFabPos/.test(TAGS.fab) && /initial:\s*chatFabPos/.test(TAGS.fab), 'FAB 的位置沒有保存／還原');
});
T('S3 ⭐⭐【HEAD-FAIL】聊天面板：手機直式用 margin 位移（v5.626 iOS 捲動），桌機用 translate', () => {
  assert.ok(/mode:\s*isPortraitMobile\s*\?\s*'margin'\s*:\s*'translate'/.test(TAGS.chatPanel), '聊天面板沒有依手機直式切 margin 模式');
  assert.ok(/handle:\s*'\.chat-panel-header'/.test(TAGS.chatPanel), '聊天面板的把手不是 header');
  assert.ok(/handle:\s*'\.opp-turn-panel-header'/.test(TAGS.oppPanel), '對手回合面板的把手不是 header');
  for (const k of ['chatPanel', 'oppPanel']) assert.ok(/overlay:\s*false/.test(TAGS[k]), `${k} 沒有 overlay:false（會誤把祖先變透明）`);
});
T('S4 ⭐⭐⭐【HEAD-FAIL】判準只有一份：game/+page.svelte 不得再有自己的浮動拖曳實作（剝註解後）', () => {
  const code = stripCommentsBlankChecked(GAME.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')));
  for (const tok of ['chatFabDragStart', 'chatFabDragged', 'onFabPointerDown', 'onFabPointerMove', 'onFabPointerUp',
    'clampChatFabPos', 'chatPanelDragStart', 'onChatHeaderDown', 'onChatHeaderMove', 'onChatHeaderUp',
    'oppTurnDragStart', 'onOppTurnDragStart', 'onOppTurnDragMove', 'onOppTurnDragEnd',
    'oppTurnToggleDragStart', 'onOppTurnToggleDragStart', 'onOppTurnToggleDragMove', 'onOppTurnToggleDragEnd', 'oppTurnToggleMoved']) {
    assert.ok(!code.includes(tok), `還有自己那一份拖曳：${tok}`);
  }
});
T('S5 ⭐反安慰劑：S4 的掃描對 BASE 那一份的寫法確實會紅（餵一段舊碼樣本）', () => {
  const sample = 'function onFabPointerDown(e) { chatFabDragStart = {}; }';
  assert.ok(['onFabPointerDown', 'chatFabDragStart'].some((t) => stripCommentsBlankChecked(sample + '\n' + GAME.slice(0, 4000)).includes(t)));
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【H】Playwright：中央 action 的新選項實測');
const chromium = pwChromium('v6.423 【H】浮動按鈕／面板拖曳實測');
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.423 【H】浮動按鈕／面板拖曳實測');
  if (browser) {
    try {
      const dir = mkdtempSync(join(tmpdir(), 'v6423h-'));
      await build({ entryPoints: [join(ROOT, 'src/lib/modal-drag.ts')], bundle: true, format: 'iife', globalName: 'MDRAG',
        outfile: join(dir, 'md.js'), logLevel: 'silent' });
      const md = readFileSync(join(dir, 'md.js'), 'utf8');
      const HTML = `<!doctype html><html><head><style>
        html,body{margin:0;height:100%;}
        .wrap-overlay{position:fixed;inset:0;}
        #fab{position:fixed;right:18px;bottom:18px;width:54px;height:54px;border-radius:50%;touch-action:none;}
        #panel{position:fixed;left:10px;top:40px;width:300px;height:300px;background:#123;}
        #ph{height:40px;background:#245;touch-action:none;}
      </style></head><body>
        <div class="wrap-overlay" id="ov">
          <button id="fab">💬</button>
          <div id="panel"><div id="ph">把手<button id="nav">◀</button></div></div>
        </div>
      </body></html>`;
      const open = async (vw = 375, vh = 667) => {
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
        const pg = await ctx.newPage();
        await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: HTML }));
        await pg.goto('https://t.local/');
        await pg.addScriptTag({ content: md });
        return { ctx, pg };
      };
      const mountFab = (pg, extra = '{}') => pg.evaluate((extraSrc) => {
        const extra = JSON.parse(extraSrc);
        window.__clicks = 0; window.__ends = []; window.__parentDown = 0;
        const fab = document.getElementById('fab');
        fab.addEventListener('click', () => { window.__clicks++; });
        document.getElementById('ov').addEventListener('pointerdown', () => { window.__parentDown++; });
        window.__h = window.MDRAG.modalDrag(fab, { wholeNode: true, threshold: 12, stopPropagation: true, overlay: false,
          onEnd: (o) => { window.__ends.push(o); }, ...extra });
      }, extra);
      const state = (pg) => pg.evaluate(() => {
        const r = document.getElementById('fab').getBoundingClientRect();
        return { clicks: window.__clicks, ends: window.__ends, parentDown: window.__parentDown, translate: document.getElementById('fab').style.translate,
          inView: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
          ovDragged: document.getElementById('ov').classList.contains('dragged') };
      });
      const center = async (pg, id) => { const b = await pg.locator('#' + id).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

      { // H1／H2／H4／H5：拖曳一顆按鈕
        const { ctx, pg } = await open(); await mountFab(pg);
        const [cx, cy] = await center(pg, 'fab');
        await pg.mouse.move(cx, cy); await pg.mouse.down();
        await pg.mouse.move(cx - 150, cy - 200, { steps: 8 }); await pg.mouse.up();
        const s = await state(pg);
        await TA('H1 ⭐⭐⭐【HEAD-FAIL】wholeNode：按鈕本身當把手拖得動（BASE：按在 <button> 上一律不拖）', () => {
          assert.ok(s.translate && s.translate !== '0px 0px', `沒有移動（translate=${s.translate}）`);
        });
        await TA('H2 ⭐⭐⭐【HEAD-FAIL】拖曳結束後緊接著的 click 被吃掉（否則拖完聊天室就被打開）', () => {
          assert.ok(s.translate && s.translate !== '0px 0px', '前置不成立：沒有真的拖動（否則 click 本來就不會發生，這條是空真）');
          assert.strictEqual(s.clicks, 0, `拖曳後觸發了 ${s.clicks} 次 click`);
        });
        await TA('H3 ⭐⭐【HEAD-FAIL】拖曳結束 onEnd 收到目前位移（呼叫端才能保存位置）', () => {
          assert.strictEqual(s.ends.length, 1, `onEnd 呼叫 ${s.ends.length} 次`);
          assert.ok(s.ends[0].x < -100 && s.ends[0].y < -100, JSON.stringify(s.ends[0]));
        });
        await TA('H4 ⭐⭐【HEAD-FAIL】stopPropagation：父層收不到 pointerdown（v5.231 防穿透點到下面的卡）', () => {
          assert.strictEqual(s.parentDown, 0, `父層收到 ${s.parentDown} 次`);
        });
        await TA('H5 ⭐overlay:false：祖先（class 含 overlay）不會被加上 dragged', () => { assert.strictEqual(s.ovDragged, false); });
        // 之後真正的點擊不能被吃掉
        await pg.waitForTimeout(30);
        const [cx2, cy2] = await center(pg, 'fab');
        await pg.mouse.click(cx2, cy2);
        const s2 = await state(pg);
        await TA('H6 ⭐⭐拖曳之後「下一次真正的點擊」照常觸發（吃 click 只吃緊接著的那一個）', () => { assert.strictEqual(s2.clicks, 1, `clicks=${s2.clicks}`); });
        await ctx.close();
      }
      { // H7：輕觸抖動（8px < 12px）
        const { ctx, pg } = await open(); await mountFab(pg);
        const [cx, cy] = await center(pg, 'fab');
        await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(cx + 5, cy + 3, { steps: 3 }); await pg.mouse.up();
        const s = await state(pg);
        await TA('H7 ⭐⭐⭐【HEAD-FAIL】輕觸有 8px 抖動（門檻 12px 以內）⇒ 按鈕不動、click 照常觸發（手機點得開聊天室）', () => {
          assert.ok(!s.translate, `輕觸就位移了（${s.translate}）`);
          assert.strictEqual(s.clicks, 1, `clicks=${s.clicks}`);
          assert.strictEqual(s.ends.length, 0, '輕觸不應該觸發 onEnd（不必寫 localStorage）');
        });
        await ctx.close();
      }
      { // H8：拖出畫面的夾制
        const { ctx, pg } = await open(); await mountFab(pg);
        const [cx, cy] = await center(pg, 'fab');
        await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(cx - 3000, cy - 3000, { steps: 8 }); await pg.mouse.up();
        const s = await state(pg);
        await TA('H8 ⭐⭐⭐按鈕往左上拖 3000px 仍完整留在畫面內（舊的對手回合按鈕沒有夾制）', () => { assert.ok(s.inView, JSON.stringify(s)); });
        await ctx.close();
      }
      { // H9：還原的初始位置在畫面外 ⇒ 掛載後夾制並回報
        const { ctx, pg } = await open(); await mountFab(pg, JSON.stringify({ initial: { x: -5000, y: -5000 } }));
        await pg.waitForTimeout(80);
        const s = await state(pg);
        await TA('H9 ⭐⭐⭐【HEAD-FAIL】initial 還原到畫面外（換裝置／轉向）⇒ 掛載後自動夾回畫面內，並透過 onEnd 更新保存值', () => {
          assert.ok(s.translate, '初始位移根本沒套用');
          assert.ok(s.inView, JSON.stringify(s));
          assert.ok(s.ends.length === 1 && s.ends[0].x > -5000, `沒有回報夾制後的位置：${JSON.stringify(s.ends)}`);
        });
        await ctx.close();
      }
      { // H10／H11：面板（handle）＋ margin 模式
        const { ctx, pg } = await open();
        await pg.evaluate(() => { window.__p = window.MDRAG.modalDrag(document.getElementById('panel'), { handle: '#ph', overlay: false, mode: 'margin' }); });
        const b = await pg.locator('#ph').boundingBox();
        await pg.mouse.move(b.x + 200, b.y + 20); await pg.mouse.down(); await pg.mouse.move(b.x + 260, b.y + 90, { steps: 6 }); await pg.mouse.up();
        const r1 = await pg.evaluate(() => { const p = document.getElementById('panel'); return { ml: p.style.marginLeft, mt: p.style.marginTop, tr: p.style.translate }; });
        await TA('H10 ⭐⭐⭐【HEAD-FAIL】mode:margin ⇒ 用 margin 位移、不寫 translate（v5.626：iOS fixed＋transform 會破壞面板內捲動）', () => {
          assert.ok(r1.ml === '60px' && r1.mt === '70px', JSON.stringify(r1));
          assert.ok(!r1.tr, `仍寫了 translate：${r1.tr}`);
        });
        await pg.evaluate(() => { window.__p.update({ handle: '#ph', overlay: false, mode: 'translate' }); });
        const r2 = await pg.evaluate(() => { const p = document.getElementById('panel'); return { ml: p.style.marginLeft, mt: p.style.marginTop, tr: p.style.translate }; });
        await TA('H11 ⭐⭐切換模式（手機轉成橫向）⇒ 清掉另一種的殘值、位移不變', () => {
          assert.ok(!r2.ml && !r2.mt && r2.tr === '60px 70px', JSON.stringify(r2));
        });
        const nb = await pg.locator('#nav').boundingBox();
        await pg.mouse.move(nb.x + 5, nb.y + 5); await pg.mouse.down(); await pg.mouse.move(nb.x + 100, nb.y + 100, { steps: 5 }); await pg.mouse.up();
        const r3 = await pg.evaluate(() => document.getElementById('panel').style.translate);
        await TA('H12 ⭐把手裡的按鈕（◀ ▶ ✕）按下去拖不會拖動面板（按鈕要按得到）', () => { assert.strictEqual(r3, '60px 70px'); });
        await ctx.close();
      }
      { // H14：拖曳被中斷（pointercancel，不會產生 click）⇒ 之後真正的點擊不能被吃掉
        const { ctx, pg } = await open(); await mountFab(pg);
        await pg.evaluate(() => {
          const f = document.getElementById('fab'); const r = f.getBoundingClientRect();
          const o = { bubbles: true, pointerId: 9, clientX: r.left + 20, clientY: r.top + 20 };
          f.dispatchEvent(new PointerEvent('pointerdown', o));
          f.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: o.clientX - 100, clientY: o.clientY - 100 }));
          f.dispatchEvent(new PointerEvent('pointercancel', o));
        });
        await pg.waitForTimeout(40);
        const [cx, cy] = await center(pg, 'fab');
        await pg.mouse.click(cx, cy);
        const s = await state(pg);
        await TA('H14 ⭐⭐拖曳被中斷（沒有產生 click）⇒ 下一次真正的點擊照常觸發（吃 click 的旗標必須過期）', () => {
          assert.ok(s.translate, '前置不成立：中斷前沒有真的拖動');
          assert.strictEqual(s.clicks, 1, `clicks=${s.clicks}`);
        });
        await ctx.close();
      }
      { // H13：沒有給 threshold 的一般視窗維持 v6.420 行為（第一個 px 就跟手）
        const { ctx, pg } = await open();
        await pg.evaluate(() => { window.MDRAG.modalDrag(document.getElementById('panel'), { handle: '#ph', overlay: false }); });
        const b = await pg.locator('#ph').boundingBox();
        await pg.mouse.move(b.x + 200, b.y + 20); await pg.mouse.down(); await pg.mouse.move(b.x + 202, b.y + 20);
        const tr = await pg.evaluate(() => document.getElementById('panel').style.translate);
        await pg.mouse.up();
        await TA('H13 ⭐零回歸：一般視窗（未指定 threshold）拖 2px 就跟手（v6.420 行為不變）', () => { assert.ok(tr === '2px' || tr === '2px 0px', tr); });
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.423 浮動元件拖曳中央化：${pass} PASS / ${fail} FAIL ===` + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail > 0) process.exit(1);
