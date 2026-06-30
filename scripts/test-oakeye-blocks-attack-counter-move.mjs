/**
 * 探探鼠|監視之眼(雙方傷害指示物無法改放)應擋「招式型」移動指示物(v5.789)
 * 九尾狐搬動/伸長的傷害棺材/蠱惑挪移/傷害集結/火箭鏡面/奇異駭入 原只 gate 特性、漏招式。
 * 驗:場上有探探鼠時 regPost 不開 picker(被擋);無探探鼠時正常開 picker。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.oe-s.js'), E = join(ROOT, '.oe-e.ts'), O = join(ROOT, '.oe-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const OAK='18488', BIG='14335', ENERGY='18519', ANCIENT='10608', ROCKET='16570';
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
// 攻擊方 active=招式卡, 自方備戰有受傷寶可夢(供 self-source 用), 對手 active+備戰受傷(供 opp-source 用)
function mk(attackerCid, withOak) {
  const myBench=[inst(BIG,{damage:30}), inst(ANCIENT,{damage:20}), inst(ROCKET,{damage:20})]; // 受傷自方備戰(含古代/火箭隊來源)
  if (withOak) myBench.push(inst(OAK));   // 探探鼠在自方備戰(雙方都擋)
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(attackerCid),bench:myBench,hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]},
             {name:'P2',active:inst(BIG,{damage:30}),bench:[inst(BIG,{damage:20})],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]}]};
}
const cards=[['九尾|九尾狐搬動','18429'],['死神棺|伸長的傷害棺材','16793'],['振翼髮|蠱惑挪移','16825'],
             ['勾魂眼|傷害集結','16924'],['火箭隊的果然翁|火箭鏡面','12790'],['胡地|奇異駭入','10463']];
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const genericControl = new Set(['九尾|九尾狐搬動','死神棺|伸長的傷害棺材','胡地|奇異駭入','振翼髮|蠱惑挪移','火箭隊的果然翁|火箭鏡面']);
for (const [key,cid] of cards) {
  T(`★${key}：有探探鼠→不開picker(被擋)`, () => {
    const out=ATTACK_POST.get(key)(mk(cid,true),0,pool,{});
    assert.equal(out.pendingSelection, null, '監視之眼應擋下(不開 picker)');
  });
  if (genericControl.has(key)) T(`${key}：無探探鼠→正常開picker`, () => {
    const out=ATTACK_POST.get(key)(mk(cid,false),0,pool,{});
    assert.ok(out.pendingSelection, '無探探鼠應正常開 picker');
  });
}
console.log('\n監視之眼擋招式型移動指示物(v5.789):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
