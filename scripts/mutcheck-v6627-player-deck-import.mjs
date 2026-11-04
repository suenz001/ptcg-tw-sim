// 僅在外部暫存副本實驗，不改ROOT；每個突變須由指定行為攔截。
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import{join,dirname,resolve,sep}from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'ptcg-v6627-'));
const admin='oracle-admin/admin.html',page='src/routes/decks/+page.svelte';
const originals=new Map([admin,page].map(p=>[p,readFileSync(join(ROOT,p),'utf8').replace(/\r\n/g,'\n')]));
for(const p of ['src/lib/decks/cardIdMigration.ts','src/lib/cards/visibility.ts']){mkdirSync(dirname(join(temp,p)),{recursive:true});copyFileSync(join(ROOT,p),join(temp,p));}
mkdirSync(join(temp,'static'),{recursive:true});symlinkSync(join(ROOT,'static/cards'),join(temp,'static/cards'),'junction');
function reset(){for(const[p,s]of originals){mkdirSync(dirname(join(temp,p)),{recursive:true});writeFileSync(join(temp,p),s);}}
function run(name,red){const r=spawnSync(process.execPath,[join(ROOT,'scripts/test-v6627-player-deck-import.mjs')],{cwd:ROOT,env:{...process.env,V6627_PRODUCT:temp},encoding:'utf8',timeout:60000});const out=(r.stdout||'')+(r.stderr||'');assert.equal(r.status,red?1:0,name+' '+out);if(red)assert.ok(out.includes('FAIL '+red),name+' 未命中指定行為 '+out);else assert.match(out,/23 PASS \/ 0 FAIL/);console.log(name+' OK'+(red?' -> '+red:''));}
function change(p,a,b){const s=originals.get(p);assert.equal(s.split(a).length-1,1,'突變錨點需唯一 '+a);writeFileSync(join(temp,p),s.replace(a,b));}
const cases=[
 ['M1 標題失去註解',admin,'`// ${title}`','`${title}`','無標記基本能量'],
 ['M2 卡號失去精確性',admin,'`${count} ${info.name} #${canonicalId}`','`${count} ${info.name}`','同名不同印刷'],
 ['M3 右半誤用卡號格式',admin,'`${count} ${info.name} ${info.setCode} ${info.collectorNumber}`','`${count} ${info.name} #${id}`','雙張場地左右不增減 19621'],
 ['M4 接受零張',admin,'count <= 0','count < 0','零張整份'],
 ['M5 缺卡仍開啟複製',admin,"${copyData.error ? 'disabled' : ''}","${''}",'缺卡整份'],
 ['M6 標題換行注入',admin,".replace(/[\\r\\n\\u2028\\u2029]+/g, ' ')",'','預覽文字與複製'],
 ['M7 預覽沒做HTML轉義',admin,'${escapeHtml(previewText)}','${previewText}','預覽文字與複製'],
 ['M8 玩家說明揭露來源',page,'（指定卡片版本）','（從 admin 複製）','玩家匯入說明'],
 ['M9 舊卡號未正規化',admin,'String(info.id ?? id)','String(id)','舊版M5 alias'],
 ['M10 強轉張數型別',admin,'const count = entry?.count;','const count = Number(entry?.count);','字串張數整份'],
];
try{reset();run('正對照');for(const[name,p,a,b,red]of cases){reset();change(p,a,b);run(name,red);}reset();writeFileSync(join(temp,admin),originals.get(admin)+'\n<!-- 中性註解 -->\n');run('N1 中性註解');reset();run('還原');console.log(cases.length+'/'+cases.length+'有效突變全殺');}finally{assert.ok(resolve(temp).startsWith(resolve(tmpdir())+sep));rmSync(temp,{recursive:true,force:true});}
