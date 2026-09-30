// 進化選擇診斷（AI 對戰強化「同步驟內比較能力」第一步的前置量測；診斷用，不進 CI，不動 src/）。
//
// 現況：ai.ts 進化永遠取 getEvolvableTargets(state)[0] 的第一個選項（戰鬥位排最前，其次備戰由左至右）。
// 取第一個「會不會選錯」只在**真的有得選**時才有意義。有得選的兩種情況：
//   (甲) 爭奪：同一張進化卡（手上只有 1 張這個卡名）可以進化 ≥2 隻不同的寶可夢 ⇒ 給誰？
//   (乙) 分歧：同一隻寶可夢手上有 ≥2 種不同卡名的進化卡（例：伊布系）⇒ 進化成哪一種？
// 本腳本量：每局 AI 遇到 (甲)／(乙) 幾次；(甲) 裡選中的是不是戰鬥位；(乙) 裡的卡名組合。
// 判讀：跟批次 D 一樣——量出來很少（例如每局 < 0.3 次）就不做行為改動。
//
// 用法：node scripts/diag-ai-evolve-choice.mjs [--seeds 20]
import { fileURLToPath } from 'node:url';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEEDS = Number(arg('--seeds', 20));
const mod = await buildAiBundle(ROOT);
const pool = loadLivePool(ROOT);
const ai = (st, idx) => mod.aiNew(st, pool, idx);
const nameOf = (cid) => pool.get(String(cid))?.name ?? String(cid);

// 對手池 5 副＋其餘所有預組各當一次「受測方」（進化選擇跟牌組結構有關，要看全部預組）
const OPP_IDS = ['__preset_alakazam__', '__preset_slowking__', '__preset_mega_lucario__', '__preset_marnie_scrafty__', '__preset_marrune_dragapult__'];
const OPPS = OPP_IDS.map((id) => presetById(mod, id));
const tot = { games: 0, evolves: 0, contend: 0, contendActive: 0, branch: 0 };
const byDeck = {}; const branchNames = {};
for (const deck of mod.PRESET_DECKS) {
  const d = (byDeck[deck.name] = { games: 0, contend: 0, branch: 0 });
  for (let k = 0; k < OPPS.length; k++) {
    for (let s = 0; s < Math.max(1, Math.round(SEEDS / OPPS.length)); s++) {
      const seed = 31337 + s * 7919 + k * 101;
      for (const seat of [0, 1]) {
        const decks = seat === 0 ? [deck, OPPS[k]] : [OPPS[k], deck];
        const onStep = (before, act, after, actor) => {
          if (actor !== seat || act.type !== 'EVOLVE') return;
          tot.evolves++;
          const me = before.players[seat];
          const targets = mod.getEvolvableTargets(before, pool);
          // (甲) 爭奪：選中那張卡的卡名，手上只有 1 張，而能進化的 fromIid ≥ 2
          const chosenName = nameOf(me.hand.find((c) => c.iid === act.toIid)?.cardId);
          const sameNameInHand = me.hand.filter((c) => nameOf(c.cardId) === chosenName).length;
          const froms = targets.filter((t) => t.toIids.some((iid) => nameOf(me.hand.find((c) => c.iid === iid)?.cardId) === chosenName)).map((t) => t.fromIid);
          if (sameNameInHand === 1 && new Set(froms).size >= 2) {
            tot.contend++; d.contend++;
            if (me.active && act.fromIid === me.active.iid) tot.contendActive++;
          }
          // (乙) 分歧：選中的那隻手上有 ≥2 種不同卡名的進化卡
          const t = targets.find((x) => x.fromIid === act.fromIid);
          const names = new Set((t?.toIids ?? []).map((iid) => nameOf(me.hand.find((c) => c.iid === iid)?.cardId)));
          if (names.size >= 2) { tot.branch++; d.branch++; const key = [...names].sort().join(' / '); branchNames[key] = (branchNames[key] || 0) + 1; }
        };
        const g = playGame({ mod, pool, decks, agents: [ai, ai], seed, firstPlayer: firstPlayerOf(seed), onStep });
        if (g.outcome === 'ended') { tot.games++; d.games++; }
      }
    }
  }
}
console.log(JSON.stringify(tot));
console.log(`局數 ${tot.games}；AI 進化 ${tot.evolves} 次（每局 ${(tot.evolves / tot.games).toFixed(2)}）`);
console.log(`(甲) 爭奪：${tot.contend} 次（每局 ${(tot.contend / tot.games).toFixed(3)}），其中給了戰鬥位 ${tot.contendActive}`);
console.log(`(乙) 分歧：${tot.branch} 次（每局 ${(tot.branch / tot.games).toFixed(3)}）`);
const top = Object.entries(byDeck).filter(([, v]) => v.contend + v.branch > 0).sort((a, b) => (b[1].contend + b[1].branch) / b[1].games - (a[1].contend + a[1].branch) / a[1].games).slice(0, 10);
for (const [n, v] of top) console.log(`  ${n}：爭奪 ${v.contend}、分歧 ${v.branch}（${v.games} 局）`);
for (const [k, n] of Object.entries(branchNames).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  分歧組合 ${k} ×${n}`);
