// 回歸測試：火箭隊的臭臭泥｜渾身臭臭 = 混亂 + 對手下回合無法撤退（雙效果）
// v5.981：原只實裝混亂（「本波先實裝主狀態」技術債），漏無法撤退副作用。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-s-sc.js'), E = join(ROOT, '.x-e-sc.ts'), O = join(ROOT, '.x-o-sc.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { ATTACK_POST, ATTACK_PRE } from './src/lib/game/effects/_shared';\n" +
  "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let stinkyId = null;
for (const [id, c] of pool) if (c.name === '火箭隊的臭臭泥') { stinkyId = id; break; }
assert(stinkyId, '找不到 火箭隊的臭臭泥');
let victimId = null;
for (const [id, c] of pool) { if ((c.supertype === 'Pokémon' || c.supertype === 'Pokemon') && c.name !== '火箭隊的臭臭泥') { victimId = id; break; } }
assert(victimId, '找不到對手寶可夢');

function mkPoke(cardId, over = {}) {
  return { iid: over.iid ?? ('i' + cardId), cardId: String(cardId), damage: 0, energyAttached: [],
    status: null, secondaryStatus: null, tertiaryStatus: null, toolAttached: null, extraTools: [], ...over };
}
function baseState() {
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'A', active: mkPoke(stinkyId, { iid: 'atk' }), bench: [], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
      { name: 'B', active: mkPoke(victimId, { iid: 'vic' }), bench: [], hand: [], deck: [], discard: [], prizes: [1,1,1,1,1,1] },
    ] };
}

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('  ✗', name); } }

const post = mod.ATTACK_POST.get('火箭隊的臭臭泥|渾身臭臭');
check('渾身臭臭 有註冊 ATTACK_POST', !!post);
if (post) {
  const st = baseState();
  const out = post(st, 0, pool, {});
  const vic = out.players[1].active;
  const confused = vic.status === 'confused' || vic.secondaryStatus === 'confused' || vic.tertiaryStatus === 'confused';
  check('對手戰鬥寶可夢【混亂】', confused);
  check('對手戰鬥寶可夢 cantRetreatNextTurn=true', vic.cantRetreatNextTurn === true);
}

console.log(`\n渾身臭臭雙效果測試：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
