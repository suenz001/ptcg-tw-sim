// ⚠ v6.611 起：這支只適用 v6.609／v6.610 當時的 SpecialEnergyBadges 元件（是那兩版的突變證據，不在測試鏈）；元件已改成一顆膠囊，現在跑會因錨點缺失而失敗，屬預期。
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
assert.equal(process.env.V6610_MUTATION_SANDBOX,'1');
const copy=mkdtempSync(join(tmpdir(),'ptcg-6610-'));
assert.equal(dirname(resolve(copy)),resolve(tmpdir()));
const clean=()=>rmSync(copy,{recursive:true,force:true});process.once('exit',clean);
cpSync(join(ROOT,'src'),join(copy,'src'),{recursive:true});mkdirSync(join(copy,'static'));cpSync(join(ROOT,'static/cards'),join(copy,'static/cards'),{recursive:true});
for(const n of ['changelog.html','changelog-bodies.html','changelog-archive.html'])cpSync(join(ROOT,'static',n),join(copy,'static',n));
const helper='src/lib/cards/attached-energy.ts',badge='src/lib/ui/SpecialEnergyBadges.svelte',mobile='src/routes/game/MobilePortraitBattle.svelte';
const originals=new Map([helper,badge,mobile].map(p=>[p,readFileSync(join(copy,p))]));
const run=()=>{const r=spawnSync(process.execPath,[join(ROOT,'scripts/test-v6610-energy-labels.mjs')],{cwd:ROOT,env:{...process.env,V6610_PRODUCT:copy},encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});assert.ifError(r.error);return r;};
const mutations=[
 ['M1 單張錯顯示數量',badge,'group.count > 1 ?','group.count >= 1 ?','B1',1],
 ['M2 手機也用乘號',badge,"mobile ? '' : ' ×'","' ×'",'B1',1],
 ['M3 compact錯當手機判準',badge,"mobile ? '' : ' ×'","compact ? '' : ' ×'",'B2',1],
 ['M4 衝天回歸三字',helper,"'新衝天能量': '衝天'","'新衝天能量': '新衝天'",'A1',1],
 ['M5 手機漏接mobile',mobile,' mobile oninspect={onOpenEnergy}',' oninspect={onOpenEnergy}','B6',4],
 ['M6 新卡回歸冗長標記',helper,"card ? '特殊' : '未知'","card ? name.replace(/能量$/, '') : '未知'",'A3',1],
];
try{const first=run();assert.equal(first.status,0,'正對照必須綠 '+first.stdout+first.stderr);let killed=0;for(const[name,p,from,to,behavior,expectedHits]of mutations){for(const[f,b]of originals)writeFileSync(join(copy,f),b);const s=readFileSync(join(copy,p),'utf8');assert.equal(s.split(from).length-1,expectedHits,name+'錨點命中數不符');writeFileSync(join(copy,p),s.split(from).join(to));const r=run();assert.equal(r.status,1,name+'存活');assert.match(r.stdout,new RegExp('FAIL '+behavior+' '),name+'須由指定行為攔下，不能只靠P範圍檢查');console.log('KILLED '+name+' -> '+behavior);killed++;}
for(const[f,b]of originals)writeFileSync(join(copy,f),b);writeFileSync(join(copy,helper),originals.get(helper).toString()+'\n// 純註解正對照\n');assert.equal(run().status,0,'N1純註解不能使行為假紅');for(const[f,b]of originals)writeFileSync(join(copy,f),b);for(const[f,b]of originals)assert.deepEqual(readFileSync(join(copy,f)),b);assert.equal(run().status,0);console.log(`${killed}/${mutations.length}功能突變全殺，N1與逐位元還原回綠`);
}finally{clean();}
