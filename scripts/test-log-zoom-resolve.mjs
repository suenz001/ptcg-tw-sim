// v5.955 守衛:log 卡名 → 本場實體卡 resolver(resolveLogCard)。
//   驗證:①iid 精準命中頂層 ②iid 命中巢狀能量(新能力) ③名字掃描選本場實體(非 null/全域)
//   ④同名不同印刷靠 hintPlayerIdx 消歧義 ⑤本場不存在 → null(呼叫端 fallback 全域)
//   ⑥公開區(棄牌)優先於蓋牌區(牌庫) 的決定性
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.lz-e.ts'), O = join(ROOT, '.lz-o.mjs'), S = join(ROOT, '.lz-s.mjs');
process.on('exit', () => { for (const p of [E,O,S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { resolveLogCard } from './src/lib/game/log_zoom';");
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const { resolveLogCard } = await import(pathToFileURL(O).href);

// 假 pool:cardId → {id,name}。同名「皮卡丘」兩種印刷 PIKA_A / PIKA_B。
const pool = new Map([
  ['PIKA_A', { id:'PIKA_A', name:'皮卡丘' }],
  ['PIKA_B', { id:'PIKA_B', name:'皮卡丘' }],
  ['RAICHU', { id:'RAICHU', name:'雷丘' }],
  ['LGT',    { id:'LGT',    name:'基本雷能量' }],
  ['MEW',    { id:'MEW',    name:'夢幻' }],
]);
const inst = (iid, cardId, extra={}) => ({ iid, cardId, damage:0, energyAttached:[], ...extra });

// 玩家0:戰鬥位雷丘(由皮卡丘PIKA_A進化來,身上附一張雷能量iid=E1);牌庫有皮卡丘PIKA_B
// 玩家1:備戰有皮卡丘PIKA_B;棄牌有夢幻
const p0 = {
  name:'P0',
  active: inst('R1','RAICHU', { evolvedFromStack:[inst('K1','PIKA_A')], energyAttached:[inst('E1','LGT')] }),
  bench:[], hand:[], discard:[], prizes:[], deck:[ inst('D1','PIKA_B') ],
};
const p1 = {
  name:'P1', active:null, bench:[ inst('B1','PIKA_B') ], hand:[], discard:[ inst('DC1','MEW') ], prizes:[], deck:[],
};
const game = { players:[p0,p1], activeStadium:undefined, activeStadiumOwnerIdx:undefined };

let pass=0, fail=0;
const chk=(name,cond)=>{ if(cond){pass++;} else {fail++; console.log('  ❌',name);} };

// ① iid 精準命中頂層(雷丘 R1)
let r = resolveLogCard(game, pool, '雷丘', 'R1', 0);
chk('①iid頂層命中雷丘', r && r.cardId==='RAICHU' && r.inst?.iid==='R1');

// ② iid 指向 R1 但名字是「皮卡丘」→ 從 R1 的 evolvedFromStack 找皮卡丘(PIKA_A,正確版本)
r = resolveLogCard(game, pool, '皮卡丘', 'R1', 0);
chk('②iid命中但名不符→巢狀進化來源皮卡丘PIKA_A', r && r.cardId==='PIKA_A' && r.inst?.iid==='K1');

// ③ iid 命中巢狀能量:log 連 E1 能量名(基本雷能量)——先用 hint sourceIid=R1,名字=基本雷能量
//    R1 名字≠基本雷能量 → 巢狀 energyAttached 找到 E1
r = resolveLogCard(game, pool, '基本雷能量', 'R1', 0);
chk('③iid命中但名是能量→巢狀能量E1', r && r.cardId==='LGT' && r.inst?.iid==='E1');

// ④ 同名「皮卡丘」不同印刷:hintPlayerIdx=1(actor側P1)→應選 P1 備戰的 PIKA_B(B1),非 P0 牌庫的
r = resolveLogCard(game, pool, '皮卡丘', undefined, 1);
chk('④同名靠hintPlayerIdx=1選P1備戰PIKA_B(B1)', r && r.inst?.iid==='B1' && r.cardId==='PIKA_B');

// ④b hintPlayerIdx=0:P0 公開區沒皮卡丘頂層(active是雷丘),但牌庫有 PIKA_B(D1);
//    然而 P0 的雷丘巢狀有皮卡丘 PIKA_A(K1) → collectPlayerInstances 把巢狀排在 active 之後、deck 之前
//    → 第二層名字掃描 P0 先命中 K1(PIKA_A)。決定性:公開區(含巢狀)優先於牌庫。
r = resolveLogCard(game, pool, '皮卡丘', undefined, 0);
chk('④b hintIdx=0→P0巢狀皮卡丘K1(PIKA_A)優先於牌庫D1', r && r.inst?.iid==='K1' && r.cardId==='PIKA_A');

// ⑤ 本場不存在的名字 → null(呼叫端 fallback 全域 pool)
r = resolveLogCard(game, pool, '不存在的卡', 'R1', 0);
chk('⑤本場無此名→null', r === null);

// ⑥ 公開區(棄牌 P1 的夢幻)可被名字掃描找到
r = resolveLogCard(game, pool, '夢幻', undefined, 1);
chk('⑥棄牌區夢幻DC1被找到', r && r.inst?.iid==='DC1' && r.cardId==='MEW');

// ⑦ game=null → null(不 crash)
chk('⑦game null→null', resolveLogCard(null, pool, '皮卡丘', 'R1', 0) === null);

console.log(`log-zoom resolver:PASS ${pass} / FAIL ${fail}`);
if (fail>0) process.exit(1);
