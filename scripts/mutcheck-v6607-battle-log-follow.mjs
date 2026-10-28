// 只在測試沙盒執行；產品突變在臨時副本，不碰主工作樹。
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
assert.equal(process.env.V6607_MUTATION_SANDBOX,'1','只准沙盒執行');
const copy=mkdtempSync(join(tmpdir(),'v6607-')),paths=['src/routes/game/+page.svelte','src/routes/game/MobilePortraitBattle.svelte','src/lib/game/battle-log-follow.ts'];
const originals=new Map(paths.map(p=>[p,readFileSync(join(ROOT,p))]));
for(const [p,b]of originals){mkdirSync(join(copy,p,'..'),{recursive:true});writeFileSync(join(copy,p),b);}
const path='src/lib/game/battle-log-follow.ts',source=originals.get(path).toString().replace(/\r\n/g,'\n');
function run(){const r=spawnSync(process.execPath,['scripts/test-v6607-battle-log-follow.mjs'],{cwd:ROOT,env:{...process.env,V6607_PRODUCT:copy,PTCG_PW_STRICT:'1'},encoding:'utf8',maxBuffer:12*1024*1024,timeout:180000});assert.ok(!r.error,String(r.error));return r;}
const variants=[
 ['M1不捲動','if (pinned) node.scrollTop = node.scrollHeight;','if (false) node.scrollTop = node.scrollHeight;','A1'],
 ['M2忽略閱讀意圖','if (pinned) node.scrollTop = node.scrollHeight;','if (true) node.scrollTop = node.scrollHeight;','A2'],
 ['M3不監看新增紀錄','mutations.observe(node, { childList: true, subtree: true, characterData: true, attributes: true });','void node;','A3'],
 ['M4不監看容器高度','resize.observe(node);','void node;','A4'],
 ['M5錯捲到頂端','if (pinned) node.scrollTop = node.scrollHeight;','if (pinned) node.scrollTop = 0;','A1'],
 ['M6不接收捲動意圖',"node.addEventListener('scroll', onScroll, { passive: true });",'void node;','A2'],
 ['M7短紀錄滾輪誤停','node.scrollTop > 0 && event.deltaY','event.deltaY','A10'],
 ['M8短紀錄觸控誤停','node.scrollTop > 0 && touchY','touchY','A11'],
 ['M9縮放誤停','!event.ctrlKey && ','','A12'],
];
try{for(const [id,a,b,assertion]of variants){assert.equal(source.split(a).length,2,id+'唯一錨點');writeFileSync(join(copy,path),source.replace(a,b));const r=run();assert.notEqual(r.status,0,id+'存活');assert.match(r.stdout,new RegExp('FAIL '+assertion+' '),id+'必須行為紅');assert.match(r.stdout,/PASS P1 /);assert.match(r.stdout,/PASS P2 /);console.log('KILLED '+id+' -> '+assertion);}
 writeFileSync(join(copy,path),source+'\n// 無行為影響的註解正對照。\n');assert.equal(run().status,0,'N1註解不得失敗');writeFileSync(join(copy,path),originals.get(path));assert.equal(run().status,0,'還原必須回綠');for(const[p,b]of originals)assert.deepEqual(readFileSync(join(copy,p)),b);console.log('9/9功能突變全殺；N1及逐位元還原回綠');
}finally{rmSync(copy,{recursive:true,force:true});}
