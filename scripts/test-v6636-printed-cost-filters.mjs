// v6.636：正式費用判準、網址往返與兩頁接線；BASE 缺模組時逐條翻紅，不整支 throw。
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {compile} from 'svelte/compiler';
import http from 'node:http';
import {dirname} from 'node:path';
import {pwLaunch} from './lib/pw.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_ROOT = process.env.PTCG_COST_SOURCE_ROOT || ROOT;
const rd=p=>existsSync(join(SOURCE_ROOT,p))?readFileSync(join(SOURCE_ROOT,p),'utf8').replace(/\r\n/g,'\n'):'';
let pass=0,fail=0;
function ok(label,value){if(value){pass++;console.log('PASS '+label);}else{fail++;console.log('FAIL '+label);}}
const text=rd('src/lib/cards/cost-filter.ts');
let M={};
if(text){const out=await build({stdin:{contents:text,loader:'ts',resolveDir:join(SOURCE_ROOT,'src/lib/cards')},bundle:true,write:false,format:'esm',platform:'node'});M=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));}
const missing=Symbol('missing');
const call=(name,...args)=>typeof M[name]==='function'?M[name](...args):missing;
const eq=(a,b)=>a!==missing&&JSON.stringify(a)===JSON.stringify(b);
const set=(...n)=>new Set(n);
const pokemon=(r,costs)=>({supertype:'Pokemon',...(r===undefined?{}:{retreatCost:Array(r).fill('Colorless')}),attacks:costs.map(n=>({name:'測試招式',cost:Array(n).fill('Fire')}))});
const a=pokemon(1,[1,3]),zero=pokemon(undefined,[0,2]),four=pokemon(4,[5]);
const match=(card,r=[],a=[])=>call('matchesPrintedCosts',card,new Set(r),new Set(a));
ok('A1 無條件保留訓練家與能量',match({supertype:'Trainer'})===true&&match({supertype:'Energy'})===true);
ok('A2 非寶可夢不可冒充零撤退',match({supertype:'Trainer'},[0])===false&&match({supertype:'Energy'},[0])===false);
ok('A3 省略撤退欄位表示零',match(zero,[0])===true&&match(zero,[1])===false);
ok('A4 空陣列零撤退',match(pokemon(0,[1]),[0])===true);
ok('A5 選 0 1 2 3 包含三費且排除四費',match(pokemon(3,[1]),[0,1,2,3])===true&&match(four,[0,1,2,3])===false);
ok('A6 不連續複選取聯集不補中間值',match(pokemon(2,[1]),[0,3])===false&&match(pokemon(3,[1]),[0,3])===true);
ok('A7 第一或第二招符合都算',match(a,[],[1])===true&&match(a,[],[3])===true&&match(a,[],[2])===false);
ok('A8 不需能量與一費區分',match(zero,[],[0])===true&&match(a,[],[0])===false);
ok('A9 招式複選取聯集',match(a,[],[2,3])===true&&match(a,[],[2,4])===false);
ok('A10 兩組必須同時符合',match(a,[1],[3])===true&&match(a,[0],[3])===false&&match(a,[1],[2])===false);
ok('A11 非寶可夢不可冒充免費招式',match({supertype:'Trainer',attacks:[{cost:[]}]},[],[0])===false);
ok('A12 缺費用或招式不是免費招式',match({supertype:'Pokemon',attacks:[{}]},[],[0])===false&&match({supertype:'Pokemon'},[],[0])===false);
ok('A13 混色圖示依總數',match({supertype:'Pokemon',attacks:[{cost:['Fire','Water','Colorless']}]},[],[3])===true);
ok('A14 不計特性道具減費',match({...four,abilities:[{effect:'招式所需能量全部消除'}]},[4],[5])===true);
ok('B1 撤退保留 0 至 4 基本選項',eq(call('printedCostOptions',[],'retreat'),[0,1,2,3,4]));
ok('B2 招式保留 0 至 5 基本選項',eq(call('printedCostOptions',[],'attack'),[0,1,2,3,4,5]));
ok('B3 未來較高費用自動擴充',eq(call('printedCostOptions',[pokemon(6,[7])],'retreat'),[0,1,2,3,4,5,6])&&eq(call('printedCostOptions',[pokemon(6,[7])],'attack'),[0,1,2,3,4,5,6,7]));
const original=set(0,2); const toggled=call('togglePrintedCost',original,2);
ok('B4 切換不改原選擇且可取消',eq(toggled===missing?missing:[...toggled],[0])&&eq([...original],[0,2]));
ok('B5 新增選擇',eq((()=>{const n=call('togglePrintedCost',set(0),3);return n===missing?n:[...n];})(),[0,3]));
const opts=[0,1,2,3,4,5];
const read=s=>call('readCostFilterSearch',s,opts,opts);
const vals=v=>v===missing?missing:{retreat:[...v.retreat],attack:[...v.attack]};
ok('C1 網址接受零與多選、去重',eq(vals(read('?retreat=0,2,2&attack=0,3')),{retreat:[0,2],attack:[0,3]}));
ok('C2 網址拒絕負值小數非數字與越界',eq(vals(read('?retreat=-1,1.5,NaN,99,01&attack=,null,Infinity,1e0')),{retreat:[],attack:[]}));
const written=call('writeCostFilterSearch','?set=ALL&page=3&card=9776&q=ex&utm=x&retreat=4',{retreat:set(3,0,1),attack:set(2,0)});
ok('C3 寫網址保留其他條件',written!==missing&&['set=ALL','page=3','card=9776','q=ex','utm=x'].every(s=>written.includes(s)));
ok('C4 排序後讀回不丟零',eq(vals(written===missing?missing:read(written)),{retreat:[0,1,3],attack:[0,2]}));
ok('C5 清空只刪本組參數',call('writeCostFilterSearch','?set=ALL&retreat=0&attack=3',{retreat:set(),attack:set()})==='?set=ALL');
const cards=rd('src/routes/cards/+page.svelte'),decks=rd('src/routes/decks/+page.svelte'),ui=rd('src/lib/cards/CostFilters.svelte');
for(const [name,src]of[['cards',cards],['decks',decks]]){
 ok('D '+name+' 共用判準接在清單 filter',src.includes('if (!matchesPrintedCosts(c, retreatCosts, attackCosts)) return false;'));
 ok('D '+name+' 共用元件雙向綁定',src.includes('<CostFilters bind:retreat={selectedRetreatCosts} bind:attack={selectedAttackCosts}'));
 ok('D '+name+' 手機收合計數包含費用',/countActiveFilters\([\s\S]{0,220}selectedRetreatCosts, selectedAttackCosts/.test(src));
 const foldStart=src.indexOf('{#if showFilters}'),foldEnd=src.indexOf('{/if}<!-- v6497-mobile-filter-toggle -->');
 ok('D '+name+' 費用元件位於手機收合區',foldStart>=0&&foldEnd>foldStart&&src.slice(foldStart,foldEnd).includes('<CostFilters bind:retreat={selectedRetreatCosts} bind:attack={selectedAttackCosts}'));
}
ok('D cards 費用寫入及還原網址',cards.includes('writeCostFilterSearch(writeCardsUrlSearch(location.search, st), costs)')&&cards.includes('readCostFilterSearch(location.search, retreatOptions, attackOptions)'));
ok('D cards 條件變更重設頁碼',/function allFilterKey\(\)[\s\S]{0,450}\[\.\.\.selectedRetreatCosts\], \[\.\.\.selectedAttackCosts\]/.test(cards));
ok('D 共用按鈕可讀標籤與 pressed 狀態',ui.includes('不需能量')&&ui.includes('aria-pressed={attack.has(value)}')&&ui.includes('aria-pressed={retreat.has(value)}'));
ok('D 本版純前端不新增請求或計時器',!!text&&!!ui&&!/\b(fetch|setInterval|setTimeout)\s*\(/.test(text+ui));
// 正對照在 BASE 與新版都要綠：原有網址分類／搜尋不因本版改變。
const legacy=await build({stdin:{contents:rd('src/lib/cards/url-state.ts'),loader:'ts'},bundle:true,write:false,format:'esm'});
const U=await import('data:text/javascript;base64,'+Buffer.from(legacy.outputFiles[0].text).toString('base64'));
const allowed={cat:['Pokemon','Item'],tag:[],type:['Fire'],stage:['Basic'],mark:['H','I','J']};
const oldState=U.readCardsUrlState('?set=ALL&q=測試&cat=Pokemon&type=Fire&stage=Basic&mark=J',allowed);
ok('P1 正對照 既有搜尋與分類還原',oldState.q==='測試'&&oldState.cat.join()==='Pokemon'&&oldState.type.join()==='Fire'&&oldState.stage.join()==='Basic'&&oldState.mark.join()==='J');
ok('P2 正對照 既有網址保留卡包與未知參數',U.writeCardsUrlSearch('?set=ALL&utm=x',oldState).includes('set=ALL&utm=x')&&U.writeCardsUrlSearch('?set=ALL', {...oldState,q:'',cat:[],type:[],stage:[],mark:[]})==='?set=ALL');
// BASE 缺元件時使用同一份標籤逐條報紅，不讓互動斷言消失。
const UI_LABELS=['撤退點擊更新父層清單','撤退複選','再點取消','撤退不限','第二招符合','招式複選','招式取消保留零費','跨組交集無結果','招式不限保留撤退','無橫向溢出與腳本錯誤','按鈕尺寸與選取狀態'];
// 真元件、真雙向綁定與正式判準，避免只驗事件字串而放過按鈕失效。
if (ui && text) {
  const wrapper=`<script>
    import CostFilters from ${JSON.stringify(join(SOURCE_ROOT,'src/lib/cards/CostFilters.svelte').replace(/\\/g,'/'))};
    import {matchesPrintedCosts} from ${JSON.stringify(join(SOURCE_ROOT,'src/lib/cards/cost-filter.ts').replace(/\\/g,'/'))};
    let retreat=$state(new Set()),attack=$state(new Set());
    const cards=${JSON.stringify([{...a,id:'a'},{...zero,id:'z'},{...four,id:'f'},{supertype:'Trainer',id:'t'}])};
    const shown=$derived(cards.filter(c=>matchesPrintedCosts(c,retreat,attack)).map(c=>c.id).join(','));
  </script>
  <CostFilters bind:retreat bind:attack retreatOptions={[0,1,2,3,4]} attackOptions={[0,1,2,3,4,5]} />
  <output id="results">{shown}</output>`;
  const component=compile(wrapper,{filename:join(ROOT,'v6636-wrapper.svelte'),generate:'client',css:'injected'}).js.code;
  const entry=await build({stdin:{contents:`import {mount} from 'svelte';import App from 'cost:app';mount(App,{target:document.getElementById('app')});`,resolveDir:ROOT,loader:'js'},bundle:true,write:false,format:'iife',conditions:['browser'],platform:'browser',plugins:[{name:'cost-app',setup(b){
    b.onResolve({filter:/^cost:app$/},()=>({path:'app',namespace:'cost'}));
    b.onLoad({filter:/.*/,namespace:'cost'},()=>({contents:component,loader:'js',resolveDir:ROOT}));
    b.onLoad({filter:/\.svelte$/},args=>({contents:compile(readFileSync(args.path,'utf8'),{filename:args.path,generate:'client',css:'injected'}).js.code,loader:'js',resolveDir:dirname(args.path)}));
  }}]});
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/app.js'?entry.outputFiles[0].text:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script src="/app.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await pwLaunch('v6636 真費用按鈕與雙向綁定');
    if(browser)for(const width of [320,390,1440]){
      const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:width<600,isMobile:width<600});const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
      try{
        await p.goto('http://127.0.0.1:'+server.address().port);p.setDefaultTimeout(3000);
        const r=p.getByRole('group',{name:'撤退費用（可複選）',exact:true}),a=p.getByRole('group',{name:'招式費用（可複選）',exact:true});
        const shown=()=>p.locator('#results').innerText();
        await r.getByRole('button',{name:'1',exact:true}).click();ok('E '+width+' '+UI_LABELS[0],await shown()==='a');
        await r.getByRole('button',{name:'0',exact:true}).click();ok('E '+width+' '+UI_LABELS[1],await shown()==='a,z');
        await r.getByRole('button',{name:'1',exact:true}).click();ok('E '+width+' '+UI_LABELS[2],await shown()==='z');
        await r.getByRole('button',{name:'不限',exact:true}).click();ok('E '+width+' '+UI_LABELS[3],await shown()==='a,z,f,t');
        await a.getByRole('button',{name:'3顆',exact:true}).click();ok('E '+width+' '+UI_LABELS[4],await shown()==='a');
        await a.getByRole('button',{name:'不需能量',exact:true}).click();ok('E '+width+' '+UI_LABELS[5],await shown()==='a,z');
        await a.getByRole('button',{name:'3顆',exact:true}).click();ok('E '+width+' '+UI_LABELS[6],await shown()==='z');
        await r.getByRole('button',{name:'4',exact:true}).click();ok('E '+width+' '+UI_LABELS[7],await shown()==='');
        await a.getByRole('button',{name:'不限',exact:true}).click();ok('E '+width+' '+UI_LABELS[8],await shown()==='f');
        ok('E '+width+' '+UI_LABELS[9],await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)&&errors.length===0);
        ok('E '+width+' '+UI_LABELS[10],await r.getByRole('button',{name:'4',exact:true}).getAttribute('aria-pressed')==='true'&&await p.locator('.cost-row button').evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect();return r.width>=36&&r.height>=36;})));
      }finally{await ctx.close();}
    }
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
} else {
  for(const width of [320,390,1440])for(const label of UI_LABELS)ok('E '+width+' '+label,false);
}
console.log(`v6636 ${pass} passed / ${fail} failed`);process.exitCode=fail?1:0;
