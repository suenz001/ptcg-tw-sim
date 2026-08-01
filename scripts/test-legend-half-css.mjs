// v6.087 守衛：傳說競技場手牌裁半的 **CSS 前提**
//   ⭐ Fable 5 審 v6.086 抓到：桌機 `.hand-card img` 只設 width、沒設 height/aspect-ratio →
//     img 盒比例 == 圖片天然比例 → `object-fit: cover` 完全不裁切、object-position 無效
//     → 裁半在桌機主戰場靜默沒生效。這個守衛讓「有 object-position 卻沒有固定盒比例」再犯時 FAIL。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c){pass++;} else {fail++;console.log('  ❌',t,extra);} };

for (const f of ['src/routes/game/+page.svelte','src/routes/game/MobilePortraitBattle.svelte']) {
  const src = readFileSync(join(ROOT,f),'utf8');
  const hasHalfClass = /legend-half-[lr]/.test(src);
  chk(`${f} 有掛 legend-half class`, hasHalfClass);
  if (!hasHalfClass) continue;
  // 取 <style> 區塊
  const style = src.slice(src.lastIndexOf('<style'));
  const rules = style.split('}').filter(r => /legend-half-[lr]/.test(r));
  chk(`${f} <style> 內有 legend-half 規則`, rules.length > 0, String(rules.length));
  const joined = rules.join(' ');
  chk(`${f} 有 object-position（決定取左半/右半）`, /object-position/.test(joined));
  chk(`${f} 有 object-fit: cover（沒有 cover 就不會裁）`, /object-fit:\s*cover/.test(joined));
  // ⭐ 核心：必須有固定盒比例，否則 cover 不裁（v6.086 桌機的實際 bug）
  chk(`${f} ⭐ 有 aspect-ratio（沒有的話 cover 不會裁 → 裁半靜默失效）`,
      /aspect-ratio/.test(joined), joined.replace(/\s+/g,' ').slice(0,160));
  // 選擇器要限定在 legend-half，不能整批 .hand-card img 都被改
  chk(`${f} 選擇器限定 legend-half（不影響其他手牌卡）`,
      !/^\s*\.(hand-card|mp-hand-card)\s+img\s*\{[^}]*object-position/m.test(style));
}
console.log(`test-legend-half-css: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
