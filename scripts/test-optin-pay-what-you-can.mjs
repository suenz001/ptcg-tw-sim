// v5.992 HEAD-FAIL 守衛:「若希望,付出 N 個能量→加傷/狀態」opt-in pay-what-you-can 中央管線(resolveOptInPayment)
//   Wilson 裁定:①加傷型 opt-in 0 能量也全額加傷(忍者飛旋/時間爆炸/狂暴噴射/叢林鞭打/金屬之錘)
//   ②狀態型(災難衝擊)不足 N 丟可丟的+狀態一定施加;0 個也可 opt-in
//   ③公平性:opt-in 送短少 iids → 引擎 auto-top-up 強制足額付款
//   HEAD(v5.991) 忍者飛旋0水=120/狂暴噴射0能=200/叢林鞭打0能=80/災難衝擊0..1雷不麻痺 → 本檔 FAIL
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-opw.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-opw.ts'); const O = join(ROOT, '.ent-opw.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { ATTACK_PRE, ATTACK_POST, OPTIN_NO_PAYMENT, ATTACK_PRE_DISCARD_CHOICE } from './src/lib/game/effects';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', alias:{ '$lib':join(ROOT,'src/lib'), '$app/paths':S }, logLevel:'error' });
const { ATTACK_PRE, ATTACK_POST, OPTIN_NO_PAYMENT, ATTACK_PRE_DISCARD_CHOICE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

const PICOSHI='10460', GRENINJA='18516', EEL='14709', WATER='11175', LIGHTNING='11176', METAL='11180', METAGROSS='18479', DIALGA='14004', EELEK_M='14052', ZARUDE='11035', BUD='14443';
// EELEK_M=超級雷電獸ex? 14052 is 超級雷電獸ex
let nn=0;
const inst=(cid,e=[])=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
const mk=(myActive,oppActive)=>({ phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:3, isFirstTurn:false, log:[], pendingSelection:null,
  players:[
    { name:'P1', active:myActive, bench:[], hand:[], deck:[inst(BUD)], discard:[], prizes:[] },
    { name:'P2', active:oppActive, bench:[], hand:[], deck:[inst(BUD)], discard:[], prizes:[] },
  ]});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

const ninjaPre = ATTACK_PRE.get('超級甲賀忍蛙ex|忍者飛旋');
const flickPre = ATTACK_PRE.get('皮可西|揮指');
const disasterPost = ATTACK_POST.get('超級麻麻鰻魚王ex|災難衝擊');
const dialgaPre = ATTACK_PRE.get('帝牙盧卡|時間爆炸');
const eelekPre = ATTACK_PRE.get('超級雷電獸ex|狂暴噴射');
const zarudePre = ATTACK_PRE.get('薩戮德|叢林鞭打');
const hammerPre = ATTACK_PRE.get('巨金怪|金屬之錘');

// ── 忍者飛旋 direct ──
T('忍者飛旋:選否([])→120', () => {
  const st=mk(inst(GRENINJA,[en(WATER)]),inst(BUD));
  const out=ninjaPre(st,0,pool,{discardedEnergyIids:[]});
  assert.equal(out.damage,120);
  assert.equal(out.state.players[0].active.energyAttached.length,1,'不付出');
});
T('忍者飛旋:有1水 opt-in([iid])→200+水回手', () => {
  const w=en(WATER); const st=mk(inst(GRENINJA,[w]),inst(BUD));
  const out=ninjaPre(st,0,pool,{discardedEnergyIids:[w.iid]});
  assert.equal(out.damage,200);
  assert.equal(out.state.players[0].active.energyAttached.length,0,'水應離身');
  assert.ok(out.state.players[0].hand.some(c=>c.iid===w.iid),'水應回手');
});
T('忍者飛旋:0能量 opt-in(sentinel)→200(裁定1)', () => {
  const st=mk(inst(GRENINJA,[]),inst(BUD));
  const out=ninjaPre(st,0,pool,{discardedEnergyIids:[OPTIN_NO_PAYMENT]});
  assert.equal(out.damage,200,`0水 opt-in 應 200,實 ${out.damage}`);
});
T('忍者飛旋:2水 opt-in 只付1(payMax=1)', () => {
  const w1=en(WATER),w2=en(WATER); const st=mk(inst(GRENINJA,[w1,w2]),inst(BUD));
  const out=ninjaPre(st,0,pool,{discardedEnergyIids:[w1.iid]});
  assert.equal(out.damage,200);
  assert.equal(out.state.players[0].active.energyAttached.length,1,'只放回1張');
});
T('忍者飛旋:有雷無水 opt-in(sentinel)→200 且雷不動(filter)', () => {
  const l=en(LIGHTNING); const st=mk(inst(GRENINJA,[l]),inst(BUD));
  const out=ninjaPre(st,0,pool,{discardedEnergyIids:[OPTIN_NO_PAYMENT]});
  assert.equal(out.damage,200);
  assert.equal(out.state.players[0].active.energyAttached.length,1,'雷能量不是水,不可付');
});
// ── 皮可西 揮指 borrow ──
T('揮指借忍者飛旋:皮可西0水 opt-in(sentinel)→200(玩家回報bug情境)', () => {
  const opp=inst(GRENINJA,[]); const st=mk(inst(PICOSHI,[]),opp);
  const out=flickPre(st,0,pool,{copyAttackChoice:{pokeIid:opp.iid,attackIndex:0},discardedEnergyIids:[OPTIN_NO_PAYMENT]});
  assert.equal(out.damage,200,`揮指0水 opt-in 應 200,實 ${out.damage}`);
});
T('揮指借忍者飛旋:皮可西有1水→200+回手', () => {
  const w=en(WATER); const opp=inst(GRENINJA,[]); const st=mk(inst(PICOSHI,[w]),opp);
  const out=flickPre(st,0,pool,{copyAttackChoice:{pokeIid:opp.iid,attackIndex:0},discardedEnergyIids:[w.iid]});
  assert.equal(out.damage,200);
  assert.ok(out.state.players[0].hand.some(c=>c.iid===w.iid),'皮可西的水應回手');
});
T('揮指借忍者飛旋:選否→120', () => {
  const opp=inst(GRENINJA,[]); const st=mk(inst(PICOSHI,[en(WATER)]),opp);
  const out=flickPre(st,0,pool,{copyAttackChoice:{pokeIid:opp.iid,attackIndex:0},discardedEnergyIids:[]});
  assert.equal(out.damage,120);
});
// ── 災難衝擊(狀態型)──
const paralyzedOf=(s)=>{const a=s.players[1].active;return [a.status,a.secondaryStatus,a.tertiaryStatus].includes('paralyzed');};
T('災難衝擊:選否([])→不丟不麻痺', () => {
  const l=en(LIGHTNING); const st=mk(inst(EEL,[l]),inst(BUD));
  const out=disasterPost(st,0,pool,{discardedEnergyIids:[]});
  assert.equal(out.players[0].active.energyAttached.length,1);
  assert.ok(!paralyzedOf(out),'不應麻痺');
});
T('災難衝擊:0雷 opt-in(sentinel)→麻痺(裁定2)', () => {
  const st=mk(inst(EEL,[]),inst(BUD));
  const out=disasterPost(st,0,pool,{discardedEnergyIids:[OPTIN_NO_PAYMENT]});
  assert.ok(paralyzedOf(out),'0雷 opt-in 應麻痺');
});
T('災難衝擊:1雷 opt-in→丟1+麻痺(裁定2)', () => {
  const l=en(LIGHTNING); const st=mk(inst(EEL,[l]),inst(BUD));
  const out=disasterPost(st,0,pool,{discardedEnergyIids:[l.iid]});
  assert.equal(out.players[0].active.energyAttached.length,0,'應丟1雷');
  assert.equal(out.players[0].discard.filter(c=>c.iid===l.iid).length,1);
  assert.ok(paralyzedOf(out),'1雷 opt-in 應麻痺');
});
T('災難衝擊:2雷 opt-in→丟2+麻痺', () => {
  const l1=en(LIGHTNING),l2=en(LIGHTNING); const st=mk(inst(EEL,[l1,l2]),inst(BUD));
  const out=disasterPost(st,0,pool,{discardedEnergyIids:[l1.iid,l2.iid]});
  assert.equal(out.players[0].active.energyAttached.length,0,'應丟2雷');
  assert.ok(paralyzedOf(out));
});
T('災難衝擊:3雷 opt-in只給1 iid→auto-top-up丟2(公平性)', () => {
  const l1=en(LIGHTNING),l2=en(LIGHTNING),l3=en(LIGHTNING); const st=mk(inst(EEL,[l1,l2,l3]),inst(BUD));
  const out=disasterPost(st,0,pool,{discardedEnergyIids:[l1.iid]});
  assert.equal(out.players[0].active.energyAttached.length,1,'3雷 opt-in 應強制丟2留1');
  assert.ok(paralyzedOf(out));
});
// ── 時間爆炸/狂暴噴射/叢林鞭打(全部型 0 能量)──
T('時間爆炸:0能量 opt-in(sentinel)→160', () => {
  const st=mk(inst(DIALGA,[]),inst(BUD));
  const out=dialgaPre(st,0,pool,{discardedEnergyIids:[OPTIN_NO_PAYMENT]});
  assert.equal(out.damage,160,`0能量 opt-in 應 160,實 ${out.damage}`);
});
T('時間爆炸:2能量 opt-in→160+全回牌庫', () => {
  const e1=en(METAL),e2=en(WATER); const st=mk(inst(DIALGA,[e1,e2]),inst(BUD));
  const out=dialgaPre(st,0,pool,{discardedEnergyIids:[e1.iid,e2.iid]});
  assert.equal(out.damage,160);
  assert.equal(out.state.players[0].active.energyAttached.length,0);
  assert.equal(out.state.players[0].deck.filter(c=>c.iid===e1.iid||c.iid===e2.iid).length,2,'能量應進牌庫');
});
T('狂暴噴射:0能量 opt-in→330(HEAD為200的bug已修)', () => {
  const st=mk(inst(EELEK_M,[]),inst(BUD));
  const out=eelekPre(st,0,pool,{discardedEnergyIids:[OPTIN_NO_PAYMENT]});
  assert.equal(out.damage,330,`0能量 opt-in 應 330,實 ${out.damage}`);
});
T('狂暴噴射:2能量 opt-in→330+全丟(PRE即付)', () => {
  const e1=en(LIGHTNING),e2=en(LIGHTNING); const st=mk(inst(EELEK_M,[e1,e2]),inst(BUD));
  const out=eelekPre(st,0,pool,{discardedEnergyIids:[e1.iid,e2.iid]});
  assert.equal(out.damage,330);
  assert.equal(out.state.players[0].active.energyAttached.length,0,'應全丟');
  assert.equal(out.state.players[0].discard.filter(c=>c.iid===e1.iid||c.iid===e2.iid).length,2);
});
T('狂暴噴射:選否→200保留能量', () => {
  const e1=en(LIGHTNING); const st=mk(inst(EELEK_M,[e1]),inst(BUD));
  const out=eelekPre(st,0,pool,{discardedEnergyIids:[]});
  assert.equal(out.damage,200);
  assert.equal(out.state.players[0].active.energyAttached.length,1);
});
T('叢林鞭打:0能量 opt-in→160(HEAD為80的bug已修)', () => {
  const st=mk(inst(ZARUDE,[]),inst(BUD));
  const out=zarudePre(st,0,pool,{discardedEnergyIids:[OPTIN_NO_PAYMENT]});
  assert.equal(out.damage,160,`0能量 opt-in 應 160,實 ${out.damage}`);
});
T('叢林鞭打:2能量 opt-in→160+全回手(PRE即付)', () => {
  const e1=en(WATER),e2=en(METAL); const st=mk(inst(ZARUDE,[e1,e2]),inst(BUD));
  const out=zarudePre(st,0,pool,{discardedEnergyIids:[e1.iid,e2.iid]});
  assert.equal(out.damage,160);
  assert.equal(out.state.players[0].active.energyAttached.length,0);
  assert.equal(out.state.players[0].hand.filter(c=>c.iid===e1.iid||c.iid===e2.iid).length,2,'能量應回手');
});
// ── 金屬之錘 auto-top-up ──
T('金屬之錘:4鋼 opt-in只給1 iid→auto-top-up丟3', () => {
  const es=[en(METAL),en(METAL),en(METAL),en(METAL)]; const st=mk(inst(METAGROSS,es),inst(BUD));
  const out=hammerPre(st,0,pool,{discardedEnergyIids:[es[0].iid]});
  assert.equal(out.damage,300);
  assert.equal(out.state.players[0].active.energyAttached.length,1,'4鋼應強制丟3留1');
});
T('金屬之錘:2鋼 opt-in→丟2+300(pay-what-you-can)', () => {
  const es=[en(METAL),en(METAL)]; const st=mk(inst(METAGROSS,es),inst(BUD));
  const out=hammerPre(st,0,pool,{discardedEnergyIids:[es[0].iid,es[1].iid]});
  assert.equal(out.damage,300);
  assert.equal(out.state.players[0].active.energyAttached.length,0);
});
// ── v5.994 平穩境地擋回手仍照給加傷(Wilson 裁定:付出與加傷獨立) ──
const MENASU='10444';
T('忍者飛旋:平穩境地擋回手 opt-in→仍+80=200且水留身', () => {
  const w=en(WATER); const st=mk(inst(GRENINJA,[w]),inst(BUD));
  st.players[1].bench=[inst(MENASU)];
  const out=ninjaPre(st,0,pool,{ discardedEnergyIids:[w.iid] });
  assert.equal(out.damage,200,'平穩境地擋回手仍+80=200');
  assert.equal(out.state.players[0].active.energyAttached.length,1,'水留身(平穩境地擋回手)');
  assert.ok(!out.state.players[0].hand.some(c=>c.iid===w.iid),'水未回手');
});
T('叢林鞭打:平穩境地擋回手 opt-in→仍+80=160且能量留身', () => {
  const w=en(WATER); const st=mk(inst(ZARUDE,[w]),inst(BUD));
  st.players[1].bench=[inst(MENASU)];
  const out=zarudePre(st,0,pool,{ discardedEnergyIids:['x'] });
  assert.equal(out.damage,160,'平穩境地擋回手仍+80=160');
  assert.equal(out.state.players[0].active.energyAttached.length,1,'能量留身');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
