// 真共用判準、網址往返與元件互動；舊版缺模組時逐條報紅，不整支 throw。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import http from 'node:http';
import { pwLaunch } from './lib/pw.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = process.env.PTCG_TRAIT_SOURCE_ROOT || ROOT;
const rd = p => existsSync(join(SOURCE, p)) ? readFileSync(join(SOURCE, p), 'utf8').replace(/\r\n/g, '\n') : '';
let pass = 0, fail = 0;
const ok = (label, value) => { console.log((value ? 'PASS ' : 'FAIL ') + label); value ? pass++ : fail++; };
let M = {};
if (rd('src/lib/cards/trait-filter.ts')) {
  const out = await build({ entryPoints: [join(SOURCE, 'src/lib/cards/trait-filter.ts')], bundle: true, write: false, format: 'esm', platform: 'node' });
  M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}
const missing = Symbol('missing');
const call = (name, ...args) => typeof M[name] === 'function' ? M[name](...args) : missing;
const pokemon = (id, hasAbility) => ({ id, supertype: 'Pokemon', ...(hasAbility ? { abilities: [{ name: '測試', effect: '', label: '特性' }] } : {}) });
const rare = pokemon('10207', true), regular = pokemon('14086', false), trainer = { id: 'normal-trainer', supertype: 'Trainer' };
for (const id of ['10207', '10216', '10195', '10893', '13954', '14210', '15971', '20042', '12291', '12741', '11459']) ok('A 官方稀有度固定樣本 ' + id, call('isRarePrinting', { id }) === true);
ok('A 特典未標稀有度歸一般卡', call('isRarePrinting', regular) === false);
ok('A 不按卡號超編或 ex 名稱猜稀有度', call('isRarePrinting', { id: 'ordinary-fixture', name: '超級測試ex', collectorNumber: '999/001' }) === false);
const match = (c, r = 'all', a = 'all') => call('matchesCardTraits', c, r, a);
ok('B 稀有卡只保留特殊稀有度', match(rare, 'rare') === true && match(regular, 'rare') === false);
ok('B 一般卡保留普通卡而排除稀有卡', match(rare, 'regular') === false && match(regular, 'regular') === true);
ok('B 有特性讀卡面資料', match(rare, 'all', 'yes') === true && match(regular, 'all', 'yes') === false);
ok('B 無特性包含省略與空陣列', match(regular, 'all', 'no') === true && match({ ...regular, abilities: [] }, 'all', 'no') === true && match(rare, 'all', 'no') === false);
ok('B 訓練家與能量不冒充無特性寶可夢', match(trainer, 'all', 'no') === false && match({ ...trainer, supertype: 'Energy' }, 'all', 'yes') === false);
ok('B 跨組取交集', match(rare, 'regular', 'yes') === false && match(regular, 'rare', 'no') === false);
ok('B 無篩選保留訓練家與能量', match(trainer) === true && match({ ...trainer, supertype: 'Energy' }) === true);
ok('B 不限特性仍可依稀有度找訓練家', match({ id: '10207', supertype: 'Trainer' }, 'rare') === true);
// 兩版都必須維持綠的既有費用正對照，直接讀產品模組。
const costOut = await build({ entryPoints: [join(SOURCE, 'src/lib/cards/cost-filter.ts')], bundle: true, write: false, format: 'esm', platform: 'node' });
const C = await import('data:text/javascript;base64,' + Buffer.from(costOut.outputFiles[0].text).toString('base64'));
ok('P1 正對照 無費用條件保留訓練家', C.matchesPrintedCosts(trainer,new Set(),new Set()) === true);
ok('P2 正對照 費用零只保留有零費招式的寶可夢', C.matchesPrintedCosts({...regular,attacks:[{cost:[]}]},new Set(),new Set([0])) === true && C.matchesPrintedCosts(trainer,new Set(),new Set([0])) === false);
const equal = (a, b) => a !== missing && JSON.stringify(a) === JSON.stringify(b);
ok('C 網址還原兩組', equal(call('readTraitFilterSearch', '?rarity=rare&ability=no'), { rarity: 'rare', ability: 'no' }));
ok('C 拒絕未知值與空值', equal(call('readTraitFilterSearch', '?rarity=SAR&ability=bogus'), { rarity: 'all', ability: 'all' }));
const written = call('writeTraitFilterSearch', '?set=ALL&page=3&card=14086&retreat=0&attack=2&utm=x', { rarity: 'regular', ability: 'yes' });
ok('C 寫入保留舊條件頁碼與卡片', written !== missing && ['set=ALL', 'page=3', 'card=14086', 'retreat=0', 'attack=2', 'utm=x'].every(s => written.includes(s)));
ok('C 往返保留條件', written !== missing && equal(call('readTraitFilterSearch', written), { rarity: 'regular', ability: 'yes' }));
ok('C 清不限只移除本版兩參數', call('writeTraitFilterSearch', '?set=ALL&rarity=rare&ability=yes&attack=0', { rarity: 'all', ability: 'all' }) === '?set=ALL&attack=0');
const mobileOut = await build({ entryPoints: [join(SOURCE, 'src/lib/mobile-filters.ts')], bundle: true, write: false, format: 'esm', platform: 'node' });
const Mobile = await import('data:text/javascript;base64,' + Buffer.from(mobileOut.outputFiles[0].text).toString('base64'));
for (const name of ['cards', 'decks']) {
  const s = rd(`src/routes/${name}/+page.svelte`);
  ok('D ' + name + ' 清單使用共用判準', s.includes('if (!matchesCardTraits(c, rarity, ability)) return false;'));
  ok('D ' + name + ' 推導本體追蹤兩組狀態', s.includes('const rarity = selectedRarity, ability = selectedAbility;'));
  ok('D ' + name + ' 元件雙向綁定', s.includes('<TraitFilters bind:rarity={selectedRarity} bind:ability={selectedAbility} />'));
  ok('D ' + name + ' 收合計數包含兩組', /countActiveFilters\([\s\S]{0,400}selectedRarity !== 'all', selectedAbility !== 'all'/.test(s));
  // 直接執行正式頁面的計數運算式，不能以字串存在代替響應式狀態。
  const countStart = s.indexOf('const activeFilterCount = $derived(');
  const countEnd = s.indexOf(';', countStart);
  const expression = countStart < 0 ? '' : s.slice(countStart + 'const activeFilterCount = $derived('.length, countEnd).replace(/\)\s*$/, '');
  const fields = { selectedCategories:new Set(),selectedTags:new Set(),selectedTypes:new Set(),selectedStages:new Set(),selectedRetreatCosts:new Set(),selectedAttackCosts:new Set(),selectedRegMarks:new Set(),regMarksNarrowed:new Set(),favoritesOnly:false,setFilter:'',selectedRarity:'rare',selectedAbility:'yes' };
  let count = null;
  try { count = Function('countActiveFilters', ...Object.keys(fields), 'return ' + expression)(Mobile.countActiveFilters,...Object.values(fields)); } catch {}
  ok('D ' + name + ' 真計數運算式得到兩項',count===2);
  const a = s.indexOf('{#if showFilters}'), b = s.indexOf('{/if}<!-- v6497-mobile-filter-toggle -->', a);
  ok('D ' + name + ' 手機收合包含新篩選', a >= 0 && b > a && s.slice(a, b).includes('<TraitFilters'));
}
const cards = rd('src/routes/cards/+page.svelte');
ok('D cards 網址讀寫已接線', cards.includes('readTraitFilterSearch(location.search)') && cards.includes('writeTraitFilterSearch(writeCostFilterSearch('));
ok('D cards 兩條件改變重設分頁', /function allFilterKey\(\)[\s\S]{0,600}selectedRarity, selectedAbility/.test(cards));
const traits = rd('src/lib/cards/TraitFilters.svelte'), costs = rd('src/lib/cards/CostFilters.svelte');
ok('D 純前端判準與控制項沒有請求或輪詢', !!traits && !!rd('src/lib/cards/trait-filter.ts') && !/\b(fetch|setTimeout|setInterval)\s*\(/.test(traits + costs + rd('src/lib/cards/trait-filter.ts')));
const uiLabels = ['稀有卡操作', '有特性交集', '一般卡交集', '無特性交集', '不限保留其他組', '費用零純數字', '費用多選', '費用不限', '欄位與按鈕對齊', '按鈕完整可見與無溢出', '鍵盤切換', '無腳本錯誤'];
if (traits && costs && Object.keys(M).length) {
  const fixtures = [
    { ...rare, retreatCost: [], attacks: [{ cost: [] }] },
    { ...pokemon('10216', false), retreatCost: ['Colorless'], attacks: [{ cost: ['Fire'] }] },
    { ...pokemon('14086', true), retreatCost: ['Colorless'], attacks: [{ cost: ['Fire', 'Fire'] }] },
    { ...pokemon('normal-pokemon', false), retreatCost: ['Colorless', 'Colorless'], attacks: [{ cost: ['Fire', 'Fire', 'Fire'] }] },
    trainer,
  ];
  const dir = join(SOURCE, 'src/lib/cards').replace(/\\/g, '/');
  const wrapper = `<script>
    import TraitFilters from '${dir}/TraitFilters.svelte';
    import CostFilters from '${dir}/CostFilters.svelte';
    import { matchesCardTraits } from '${dir}/trait-filter.ts';
    import { matchesPrintedCosts } from '${dir}/cost-filter.ts';
    let rarity=$state('all'), ability=$state('all'), retreat=$state(new Set()), attack=$state(new Set());
    const all=${JSON.stringify(fixtures)};
    const shown=$derived(all.filter(c=>matchesCardTraits(c,rarity,ability)&&matchesPrintedCosts(c,retreat,attack)).map(c=>c.id).join(','));
  </script><main style="max-width:1100px;margin:0 auto"><TraitFilters bind:rarity bind:ability/><CostFilters bind:retreat bind:attack retreatOptions={[0,1,2,3,4]} attackOptions={[0,1,2,3,4,5]}/><output>{shown}</output></main>`;
  const code = compile(wrapper, { filename: join(ROOT, 'v6656-wrapper.svelte'), generate: 'client', css: 'injected' }).js.code;
  const out = await build({ stdin: { contents: `import {mount} from 'svelte';import App from 'trait:app';mount(App,{target:document.getElementById('app')});`, loader: 'js', resolveDir: ROOT }, bundle: true, write: false, platform: 'browser', format: 'iife', conditions: ['browser'], plugins: [{ name: 'trait-fixture', setup(b) {
    b.onResolve({ filter: /^trait:app$/ }, () => ({ path: 'app', namespace: 'trait' }));
    b.onLoad({ filter: /.*/, namespace: 'trait' }, () => ({ contents: code, loader: 'js', resolveDir: ROOT }));
    b.onLoad({ filter: /\.svelte$/ }, a => ({ contents: compile(readFileSync(a.path, 'utf8'), { filename: a.path, generate: 'client', css: 'injected' }).js.code, loader: 'js', resolveDir: dirname(a.path) }));
  } }] });
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html; charset=utf-8'); res.end(req.url === '/app.js' ? out.outputFiles[0].text : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script src="/app.js"></script>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await pwLaunch('v6656 真元件與篩選互動');
    if (browser) for (const width of [320, 390, 768, 1440]) {
      const p = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
      const errors = []; p.on('pageerror', e => errors.push(e.message));
      try {
        await p.goto('http://127.0.0.1:' + server.address().port); p.setDefaultTimeout(3000);
        const r = p.getByRole('group', { name: '稀有度篩選', exact: true }), a = p.getByRole('group', { name: '特性篩選', exact: true }), c = p.getByRole('group', { name: '招式費用（可複選）', exact: true });
        const shown = () => p.locator('output').innerText();
        await r.getByRole('button', { name: '稀有卡', exact: true }).click().catch(() => {}); ok('E ' + width + ' ' + uiLabels[0], await shown() === '10207,10216');
        await a.getByRole('button', { name: '有特性', exact: true }).click().catch(() => {}); ok('E ' + width + ' ' + uiLabels[1], await shown() === '10207');
        await r.getByRole('button', { name: '一般卡', exact: true }).click().catch(() => {}); ok('E ' + width + ' ' + uiLabels[2], await shown() === '14086');
        await a.getByRole('button', { name: '無特性', exact: true }).click().catch(() => {}); ok('E ' + width + ' ' + uiLabels[3], await shown() === 'normal-pokemon');
        await a.getByRole('button', { name: '不限', exact: true }).click().catch(() => {}); ok('E ' + width + ' ' + uiLabels[4], await shown() === '14086,normal-pokemon,normal-trainer');
        await r.getByRole('button', { name: '不限', exact: true }).click().catch(() => {});
        await c.getByRole('button', { name: '0', exact: true }).click().catch(() => {}); ok('E ' + width + ' ' + uiLabels[5], await shown() === '10207' && await c.getByRole('button', { name: '不需能量', exact: true }).count() === 0);
        await c.getByRole('button', { name: '1', exact: true }).click().catch(() => {}); ok('E ' + width + ' ' + uiLabels[6], await shown() === '10207,10216');
        await c.getByRole('button', { name: '不限', exact: true }).click().catch(() => {}); ok('E ' + width + ' ' + uiLabels[7], await shown() === '10207,10216,14086,normal-pokemon,normal-trainer');
        ok('E ' + width + ' ' + uiLabels[8], await p.locator('.trait-row, .cost-row').evaluateAll(rows => { const x = rows.map(r => r.querySelector('button').getBoundingClientRect().left); return Math.max(...x) - Math.min(...x) < 1; }));
        ok('E ' + width + ' ' + uiLabels[9], await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('button')].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width >= 36 && r.height >= 36; })));
        await a.getByRole('button', { name: '有特性', exact: true }).focus(); await p.keyboard.press('Enter'); ok('E ' + width + ' ' + uiLabels[10], await shown() === '10207,14086');
        ok('E ' + width + ' ' + uiLabels[11], errors.length === 0);
      } finally { await p.close(); }
    }
  } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
} else for (const width of [320, 390, 768, 1440]) for (const label of uiLabels) ok('E ' + width + ' ' + label, false);
console.log(`v6656 ${pass} passed / ${fail} failed`); process.exitCode = fail ? 1 : 0;
