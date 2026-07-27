// 診斷探針（不進 CI）：量化「AI 選招 vs 場面上真正最好的招」差多少。
//
// 判準不靠我重算傷害公式 —— **用引擎當權威**：對每個可用招式，把 state 複製一份實際
// applyAction 打下去，看對手戰鬥位是否真的被擊倒、造成多少傷害。引擎算出來的才是真的
// （含弱點×2、抵抗力、道具減傷、免疫、被動特性…）。
//
// 統計三類缺口：
//   ① 漏 KO：有招能擊倒對手戰鬥位，AI 卻選了不能擊倒的（最嚴重，直接少拿獎賞）
//   ② 漏弱點：AI 選的招印刷傷害較高，但另一招因弱點實際傷害更高
//   ③ overkill：AI 選的招大幅超過需要的傷害，而較小的招也能擊倒（浪費副作用/能量）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-pr-s.js'), E = join(ROOT, '.x-pr-e.ts'), O = join(ROOT, '.x-pr-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction, getAvailableAttacks, getEffectiveAttacks, getEffectiveHP } from './src/lib/game/engine';\n"
  + "export { getAIAction } from './src/lib/game/ai';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// 用內建預組（真實牌組構成），跨原型對打才看得到弱點與不同節奏
const PRESET_SRC = readFileSync(join(ROOT, 'src/lib/decks/presets.ts'), 'utf8');
function presetEntries(id) {
  const i = PRESET_SRC.indexOf(`id: '${id}'`);
  if (i < 0) throw new Error('找不到預組 ' + id);
  const j = PRESET_SRC.indexOf('entries: [', i);
  const k = PRESET_SRC.indexOf('\n  ],', j);
  const body = PRESET_SRC.slice(j, k);
  return [...body.matchAll(/cardId:\s*'(\d+)',\s*count:\s*(\d+)/g)]
    .map((m) => ({ cardId: m[1], count: Number(m[2]) }));
}
const MATCHUPS = [
  ['N的索羅亞克', '__preset_n_zoroark__', '超級耿鬼ex', '__preset_mbg__'],
  ['N的索羅亞克', '__preset_n_zoroark__', '竹蘭的烈咬陸鯊EX', '__preset_cynthia_garchomp__'],
  ['N的索羅亞克', '__preset_n_zoroark__', '猛雷鼓ex', '__preset_thunder_drum__'],
  ['魔靈多龍', '__preset_marrune_dragapult__', '超級路卡利歐', '__preset_mega_lucario__'],
];

function seedRandom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

/** 用引擎實測某招打下去的結果：{ ko, dealt, unresolved } */
function tryAttack(st, atkIdx, myIdx) {
  const oppIdx = (1 - myIdx);
  const before = st.players[oppIdx].active;
  if (!before) return null;
  let after;
  try { after = mod.applyAction(clone(st), { type: 'ATTACK', attackIndex: atkIdx, actorIdx: myIdx }, pool); }
  catch { return null; }
  if (!after || after === st) return null;
  const oppNow = after.players[oppIdx].active;
  // 被擊倒 = 原本那隻不在戰鬥位了（換上新的或空了）
  const ko = !oppNow || oppNow.iid !== before.iid;
  const dealt = ko ? Infinity : Math.max(0, (oppNow.damage ?? 0) - (before.damage ?? 0));
  return { ko, dealt, unresolved: !!after.pendingSelection };
}

const stats = { attacks: 0, missedKO: 0, overkill: 0, betterDmg: 0, samples: [] };

