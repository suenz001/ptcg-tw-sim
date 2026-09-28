// 診斷（不進 CI）：電腦對手「撤退換人」的實際效果 —— 門檻 60 要不要重新校準？
//
// 背景：ai.ts 撤退分支（戰鬥位這回合打不出任何招才會走到）用 estimateIfPromoted 估「換上去打得出什麼」，
//   撤退費 0 ⇒ 任何正傷害就換；撤退費 1～2 ⇒ 要擊倒或估計傷害 ≥ 60。v6.431 起估計值是 evaluateAttack 3 次平均的
//   「對手全場傷害」（含打到備戰），fable 審查指出門檻當初是以「戰鬥位傷害」校準的，語意略寬。
// 用法：node scripts/diag-ai-retreat.mjs [每組局數=2] [--out 報告.md]
// 量的東西（全部從引擎盤面讀）：
//   - 撤退次數（依撤退費分組）
//   - 換上去的那隻**同一回合**有沒有出招、對手全場受到多少傷害、有沒有擊倒
//   - 「換上去卻沒出招」的比例（估計失準的直接證據）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAiBundle, loadLivePool, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAMES = Number(process.argv[2] ?? 2);
const oi = process.argv.indexOf('--out');
const OUT = oi >= 0 ? process.argv[oi + 1] : null;
const mod = await buildAiBundle(ROOT, { extraExports: ["export { computeActiveRetreatCostFor, getEffectiveHP } from './src/lib/game/engine';"] });
const pool = loadLivePool(ROOT);
const ai = (st, i) => mod.aiNew(st, pool, i);
const presets = mod.PRESET_DECKS;
const field = (p) => [p.active, ...p.bench].filter(Boolean);
function oppDamage(prev, next, side) {
  const after = new Map(field(next.players[side]).map((c) => [c.iid, c]));
  let dmg = 0, ko = 0;
  for (const b of field(prev.players[side])) {
    const a = after.get(b.iid);
    if (a) dmg += Math.max(0, (a.damage ?? 0) - (b.damage ?? 0));
    else { dmg += Math.max(0, mod.getEffectiveHP(b, pool, prev) - (b.damage ?? 0)); ko++; }
  }
  return { dmg, ko };
}
const B = {};   // 依撤退費分組
const bucket = (k) => (B[k] ??= { n: 0, attacked: 0, dmg: 0, ko: 0, noAtk: 0, dmgHist: [0, 0, 0, 0] });
const t0 = Date.now();
for (let a = 0; a < presets.length; a++) for (const off of [1, 7, 19]) {
  const b = (a + off) % presets.length;
  for (let g = 0; g < GAMES; g++) {
    const seat = g % 2;
    const decks = seat === 0 ? [presets[a], presets[b]] : [presets[b], presets[a]];
    const seed = 626262 + a * 1009 + off * 97 + g;
    let cur = null;
    playGame({ mod, pool, decks, agents: [ai, ai], seed, firstPlayer: firstPlayerOf(seed), onStep: (prev, act, next, actor) => {
      if (prev.phase !== 'playing' || actor !== seat) return;
      if (act.type === 'RETREAT' && prev.turnPhase === 'main') {
        const cost = mod.computeActiveRetreatCostFor(prev, seat, pool);
        cur = { turn: prev.turn, cost: cost >= 2 ? '2+' : String(cost), done: false };
        bucket(cur.cost).n++;
      } else if (cur && !cur.done && act.type === 'ATTACK' && prev.turn === cur.turn) {
        const r = oppDamage(prev, next, 1 - seat);
        const k = bucket(cur.cost);
        k.attacked++; k.dmg += r.dmg; if (r.ko) k.ko++;
        k.dmgHist[r.ko ? 3 : r.dmg >= 60 ? 2 : r.dmg > 0 ? 1 : 0]++;
        cur.done = true;
      } else if (cur && !cur.done && act.type === 'END_TURN' && prev.turn === cur.turn) {
        bucket(cur.cost).noAtk++; cur.done = true;
      }
    } });
  }
}
const pct = (x, n) => (n ? (100 * x / n).toFixed(1) + '%' : '—');
const L = [];
const P = (s = '') => { L.push(s); console.log(s); };
P(`# 診斷：撤退換人（${presets.length} 副預組 × 3 個對手 × ${GAMES} 局，${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
P('| 撤退費 | 撤退次數 | 同回合有出招 | 沒出招 | 擊倒 | 出招平均對手全場傷害 | 出招結果分布（0／1～59／≥60／擊倒） |');
P('|---|---|---|---|---|---|---|');
for (const k of Object.keys(B).sort()) {
  const v = B[k];
  P(`| ${k} | ${v.n} | ${v.attacked}（${pct(v.attacked, v.n)}） | ${v.noAtk}（${pct(v.noAtk, v.n)}） | ${v.ko}（${pct(v.ko, v.n)}） | ${(v.dmg / Math.max(1, v.attacked)).toFixed(0)} | ${v.dmgHist.join('／')} |`);
}
if (OUT) writeFileSync(OUT, L.join('\n') + '\n');
