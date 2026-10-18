// v6.588：實際編譯公布欄工具列／列表與完整測抽元件；資料與登入由夾具隔離。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { compile } from 'svelte/compiler';
import { build } from 'esbuild';
import { functionSource } from './deck-replay-db-fixture.mjs';
import { pageHtml } from './zoom-modal-fixture.mjs';

export async function postListBundle(root, source) {
  const start = source.indexOf('    <div class="toolbar">');
  const end = source.indexOf('    {/if}\n  {/if}\n</main>', start);
  if (start < 0 || end < start) throw new Error('公布欄產品區塊定位失敗');
  const funcs = ['fetchList', 'changeSort', 'toggleTournamentOnly', 'goPage', 'onSearchInput', 'clearSearch', 'fmtDate'];
  if (source.includes('function toggleReplaysOnly(')) funcs.push('toggleReplaysOnly');
  const script = `<script lang="ts">
    let posts=$state<any[]>([]),total=$state(0),page=$state(1); const pageSize=20;
    let sort=$state<'new'|'likes'|'downloads'|'comments'|'replays'>('new');
    let tournamentOnly=$state(false),replaysOnly=$state(false),replayStatsSupported=$state(false);
    let searchQ=$state(''),searchUnsupported=$state(false),searchTimer:any=null;
    let loading=$state(true),loadError=$state(''),postOk=$state(''),listSeq=0;
    const totalPages=$derived(Math.max(1,Math.ceil(total/pageSize)));
    async function api(path:string){return await window.fixtureApi(path);}
    function openDetail(id:string){window.fixtureOpened=id;}
    ${funcs.map(n => functionSource(source, n)).join('\n')}
    void fetchList();
  </script><main>${source.slice(start, end)}</main>${source.slice(source.lastIndexOf('<style>'))}`;
  return componentBundle(root, script);
}
async function componentBundle(root, source) {
  const compiled = compile(source, { filename: join(root, 'v6588-fixture.svelte'), generate: 'client', css: 'injected', dev: true });
  const out = await build({
    stdin: { contents: "import {mount} from 'svelte';import App from 'fixture:component';mount(App,{target:document.getElementById('app')});", resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['browser'], logLevel: 'silent', alias: { '$lib': join(root, 'src/lib') },
    plugins: [{ name: 'real-deck-components', setup(b) {
      b.onResolve({ filter: /^fixture:component$/ }, () => ({ path: 'component', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: compiled.js.code, loader: 'js', resolveDir: root }));
      b.onResolve({ filter: /^\$app\/paths$/ }, () => ({ path: 'paths', namespace: 'fixture-paths' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture-paths' }, () => ({ contents: 'export const base="";', loader: 'js' }));
      b.onLoad({ filter: /\.svelte$/ }, args => ({ contents: compile(readFileSync(args.path, 'utf8'), { filename: args.path, generate: 'client', css: 'injected', dev: true }).js.code, loader: 'js', resolveDir: dirname(args.path) }));
    } }],
  });
  return out.outputFiles[0].text;
}
export async function openingBundle(root, source, asset) {
  // 只將正式相對圖檔換成相同位元組的資料 URI，避免 fixture 依賴開發伺服器。
  const url = 'data:image/jpeg;base64,' + asset.toString('base64');
  const text = source.replaceAll('../assets/pokemon-card-back.jpg', url);
  const compiled = compile(text, { filename: join(root, 'src/lib/decks/OpeningHandSim.svelte'), generate: 'client', css: 'injected', dev: true });
  const out = await build({
    stdin: { contents: "import {mount} from 'svelte';import App from 'fixture:opening';mount(App,{target:document.getElementById('app'),props:{entries:window.fixtureEntries,onclose:()=>{window.fixtureClosed=true}}});", resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['browser'], logLevel: 'silent', alias: { '$lib': join(root, 'src/lib') },
    plugins: [{ name: 'real-opening-hand', setup(b) {
      b.onResolve({ filter: /^fixture:opening$/ }, () => ({ path: 'opening', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: compiled.js.code, loader: 'js', resolveDir: join(root, 'src/lib/decks') }));
      b.onResolve({ filter: /^\$app\/paths$/ }, () => ({ path: 'paths', namespace: 'fixture-paths' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture-paths' }, () => ({ contents: 'export const base="";', loader: 'js' }));
    } }],
  });
  return out.outputFiles[0].text;
}
const layoutStyles=new Map();
export function fixtureHtml(layout, width, theme) {
  // 交給 Svelte 處理 :global(:where(...):focus-visible) 的巢狀括號，避免簡單 regex 改變選擇器。
  if(!layoutStyles.has(layout))layoutStyles.set(layout,compile('<div></div>'+layout.slice(layout.lastIndexOf('<style>')),{generate:'client',css:'external'}).css.code);
  return pageHtml(layoutStyles.get(layout), '<div id="app"></div>').replace('<html lang="zh-TW">', `<html lang="zh-TW" data-ui-themed data-theme="${theme}"${width >= 1024 ? ' data-ui-wide' : ''}>`);
}
export async function measureOpening(page) {
  return page.evaluate(() => {
    const rect = e => { const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]; };
    const backs = [...document.querySelectorAll('.ohs-back')];
    return {
      count: backs.length,
      official: backs.length===6 && backs.every(e=>{const s=getComputedStyle(e);return s.backgroundImage.includes('data:image/jpeg;base64,')&&s.backgroundSize==='cover'&&s.backgroundRepeat==='no-repeat'&&s.backgroundPosition==='50% 50%'&&s.display!=='none'&&s.visibility==='visible'&&e.getBoundingClientRect().width>0;}),
      hiddenNames: [...document.querySelectorAll('.ohs-prizes .ohs-card')].every(e=>e.title==='獎賞卡'&&!e.querySelector('img,figcaption')),
      geometry: [...document.querySelectorAll('.ohs-prizes .ohs-card,.ohs-actions')].map(rect),
      hand: document.querySelectorAll('.ohs-body > .ohs-grid:not(.ohs-prizes) figure').length,
      overflow: document.documentElement.scrollWidth>innerWidth,
    };
  });
}
