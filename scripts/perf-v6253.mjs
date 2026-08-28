// v6.253 效能量測：BASE vs FIXED 同一 workload。用法：node perf-v6253.mjs <ROOT>
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.argv[2];
const E = join(ROOT, '.pf-e.ts'), O = join(ROOT, '.pf-o.mjs'), S = join(ROOT, '.pf-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction, getRetreatCost, getUsableAbilities } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { getRetreatCost, getUsableAbilities, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
let n = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++n), cardId: String(cid), damage: 0, energyAttached: [] });
const P = (name, a, b) => ({ name, active: a, bench: b, hand: [], deck: Array.from({length:20},()=>en('14103')),
  discard: [], prizes: Array.from({length:6},()=>en('14103')) });
// 最壞情境：雙方滿場，含規則寶可夢＋消除源（振翼髮 active、鐵荊棘ex active、海兔獸 bench）
const SCEN = process.env.SCEN ?? 'worst';
const mk = (stadium, p0a, p1a) => ({ phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:9, isFirstTurn:false,
  firstPlayerIdx:0, setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], log:[],
  pendingSelection:null, activeStadium: stadium ? inst(stadium) : null,
  players:[ P('P0', inst(p0a, [en('14103')]), ['14735','11246','19183','14704','13741'].map(c=>inst(c))),
            P('P1', inst(p1a), ['14735','11246','19183','14704','13741'].map(c=>inst(c))) ] });
// worst = 雙方滿場 + 振翼髮 vs 鐵荊棘ex + 熔岩洞（消除源全開）
// typical = 一般對局：沒有任何特性消除源在場
const st = SCEN === 'worst' ? mk('19623', '11597', '16753') : mk(null, '16782', '17976');
const N = Number(process.env.N ?? 60000);
// warmup
for (let i=0;i<3000;i++){ getRetreatCost(st, pool); getUsableAbilities(st, pool); }
let t0 = process.hrtime.bigint();
for (let i=0;i<N;i++) getRetreatCost(st, pool);
let t1 = process.hrtime.bigint();
for (let i=0;i<N;i++) getUsableAbilities(st, pool);
let t2 = process.hrtime.bigint();
const ms = (a,b)=>Number(b-a)/1e6;
console.log(JSON.stringify({ scen: SCEN, root: ROOT.split('/').pop(), N,
  getRetreatCost_us_per_call: +(ms(t0,t1)*1000/N).toFixed(3),
  getUsableAbilities_us_per_call: +(ms(t1,t2)*1000/N).toFixed(3) }));
