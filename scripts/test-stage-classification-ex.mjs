// v5.565：進化階段判定用 stage 欄(ex/超級卡 subtype='ex' 丟失階段,stage 保留)。
//   玩家回報：帕底亞肯泰羅|真氣衝撞(對手1階+90) 打 超級龍頭地鼠ex(Stage1,弱火) 只給180,應(90+90)x2=360。
//   根因：原 subtype==='Stage1' 漏判 ex 進化卡 → +90 沒套。收斂 cardStage/isStage1Card 用 stage 欄。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.sc-e.ts'), O = join(ROOT, '.sc-o.mjs'), S = join(ROOT, '.sc-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const TAUROS = '16564' /*帕底亞肯泰羅|真氣衝撞 idx1*/, EXCADRILL = '19207' /*超級龍頭地鼠ex Stage1,弱火,HP340*/,
      FIRE = '14428';
let iid = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++iid), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++iid), cardId: String(cid), damage: 0, energyAttached: [] });

function mk(defId, defDmg) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false,
    pendingPrizes: [0, 0], log: [], pendingSelection: null, activeStadium: null, setupDone: [true, true],
    players: [
      { active: inst(TAUROS, [en(FIRE), en(FIRE), en(FIRE)]), bench: [], hand: [], deck: Array.from({ length: 8 }, () => en(FIRE)), discard: [], prizes: Array.from({ length: 6 }, () => en(FIRE)), name: 'P0' },
      { active: inst(defId, [], { damage: defDmg }), bench: [inst(defId)], hand: [], deck: Array.from({ length: 8 }, () => en(FIRE)), discard: [], prizes: Array.from({ length: 6 }, () => en(FIRE)), name: 'P1' },
    ],
  };
}
let pass = 0, fail = 0;
const ck = (label, cond, extra) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label, extra || ''); } };
const logDmg = (s) => { for (const l of s.log) { const m = (typeof l === 'string' ? l : (l.message || '')).match(/造成\s*(\d+)\s*點傷害/); if (m) return Number(m[1]); } return -1; };

console.log('1) 真氣衝撞 打 超級龍頭地鼠ex(Stage1,弱火) → (90+90)x2 = 360');
{
  const s = applyAction(mk(EXCADRILL, 0), { type: 'ATTACK', attackIndex: 1 }, pool);
  const dmg = logDmg(s);
  const koed = s.players[1].active === null || s.players[1].active.cardId !== EXCADRILL;
  ck('傷害應 360（stage 認得 ex 為 Stage1 → +90，再 x2 弱火）', dmg === 360, '實際 log 傷害=' + dmg);
  ck('360 >= 340 → 應 KO 超級龍頭地鼠ex', koed);
}
console.log('\nStage 階段判定(ex 進化) PASS ' + pass + ' / FAIL ' + fail);
process.exitCode = fail ? 1 : 0;
