// 回歸測試網：picker 候選建構（src/lib/game/selection-candidates.ts）。
//   重點覆蓋 v5.718 教訓——戲法舞步把選能量 picker 改 active-energy-discard 時誤傳
//   targetIid=對手 active → all-opp 分支跳過 active 能量 → 玩家「連能量都選不到」。
//   engine harness 測不到此前端渲染，本網把「params → 候選」對應固化。
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.tmp-selcand.ts'); const O = join(ROOT, '.tmp-selcand.mjs');
process.on('exit', () => { for (const p of [E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { activeEnergyDiscardCandidates } from './src/lib/game/selection-candidates';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', logLevel:'error' });
const { activeEnergyDiscardCandidates } = await import(pathToFileURL(O).href);

const en = (iid) => ({ iid, cardId: 'E', damage: 0, energyAttached: [] });
const poke = (iid, energies) => ({ iid, cardId: 'P', damage: 0, energyAttached: energies });
let pass = 0; const fails = [];
const ck = (n, ok) => { ok ? pass++ : fails.push(n); };

const e1 = en('e1'), e2 = en('e2'), e3 = en('e3');
const oppActive2E = { active: poke('A', [e1, e2]), bench: [poke('B', [])] };
const oppMixed = { active: poke('A', [e1]), bench: [poke('B', [e3])] };

// ════ 戲法舞步：選對手戰鬥位能量（v5.718 修正後）════
ck('戲法舞步(scope all-opp,validIids=active能量,無targetIid)→列出對手戰鬥位2能量',
   activeEnergyDiscardCandidates({ scope: 'all-opp', validIids: ['e1', 'e2'] }, oppActive2E).length === 2);
// ★ 鎖住 v5.718 bug：誤傳 targetIid=對手active → 跳過 active 能量 → 候選空(玩家選不到)
ck('★戲法舞步誤傳targetIid=active → 候選空(這就是「連能量都選不到」的 bug)',
   activeEnergyDiscardCandidates({ scope: 'all-opp', validIids: ['e1', 'e2'], targetIid: 'A' }, oppActive2E).length === 0);

// ════ 挪動一下：對手全場能量 ════
ck('挪動一下(all-opp全場,validIids=全場能量)→列 active+bench 共2能量',
   activeEnergyDiscardCandidates({ scope: 'all-opp', validIids: ['e1', 'e3'] }, oppMixed).length === 2);
ck('挪動一下 targetIid=來源A → 排除A自己能量,只列 bench e3',
   activeEnergyDiscardCandidates({ scope: 'all-opp', targetIid: 'A' }, oppMixed).length === 1);

// ════ targetIid 分支（粉碎之錘/改造之錘）════
ck('targetIid分支(無scope,targetIid=A)→列A的2能量',
   activeEnergyDiscardCandidates({ targetIid: 'A' }, oppActive2E).length === 2);
ck('targetIid+validIids(改造之錘)→篩選只e1',
   activeEnergyDiscardCandidates({ targetIid: 'A', validIids: ['e1'] }, oppActive2E).length === 1);

// ════ default（自身丟能量）════
ck('default(無scope無targetIid)→列自身active能量',
   activeEnergyDiscardCandidates({}, oppActive2E).length === 2);
ck('all-opp validIids空→列全部(向後相容)',
   activeEnergyDiscardCandidates({ scope: 'all-opp' }, oppActive2E).length === 2);

console.log(`\npicker 候選測試網：PASS ${pass} / FAIL ${fails.length}`);
for (const f of fails) console.log('  ❌', f);
if (fails.length > 0) { console.log('\n有候選建構回歸！'); process.exit(1); }
console.log('全部通過 ✅');
