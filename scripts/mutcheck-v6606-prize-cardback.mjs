// 在 runner 沙盒執行；產品只修改獨立副本，N1使用沙盒內獨立探針檔。
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
assert.equal(process.env.V6606_MUTATION_SANDBOX,'1','必須明確指定 runner 沙盒');
const scratch=mkdtempSync(join(tmpdir(),'prize-6606-'));
const files=['src/routes/game/+page.svelte','src/lib/game/card-back.css','src/lib/assets/pokemon-card-back.jpg'];
for(const f of files){mkdirSync(dirname(join(scratch,f)),{recursive:true});writeFileSync(join(scratch,f),readFileSync(join(ROOT,f)));}
const path=join(scratch,files[0]),original=readFileSync(path,'utf8').replace(/\r\n/g,'\n');writeFileSync(path,original);
const guard=join(ROOT,'scripts/test-v6606-prize-cardback-ratio.mjs');
const run=(script=guard)=>spawnSync(process.execPath,[script],{cwd:ROOT,env:{...process.env,V6606_PRODUCT:scratch,PTCG_PW:'strict'},encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
const mutants=[
 ['M1 固定高度仍保留比例字串','height:auto; aspect-ratio:660 / 921;','height:134px; aspect-ratio:660 / 921;','A1'],
 ['M2 錯誤正方形比例','aspect-ratio:660 / 921;','aspect-ratio:1 / 1;','A1'],
 ['M3 不依手機格子縮寬','max-width:100%; box-sizing:border-box; } /* v6.606','max-width:none; box-sizing:border-box; } /* v6.606','A4'],
 ['M4 桌機卡背無故縮小','width:var(--pk-card); height:auto; aspect-ratio:','width:64px; height:auto; aspect-ratio:','A3'],
 ['M5 邊框另加破壞比例','max-width:100%; box-sizing:border-box; } /* v6.606','max-width:100%; box-sizing:content-box; } /* v6.606','A2'],
];
const probe=join(ROOT,'scripts/.v6606-comment-probe.mjs');
try{
 assert.equal(run().status,0,'原版必須全綠');
 for(const[id,from,to,red]of mutants){assert.equal(original.split(from).length-1,1,id+'錨點唯一');writeFileSync(path,original.replace(from,to));const r=run();assert.notEqual(r.status,0,id+'存活');assert.match(r.stdout,new RegExp('^FAIL '+red+'\\b','m'));assert.match(r.stdout,/^PASS P1\b/m);assert.match(r.stdout,/^PASS P2\b/m);console.log('KILLED '+id+' -> '+red);writeFileSync(path,original);}
 // 產品的逐位元範圍鎖本來會攔註解異動；N1只修改測試說明，確認行為探針不受文字干擾。
 const text=readFileSync(guard,'utf8');writeFileSync(probe,'// N1：純測試註解，不改行為。\n'+text);
 assert.equal(run(probe).status,0,'N1純註解不得紅');
 assert.equal(readFileSync(path,'utf8'),original,'產品逐位元還原');assert.equal(run().status,0,'還原複驗必須綠');
 console.log('5/5功能突變殺死；N1及逐位元還原回綠');
}finally{rmSync(probe,{force:true});rmSync(scratch,{recursive:true,force:true});}
