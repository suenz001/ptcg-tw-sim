// 所有突變僅落在新建的暫存產品副本；不改主工作樹，也不與全套同時執行。
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
assert.equal(process.env.V6608_MUTATION_SANDBOX,'1','須明確使用隔離產品副本');
const copy=mkdtempSync(join(tmpdir(),'v6608-mut-'));
const clean=()=>rmSync(copy,{recursive:true,force:true});process.once('exit',clean);for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{clean();process.exit(130);});
cpSync(join(ROOT,'src'),join(copy,'src'),{recursive:true});mkdirSync(join(copy,'static'));cpSync(join(ROOT,'static/cards'),join(copy,'static/cards'),{recursive:true});
const ray='src/lib/game/effects/cards/m6_wave14.ts',wait='src/lib/game/effects/cards/v169_supporters.ts';
const heat='src/lib/game/effects/cards/m5_preview.ts',peek='src/lib/game/effects/cards/v2750_h_wave2_full.ts';
const originals=new Map([ray,wait,heat,peek].map(p=>[p,readFileSync(join(copy,p))]));
const run=()=>{const r=spawnSync(process.execPath,[join(ROOT,'scripts/test-v6608-private-top-choice.mjs')],{cwd:ROOT,env:{...process.env,V6608_PRODUCT:copy,V6608_AUDIT_OUT:''},encoding:'utf8',maxBuffer:8*1024*1024,timeout:90000});assert.ifError(r.error);return r;};
const variants=[
 ['M1霸者誤必選',ray,'minCount: 0, maxCount: 1,','minCount: 1, maxCount: 1,','A1','P8'],
 ['M2女服務生誤必選',wait,'minCount: 0, maxCount: 1,\n    // <<< v6608-private-typed-peek','minCount: 1, maxCount: 1,\n    // <<< v6608-private-typed-peek','A4','P2'],
 ['M3不附選中能量',ray,'c && chosen && c.iid === selfIid ?','c && chosen && false && c.iid === selfIid ?','P2','P8'],
 ['M4誤動第五張以後順序',ray,"deckWithCardsToBottom(remainingDeck, rest, 'shuffled')","deckWithCardsToBottom([...remainingDeck].reverse(), rest, 'shuffled')",'A1','P8'],
 ['M5錯限火雷能量',ray,"const basicEnergyIids = top4\n    .filter(c => { const cc = pool.get(c.cardId); return cc?.supertype === 'Energy' && cc.subtype === 'Basic'; })","const basicEnergyIids = top4\n    .filter(c => { const cc = pool.get(c.cardId); return cc?.supertype === 'Energy' && cc.subtype === 'Basic' && (cc.name.includes('火') || cc.name.includes('雷')); })",'P4','P8'],
 ['M6取消附加目標宣告',wait,'validIids: [st.players[idx].active, ...st.players[idx].bench].filter((c): c is CardInstance => !!c).map(c => c.iid)','validIids: []','P8','P1'],
 ['M7附加目標可空選',wait,"minCount: 1, maxCount: 1,\n    effectKey: 'waitress-attach'","minCount: 0, maxCount: 1,\n    effectKey: 'waitress-attach'",'P8','P1'],
 ['M8附給戰鬥位而非發動者',ray,'c && chosen && c.iid === selfIid ?','c && chosen && c.iid === pl.active?.iid ?','P2','P8'],
 ['M9熱帶公開候選數',heat,'果實香氣：查看牌庫上方 ${peekN} 張，選任意數量寶可夢加手牌','果實香氣：查看牌庫上方 ${peekN} 張，含 ${pokeIids.length} 隻寶可夢','D1','P8'],
 ['M10拉普公開候選數',peek,'選任意數量能量（附到自方任一寶可夢，剩餘洗回）','選 0~${realMax} 張能量（附到自方任一寶可夢，剩餘洗回）','D2','P8'],
 ['M11零候選公開無寶可夢',peek,'// v5.964 卡面「查看…上方N張」是無條件動作:無寶可夢也要讓玩家看到這 N 張(maxCount:0 僅檢視 → 洗回)。','// v5.964 卡面「查看…上方N張」是無條件動作:無寶可夢也要讓玩家看到這 N 張(maxCount:0 僅檢視 → 洗回）。\n      state = addLog(state, `${label}：沒有寶可夢`, aIdx);','D3','P8'],
 ['M12熱帶零候選略過查看',heat,'// v6.608：私下查看不公開候選數；無命中仍須讓本人查看這些卡，再選0並重洗。','if (pokeIids.length === 0) return updatePlayer(state, aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));','D1','P8'],
 ['M13拉普零候選略過查看',peek,'// v6.608：無命中仍開私下檢視；公開紀錄不得揭露候選數或宣告沒有能量。','if (energiesInTop.length === 0) return updatePlayer(state, aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));','D2','P8'],
 ['M14熱帶漏傳查看範圍',heat,'topIids: top6.map(c => c.iid), validIids: pokeIids','validIids: pokeIids','D1','P8'],

];
try{
 assert.equal(run().status,0,'突變前必須綠');
 for(const[id,path,a,b,red,green]of variants){for(const[p,raw]of originals)writeFileSync(join(copy,p),raw);const s=originals.get(path).toString().replaceAll('\r\n','\n');assert.equal(s.split(a).length,2,id+'錨點須唯一');writeFileSync(join(copy,path),s.replace(a,b));const r=run();assert.equal(r.status,1,id+'須由行為斷言失敗');assert.match(r.stdout,new RegExp('^FAIL '+red+' ','m'),id+'指定紅');assert.match(r.stdout,new RegExp('^PASS '+green+' ','m'),id+'正對照須綠');console.log('KILLED '+id+' -> '+red);}
 for(const[p,raw]of originals)writeFileSync(join(copy,p),raw);
 writeFileSync(join(copy,ray),originals.get(ray).toString()+'\n// N1 無行為變更。\n');assert.equal(run().status,0,'N1註解不得誤紅');
 for(const[p,raw]of originals)writeFileSync(join(copy,p),raw);
 for(const[p,raw]of originals)assert.deepEqual(readFileSync(join(copy,p)),raw);
 assert.equal(run().status,0,'逐位元還原後回綠');console.log('14/14功能突變全殺；N1、逐位元還原及回綠通過。正對照部分為未讀受突變檔的結構性綠。');
}finally{clean();}
