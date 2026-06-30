/**
 * 「查看牌庫頂→回復原樣」的揭示不可對對手洩漏卡名(v5.794)
 *  - 好啦魷|惡作劇觸手:查【對手】牌庫頂放回 → 公開 log 揭卡名會讓對手得知自己牌庫頂。
 *  - 莫魯貝可|搜尋點心:查【自己】牌庫頂(保留分支放回)→ 同樣洩漏你的牌庫頂。
 *  兩者皆應改用中央 addPrivateLog:出招方 log 含卡名(privateMessage)、對手只見脫敏 message。
 *  HEAD:用普通 addLog → message 直接含卡名、無 privateMessage。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.dtp-s.js'), E = join(ROOT, '.dtp-e.ts'), O = join(ROOT, '.dtp-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST, ABILITY_EFFECTS_BY_NAME } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_POST, ABILITY_EFFECTS_BY_NAME } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const TOP='14321'; const TOPNAME=pool.get(TOP).name; // 霸王花
const HORROR='10615';   // 好啦魷
const MORPEKO='12611';  // 莫魯貝可
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

// 取最後一筆 source=出招方的 log
const lastLog = (st) => st.log[st.log.length-1];

T('★好啦魷|惡作劇觸手:揭示對手牌庫頂不洩漏(message脫敏+privateMessage含卡名)', () => {
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(HORROR),bench:[],hand:[],deck:[inst(TOP)],discard:[],prizes:[]},
             {name:'P2',active:inst(TOP),bench:[],hand:[],deck:[inst(TOP)],discard:[],prizes:[]}]};
  const out=ATTACK_POST.get('好啦魷|惡作劇觸手')(st,0,pool,{});
  // 找揭示那筆(含「查看對手牌庫頂」)
  const reveal=out.log.find(e=>e.message?.includes('查看對手牌庫頂'));
  assert.ok(reveal, '應有揭示 log');
  assert.ok(!reveal.message.includes(TOPNAME), `對手可見 message 不可含卡名「${TOPNAME}」: ${reveal.message}`);
  assert.ok(reveal.privateMessage && reveal.privateMessage.includes(TOPNAME), `出招方 privateMessage 應含卡名: ${reveal.privateMessage}`);
  assert.equal(reveal.playerIndex, 0, 'private 對象應為出招方');
});

T('★莫魯貝可|搜尋點心:揭示自己牌庫頂不洩漏(message脫敏+privateMessage含卡名)', () => {
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(MORPEKO),bench:[],hand:[],deck:[inst(TOP)],discard:[],prizes:[]},
             {name:'P2',active:inst(TOP),bench:[],hand:[],deck:[inst(TOP)],discard:[],prizes:[]}]};
  const fn=ABILITY_EFFECTS_BY_NAME.get('莫魯貝可|搜尋點心');
  assert.ok(fn,'應註冊搜尋點心');
  const out=fn(st,0,pool,st.players[0].active);
  const reveal=out.log.find(e=>e.message?.includes('搜尋點心'));
  assert.ok(reveal, '應有揭示 log');
  assert.ok(!reveal.message.includes(TOPNAME), `對手可見 message 不可含卡名「${TOPNAME}」: ${reveal.message}`);
  assert.ok(reveal.privateMessage && reveal.privateMessage.includes(TOPNAME), `出招方 privateMessage 應含卡名: ${reveal.privateMessage}`);
});

console.log('\n查看牌庫頂私有揭示(v5.794):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