function runGame(seed, d1, d2) {
  const orig = Math.random; Math.random = seedRandom(seed);
  try {
    let st = mod.createGame({ name: 'A', entries: d1 }, { name: 'B', entries: d2 }, pool);
    let rejected = 0;
    for (let i = 0; i < 4000 && st.phase !== 'game-over'; i++) {
      let actor;
      if (st.phase === 'setup') {
        const mul = st.pendingMulliganDraw ?? [0, 0];
        actor = mul[0] > 0 ? 0 : (mul[1] > 0 ? 1 : (!st.setupDone[0] ? 0 : (!st.setupDone[1] ? 1 : 0)));
      } else if (st.pendingSelection) actor = st.pendingSelection.actorIdx;
      else if (st.players[0].active === null && st.players[0].bench.length > 0) actor = 0;
      else if (st.players[1].active === null && st.players[1].bench.length > 0) actor = 1;
      else actor = st.activePlayerIndex;
      const act = mod.getAIAction(st, pool, actor);
      if (!act) break;

      // ── 旁觀比較（不改變實際流程）────────────────────────────────
      if (act.type === 'ATTACK' && !st.pendingSelection && st.phase === 'playing') {
        const avail = mod.getAvailableAttacks(st, pool);
        if (avail.length > 1) {
          const results = new Map();
          for (const idx of avail) { const r = tryAttack(st, idx, actor); if (r) results.set(idx, r); }
          const mine = results.get(act.attackIndex);
          if (mine && results.size > 1) {
            stats.attacks++;
            const anyKO = [...results.values()].some((r) => r.ko);
            const eff = mod.getEffectiveAttacks(st, st.players[actor].active, pool);
            const nameOf = (i) => eff[i]?.atk?.name ?? `#${i}`;
            const printed = (i) => parseInt(eff[i]?.atk?.damage ?? '0') || 0;
            if (anyKO && !mine.ko) {
              stats.missedKO++;
              const koIdx = [...results.entries()].find(([, r]) => r.ko)[0];
              if (stats.samples.length < 12) stats.samples.push(
                `漏KO：選了「${nameOf(act.attackIndex)}」(印刷${printed(act.attackIndex)})，`
                + `但「${nameOf(koIdx)}」(印刷${printed(koIdx)})可以擊倒`);
            } else if (!anyKO) {
              // 都不能 KO → 看有沒有實際傷害更高的（印刷較低但因弱點更高）
              const bestIdx = [...results.entries()].reduce((a, b) => b[1].dealt > a[1].dealt ? b : a)[0];
              if (results.get(bestIdx).dealt > mine.dealt) {
                stats.betterDmg++;
                if (stats.samples.length < 12) stats.samples.push(
                  `實傷較低：選了「${nameOf(act.attackIndex)}」實傷${mine.dealt}，`
                  + `「${nameOf(bestIdx)}」實傷${results.get(bestIdx).dealt}（印刷 ${printed(act.attackIndex)} vs ${printed(bestIdx)}）`);
              }
            } else if (mine.ko) {
              // 我 KO 了，但有沒有「印刷更小也能 KO」的招（省副作用/能量）
              const cheaper = [...results.entries()].filter(([i, r]) => r.ko && printed(i) < printed(act.attackIndex));
              if (cheaper.length > 0) {
                stats.overkill++;
                if (stats.samples.length < 12) stats.samples.push(
                  `overkill：用「${nameOf(act.attackIndex)}」(印刷${printed(act.attackIndex)})擊倒，`
                  + `但「${nameOf(cheaper[0][0])}」(印刷${printed(cheaper[0][0])})也能擊倒`);
              }
            }
          }
        }
      }

      const next = mod.applyAction(st, act, pool);
      if (next === st) { if (++rejected > 5) break; continue; }
      rejected = 0; st = next;
    }
  } finally { Math.random = orig; }
}

const N = Number(process.argv[2] ?? 40);
for (const [n1, id1, n2, id2] of MATCHUPS) {
  const d1 = presetEntries(id1), d2 = presetEntries(id2);
  for (let s = 0; s < N; s++) runGame(1000 + s * 7919, d1, d2);
  console.log(`  跑完 ${n1} vs ${n2}`);
}

console.log(`\n=== AI 選招缺口探針（${N} 場，引擎實測）===`);
console.log(`有多招可選的攻擊時刻：${stats.attacks}`);
if (stats.attacks > 0) {
  const pct = (n) => `${n}（${(n / stats.attacks * 100).toFixed(1)}%）`;
  console.log(`  ① 漏 KO（有招能擊倒卻沒選）：${pct(stats.missedKO)}`);
  console.log(`  ② 實傷較低（印刷高但實際傷害較低，多半是弱點）：${pct(stats.betterDmg)}`);
  console.log(`  ③ overkill（較小的招也能擊倒）：${pct(stats.overkill)}`);
}
console.log('\n樣本：');
for (const s of stats.samples) console.log('  ' + s);
