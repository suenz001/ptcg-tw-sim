// 預組「傷害算術」與「AI 用不到的卡」診斷（AI 對戰強化；診斷用，不進 CI，不動 src/）。
//
// Kaggle 銀牌作者的教訓：「程式修決策，設定（牌組）修算術」——一擊線 210、對手 220 HP，再多決策邏輯都補不了那 10 點。
// 這支腳本用**實際 AI 對局**量兩件事（不是讀印刷數字猜）：
//   ① 差一點（near-miss）：攻擊有打到、沒打倒、而且對方只剩 1～30 HP 的比例。
//      高的牌組＝一擊線常常差一口氣 ⇒ 可能是「預組算術」問題（加傷道具／HP 加成卡張數），不是 AI 決策問題。
//      同時列出最常見的「招式 → 目標 → 剩幾 HP」組合，指出卡在哪一條線。
//   ② AI 從來沒打出的卡：牌組裡有、抽到過（進過手牌）、但 AI 整批對局一次都沒打出的訓練家／寶可夢。
//      ⇒ 可能是「AI 看不見這張卡的價值」（干擾型卡的典型），或是卡本身在這副牌裡用不到。
//   每副預組對「對手池 5 副」各打 SEEDS×2 場（先攻後攻各一），雙方都是工作樹 AI。
//
// 用法：node scripts/diag-preset-arithmetic.mjs [--seeds 6] [--only 起,迄] [--save out.json]
// ⚠ 這是診斷：結果只拿來「找可疑的牌組」，改不改預組由站長裁定（呆呆王 9 張能量就是站長裁定不調）。
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf, pct } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEEDS = Number(arg('--seeds', 6));
const SAVE = arg('--save', null);
const ONLY = arg('--only', null);
const NEAR = 30;

const mod = await buildAiBundle(ROOT, { extraExports: ["export { getEffectiveHP } from './src/lib/game/engine';"] });
const pool = loadLivePool(ROOT);
const ai = (st, idx) => mod.aiNew(st, pool, idx);
const OPP_IDS = ['__preset_alakazam__', '__preset_slowking__', '__preset_mega_lucario__', '__preset_marnie_scrafty__', '__preset_marrune_dragapult__'];
const OPPS = OPP_IDS.map((id) => presetById(mod, id));
let presets = mod.PRESET_DECKS;
if (ONLY) { const [a, b] = ONLY.split(',').map(Number); presets = presets.slice(a, b); }

const nameOf = (cid) => pool.get(String(cid))?.name ?? String(cid);
function findInst(st, iid) {
  for (const p of st.players) {
    if (p.active?.iid === iid) return p.active;
    const b = p.bench.find((x) => x.iid === iid); if (b) return b;
  }
  return null;
}

const report = [];
const t0 = Date.now();
for (const deck of presets) {
  const r = { id: deck.id, name: deck.name, games: 0, wins: 0, hits: 0, kos: 0, near: 0, nearPairs: {}, played: {}, drawn: {} };
  const cardsInDeck = new Map(deck.entries.map((e) => [nameOf(e.cardId), pool.get(String(e.cardId))]));
  for (const opp of OPPS) {
    if (opp.id === deck.id) continue;
    for (let s = 0; s < SEEDS; s++) {
      const seed = 55501 + s * 7919 + OPP_IDS.indexOf(opp.id) * 13;
      for (const seat of [0, 1]) {
        const decks = seat === 0 ? [deck, opp] : [opp, deck];
        const onStep = (before, act, after, actor) => {
          if (actor !== seat) return;
          const me = before.players[seat];
          // 抽到過：記錄手牌裡出現過的卡名
          for (const c of me.hand) r.drawn[nameOf(c.cardId)] = 1;
          if (act.type === 'PLAY_TRAINER' || act.type === 'PLAY_BASIC') {
            const c = me.hand.find((x) => x.iid === act.iid); if (c) r.played[nameOf(c.cardId)] = (r.played[nameOf(c.cardId)] || 0) + 1;
          } else if (act.type === 'EVOLVE') {
            const c = me.hand.find((x) => x.iid === act.toIid); if (c) r.played[nameOf(c.cardId)] = (r.played[nameOf(c.cardId)] || 0) + 1;
          } else if (act.type === 'ATTACH_ENERGY') {
            const c = me.hand.find((x) => x.iid === act.energyIid); if (c) r.played[nameOf(c.cardId)] = (r.played[nameOf(c.cardId)] || 0) + 1;
          } else if (act.type === 'ATTACK') {
            const def = before.players[1 - seat].active; if (!def) return;
            const atkInst = me.active;
            const effs = atkInst ? mod.getEffectiveAttacks(before, atkInst, pool) : null;
            const atkName = effs?.[act.attackIndex]?.atk?.name ?? '?';
            const aft = findInst(after, def.iid);
            const dealt = (aft ? aft.damage : Infinity) - (def.damage || 0);
            if (!aft) { r.hits++; r.kos++; return; }
            if (!(dealt > 0)) return;
            r.hits++;
            const remain = mod.getEffectiveHP(aft, pool, after) - aft.damage;
            if (remain <= 0) { r.kos++; return; }
            if (remain <= NEAR) {
              r.near++;
              const k = `${nameOf(atkInst.cardId)}「${atkName}」→ ${nameOf(def.cardId)}（剩 ${remain}）`;
              r.nearPairs[k] = (r.nearPairs[k] || 0) + 1;
            }
          }
        };
        const g = playGame({ mod, pool, decks, agents: [ai, ai], seed, firstPlayer: firstPlayerOf(seed), onStep });
        if (g.outcome === 'ended' && g.winner != null) { r.games++; if (g.winner === seat) r.wins++; }
      }
    }
  }
  r.nearRate = r.hits ? r.near / r.hits : 0;
  r.koRate = r.hits ? r.kos / r.hits : 0;
  // AI 從沒打出、但抽到過的卡（只算能「打出」的類型：訓練家、寶可夢；能量另列）
  r.neverPlayed = [...cardsInDeck.entries()]
    .filter(([n, c]) => c && r.drawn[n] && !r.played[n] && (c.supertype === 'Trainer' || c.supertype === 'Pokémon' || c.supertype === 'Pokemon'))
    .map(([n, c]) => `${n}${c.subtypes?.length ? '（' + c.subtypes.join('/') + '）' : ''}`);
  r.topNear = Object.entries(r.nearPairs).sort((a, b) => b[1] - a[1]).slice(0, 3);
  delete r.nearPairs; delete r.drawn;
  report.push(r);
  console.log(`${deck.name}：勝 ${pct(r.wins / Math.max(1, r.games))}（${r.games} 場） 命中 ${r.hits} 擊倒 ${pct(r.koRate)} 差一點 ${pct(r.nearRate)}`
    + (r.topNear.length ? `  最常差一點：${r.topNear.map(([k, n]) => k + '×' + n).join('；')}` : '')
    + (r.neverPlayed.length ? `\n    AI 從沒打出（抽到過）：${r.neverPlayed.join('、')}` : '')
    + `  [${((Date.now() - t0) / 60000).toFixed(1)} 分]`);
}
if (SAVE) writeFileSync(SAVE, JSON.stringify({ seeds: SEEDS, near: NEAR, at: new Date().toISOString(), report }, null, 2));
