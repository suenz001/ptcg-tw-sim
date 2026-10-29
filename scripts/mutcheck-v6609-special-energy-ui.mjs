// 突變只落在OS隔離產品副本，不改工作樹；不與全套同時執行。
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
assert.equal(process.env.V6609_MUTATION_SANDBOX,'1');
const copy=mkdtempSync(join(tmpdir(),'ptcg-v6609-mut-'));
const clean=()=>rmSync(copy,{recursive:true,force:true});process.once('exit',clean);for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{clean();process.exit(130);});
cpSync(join(ROOT,'src'),join(copy,'src'),{recursive:true});mkdirSync(join(copy,'static'));cpSync(join(ROOT,'static/cards'),join(copy,'static/cards'),{recursive:true});
const helper='src/lib/cards/attached-energy.ts',badge='src/lib/ui/SpecialEnergyBadges.svelte',mobile='src/routes/game/MobilePortraitBattle.svelte';
const originals=new Map([helper,badge,mobile].map(p=>[p,readFileSync(join(copy,p))]));
const run=()=>{const r=spawnSync(process.execPath,[join(ROOT,'scripts/test-v6609-special-energy-ui.mjs')],{cwd:ROOT,env:{...process.env,V6609_PRODUCT:copy},encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});assert.ifError(r.error);return r;};
const mutations=[
 ['M1 同名異圖不合併',helper,'${card?.name ?? energy.cardId}','${energy.cardId}','A1'],
 ['M2 特殊卡重複算入基本圖示',helper,"inst.energyAttached.filter(e => pool.get(e.cardId)?.subtype === 'Basic')",'inst.energyAttached','A3'],
 ['M3 把供能誤當張數',helper,'count: 1','count: 2','A2'],
 ['M4 一律截前兩字',helper,"SPECIAL_ENERGY_NAMES[name] ?? name.replace(/能量$/, '')","name.slice(0, 2)",'A5'],
 ['M5 備戰不合併種類',badge,'compact && groups.length > 1','compact && groups.length > 999','B2'],
 ['M6 吞掉Escape',badge,"if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();",'e.stopPropagation();','B4'],
 ['M7 特殊徽章允許被擠壓',badge,'flex:0 0 auto;','flex:0 1 auto;','B5'],
 ['M8 點徽章誤觸卡面',badge,'e.preventDefault(); e.stopPropagation();','e.preventDefault();','B3'],
 ['M9 基本圖示不讓出空間',mobile,'.mp-slot-basic { display:flex; min-width:0; overflow:hidden; }','.mp-slot-basic { display:flex; flex:none; }','B5'],
 ['M10 未知卡錯誤合併',helper,'card?.name ?? energy.cardId',"card?.name ?? 'unknown'",'A4'],
 ['M13 手機對齊回歸',mobile,'position:relative; text-align:center;','position:relative;','B8'],
 ['M12 經典欄位不限寬',badge,'max-width:90px;max-height:110px;','max-width:none;max-height:none;','B7'],
 ['M11 同iid重複算',helper,'if (seen.has(energy.iid)) continue;','if (false) continue;','A6'],
];
try{assert.equal(run().status,0,'正對照必須綠');let killed=0;for(const[name,p,from,to,behavior]of mutations){for(const[f,b]of originals)writeFileSync(join(copy,f),b);const source=readFileSync(join(copy,p),'utf8');assert.ok(source.includes(from),name+'錨點缺失');writeFileSync(join(copy,p),source.split(from).join(to));const r=run();assert.equal(r.status,1,name+'存活');assert.match(r.stdout,new RegExp('FAIL '+behavior+' '),name+'必須被指定行為斷言殺死，不能只靠精確還原');console.log('KILLED '+name+' -> '+behavior);killed++;}
for(const[f,b]of originals)writeFileSync(join(copy,f),b);writeFileSync(join(copy,helper),originals.get(helper).toString()+'\n// 無行為改變的正對照\n');assert.equal(run().status,0,'N1不能假紅');for(const[f,b]of originals)writeFileSync(join(copy,f),b);for(const[f,b]of originals)assert.deepEqual(readFileSync(join(copy,f)),b);assert.equal(run().status,0);console.log(`${killed}/${mutations.length}功能突變全殺，N1與逐位元還原回綠`);
}finally{clean();}
