import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pwLaunch } from './lib/pw.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { V6661_PAIRS, revertV6661IfPresent } from './lib/revert-v6661-deck-filter-layout.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const base = 'b4811af68c933615cfe2dcbbaad0f97ba8c73d6f';
const decks = 'src/routes/decks/+page.svelte';
const read = file => normEol(readFileSync(join(ROOT, file), 'utf8'));
const current = read(decks);

if (hasBaseCommit(ROOT, base)) {
  for (const file of Object.keys(V6661_PAIRS)) {
    const original = readBaseBlob(ROOT, base, file);
    assert.ok(original.ok, file);
    assert.equal(revertV6661IfPresent(file, read(file)), normEol(original.out), file);
  }
  console.log('PASS 歷史還原逐檔精確回到 v6.660');
} else {
  shallowSkip('v6.661 歷史還原與舊版反證', '需要 v6.660 歷史 commit');
}

const classRule = (src, name) => {
  const rule = src.match(new RegExp('\\.' + name + '\\s*\\{[^}]+\\}'))?.[0];
  assert.ok(rule, '缺少篩選容器樣式 ' + name);
  return rule;
};
const sharedStyles = ['TraitFilters', 'CostFilters'].map((name, i) =>
  classRule(read(`src/lib/cards/${name}.svelte`), ['trait-filters', 'cost-filters'][i])).join('\n');
const scopedRule = /  \.pk-filters > :global\(\.trait-filters\),\n  \.pk-filters > :global\(\.cost-filters\) \{[^\n]+\}/;
const fixed = current.match(scopedRule)?.[0];
assert.ok(fixed, '兩個直排篩選器須共用牌組編輯器限定的高度規則');
const browser = await pwLaunch('牌組編輯器篩選列高度');
if (browser) try {
  const page = await browser.newPage();
  const groups = '<div class="trait-filters"><button>不限</button><button>有特性</button></div>' +
    '<div class="cost-filters"><button>不限</button><button>撤退費用</button></div>';

  async function check(source, override, width) {
    const pageStyles = ['picker', 'pk-filters', 'picker-list'].map(name => classRule(source, name)).join('\n');
    await page.setViewportSize({ width, height: 820 });
    await page.setContent(`<style>${sharedStyles}\n${pageStyles}\n${override.replace(/:global\(([^)]+)\)/g, '$1')}
      .picker{height:520px}.cards-controls{display:flex;flex-wrap:wrap;width:300px}button{height:36px}
      .picker-list{flex:1 1 auto;min-height:120px}.picker-list li{min-height:32px}</style>
      <section class="picker"><div class="pk-filters"><button>篩選</button>${groups}<button aria-label="卡包">卡包</button></div>
      <p>符合 286 張</p><ul class="picker-list">${'<li>卡片</li>'.repeat(25)}</ul></section>
      <section class="cards-controls">${groups}</section>`);
    return page.evaluate(() => {
      const filters = document.querySelector('.pk-filters');
      const list = document.querySelector('.picker-list');
      list.scrollTop = 64;
      const bottom = filters.getBoundingClientRect().bottom;
      const editorGroups = [...filters.querySelectorAll('.trait-filters,.cost-filters')];
      const editor = editorGroups.every(group => group.getBoundingClientRect().height <= 90) &&
        [...filters.children].every(child => child.getBoundingClientRect().bottom <= bottom + 1) &&
        bottom < list.getBoundingClientRect().top && list.scrollTop > 0;
      const database = [...document.querySelector('.cards-controls').children]
        .every(group => group.getBoundingClientRect().width === 300 && getComputedStyle(group).flexBasis === '100%');
      return { editor, database };
    });
  }

  for (const width of [360, 393, 430, 1280]) {
    assert.deepEqual(await check(current, fixed, width), { editor: true, database: true }, String(width));
  }
  console.log('PASS 三種手機與桌機寬度無重疊，橫排共用元件仍佔滿整列');

  if (hasBaseCommit(ROOT, base)) {
    const original = readBaseBlob(ROOT, base, decks);
    assert.ok(original.ok);
    assert.deepEqual(await check(normEol(original.out), '', 393), { editor: false, database: true });
    console.log('PASS v6.660 反證重現垂直溢出，卡牌資料庫正對照通過');
  }

  const [trait, cost] = fixed.trim().split(',\n');
  for (const [label, mutation] of [
    ['只修特性', trait + ' { flex-basis: auto; }'],
    ['只修費用', cost],
    ['恢復百分比高度', fixed.replace('auto', '100%')],
    ['拿掉頁面範圍', fixed.replaceAll('.pk-filters > ', '')],
    ['指定不合理的固定高度', fixed.replace('auto', '320px')],
  ]) {
    assert.notDeepEqual(await check(current, mutation, 393), { editor: true, database: true }, label);
  }
  console.log('PASS 五個樣式突變均被版面斷言偵測');
} finally {
  await browser.close();
}
