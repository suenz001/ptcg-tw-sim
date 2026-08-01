// v6.098 玩家回報（手機版）：場上有超級袋獸ex 時，烈箭鷹ex 無法使用特性「激動俯衝」放到備戰。
//
// 根因：手機版 MobilePortraitBattle.svelte 的手牌 sheet 選單把「從手牌發動的特性」**硬編**成
//   齒輪怪｜緊急迴轉（還自寫一份 oppHasStage2Local），v6.080 新增的烈箭鷹ex｜激動俯衝
//   完全沒有按鈕 —— 黃框會亮（判定已收斂到 engine getHandActivatableAbilities），
//   但點開卡片只有「查看詳情」。桌機版走同一份 map 故正常。
//   ⇒ 同型教訓：中央述詞寫好 ≠ 每個消費點都接上（見 v6.088 熔岩洞、v6.089）。
//
// 本守衛兩層：
//   ① 行為端：engine 的 HAND_ACTIVATE_GATES 對兩張卡都正確（正對照 + 負對照）
//   ② 靜態端：兩套 UI 的手牌特性入口都必須走中央 gate，且**不得**硬編任何 gate 的特性名
//      （附故意壞樣本正對照，證明守衛真的會紅）
//
// ⚠ 誠實說明 HEAD-FAIL 範圍：這次的 bug **純在 UI 端**，engine 的 gate 本來就是對的，
//   所以把 MobilePortraitBattle.svelte 還原成 v6.097 時，只有 ②-B 與 ②-C 兩項會 FAIL；
//   ①-* 行為端在修正前後都會 PASS（它們是回歸保護，不是本 bug 的重現）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.v98-s.js'),E=join(ROOT,'.v98-e.ts'),O=join(ROOT,'.v98-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, getHandActivatableAbilities, getBenchLimit } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, getHandActivatableAbilities } = await import(pathToFileURL(O).href);

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c); }
const byId=(id)=>pool.get(String(id));
const byName=(n,p2)=>[...pool.values()].find(c=>c.name===n && (!p2||p2(c)));
let n=0; const inst=(cid,e={})=>({iid:`h${++n}`,cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...e});
let pass=0,fail=0; const T=(t,f)=>{try{f();console.log('  OK',t);pass++;}catch(e){console.log('  FAIL',t,'::',e.message);fail++;}};

const TALON = byName('烈箭鷹ex', c=>(c.abilities||[]).some(a=>a.name==='激動俯衝'));
const KANGA = byName('超級袋獸ex');
const KLINK = byName('齒輪怪', c=>(c.abilities||[]).some(a=>a.name==='緊急迴轉'));
const BASIC = [...pool.values()].find(c=>c.supertype==='Pokemon'&&c.stage==='Basic'&&(c.abilities||[]).length===0&&['H','I','J'].includes(c.regulationMark));
const STAGE2 = [...pool.values()].find(c=>c.supertype==='Pokemon'&&c.stage==='Stage2'&&['H','I','J'].includes(c.regulationMark));

const mk=(over={})=>({ id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0,
  turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true],
  stadiumPlayedThisTurn:[false,false], stadiumUsedThisTurn:[false,false],
  players:[
    {name:'ME', active:inst(BASIC.id), bench:[], hand:[], deck:[inst(BASIC.id)], discard:[], prizes:[], abilityNamesUsedThisTurn:[]},
    {name:'OP', active:inst(BASIC.id), bench:[], hand:[], deck:[inst(BASIC.id)], discard:[], prizes:[], abilityNamesUsedThisTurn:[]},
  ], ...over });

