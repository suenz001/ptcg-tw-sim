// 診斷（不進 CI）：對手池災難格「呆呆王 vs 瑪俐的長毛巨魔ex」——是決策、預組、還是卡池問題？
//
// 用法：node scripts/diag-ai-slowking-vs-marnie.mjs [seeds=20] [--out 報告.md]
//   受測兩邊都用工作樹 AI（這裡要看的是牌組相剋本身，不是新舊 AI 比較）。
// 量的東西（全部從引擎盤面讀，不解讀卡面文字）：
//   ① 勝負與敗因、回合數、雙方拿到的獎賞張數
//   ② 呆呆王側每一次攻擊：招式、對手全場傷害、有沒有擊倒；對長毛巨魔ex（320 HP）的擊倒要打幾下
//   ③ 瑪俐側每一次攻擊：招式、傷害、擊倒了誰
//   ④ 呆呆王側每個自己的回合：戰鬥位是誰、有沒有招可用、場上競技場是哪一張
//   ⑤ 對照組：同樣的量測跑「呆呆王 vs 胡地」（呆呆王勝率約五成的對手）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf, classifyReason } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SEEDS = Number(process.argv[2] ?? 20);
const oi = process.argv.indexOf('--out');
const OUT = oi >= 0 ? process.argv[oi + 1] : null;
const mod = await buildAiBundle(ROOT, { extraExports: ["export { getEffectiveHP } from './src/lib/game/engine';"] });
const pool = loadLivePool(ROOT);
const nm = (c) => pool.get(String(c))?.name ?? '?';
const ai = (st, i) => mod.aiNew(st, pool, i);
const SK = presetById(mod, '__preset_slowking__');
const OPPS = [['瑪俐的長毛巨魔ex', presetById(mod, '__preset_marnie_scrafty__')], ['胡地（對照）', presetById(mod, '__preset_alakazam__')]];

const inc = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const srt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
const fieldOf = (p) => [p.active, ...p.bench].filter(Boolean);
function dmgAndKo(prev, next, side, pool) {
  // 對 side 那一方全場的有效傷害（逐隻比 iid；離場的算剩餘 HP）與被擊倒的卡名
  const after = new Map(fieldOf(next.players[side]).map((c) => [c.iid, c]));
  let dmg = 0; const kos = [];
  for (const b of fieldOf(prev.players[side])) {
    const a = after.get(b.iid);
    if (a) dmg += Math.max(0, (a.damage ?? 0) - (b.damage ?? 0));
    else { dmg += Math.max(0, mod.getEffectiveHP(b, pool, prev) - (b.damage ?? 0)); kos.push(nm(b.cardId)); }
  }
  return { dmg, kos };
}

