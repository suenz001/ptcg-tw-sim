#!/usr/bin/env node
/**
 * v6.488 守衛：電腦版牌桌鍵盤快捷鍵（站長同意的建議 #7；預設關閉）。
 *   【S】對戰頁 onGlobalKey 第一行交給 runKbdShortcut；設定視窗掛 KbdShortcutsSetting（開關存在 localStorage）。
 *   【L】kbdActionFor：Enter＝確定、L＝對戰紀錄；輸入框／下拉／可編輯區、Ctrl／Alt／⌘、長按重複、焦點在按鈕或連結上的 Enter 一律不攔。
 *   【H】真瀏覽器（模擬對戰頁按鈕）：開關打開＋滑鼠裝置 ⇒ Enter 按下選擇視窗唯一能按的「確定」、L 按紀錄開關；
 *        沒打開／觸控裝置／按鈕停用／同時有兩顆／在輸入框打字 ⇒ 一律不按。
 * HEAD-FAIL：靜態判準餵 v6.487 必須紅。
 * Run: node scripts/test-v6488-kbd-shortcuts.mjs
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.487。
const BASE_SHA = '63b7e9fc';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const judge = (get) => {
  const g = get('src/routes/game/+page.svelte');
  return {
    S1: /function onGlobalKey\(e: KeyboardEvent\) \{\n\s*if \(runKbdShortcut\(e\)\) return;/.test(g),
    S2: /<KbdShortcutsSetting \/>\n\s*<\/div>\n\s*<\/div>\n\s*\{\/if\}/.test(g),
  };
};
console.log('【S】靜態');
const J = judge(rd);
ok('★★★[S1] 對戰頁全域按鍵先交給 runKbdShortcut', J.S1);
ok('★★★[S2] 設定視窗有鍵盤快捷鍵開關', J.S2);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.487 全紅', !B.S1 && !B.S2, JSON.stringify(B));
} else shallowSkip('v6488 S0：HEAD-FAIL', '需要 BASE commit');

const require_ = createRequire(import.meta.url);
const esbuild = require_('esbuild');
const tmp = mkdtempSync(join(tmpdir(), 'v6488-'));
await esbuild.build({ entryPoints: [join(ROOT, 'src/lib/game/kbd-shortcuts.ts')], bundle: true, format: 'esm', outfile: join(tmp, 'k.mjs'), logLevel: 'silent' });
const K = await import(join(tmp, 'k.mjs'));
console.log('\n【L】按鍵判斷');
{
  const f = K.kbdActionFor;
  ok('★★★[L1] Enter＝確定、L／l＝對戰紀錄、其他鍵不攔', f({ key: 'Enter' }, { tagName: 'DIV' }) === 'confirm' && f({ key: 'l' }, null) === 'log' && f({ key: 'L' }, { tagName: 'BODY' }) === 'log' && f({ key: 'e' }, null) === null && f({ key: ' ' }, null) === null);
  ok('★★★[L2] 在輸入框／多行輸入／下拉／可編輯區打字 ⇒ 不攔', ['INPUT', 'TEXTAREA', 'SELECT'].every((t) => f({ key: 'Enter' }, { tagName: t }) === null && f({ key: 'l' }, { tagName: t }) === null) && f({ key: 'l' }, { tagName: 'DIV', isContentEditable: true }) === null);
  ok('★★[L3] Ctrl／Alt／⌘、長按重複 ⇒ 不攔', f({ key: 'l', ctrlKey: true }, null) === null && f({ key: 'Enter', altKey: true }, null) === null && f({ key: 'l', metaKey: true }, null) === null && f({ key: 'Enter', repeat: true }, null) === null);
  ok('★★[L4] 焦點在按鈕／連結／摺疊標題上的 Enter ⇒ 交給瀏覽器（不重複按）', ['BUTTON', 'A', 'SUMMARY'].every((t) => f({ key: 'Enter' }, { tagName: t }) === null));
}

const chromium = pwChromium('v6.488 快捷鍵');
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.488 快捷鍵');
  if (browser) {
    try {
      console.log('\n【H】真瀏覽器（模擬對戰頁的按鈕）');
      const out = join(tmp, 'k.js');
      await esbuild.build({ entryPoints: [join(ROOT, 'src/lib/game/kbd-shortcuts.ts')], bundle: true, format: 'iife', globalName: 'KBD', outfile: out, logLevel: 'silent' });
      const js = readFileSync(out, 'utf8');
      const HTML = `<!doctype html><html><body>
        <input id="chat">
        <div class="sel-footer"><button class="btn-act secondary" id="skip">跳過</button><button class="btn-act primary" id="ok">確定</button></div>
        <button class="log-toggle-btn" id="log">📜</button>
        <script>window.hits={ok:0,log:0,skip:0};</script></body></html>`;
      const run = async (touch, setup) => {
        const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, isMobile: touch, hasTouch: touch });
        const pg = await ctx.newPage();
        await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: HTML }));
        await pg.goto('https://t.local/'); await pg.addScriptTag({ content: js });
        await pg.evaluate(() => {
          for (const id of ['ok', 'log', 'skip']) document.getElementById(id).addEventListener('click', () => { window.hits[id]++; });
          window.addEventListener('keydown', (e) => window.KBD.runKbdShortcut(e));
        });
        if (setup) await pg.evaluate(setup);
        await pg.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
        await pg.keyboard.press('Enter'); await pg.keyboard.press('l');
        await pg.focus('#chat'); await pg.keyboard.press('Enter'); await pg.keyboard.press('l');
        const h = await pg.evaluate(() => window.hits);
        await ctx.close();
        return h;
      };
      const on = () => localStorage.setItem('ptcg_kbd_shortcuts', '1');
      const A = await run(false, on);
      ok('★★★[H1] 打開＋滑鼠裝置：Enter 按「確定」、L 按紀錄開關（各一次；輸入框裡打的不算）', A.ok === 1 && A.log === 1 && A.skip === 0, JSON.stringify(A));
      const B = await run(false, null);
      ok('★★★[H2] 沒打開（預設）：完全不動作', B.ok === 0 && B.log === 0, JSON.stringify(B));
      const C = await run(true, on);
      ok('★★★[H3] 觸控裝置：就算打開也不動作', C.ok === 0 && C.log === 0, JSON.stringify(C));
      const D = await run(false, () => { localStorage.setItem('ptcg_kbd_shortcuts', '1'); document.getElementById('ok').disabled = true; });
      ok('★★★[H4] 「確定」停用中（還沒選好／送出中）⇒ Enter 不會按', D.ok === 0 && D.log === 1, JSON.stringify(D));
      const E = await run(false, () => { localStorage.setItem('ptcg_kbd_shortcuts', '1'); const b = document.createElement('button'); b.className = 'btn-act primary'; b.textContent = '第二顆'; document.querySelector('.sel-footer').appendChild(b); });
      ok('★★[H5] 同時有兩顆能按的「確定」⇒ 寧可不按', E.ok === 0, JSON.stringify(E));
    } finally { await browser.close(); }
  }
}
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
