/** v5.860 條件加傷「若對手是進化寶可夢 +N」判進化收斂中央 isEvolutionCard(cardStage 三重防線)守衛。
 *
 *  效果.ts:278 鐵律：判「對手/自己是進化寶可夢」的傷害加成禁直接 subtype==='Stage1'/純 !!evolvesFrom
 *  (會漏 ex 進化 或 資料缺 evolvesFrom 的進化卡)，一律走中央 isEvolutionCard。
 *
 *  先前殘留違規(用純 !!evolvesFrom)：
 *   - 雙斧戰龍|揮擊 (oppEvolutionConditionPre, v2600)
 *   - 厄鬼椪 火灶面具ex|極限火焰 (effects.ts:10417)
 *   - 故勒頓|戰鬥爪 (m5_preview, stage∈{S1,S2}||evolvesFrom 未收斂)
 *
 *  HEAD-FAIL：mock 對手「subtype='Stage1'、缺 stage、缺 evolvesFrom」(engine:561 註解火箭隊操陷蛛型
 *  資料缺漏，subtype 才是唯一階級來源)。cardStage 用 stage??subtype → 'Stage1' → 進化，加傷；
 *  HEAD 版純 !!evolvesFrom → false → 漏判少加傷 → FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.ce-s.js'),E=join(ROOT,'.ce-e.ts'),O=join(ROOT,'.ce-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_PRE }=await import(pathToFileURL(O).href);

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

// ── 塞 mock 卡進 pool ──
pool.set('MOCK_ATK',   {id:'MOCK_ATK',   name:'測試攻擊者',            supertype:'Pokemon', stage:'Basic', subtype:'Basic', regulationMark:'H', hp:200});
// ★資料缺漏型：只有 subtype='Stage1'，缺 stage、缺 evolvesFrom → cardStage 靠 subtype 才判進化
pool.set('MOCK_SUBEVO',{id:'MOCK_SUBEVO',name:'測試進化(僅subtype)',   supertype:'Pokemon', subtype:'Stage1', regulationMark:'H', hp:100});
// 正常基礎卡(對照，不該加傷)
pool.set('MOCK_BASIC', {id:'MOCK_BASIC', name:'測試基礎',              supertype:'Pokemon', stage:'Basic', subtype:'Basic', regulationMark:'H', hp:100});
// 正常 ex 進化卡(對照，該加傷；驗證修後正常卡仍對)
pool.set('MOCK_EXEVO', {id:'MOCK_EXEVO', name:'測試ex進化',            supertype:'Pokemon', stage:'Stage1', subtype:'ex', evolvesFrom:'測試基礎', regulationMark:'H', hp:210});

const mkState=(defCardId,attEnergy=[])=>({
  phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[
    {name:'P1',active:{iid:'atk',cardId:'MOCK_ATK',damage:0,energyAttached:attEnergy,status:null,secondaryStatus:null,tertiaryStatus:null},bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
    {name:'P2',active:{iid:'def',cardId:defCardId,damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null},bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
  ],
});
const run=(key,defCardId,attEnergy=[])=>{ const pre=ATTACK_PRE.get(key); if(!pre) throw new Error('無此招式 pre: '+key);
  const r=pre(mkState(defCardId,attEnergy),0,pool,{}); return r?.damage; };

let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

// ── ① 資料缺漏進化卡(僅 subtype='Stage1') 三招式都要加傷(HEAD-FAIL 核心) ──
T('★揮擊 對「僅subtype進化」→ 80+80=160', ()=>{ const d=run('雙斧戰龍|揮擊','MOCK_SUBEVO'); assert.strictEqual(d,160,`應160,實際${d}`); });
T('★極限火焰 對「僅subtype進化」→ 140+140=280', ()=>{ const d=run('厄鬼椪 火灶面具ex|極限火焰','MOCK_SUBEVO',[{},{}]); assert.strictEqual(d,280,`應280,實際${d}`); });
T('★戰鬥爪 對「僅subtype進化」→ 30+30=60', ()=>{ const d=run('故勒頓|戰鬥爪','MOCK_SUBEVO'); assert.strictEqual(d,60,`應60,實際${d}`); });

// ── ② 正常 ex 進化卡(stage='Stage1'+evolvesFrom) 仍加傷(修後不回歸) ──
T('揮擊 對正常ex進化 → 160', ()=>{ assert.strictEqual(run('雙斧戰龍|揮擊','MOCK_EXEVO'),160); });
T('極限火焰 對正常ex進化 → 280', ()=>{ assert.strictEqual(run('厄鬼椪 火灶面具ex|極限火焰','MOCK_EXEVO',[{}]),280); });
T('戰鬥爪 對正常ex進化 → 60', ()=>{ assert.strictEqual(run('故勒頓|戰鬥爪','MOCK_EXEVO'),60); });

// ── ③ 基礎卡 不加傷(對照，確保沒把基礎誤判進化) ──
T('揮擊 對基礎 → 80(不加)', ()=>{ assert.strictEqual(run('雙斧戰龍|揮擊','MOCK_BASIC'),80); });
T('極限火焰 對基礎 → 140(不加)', ()=>{ assert.strictEqual(run('厄鬼椪 火灶面具ex|極限火焰','MOCK_BASIC'),140); });
T('戰鬥爪 對基礎 → 30(不加)', ()=>{ assert.strictEqual(run('故勒頓|戰鬥爪','MOCK_BASIC'),30); });

console.log('\n條件加傷判進化收斂(v5.860):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
