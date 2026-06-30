/**
 * flip-until-tails 傷害守衛(v5.787):擲硬幣直到反面、傷害=印刷base+正面數×perHead。
 * 強制 K 正面(Math.random override),驗每張「×N/N+」傷害卡 ATTACK_PRE = base + K×perHead。
 * 防 coinUntilTailsMultiplyPre(perHead,base) / coinHeadsUntilTailsBonusPre(base,perHead) 參數順序填反。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ut-s.js'), E = join(ROOT, '.ut-e.ts'), O = join(ROOT, '.ut-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map(); const cards = [];
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id != null) pool.set(String(c.id), c); cards.push(c); } }

// 蒐集「擲硬幣直到反面 + 次數×P 傷害」卡，解析期望 base/perHead
const targets = [];
const seen = new Set();
for (const c of cards) {
  for (const a of (c.attacks || [])) {
    const e = a.effect || '';
    const m = e.match(/擲硬幣直到(出現)?反面/) && e.match(/次數×(\d+)點/);
    if (!m) continue;
    const key = `${c.name}|${a.name}`;
    if (seen.has(key) || !ATTACK_PRE.get(key)) continue;
    seen.add(key);
    const per = Number(e.match(/次數×(\d+)點/)[1]);
    const printed = a.damage || '';
    const base = /^\d+\+/.test(printed) ? Number(printed.match(/^(\d+)/)[1]) : 0;
    targets.push({ key, per, base, printed });
  }
}

const ENERGY='18519'; let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(cid){ return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(cid),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]},
           {name:'P2',active:inst('14335'),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]}]}; }
function cardIdOf(name){ for (const [id,c] of pool) if (c.name===name) return id; return null; }

const orig=Math.random;
function forceHeads(K){ let n=0; Math.random=()=> (n++ < K ? 0.1 : 0.9); } // 前K次正面(<0.5)後反面

let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

console.log(`偵測 flip-until-tails 傷害卡 ${targets.length} 張`);
for (const t of targets) {
  const cname = t.key.split('|')[0];
  const cid = cardIdOf(cname);
  T(`${t.key} (印${t.printed}) K=3 → ${t.base}+3×${t.per}`, () => {
    assert.ok(cid, '找不到卡 id');
    for (const K of [0, 3]) {
      forceHeads(K);
      try {
        const r = ATTACK_PRE.get(t.key)(mk(cid), 0, pool, {});
        const expect = t.base + K * t.per;
        assert.equal(r.damage, expect, `K=${K} 期望 ${expect} 實際 ${r.damage}`);
      } finally { Math.random = orig; }
    }
  });
}
console.log('\nflip-until-tails 傷害公式守衛(v5.787):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
