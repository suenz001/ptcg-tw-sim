/**
 * 雙重狀態招式收斂 — 卡面「將對手【X】與【Y】」必須兩種狀態都套上（v5.687）
 * 原 bug：九尾|奇異燈火(灼傷+混亂)、叉字蝠|毒音波(中毒+混亂)、霸王花|花粉炸彈(中毒+睡眠)
 *   舊註解「引擎僅單一 status」只套一個狀態，漏掉 action 類狀態（混亂/睡眠）。
 *   超級妖火紅狐ex|奇異燈火 雖手寫雙狀態正確，但繞過免疫檢查，一併收斂到中央 applyStatusToOppActive。
 * 修：全部逐狀態走 applyStatusToOppActive（含三狀態欄雙格共存＋免疫檢查）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ds-s.mjs'), E = join(ROOT, '.ds-e.ts'), O = join(ROOT, '.ds-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const ETYPE = {Grass:'14102',Psychic:'14103',Fighting:'14104',Fire:'14428',Darkness:'14430',Metal:'14434',Water:'18519',Lightning:'18520'};
const DEF = '14425'; // 超級噴火龍Xex HP360 無特性
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const slots = d => [d.status, d.secondaryStatus, d.tertiaryStatus];
function runAttack(atkCid, ai) {
  const c = pool.get(atkCid); const cost = c.attacks[ai].cost ?? [];
  const energy = cost.map(t => inst(ETYPE[t] || ETYPE.Psychic));
  const s = createGame({ name:'P1', entries:[{cardId:atkCid,count:1}] }, { name:'P2', entries:[{cardId:DEF,count:1}] }, pool);
  const st = { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:1, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], pendingSelection:null,
    players:[
      { ...s.players[0], active: inst(atkCid,{energyAttached:energy}), bench:[inst(DEF)], deck:[inst(DEF)], discard:[], hand:[], prizes:Array.from({length:6},()=>inst(DEF)) },
      { ...s.players[1], active: inst(DEF), bench:[inst(DEF)], deck:[inst(DEF)], discard:[], hand:[], prizes:Array.from({length:6},()=>inst(DEF)) }] };
  return applyAction(st, { type:'ATTACK', attackIndex: ai }, pool).players[1].active;
}
let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };
const both = (da, a, b) => { const s = slots(da); assert.ok(s.includes(a), `應有【${a}】 實際=${s}`); assert.ok(s.includes(b), `應有【${b}】 實際=${s}`); };

T('★九尾|奇異燈火 → 灼傷+混亂 (HEAD 只灼傷 FAIL)', () => both(runAttack('10258', 0), 'burned', 'confused'));
T('★叉字蝠|毒音波 → 中毒+混亂 (HEAD 只中毒 FAIL)', () => both(runAttack('18504', 0), 'poisoned', 'confused'));
T('★霸王花|花粉炸彈 → 中毒+睡眠 (HEAD 只中毒 FAIL)', () => both(runAttack('14321', 0), 'poisoned', 'asleep'));
// v6.193：原本指向港版重複卡 18965（已下架）；台版 18560 是逐欄位相同的同一張卡。
T('超級妖火紅狐ex|奇異燈火 → 灼傷+混亂 (收斂後仍正確)', () => both(runAttack('18560', 1), 'burned', 'confused'));

console.log('\n雙重狀態收斂:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
