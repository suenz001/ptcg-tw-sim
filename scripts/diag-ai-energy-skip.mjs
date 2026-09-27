// 診斷（不進 CI）：「手上有能量卡、這回合還沒附，就結束回合／出招」有多常見？
//
// 背景：ai.ts 的附能量分支寫著「若已有招式可發，不附能量」（v2.357）——戰鬥位打得出招時，整個回合都不附能量，
//   備戰的寶可夢永遠等不到能量。呆呆王 vs 瑪俐 的診斷看到 11% 的回合結束時手上有能量卻沒附。這支量它在全部預組的規模。
// 用法：node scripts/diag-ai-energy-skip.mjs [每組局數=2] [--out 報告.md]
//   56 副預組 × 3 個對手 × 局數；兩邊都用工作樹 AI。
// 量的東西（每個「自己回合的收尾」＝ END_TURN 或 ATTACK）：
//   - 手上有能量卡、這回合還沒附能量的比例
//   - 其中「戰鬥位當下有招可用」「備戰有付不起任何招的寶可夢（需要能量）」各多少
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAiBundle, loadLivePool, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAMES = Number(process.argv[2] ?? 2);
const oi = process.argv.indexOf('--out');
const OUT = oi >= 0 ? process.argv[oi + 1] : null;
const mod = await buildAiBundle(ROOT, { extraExports: ["export { canAffordAttack } from './src/lib/game/engine';"] });
const pool = loadLivePool(ROOT);
const ai = (st, i) => mod.aiNew(st, pool, i);
const presets = mod.PRESET_DECKS;

const T = { ends: 0, skip: 0, skipActiveCanAtk: 0, skipNeedyBench: 0, skipBoth: 0, byDeck: new Map() };
function needyBench(st, me) {
  // 備戰裡「有招式、但一招都付不起」的寶可夢（付不付得起問引擎的中央 canAffordAttack）
  const p = st.players[me];
  return p.bench.filter((b) => {
    const atks = pool.get(b.cardId)?.attacks ?? [];
    return atks.length > 0 && !atks.some((a) => mod.canAffordAttack(b, a.cost ?? [], pool, st, me, a.name));
  }).length;
}
const t0 = Date.now();
for (let a = 0; a < presets.length; a++) for (const off of [1, 7, 19]) {
  const b = (a + off) % presets.length;
  for (let g = 0; g < GAMES; g++) {
    const seat = g % 2;
    const decks = seat === 0 ? [presets[a], presets[b]] : [presets[b], presets[a]];
    const seed = 424242 + a * 1009 + off * 97 + g;
    const d = T.byDeck.get(presets[a].name) ?? { ends: 0, skip: 0, skipNeedy: 0 };
    playGame({ mod, pool, decks, agents: [ai, ai], seed, firstPlayer: firstPlayerOf(seed), onStep: (prev, act, _next, actor) => {
      if (actor !== seat || prev.phase !== 'playing' || prev.activePlayerIndex !== seat || prev.turnPhase !== 'main') return;
      if (act.type !== 'END_TURN' && act.type !== 'ATTACK') return;
      const me = prev.players[seat];
      T.ends++; d.ends++;
      const handEn = me.hand.some((c) => pool.get(c.cardId)?.supertype === 'Energy');
      if (!handEn || me.energyAttachedThisTurn) return;
      T.skip++; d.skip++;
      const canAtk = mod.getAvailableAttacks(prev, pool).length > 0;
      const needy = needyBench(prev, seat) > 0;
      if (canAtk) T.skipActiveCanAtk++;
      if (needy) { T.skipNeedyBench++; d.skipNeedy++; }
      if (canAtk && needy) T.skipBoth++;
    } });
    T.byDeck.set(presets[a].name, d);
  }
}
const pct = (x, n) => (n ? (100 * x / n).toFixed(1) + '%' : '—');
const L = [];
const P = (s = '') => { L.push(s); console.log(s); };
P(`# 診斷：手上有能量卻沒附（${presets.length} 副預組 × 3 個對手 × ${GAMES} 局，${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
P(`- 自己回合的收尾（END_TURN／ATTACK）：${T.ends}`);
P(`- 手上有能量卡、這回合沒附：${T.skip}（${pct(T.skip, T.ends)}）`);
P(`  - 其中戰鬥位當下有招可用：${T.skipActiveCanAtk}（${pct(T.skipActiveCanAtk, T.skip)}）`);
P(`  - 其中備戰有「一招都付不起」的寶可夢：${T.skipNeedyBench}（${pct(T.skipNeedyBench, T.skip)}）`);
P(`  - 兩者皆是（戰鬥位有招可用、備戰有人需要能量）：${T.skipBoth}（${pct(T.skipBoth, T.ends)} of 全部收尾）`);
P('');
P('| 牌組 | 收尾 | 有能量沒附 | 其中備戰有人需要能量 |');
P('|---|---|---|---|');
for (const [k, v] of [...T.byDeck].sort((x, y) => y[1].skipNeedy / Math.max(1, y[1].ends) - x[1].skipNeedy / Math.max(1, x[1].ends)).slice(0, 25)) {
  P(`| ${k} | ${v.ends} | ${v.skip}（${pct(v.skip, v.ends)}） | ${v.skipNeedy}（${pct(v.skipNeedy, v.ends)}） |`);
}
if (OUT) writeFileSync(OUT, L.join('\n') + '\n');
