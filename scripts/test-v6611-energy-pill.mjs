#!/usr/bin/env node
/**
 * v6.611 守衛：特殊能量標記合成「一顆膠囊」（站長 2026-10-30：「特殊能量的顯示還是佔太大的版面」，看過前後對照圖後同意）
 *
 * 原本（v6.609／v6.610）每一種特殊能量各一顆 22px 高的大按鈕，新版桌墊上戰鬥寶可夢三種特殊能量會疊兩排、蓋住卡圖與招式。
 * 本版：同一隻寶可夢一顆 17px 高的圓角膠囊。
 *   ・文字：數量沿用 v6.610 站長指定（一張省略；多張桌機 ×N、手機 N）；多種以「・」連接；
 *     桌機超過兩種寫「第一種 等N種」；手機全部列出；備戰（compact）一種寫短名、多種寫「特N種」。
 *   ・完整卡名與張數在 aria-label／title；點一下照舊呼叫 oninspect(host)、不冒泡；disabled 不能點。
 *
 * 【T】文字矩陣（桌機／手機 × 戰鬥區／備戰 × 1～3 種、1／2／12 張）
 * 【C】永遠只有一顆按鈕；aria-label 逐種列出完整卡名與張數；點一下 inspect 正確 host、不冒泡；disabled
 * 【G】版面：戰鬥區三種在 86px 寬欄內一行（高 ≤ 18px）、文字不截斷、點得到；備戰 60px 欄被基本能量擠也不縮到看不見
 * 【H】HEAD-FAIL：BASE（v6.610）的元件上 C1（一顆）、G1（一行）逐條紅；T 的「單種」情況在 BASE 也成立（正對照，格式只差空格者除外）
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { pwLaunch } from './lib/pw.mjs';
import { readBaseBlob, shallowSkip, hasBaseCommit } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = '29eeb4cf';
const BADGE = 'src/lib/ui/SpecialEnergyBadges.svelte';
const rd = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 600) : '')); } };

const card = (id, name, subtype = 'Special') => ({ id, name, supertype: 'Energy', subtype });
const CARDS = [card('rock', '硬岩【鬥】能量'), card('sky', '新衝天能量'), card('rocket', '火箭隊能量'), card('boom', '回力鏢能量'), card('anc', '古舊能量'), card('basic', '基本【鬥】能量', 'Basic')];
const host = (ids) => ({ iid: 'host-x', cardId: 'pokemon', damage: 0, energyAttached: ids.map((cardId, i) => ({ iid: 'e' + i, cardId, damage: 0, energyAttached: [] })) });

const plugins = [{ name: 'actual-product', setup(b) {
  b.onResolve({ filter: /^\$lib\// }, (a) => { let p = join(ROOT, 'src/lib', a.path.slice(5)); if (!extname(p)) p += '.ts'; return { path: p }; });
} }];
async function bundle(source) {
  const compiled = compile(source, { filename: 'Pill.svelte', generate: 'client', css: 'injected' }).js.code;
  return (await build({ stdin: { contents: compiled + `\nimport{mount,unmount,tick}from'svelte';let m;window.inspects=[];window.mountSpec=async(s)=>{if(m)await unmount(m);m=mount(Pill,{target:document.querySelector('#mount'),props:{inst:s.inst,pool:new Map(s.cards),compact:s.compact,mobile:s.mobile,disabled:s.disabled,oninspect:i=>window.inspects.push(i)}});await tick();};`, resolveDir: ROOT, sourcefile: 'pill.js' },
    bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['browser'], define: { 'process.env.NODE_ENV': '"production"' }, plugins })).outputFiles[0].text;
}

async function scenarios(page, js) {
  const r = {};
  const mount = async (ids, { compact = false, mobile = false, width = 86, disabled = false, pips = 0 } = {}) => {
    await page.setContent(`<div onclick="document.body.dataset.parent='clicked'"><div id="slot" style="display:flex;align-items:center;width:${width}px;overflow:hidden">${'<span style="flex:none;width:14px;height:14px;margin-right:2px;background:#888;border-radius:50%"></span>'.repeat(pips)}<span id="mount" style="display:contents"></span></div></div>`);
    await page.addScriptTag({ content: js });
    await page.evaluate((s) => window.mountSpec(s), { inst: host(ids), cards: CARDS.map((c) => [c.id, c]), compact, mobile, disabled });
  };
  const texts = async () => page.locator('#slot button').allTextContents();
  // T 文字矩陣
  const want = [
    [['rock'], {}, '硬岩'], [['rock', 'rock'], {}, '硬岩×2'], [Array(12).fill('rock'), {}, '硬岩×12'],
    [['rock', 'rock'], { mobile: true }, '硬岩2'],
    [['rock', 'rock', 'sky'], {}, '硬岩×2・衝天'], [['rock', 'rock', 'sky'], { mobile: true }, '硬岩2・衝天'],
    [['rock', 'rock', 'sky', 'rocket'], {}, '硬岩×2 等3種'], [['rock', 'rock', 'sky', 'rocket'], { mobile: true, width: 220 }, '硬岩2・衝天・火箭'],
    [['rock'], { compact: true, width: 60 }, '硬岩'], [['rock', 'rock'], { compact: true, width: 60 }, '硬岩×2'], [['rock', 'rock'], { compact: true, mobile: true, width: 60 }, '硬岩2'],
    [['rock', 'sky'], { compact: true, width: 60 }, '特2種'], [['rock', 'sky', 'rocket', 'basic'], { compact: true, width: 60 }, '特3種'],
    // 審查 P2-1：兩種合起來超過 7 個字 ⇒ 桌機也縮寫；P3-2：張數多的排前面
    [['rock', 'rock', 'sky', 'sky'], {}, '硬岩×2 等2種'], [['rock', 'rock', 'sky', 'sky'], { mobile: true, width: 220 }, '硬岩2・衝天2'],
    [['sky', 'rock', 'rock'], {}, '硬岩×2・衝天'], [['sky', 'rocket', 'rocket', 'rocket', 'rock'], {}, '火箭×3 等3種'],
    [['basic', 'basic'], {}, null],
  ];
  const got = [];
  for (const [ids, opt, exp] of want) { await mount(ids, opt); const t = await texts(); got.push(t); if (!(exp === null ? t.length === 0 : (t.length === 1 && t[0] === exp))) { r.Tbad = JSON.stringify({ ids, opt, exp, t }); break; } }
  r.T1 = !r.Tbad;
  // 單種的格式（BASE 也該成立：正對照）
  await mount(['rock']); const one = await texts(); await mount(['rock', 'rock'], { mobile: true }); const oneM = await texts();
  r.T0 = one.join() === '硬岩' && oneM.join() === '硬岩2';
  // C1 一顆按鈕＋完整卡名；點擊 inspect 正確 host、不冒泡；disabled
  await mount(['rock', 'rock', 'sky', 'rocket']);
  const n = await page.locator('#slot button').count();
  const al = n ? await page.locator('#slot button').first().getAttribute('aria-label') : '';
  if (n) await page.locator('#slot button').first().click();
  const ins = await page.evaluate(() => window.inspects), parent = await page.locator('body').getAttribute('data-parent');
  await mount(['rock'], { disabled: true });
  const dis = await page.locator('#slot button').first().isDisabled();
  r.C1 = n === 1 && ['硬岩【鬥】能量 2張', '新衝天能量 1張', '火箭隊能量 1張'].every((s) => al.includes(s)) && JSON.stringify(ins) === '["host-x"]' && parent === null && dis === true;
  r.C1n = JSON.stringify({ n, al, ins, parent, dis });
  // G1 戰鬥區三種／兩種多張：86px 欄內一行、不截斷、在欄內、點得到
  await mount(['rock', 'rock', 'sky', 'rocket'], { width: 86 });
  const g1 = await page.evaluate(() => { const bs = [...document.querySelectorAll('#slot button')]; const s = document.querySelector('#slot').getBoundingClientRect();
    const box = document.querySelector('.special-energy-badges').getBoundingClientRect();
    return { n: bs.length, h: Math.round(box.height), full: bs.every((e) => e.scrollWidth <= e.clientWidth + 1), inside: bs.every((e) => { const b = e.getBoundingClientRect(); return b.left >= s.left && b.right <= s.right + 1; }),
      hit: bs.every((e) => { const b = e.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === e; }) }; });
  // 審查 P2-1：兩種各多張也要在 86px 欄內不截斷
  await mount(['rock', 'rock', 'sky', 'sky'], { width: 86 });
  const g1b = await page.evaluate(() => { const e = document.querySelector('#slot button'); const b = e.getBoundingClientRect(), s = document.querySelector('#slot').getBoundingClientRect(); return { full: e.scrollWidth <= e.clientWidth + 1, inside: b.right <= s.right + 1, h: Math.round(b.height) }; });
  r.G1 = g1.n === 1 && g1.h <= 18 && g1.full && g1.inside && g1.hit && g1b.full && g1b.inside && g1b.h <= 18; r.G1n = JSON.stringify({ g1, g1b });
  // G3（審查 P3-4）手機五種全列：窄欄仍是一行（不換行成兩排），超出以省略號收尾、不超出欄
  await mount(['rock', 'sky', 'rocket', 'boom', 'anc'], { mobile: true, width: 150 });
  const g3 = await page.evaluate(() => { const e = document.querySelector('#slot button'); const b = e.getBoundingClientRect(), s = document.querySelector('#slot').getBoundingClientRect(), cs = getComputedStyle(e); return { h: Math.round(b.height), inside: b.right <= s.right + 1, ell: cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap', text: e.textContent }; });
  r.G3 = g3.h <= 18 && g3.inside && g3.ell && g3.text === '硬岩・衝天・火箭・回力・古舊'; r.G3n = JSON.stringify(g3);
  // G2 備戰 60px 欄被 0～2 個基本能量點擠（3 個點＋標記本來就超過 60px，BASE 也一樣；真實盤面另由 v6609 B5 守）：標記不縮到看不見、文字不截斷、點得到
  const g2 = [];
  for (const pips of [0, 1, 2]) { await mount(['sky'], { compact: true, width: 60, pips });
    g2.push(await page.evaluate(() => { const e = document.querySelector('#slot button'); const b = e.getBoundingClientRect(); return { w: Math.round(b.width), full: e.scrollWidth <= e.clientWidth + 1, hit: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === e }; })); }
  r.G2 = g2.every((x) => x.w >= 20 && x.full && x.hit); r.G2n = JSON.stringify(g2);
  return r;
}

const browser = await pwLaunch('v6.611 特殊能量膠囊');
if (!browser) shallowSkip('B（沒有可用的 Chromium）');
else {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    const R = await scenarios(page, await bundle(rd(BADGE)));
    ok('★★★ T1 文字：一張省略、多張桌機×N／手機N；多種以「・」相連；桌機超過兩種「第一種 等N種」、手機全列；備戰多種「特N種」；只有基本能量不顯示', R.T1 === true, R.Tbad);
    ok('★ T0 單種格式（BASE 也成立的正對照）', R.T0 === true);
    ok('★★★ C1 永遠一顆；aria-label 逐種列出完整卡名與張數；點一下打開正確 host、不冒泡；disabled 不能點', R.C1 === true, R.C1n);
    ok('★★★ G1 戰鬥區三種／兩種多張：86px 欄內一行（≤18px）、文字不截斷、在欄內、點得到', R.G1 === true, R.G1n);
    ok('★★ G3 手機五種全列：窄欄一行、省略號收尾、不超出欄', R.G3 === true, R.G3n);
    ok('★★ G2 備戰被 0～2 個基本能量點擠：標記不縮到看不見、不截斷、點得到', R.G2 === true, R.G2n);
    ok('★ 沒有瀏覽器錯誤', errs.length === 0, errs.join(' | '));
    // ── HEAD-FAIL：BASE 的元件 ──
    if (!hasBaseCommit(ROOT, BASE)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE + '）');
    else {
      const b = readBaseBlob(ROOT, BASE, BADGE);
      const B = await scenarios(page, await bundle(b.out.replace(/\r\n/g, '\n')));
      const red = ['T1', 'C1', 'G1'].filter((k) => B[k] !== true);
      ok('★★★ HEAD-FAIL：BASE（v6.610）上 T1、C1、G1 逐條紅', red.length === 3, red.join(',') + ' ' + B.G1n);
      ok('★ HEAD-FAIL 正對照：BASE 上 T0（單種格式）與 G2（備戰不被擠掉）本來就成立', B.T0 === true && B.G2 === true, B.G2n);
    }
  } finally { await browser.close(); }
}
console.log(`\n=== v6.611 特殊能量膠囊：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