// ══ ① 行為端 ══
T('卡面查證：超級袋獸ex 是【無】屬性的超級進化寶可夢ex', () => {
  assert.ok(KANGA, '找得到超級袋獸ex');
  assert.strictEqual(KANGA.pokemonType, 'Colorless', '應為【無】屬性，實際 ' + KANGA.pokemonType);
  assert.ok(KANGA.name.startsWith('超級') && KANGA.name.endsWith('ex'), '卡名應為超級進化 ex 形態：' + KANGA.name);
});
T('卡面查證：烈箭鷹ex｜激動俯衝 條件逐字', () => {
  const eff = (TALON.abilities||[]).find(a=>a.name==='激動俯衝')?.effect ?? '';
  assert.ok(eff.includes('手牌有這張卡'), '卡面應含「手牌有這張卡」：' + eff);
  assert.ok(eff.includes('【無】') && eff.includes('超級進化寶可夢'), '卡面應含【無】屬性超級進化寶可夢ex：' + eff);
});
T('①-1 超級袋獸ex 在戰鬥位 + 烈箭鷹ex 在手牌 → 中央 gate 放行', () => {
  const st = mk(); st.players[0].active = inst(KANGA.id); st.players[0].hand = [inst(TALON.id)];
  const r = getHandActivatableAbilities(st, 0, pool);
  assert.strictEqual(r.length, 1, '應有 1 項可發動，實際 ' + JSON.stringify(r));
  assert.strictEqual(r[0].abilityName, '激動俯衝');
});
T('①-2 超級袋獸ex 在備戰也算（卡面寫「自己的場上」）', () => {
  const st = mk(); st.players[0].bench = [inst(KANGA.id)]; st.players[0].hand = [inst(TALON.id)];
  assert.strictEqual(getHandActivatableAbilities(st, 0, pool).length, 1);
});
T('①-3 【負對照】場上沒有超級進化ex → 不可發動', () => {
  const st = mk(); st.players[0].hand = [inst(TALON.id)];
  assert.deepStrictEqual(getHandActivatableAbilities(st, 0, pool), []);
});
T('①-4 實際執行：烈箭鷹ex 從手牌進備戰（USE_HAND_ABILITY 用 cardIid 欄位）', () => {
  const st = mk(); st.players[0].active = inst(KANGA.id); st.players[0].hand = [inst(TALON.id)];
  const handIid = st.players[0].hand[0].iid;
  const out = applyAction(st, { type:'USE_HAND_ABILITY', cardIid: handIid, abilityIndex: 0, actorIdx: 0 }, pool);
  assert.strictEqual(out.players[0].bench.length, 1, '應進備戰，實際 bench=' + out.players[0].bench.length);
  assert.strictEqual(byId(out.players[0].bench[0].cardId).name, '烈箭鷹ex');
  assert.strictEqual(out.players[0].hand.length, 0, '應離開手牌');
});
T('①-5 回歸保護：齒輪怪｜緊急迴轉 仍然正常（對手有 2 階時可發動）', () => {
  assert.ok(KLINK && STAGE2, '找得到齒輪怪(緊急迴轉版)與 2 階寶可夢');
  const st = mk(); st.players[0].hand = [inst(KLINK.id)]; st.players[1].active = inst(STAGE2.id);
  const r = getHandActivatableAbilities(st, 0, pool);
  assert.strictEqual(r.length, 1, '應可發動，實際 ' + JSON.stringify(r));
  assert.strictEqual(r[0].abilityName, '緊急迴轉');
  const st2 = mk(); st2.players[0].hand = [inst(KLINK.id)];   // 對手沒有 2 階
  assert.deepStrictEqual(getHandActivatableAbilities(st2, 0, pool), [], '對手無 2 階時不可發動（負對照）');
});

// ══ ② 靜態端：UI 不得硬編 ══
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const gateNames = (() => {
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const i = eng.indexOf('const HAND_ACTIVATE_GATES');
  assert.ok(i >= 0, '找得到 HAND_ACTIVATE_GATES');
  const seg = eng.slice(i, eng.indexOf('\n};', i));
  return [...seg.matchAll(/^\s{2}([^\s:(]+):\s*\(s,/gm)].map(m => m[1]);
})();
const UI_FILES = ['src/routes/game/MobilePortraitBattle.svelte', 'src/routes/game/+page.svelte'];
const checkNoHardcode = (src, label) => {
  const bare = stripComments(src);
  const bad = gateNames.filter(nm => bare.includes(`'${nm}'`) || bare.includes(`"${nm}"`) || bare.includes(`\`${nm}\``));
  assert.strictEqual(bad.length, 0,
    label + ' 不得硬編手牌特性名（必須只走 getHandActivatableAbilities）：' + bad.join('、'));
};

T('② HAND_ACTIVATE_GATES 解析出至少 2 個特性名（含緊急迴轉、激動俯衝）', () => {
  assert.ok(gateNames.includes('緊急迴轉') && gateNames.includes('激動俯衝'),
    '解析結果：' + JSON.stringify(gateNames));
});
for (const f of UI_FILES) {
  T(`②-A ${f.split('/').pop()} 有呼叫中央 getHandActivatableAbilities`, () => {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(src.includes('getHandActivatableAbilities('), '必須呼叫中央 gate');
  });
  T(`②-B ${f.split('/').pop()} 不得硬編 HAND_ACTIVATE_GATES 的特性名`, () => {
    checkNoHardcode(readFileSync(join(ROOT, f), 'utf8'), f);
  });
}
T('②-C 手機版 sheet 選單確實由中央 gate 產生按鈕（label 與桌機一致）', () => {
  const src = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');
  assert.ok(/for \(const a of getHandActivatableAbilities\([^)]*\)\) \{/.test(src),
    'sheet 應以迴圈逐項讀中央 gate 產生按鈕');
  assert.ok(src.includes('`⚡ ${a.abilityName} (放備戰)`'), 'label 應用 abilityName（與桌機版逐字一致）');
  assert.ok(src.includes('GameActions.useHandAbility(iid, a.abilityIndex)'), 'abilityIndex 應由中央 gate 給');
});
T('②-D 【正對照】故意塞回硬編 → 守衛必須抓到（證明它不是永遠綠）', () => {
  const broken = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8')
    .replace('for (const a of getHandActivatableAbilities(',
             "if (c.name === '齒輪怪' && cardHasAbility('緊急迴轉')) { /* 壞樣本 */ }\n      for (const a of getHandActivatableAbilities(");
  let caught = false;
  try { checkNoHardcode(broken, '壞樣本'); } catch { caught = true; }
  assert.ok(caught, '守衛對故意硬編的壞樣本必須失敗（否則等於永遠綠）');
});

console.log(`\n=== v6.098 手牌特性 UI 中央收斂: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