const lines = [];
const P = (s = '') => { lines.push(s); console.log(s); };
P(`# 診斷：呆呆王 vs 瑪俐的長毛巨魔ex（每個對手 ${SEEDS} 個 seed × 雙方先攻 = ${SEEDS * 2} 局）`);
P('');
for (const [oppName, opp] of OPPS) {
  const R = { games: 0, wins: 0, reasons: {}, turns: 0, prizesMe: 0, prizesOpp: 0,
    myAtk: {}, myAtkDmg: {}, myKo: {}, oppAtk: {}, oppAtkDmg: {}, oppKo: {}, myTurns: 0, myTurnsCanAtk: 0,
    stadiumMyTurn: {}, activeMyTurn: {}, endTurns: 0, endAttached: 0, endHandEnergy: 0, endHandEnergyNotAttached: 0, trainers: {}, energyTargets: {}, slowkingEnergyAtStart: {}, hitsToKoScrafty: [], scraftyHits: new Map() };
  for (let s = 0; s < SEEDS; s++) for (const seat of [0, 1]) {
    const seed = 9001 + s * 7919;
    const decks = seat === 0 ? [SK, opp] : [opp, SK];
    let lastTurn = null; let lastState = null;
    const r = playGame({ mod, pool, decks, agents: [ai, ai], seed, firstPlayer: firstPlayerOf(seed), onStep: (prev, act, next, actor) => {
      lastState = next;
      if (prev.phase !== 'playing') return;
      if (actor === seat && prev.activePlayerIndex === seat && prev.turn !== lastTurn && prev.players[seat].active && prev.turnPhase === 'main') {
        lastTurn = prev.turn; R.myTurns++;
        if (mod.getAvailableAttacks(prev, pool).length) R.myTurnsCanAtk++;
        inc(R.stadiumMyTurn, prev.activeStadium ? nm(prev.activeStadium.cardId) : '（無）');
        inc(R.activeMyTurn, nm(prev.players[seat].active.cardId));
        const skOnField = fieldOf(prev.players[seat]).filter((c) => nm(c.cardId) === '呆呆王');
        for (const c of skOnField) inc(R.slowkingEnergyAtStart, `${c.energyAttached.length} 個`);
        if (!skOnField.length) inc(R.slowkingEnergyAtStart, '場上沒有呆呆王');
      }
      // ⑥ 能量：回合結束（END_TURN 或 ATTACK）時，這回合有沒有附能量、手上還有沒有能量卡
      if (actor === seat && prev.activePlayerIndex === seat && (act.type === 'END_TURN' || act.type === 'ATTACK')) {
        const me = prev.players[seat];
        const handEn = me.hand.filter((c) => pool.get(c.cardId)?.supertype === 'Energy').length;
        R.endTurns++; if (me.energyAttachedThisTurn) R.endAttached++; if (handEn) R.endHandEnergy++;
        if (handEn && !me.energyAttachedThisTurn) R.endHandEnergyNotAttached++;
      }
      if (actor === seat && act.type === 'PLAY_TRAINER') { const h = prev.players[seat].hand.find((c) => c.iid === act.iid); if (h) inc(R.trainers, nm(h.cardId)); }
      if (actor === seat && act.type === 'ATTACH_ENERGY') { const t = fieldOf(prev.players[seat]).find((c) => c.iid === act.targetIid); inc(R.energyTargets, t ? nm(t.cardId) + (t.iid === prev.players[seat].active?.iid ? '（戰鬥位）' : '（備戰）') : '?'); }
      if (act.type !== 'ATTACK') return;
      const a = prev.players[actor].active; if (!a) return;
      const eff = mod.getEffectiveAttacks(prev, a, pool);
      const key = nm(a.cardId) + '｜' + (eff[act.attackIndex]?.atk?.name ?? '?');
      const { dmg, kos } = dmgAndKo(prev, next, 1 - actor, pool);
      if (actor === seat) {
        inc(R.myAtk, key); inc(R.myAtkDmg, key, dmg); for (const k of kos) inc(R.myKo, k);
        // 對長毛巨魔ex：記每一隻被打了幾下才倒
        const oa = prev.players[1 - actor].active;
        if (oa && nm(oa.cardId) === '瑪俐的長毛巨魔ex') {
          const n = (R.scraftyHits.get(oa.iid) ?? 0) + 1; R.scraftyHits.set(oa.iid, n);
          if (kos.includes('瑪俐的長毛巨魔ex')) R.hitsToKoScrafty.push(n);
        }
      } else {
        inc(R.oppAtk, key); inc(R.oppAtkDmg, key, dmg); for (const k of kos) inc(R.oppKo, k);
      }
    } });
    R.games++; if (r.winner === seat) R.wins++;
    inc(R.reasons, (r.winner === seat ? '勝：' : r.winner == null ? '平：' : '敗：') + classifyReason(r));
    R.turns += r.turns ?? 0;
    const me = lastState?.players?.[seat], op = lastState?.players?.[1 - seat];
    if (me && op) { R.prizesMe += 6 - me.prizes.length; R.prizesOpp += 6 - op.prizes.length; }
  }
  P(`## 呆呆王 vs ${oppName}`);
  P(`- 勝 ${R.wins} / ${R.games}（${(100 * R.wins / R.games).toFixed(0)}%）；平均回合 ${(R.turns / R.games).toFixed(1)}；平均拿到獎賞 呆呆王 ${(R.prizesMe / R.games).toFixed(2)}、對手 ${(R.prizesOpp / R.games).toFixed(2)}`);
  P(`- 勝負原因：${srt(R.reasons).map(([k, v]) => `${k} ${v}`).join('、')}`);
  P(`- 呆呆王側自己的回合 ${R.myTurns}，有招可用 ${R.myTurnsCanAtk}（${(100 * R.myTurnsCanAtk / Math.max(1, R.myTurns)).toFixed(0)}%）`);
  P(`- 回合結束時：這回合有附能量 ${R.endAttached}/${R.endTurns}；手上還有能量卡 ${R.endHandEnergy}；手上有能量卻沒附 ${R.endHandEnergyNotAttached}`);
  P(`- 附能量的對象：${srt(R.energyTargets).slice(0, 10).map(([k, v]) => `${k} ${v}`).join('、')}`);
  P(`- 自己回合開始時呆呆王身上的能量：${srt(R.slowkingEnergyAtStart).map(([k, v]) => `${k} ${v}`).join('、')}`);
  P(`- 打出的訓練家：${srt(R.trainers).map(([k, v]) => `${k} ${v}`).join('、')}`);
  P(`- 自己回合開始時場上的競技場：${srt(R.stadiumMyTurn).map(([k, v]) => `${k} ${v}`).join('、')}`);
  P(`- 自己回合的戰鬥位：${srt(R.activeMyTurn).slice(0, 8).map(([k, v]) => `${k} ${v}`).join('、')}`);
  P('- 呆呆王側的攻擊（次數／平均對手全場傷害）：');
  for (const [k, v] of srt(R.myAtk).slice(0, 12)) P(`  - ${k}：${v} 次，平均 ${(R.myAtkDmg[k] / v).toFixed(0)}`);
  P(`- 呆呆王側擊倒：${srt(R.myKo).map(([k, v]) => `${k} ${v}`).join('、') || '無'}`);
  if (R.hitsToKoScrafty.length) P(`- 長毛巨魔ex 被擊倒前挨了幾下：${R.hitsToKoScrafty.join('、')}（平均 ${(R.hitsToKoScrafty.reduce((a, b) => a + b, 0) / R.hitsToKoScrafty.length).toFixed(2)}）`);
  P('- 對手的攻擊（次數／平均對呆呆王側全場傷害）：');
  for (const [k, v] of srt(R.oppAtk).slice(0, 10)) P(`  - ${k}：${v} 次，平均 ${(R.oppAtkDmg[k] / v).toFixed(0)}`);
  P(`- 對手擊倒：${srt(R.oppKo).map(([k, v]) => `${k} ${v}`).join('、') || '無'}`);
  P('');
}
if (OUT) writeFileSync(OUT, lines.join('\n') + '\n');
