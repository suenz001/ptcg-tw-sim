// v6.587：直接編譯產品的排名區塊，保留 Svelte 動態 style／class 的實際 DOM 行為。
import { compile } from 'svelte/compiler';
import { build } from 'esbuild';
import { join } from 'node:path';
import { extractCss, pageHtml } from './zoom-modal-fixture.mjs';
import { scanContrastInPage } from './contrast-scan.mjs';

export async function standingsFixture(root, source, layoutSource) {
  const start = source.indexOf('{#if brk.standings && brk.standings.length}', source.indexOf('{#snippet bracketBlock(brk)}'));
  const end = source.indexOf('{#if brk.matches && brk.matches.length}', start);
  const keyed = source.match(/  function standingsKeyed\(rows: any\[\]\): any\[\] \{[\s\S]*?\n  \}/);
  if (start < 0 || end < start || !keyed) throw new Error('瑞士排名產品區塊定位失敗');
  const script = `<script lang="ts">
    const brk = {event:{name:'瑞士制測試賽',swissRounds:5},standings:[
      {rank:1,name:'玩家甲',mine:false,w:2,l:0,owp:60,oowp:55},
      {rank:2,name:'測試本人很長的玩家名稱用來確認截字保持原樣',mine:true,w:1,l:1,owp:50,oowp:48},
      {rank:3,name:'玩家乙',mine:false,w:0,l:2,owp:40,oowp:42}]};
    const _bkId='fixture',_bkOpen=true,_bkLock=false,tBracketsStale=false;
    const tToggleEv=()=>{}; const liveRoundOf=()=>2;
    ${keyed[0]}
  </script>${source.slice(start,end)}`;
  const compiled = compile(script, { filename: join(root,'v6587-standings.svelte'), generate:'client',dev:true });
  const result = await build({
    stdin:{contents:"import {mount} from 'svelte';import App from 'v6587:standings';mount(App,{target:document.getElementById('app')});",resolveDir:root},
    bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent',
    plugins:[{name:'standings',setup(b){b.onResolve({filter:/^v6587:standings$/},()=>({path:'standings',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:compiled.js.code,loader:'js',resolveDir:root}));}}],
  });
  return {js:result.outputFiles[0].text,css:extractCss(layoutSource)+'\n'+extractCss(source)};
}

export async function measureStandings(page, fixture, width, theme, battle=false) {
  await page.setViewportSize({width,height:900});
  const html = pageHtml(fixture.css,'<main class="lobby tourn-lobby"><div id="app"></div></main>')
    .replace('<html lang="zh-TW">',`<html lang="zh-TW" data-ui-themed data-theme="${theme}"${width>=1024?' data-ui-wide':''}${battle?' data-battle-view':''}>`);
  await page.setContent(html); await page.addScriptTag({content:fixture.js});
  await page.locator('.tourn-bracket').waitFor();
  const result = await page.evaluate(() => {
    const grid = document.querySelector('.tourn-bracket > div[style]');
    if (!grid || grid.children.length!==20) throw new Error('必須有五欄與三名玩家');
    return {cells:[...grid.children].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {
      text:e.textContent,color:s.color,weight:s.fontWeight,geometry:[r.x,r.y,r.width,r.height],style:e.getAttribute('style'),
      overflow:s.overflow,textOverflow:s.textOverflow,whiteSpace:s.whiteSpace,
    };}),background:getComputedStyle(document.querySelector('.tourn-bracket')).backgroundColor};
  });
  // 對比掃描器依 selector 去重；只加不帶樣式的探針 class，讓同色欄位仍可逐格量測。
  await page.evaluate(() => {
    const cells=document.querySelector('.tourn-bracket > div[style]').children;
    cells[10].classList.add('__v6587-measure-rank');cells[11].classList.add('__v6587-measure-name');
  });
  const contrasts = await page.evaluate(scanContrastInPage,100);
  const hit = contrasts.find(r=>r.sel.includes('__v6587-measure-name'));
  if (!hit) throw new Error('未找到本人文字的實際對比量測');
  result.contrast=hit.cr;
  return result;
}
