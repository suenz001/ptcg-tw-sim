/** v5.863 對手手牌被「放回牌庫」時，戰鬥 log 須向雙方公開揭示放回的是哪張卡(Wilson 裁定)。
 *  卡藏起(重洗)後 log 是唯一記錄 → 必須公開(addLog 非 addPrivateLog、且訊息含卡名)。
 *
 *  受測(放回牌庫型):洛托姆|驚嚇、雪童子|驚嚇、長尾怪手|驚嚇、墓揚犬|恐怖啃咬、步哨鼠|臨檢。
 *  HEAD-FAIL:原用 addPrivateLog(卡名只給攻方,對手/觀戰者公開訊息無名) 或 generic(全無名)
 *           → 公開 log 不含卡名 → FAIL；修後公開 log 含卡名 → PASS。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.oh-s.js'), E = join(ROOT, '.oh-e.ts'), O = join(ROOT, '.oh-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const HAND_CARD='14104' /*基本【鬥】能量*/, HAND_NAME=pool.get('14104')?.name; // 對手手牌唯一卡→被放回者確定
let nn=0;
const inst=(cid)=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null});
function mk(){
  return { phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[
      {name:'P1',active:inst(HAND_CARD),bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
      {name:'P2',active:inst(HAND_CARD),bench:[],hand:[inst(HAND_CARD)],deck:[inst(HAND_CARD)],discard:[],prizes:[1,1,1,1,1,1]},
    ]};
}
// 公開揭示 = 存在一條 log,其 message(公開文字)含卡名(不看 privateMessage)
const publicRevealsName=(st)=> st.log.some(l => (l.message||'').includes(HAND_NAME));
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

for (const key of ['洛托姆|驚嚇','雪童子|驚嚇','長尾怪手|驚嚇','墓揚犬|恐怖啃咬','步哨鼠|臨檢']) {
  T(`★${key} 放回牌庫須公開揭示卡名（${HAND_NAME}）`, () => {
    const post=ATTACK_POST.get(key);
    assert.ok(post, '找不到 '+key);
    // 恐怖啃咬/臨檢/驚嚇皆擲幣型:固定正面讓其執行
    const orig=Math.random; Math.random=()=>0;
    let out; try{ out=post(mk(),0,pool,{}); } finally { Math.random=orig; }
    assert.ok(publicRevealsName(out), `公開 log 應含卡名「${HAND_NAME}」(HEAD:addPrivateLog/generic 不含)`);
  });
}
console.log('\n對手手牌放回牌庫公開揭示(v5.863):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
