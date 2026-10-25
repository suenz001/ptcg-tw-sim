#!/usr/bin/env node
// v6.587：真實 Svelte 排名欄位與實際 CSS 的字色、對比與不變性。
import { revertV6592Game } from './lib/revert-v6592-game.mjs';
import { revertV6599Game } from './lib/revert-v6599-pages.mjs';   // ⭐v6.599（Rule 40）：牌組先後攻偏好接線（行為由 test-v6599 守）
import { revertV6598Game as _rv6598Game, revertV6598Cards, revertV6598Decks, V6598_CARDS_PAIRS } from './lib/revert-v6598-pages.mjs';   // ⭐v6.598（Rule 40）：手機彈出視窗上緣／關閉鈕，先還原成 v6.597
import { revertV6600Game } from './lib/revert-v6600-game.mjs';   // ⭐v6.600（Rule 40）：復盤勝敗與雙方牌組接線（行為由 test-v6600 守）
import { revertV6601Game } from './lib/revert-v6601-game.mjs';   // ⭐v6.601（Rule 40）：我的錦標賽對戰標勝敗（行為由 test-v6601 守）
const revertV6598Game = (x) => _rv6598Game(revertV6599Game(revertV6600Game(revertV6601Game(x))));   // ⭐v6.599～v6.601：鏈一版一節（既有呼叫點一個字都不必改）
import { revertV6596Game } from './lib/revert-v6596-game.mjs';   // ⭐v6.596（Rule 40）：對戰頁先還原 v6.596（直立大螢幕填滿、擲幣後提示）再接 v6.595
import { revertV6595Game } from './lib/revert-v6595-game.mjs';   // ⭐v6.595（Rule 40）：對戰頁先還原 v6.595 的出招前擲幣與錦標賽復盤下載
import { readFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pwLaunch } from './lib/pw.mjs';
import { readBaseBlob,hasBaseCommit,shallowSkip } from './lib/base-blob.mjs';
import { standingsFixture,measureStandings } from './lib/swiss-standings-fixture.mjs';
import { revertMobileUiV6590 } from './lib/mobile-ui-v6590-pairs.mjs';
import { V6587_GAME_PAIRS } from './lib/revert-v6587-game.mjs';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const PAGE='src/routes/game/+page.svelte';
const BASE='34f59afb705b3a30db7abd1056303b08edbc1f26';
const rd=p=>readFileSync(join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const source=rd(PAGE),layout=rd('src/routes/+layout.svelte'),raw=readFileSync(join(ROOT,PAGE));
let pass=0,fail=0;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function ok(name,value,details=''){if(value){pass++;console.log('PASS '+name);}else{fail++;console.error('FAIL '+name+' '+details);}}
function replaceOne(s,a,b){if(s.split(a).length!==2)throw new Error('錨點不是唯一：'+a.slice(0,80));return s.replace(a,b);}
const baseRead=()=>{const x=readBaseBlob(ROOT,BASE,PAGE);if(!x.ok)throw new Error('BASE讀取失敗');return x.out.replace(/\r\n/g,'\n');};
const lightRules=[...source.matchAll(/:global\(html\[data-theme='light'\]:not\(\[data-battle-view\]\)\) \.tourn-standing-self \{ color: #[0-9a-fA-F]{6}; \}/g)];
ok('本人淺色規則恰好一條',lightRules.length===1);
const lightRule=lightRules.length===1?lightRules[0][0]:null;
// 還原色彩產生區，再用精確字面還原本版 markup；整頁原始意圖不放寬。
if(hasBaseCommit(ROOT,BASE)){
  const base=baseRead();
  const block=/\/\* >>> v6477-lobby-light \*\/[\s\S]*?\/\* <<< v6477-lobby-light \*\//g;
  const old=base.match(block),current=source.match(block);
  if(old?.length!==1||current?.length!==1)throw new Error('淺色哨兵必須唯一');
  const revertForRule40=(input,pre=(x,p)=>revertMobileUiV6590(revertV6592Game(revertV6595Game(revertV6596Game(revertV6598Game(x)))),p))=>{
  let restored=pre(input,PAGE).replace(current[0],old[0]);
  let unique=true;
  for(const [now,prev]of V6587_GAME_PAIRS){
    if(restored.split(now).length!==2){unique=false;continue;}
    restored=restored.replace(now,prev);
  }
  return unique&&restored!==input&&restored===base;
  };
  ok('Rule40 本版字面還原後逐位元等於上一版',revertForRule40(source));
  ok('Rule40 接線負對照：略過本版還原必須失敗',!revertForRule40(source,x=>x));
  ok('Rule40 接線負對照：只略過v6592還原必須失敗',!revertForRule40(source,revertMobileUiV6590));
  ok('Rule40 負對照：額外差異不得被還原吞掉',!revertForRule40(source+'\n/* 未授權差異 */\n'));
}else shallowSkip('v6587 還原與 HEAD-FAIL','需要v6.586歷史');

const browser=await pwLaunch('v6.587 瑞士制本人字色對比');
if(browser){
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.abort());
    const head=await standingsFixture(ROOT,source,layout);
    const base=hasBaseCommit(ROOT,BASE)?await standingsFixture(ROOT,baseRead(),layout):null;
    const visualCells=m=>m.cells.map(({style,...rest})=>rest);
    const controls=m=>visualCells(m).filter((_,i)=>i!==10&&i!==11);
    const geometry=m=>m.cells.map(c=>c.geometry);
    async function checks(f,width=390){
      const light=await measureStandings(page,f,width,'light');
      const dark=await measureStandings(page,f,width,'dark');
      const battle=await measureStandings(page,f,width,'light',true);
      return {light,dark,battle,
        readable:light.contrast>=4.5&&light.cells[10].color===light.cells[11].color,
        own:light.cells[11].text.endsWith('（你）')&&light.cells[10].weight==='700'&&light.cells[11].weight==='700',
        scoped:same(dark.cells.map(c=>c.color),battle.cells.map(c=>c.color)),
      };
    }
    for(const width of [320,390,430,1280]){
      const h=await checks(head,width);
      ok(width+' 淺色本人文字對比≥4.5',h.readable,JSON.stringify({contrast:h.light.contrast,color:h.light.cells[11].color,bg:h.light.background}));
      ok(width+' 本人粗體與（你）標記保留',h.own);
      ok(width+' 淺色覆寫不影響牌桌狀態',h.scoped);
      if(base){
        const b=await checks(base,width);
        ok(width+' HEAD-FAIL：舊版本人文字對比不足',!b.readable,JSON.stringify(b.light));
        ok(width+' 正對照：舊版本人標記與粗體正常',b.own);
        ok(width+' 其他玩家與標題的外觀不變',same(controls(h.light),controls(b.light)));
        ok(width+' 全表幾何與截字行為不變',same(geometry(h.light),geometry(b.light))&&h.light.cells[11].textOverflow===b.light.cells[11].textOverflow);
        ok(width+' 深色所有欄位的字色與幾何不變',same(visualCells(h.dark),visualCells(b.dark)));
      }
      if(width===390)console.log('MEASURE '+JSON.stringify({light:h.light.contrast,dark:h.dark.contrast,fg:h.light.cells[11].color,bg:h.light.background}));
    }
    const nameLine='class:tourn-standing-self={s.mine} style="overflow:hidden;';
    const rankLine='class:tourn-standing-self={s.mine} style="text-align:center;"';
    const mutationReady=[nameLine,rankLine,lightRule,'{s.name}{#if s.mine} （你）{/if}'].every(x=>x&&source.split(x).length===2);
    ok('突變前提：產品錨點各恰好一處',mutationReady);
    // BASE 沒有新版結構時，前提已判紅；仍完成下方對比與正對照，不因缺少 class 整支 throw。
    const mutations=mutationReady?[
      ['名字漏套樣式',s=>replaceOne(s,nameLine,'style="overflow:hidden;'),'readable'],
      ['名次漏套樣式',s=>replaceOne(s,rankLine,'style="text-align:center;"'),'readable'],
      ['淺色規則消失',s=>replaceOne(s,lightRule,''),'readable'],
      ['淺色仍用淡黃色',s=>replaceOne(s,lightRule,lightRule.replace(/#[0-9a-fA-F]{6}/,'#ffd56b')),'readable'],
      ['淺色規則外洩牌桌',s=>replaceOne(s,lightRule,lightRule.replace(':not([data-battle-view])','')),'scoped'],
      ['本人標記遺失',s=>replaceOne(s,'{s.name}{#if s.mine} （你）{/if}','{s.name}'),'own'],
    ]:[];
    for(const [name,mutate,red]of mutations){
      const m=await checks(await standingsFixture(ROOT,mutate(source),layout));
      ok('指定突變紅項：'+name+' → '+red,m[red]===false);
      // 幾何維持綠只是確認仍在相同版面量測，不作為邏輯獨立性的宣稱。
      const g=await checks(head);
      const geometrySame=same(geometry(m.light),geometry(g.light));
      ok('突變正對照：'+name,red==='own'?m.readable:geometrySame);
    }
    const comment=await checks(await standingsFixture(ROOT,source+'\n<!-- N1註解對照 -->\n',layout));
    ok('N1 只改註解仍綠',comment.readable&&comment.own&&comment.scoped);
    ok('測試後原始產品 bytes 不變',raw.equals(readFileSync(join(ROOT,PAGE))));
    const last=await checks(head);ok('突變後HEAD複驗仍綠',last.readable&&last.own&&last.scoped);
    ok('沒有瀏覽器JS錯誤',errors.length===0,JSON.stringify(errors));
  }finally{await browser.close();}
}
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);process.exit(fail?1:0);
