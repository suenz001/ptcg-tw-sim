/**
 * ⭐v6.511 全站色票（--ui-*）的唯一讀取點：從 src/routes/+layout.svelte 讀出現行的淺色／深色色票。
 *   守衛要驗「某個元素讀的是色票」時，一律拿這裡的值比對，不要在守衛裡寫死色碼
 *   （v6.511 調整色票時，有十幾支守衛因為寫死舊色碼而翻紅；意圖都是「讀色票」）。
 *
 *   uiPalette(root)   ⇒ { light: { '--ui-bg': '#dde3df', … }, dark: { … } }（深色只列有覆寫的；未覆寫的沿用淺色）
 *   uiColor(root, theme, name) ⇒ 該主題下 getComputedStyle 會回的字串（'rgb(r, g, b)' 或 'rgba(r, g, b, a)'）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function block(src, head) {
  // ⚠ layout 另有一個 :root（safe-area）⇒ 找「區塊內有 --ui-bg:」的那一個
  let i = src.indexOf(head);
  while (i >= 0 && !/^[^}]*--ui-bg:/.test(src.slice(i + head.length))) i = src.indexOf(head, i + 1);
  if (i < 0) throw new Error('ui-palette：找不到色票區塊 ' + head);
  const j = src.indexOf('\n  }', i);
  const out = {};
  for (const m of src.slice(i + head.length, j).matchAll(/(--ui-[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

export function uiPalette(root) {
  const src = readFileSync(join(root, 'src/routes/+layout.svelte'), 'utf8').replace(/\r\n/g, '\n');
  const light = block(src, ':global(:root) {');
  const dark = { ...light, ...block(src, ":global(html[data-theme='dark']) {") };
  if (!light['--ui-bg'] || !dark['--ui-bg'] || Object.keys(light).length < 15) throw new Error('ui-palette：色票解析結果不完整');
  return { light, dark };
}

/** '#rrggbb' ⇒ 'rgb(r, g, b)'；'rgba(…)' 正規化空白；其他（漸層等）原樣回傳 */
export function cssColor(v) {
  const h = /^#([0-9a-f]{6})$/i.exec(v);
  if (h) { const n = parseInt(h[1], 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; }
  const a = /^rgba?\(([^)]*)\)$/.exec(v);
  if (a) { const p = a[1].split(',').map((x) => x.trim()); return (p.length === 4 ? 'rgba(' : 'rgb(') + p.join(', ') + ')'; }
  return v;
}

export function uiColor(root, theme, name) {
  const p = uiPalette(root)[theme];
  if (!(name in p)) throw new Error('ui-palette：沒有這個色票 ' + name);
  return cssColor(p[name]);
}
