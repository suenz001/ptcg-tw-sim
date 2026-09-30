// 反殺風險診斷（AI 對戰強化；診斷用，不進 CI，不動 src/）。
//
// 問題：AI 攻擊沒打倒對手時，把「值 2～3 張獎賞」的主攻手留在戰鬥位，下個對手回合被打倒 —— 這種事多常發生？
//   反殺代理（只用公開資訊）：對手**到目前為止**任何一招對單一寶可夢造成過的最大傷害（oppMaxHit）。
//   代理預測「會被打倒」＝ oppMaxHit ≥ 我方戰鬥位剩餘 HP。
// 量：
//   事件＝我方出招、沒擊倒對手戰鬥位、我方戰鬥位值 ≥2 張獎賞、而且當下「撤退得了、撤退費 ≤2、備戰有人」（有得選）。
//   ① 事件後下一個對手回合，那隻真的被打倒的比例（＝可避免損失的上限）
//   ② 代理的精確率／召回率（代理說會被打倒時，真的被打倒的比例；真的被打倒的事件裡，代理事先有說中的比例）
//   ③ 每局平均因此多送的獎賞張數
// 判讀：跟批次 D（沒有可上場的寶可夢只佔敗局 4% ⇒ 跳過）一樣——量出來很少就不做行為改動。
//
// 用法：node scripts/diag-ai-retaliation.mjs [--seeds 30]
import { fileURLToPath } from 'node:url';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf, pct } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEEDS = Number(arg('--seeds', 30));
const mod = await buildAiBundle(ROOT, { extraExports: [
  "export { getEffectiveHP, computeActiveRetreatCostFor, prizesForKO } from './src/lib/game/engine';",
] });
const pool = loadLivePool(ROOT);
const ai = (st, idx) => mod.aiNew(st, pool, idx);
const IDS = ['__preset_alakazam__', '__preset_slowking__', '__preset_mega_lucario__', '__preset_marnie_scrafty__', '__preset_marrune_dragapult__'];
const DECKS = IDS.map((id) => presetById(mod, id));

function prizeOf(inst) {
  const c = pool.get(String(inst.cardId)); return c ? mod.prizesForKO(c) : 1;   // 引擎的取獎張數判準（單一來源）
}
function onField(st, iid) { return st.players.some((p) => p.active?.iid === iid || p.bench.some((b) => b.iid === iid)); }

const tot = { games: 0, events: 0, predicted: 0, koNext: 0, predKo: 0, prizesLost: 0 };
const t0 = Date.now();
for (let i = 0; i < DECKS.length; i++) for (let j = 0; j < DECKS.length; j++) {
  if (i === j) continue;
  for (let s = 0; s < SEEDS; s++) {
    const seed = 91001 + s * 7919 + i * 31 + j * 7;
    const oppMaxHit = [0, 0];            // oppMaxHit[p] ＝ p 的對手到目前為止單次最大傷害（公開資訊）
    const pending = [null, null];        // pending[p] ＝ p 方剛記下、等對手回合結算的事件
    const onStep = (before, act, after, actor) => {
      if (act.type !== 'ATTACK') return;
      const opp = 1 - actor;
      const def = before.players[opp].active;
      // 記錄「actor 對單一寶可夢造成的傷害」⇒ 更新 opp 眼中的 oppMaxHit
      if (def) {
        const aft = after.players.flatMap((p) => [p.active, ...p.bench]).find((x) => x && x.iid === def.iid);
        const dealt = aft ? aft.damage - (def.damage || 0) : Math.max(0, mod.getEffectiveHP(def, pool, before) - (def.damage || 0));
        if (dealt > oppMaxHit[opp]) oppMaxHit[opp] = dealt;
      }
      // 結算對方先前記下的事件：這次 actor 攻擊後，對方那隻還在不在
      const ev = pending[opp];
      if (ev) {
        pending[opp] = null;
        const ko = onField(before, ev.iid) && !onField(after, ev.iid);
        if (ko) { tot.koNext++; tot.prizesLost += ev.prize; if (ev.pred) tot.predKo++; }
      }
      // 記下 actor 這次的事件
      const me = before.players[actor]; const mine = me.active;
      if (!mine || !onField(after, mine.iid)) return;
      const killed = def && !onField(after, def.iid);
      if (killed) return;
      const prize = prizeOf(mine); if (prize < 2) return;
      let canSwap = false;
      try { canSwap = mod.canRetreat(before, pool) && me.bench.length > 0 && mod.computeActiveRetreatCostFor(before, actor, pool) <= 2; } catch { canSwap = false; }
      if (!canSwap) return;
      const mineAfter = after.players[actor].active?.iid === mine.iid ? after.players[actor].active : null;
      if (!mineAfter) return;
      const rem = mod.getEffectiveHP(mineAfter, pool, after) - mineAfter.damage;
      const pred = oppMaxHit[actor] >= rem && oppMaxHit[actor] > 0;
      tot.events++; if (pred) tot.predicted++;
      pending[actor] = { iid: mine.iid, prize, pred };
    };
    for (const seat of [0, 1]) {
      const decks = seat === 0 ? [DECKS[i], DECKS[j]] : [DECKS[j], DECKS[i]];
      oppMaxHit[0] = oppMaxHit[1] = 0; pending[0] = pending[1] = null;
      const g = playGame({ mod, pool, decks, agents: [ai, ai], seed, firstPlayer: firstPlayerOf(seed), onStep });
      if (g.outcome === 'ended') tot.games++;
    }
  }
  process.stdout.write(`  ${i}-${j} 完成（${((Date.now() - t0) / 60000).toFixed(1)} 分）\n`);
}
console.log(JSON.stringify(tot));
console.log(`局數 ${tot.games}；事件（沒打倒＋多獎賞主攻手＋撤得了）${tot.events}（每局 ${(tot.events / tot.games).toFixed(2)}）`);
console.log(`① 事件後下個對手回合真的被打倒：${pct(tot.koNext / tot.events)}；每局因此多送 ${(tot.prizesLost / tot.games).toFixed(2)} 張獎賞`);
console.log(`② 代理預測會被打倒：${tot.predicted}；精確率 ${pct(tot.predKo / Math.max(1, tot.predicted))}；召回率 ${pct(tot.predKo / Math.max(1, tot.koNext))}`);
