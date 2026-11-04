// 只改外部產品副本，每項突變須由指定真UI行為攔截，且既有正對照仍通過。
import assert from 'node:assert/strict';
import{mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';
import{join,resolve,sep}from'node:path';
import{fileURLToPath}from'node:url';
import{spawnSync}from'node:child_process';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'ptcg-v6628-'));
const path='oracle-admin/admin.html',original=readFileSync(join(ROOT,path),'utf8').replace(/\r\n/g,'\n');
mkdirSync(join(temp,'oracle-admin'));mkdirSync(join(temp,'static'));symlinkSync(join(ROOT,'static/cards'),join(temp,'static/cards'),'junction');
function reset(){writeFileSync(join(temp,path),original);}
function run(name,red){const r=spawnSync(process.execPath,[join(ROOT,'scripts/test-v6628-tournament-deck-snapshots.mjs')],{cwd:ROOT,env:{...process.env,V6628_PRODUCT:temp},encoding:'utf8',timeout:300000,maxBuffer:5*1024*1024});const out=(r.stdout||'')+(r.stderr||'');assert.equal(r.status,red?1:0,name+' '+out);assert.ok(out.includes('PASS 既有賽程與回放入口保留')&&out.includes('PASS 既有formatter與玩家資料不改動'),name+' 正對照必須綠 '+out);if(red)assert.ok(out.includes('FAIL '+red),name+' 指定行為未紅 '+out);else assert.match(out,/v6628 23 PASS \/ 0 FAIL/);console.log(name+' OK'+(red?' -> '+red:''));}
function change(a,b){assert.equal(original.split(a).length-1,1,'突變錨點需唯一 '+a);writeFileSync(join(temp,path),original.replace(a,b));}
const cases=[
 ['M1 不分參賽uid','String(p.uid) === String(uid)','true','冠軍用uid辨識'],
 ['M2 不分賽事eventId','String(a.eventId) === String(eventId)','true','同一玩家跨場'],
 ['M3 拿其他視窗的文字','writeText(pre.textContent)','writeText(window._lastDeckCopyText)','複製目前可見牌表'],
 ['M4 移除載入關閉檢查',"if (!overlay || overlay.style.display === 'none' || !overlay.querySelector('[data-archive-loading=\"' + request + '\"]')) return;",'', '載入途中關閉'],
 ['M5 uid改單引號拼接',"JSON.stringify(String(uid ?? ''))",`("'" + String(uid ?? '') + "'")`,'特殊字元ID'],
 ['M6 忽略關閉視窗','overlay.style.display === \'none\' || !overlay.contains(btn)','false || !overlay.contains(btn)','已關閉視窗不可再複製'],
 ['M7 不確認按鈕仍屬於目前視窗','!overlay.contains(btn)','false','切到B後不能用A舊按鈕'],
];
try{reset();run('正對照');for(const[name,a,b,red]of cases){reset();change(a,b);run(name,red);}reset();writeFileSync(join(temp,path),original+'\n<!-- 中性註解 -->\n');run('N1 中性註解');reset();run('還原');console.log(cases.length+'/'+cases.length+' 有效突變全殺');}finally{assert.ok(resolve(temp).startsWith(resolve(tmpdir())+sep));rmSync(temp,{recursive:true,force:true});}
