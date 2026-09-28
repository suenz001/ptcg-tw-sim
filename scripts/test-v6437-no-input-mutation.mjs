// 守衛 v6.437：applyAction 不可以改到「傳進去的舊 state」（引擎是純函式）
//
// 【背景】v6.435 修 FINISH_SETUP 時做了一次診斷（30 局 AI 對 AI、5,146 次 applyAction，逐次比對呼叫前後的舊 state）：
//   只有兩種動作改到舊 state —— FINISH_SETUP（v6.435 修）與「登場特性確認」的 RESOLVE_SELECTION
//   （喵喵ex｜殺手鐧捕捉：`instInPlay.abilityUsedThisTurn = true` 就地改實體）。同型寫法全站 10 處。
// 【修法（中央）】engine USE_ABILITY 與 effects 的 resolve-play-ability-prompt：發動特性的那一隻一律換成新物件，
//   再交給特性函式 ⇒ 特性函式就地改實體只會落在新 state 上（不必逐張改 10 個特性）。
// 【本守衛】
//   A. 通用行為掃描：N 局 AI 對 AI，每一次 applyAction 前後比對舊 state（JSON 逐字）——任何動作改到舊 state 都紅。
//   B. 全卡池特性掃描：每一張 H／I／J 有特性的寶可夢放上戰鬥位與備戰，逐一 USE_ABILITY，比對舊 state。
//   C. 登場特性確認（喵喵ex）：從手牌放到備戰 → 確認發動 → 比對舊 state。
//
// HEAD-FAIL（BASE＝v6.436 b404a8f2）：結果寫在 commit 訊息（Rule 41：不整支 throw）。
// 用法：node scripts/test-v6437-no-input-mutation.mjs [局數=8]
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { buildAiBundle, loadLivePool, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAMES = Number(process.argv[2] ?? 12);
const mod = await buildAiBundle(ROOT);
const pool = loadLivePool(ROOT);
const ai = (st, i) => mod.aiNew(st, pool, i);

let pass = 0, fail = 0;
const failed = [];
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n); } };

/** 包一層 applyAction：呼叫前後比對傳進去的 state */
function checked(origApply, hits) {
  return (st, act, pl) => {
    const before = JSON.stringify(st);
    const nx = origApply(st, act, pl);
    if (JSON.stringify(st) !== before) {
      const ps = st.pendingSelection;
      const k = act.type + (act.type === 'RESOLVE_SELECTION' ? ':' + (ps?.effectKey ?? ps?.type) + (ps?.params?.abilityKey ? '(' + ps.params.abilityKey + ')' : '') : '')
        + (act.type === 'USE_ABILITY' ? '(' + pool.get(String([st.players[st.activePlayerIndex].active, ...st.players[st.activePlayerIndex].bench].find((c) => c?.iid === act.iid)?.cardId))?.name + ')' : '');
      hits.set(k, (hits.get(k) ?? 0) + 1);
    }
    return nx;
  };
}

// ── A：AI 對 AI ───────────────────────────────────────────────────────────────
T(`A1 ⭐ ${GAMES} 局 AI 對 AI：沒有任何一次 applyAction 改到傳進去的舊 state`, () => {
  const hits = new Map();
  const wrapped = { ...mod, applyAction: checked(mod.applyAction, hits) };
  const P = mod.PRESET_DECKS;
  let steps = 0;
  for (let g = 0; g < GAMES; g++) {
    const seed = 4371 + g * 97;
    const r = playGame({ mod: wrapped, pool, decks: [P[(g * 7) % P.length], P[(g * 13 + 5) % P.length]], agents: [ai, ai], seed, firstPlayer: firstPlayerOf(seed),
      onStep: () => { steps++; } });
    void r;
  }
  assert.ok(steps > GAMES * 50, `只跑了 ${steps} 步（對局沒開起來？）`);
  assert.deepEqual([...hits], [], '改到舊 state 的動作：' + [...hits].map(([k, v]) => `${k}×${v}`).join('、'));
});

// ── B：全卡池特性 ─────────────────────────────────────────────────────────────
const { createGame } = mod;
const live = new Set(JSON.parse(readFileSync(join(ROOT, 'static/cards/index.json'), 'utf8')).map((e) => e.code));
const BASIC = '17038';   // 卡比獸（填充用）
const EN = ['14103', '18519', '18520'];
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'm' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function board(cardId, where) {
  const s = createGame({ name: 'P1', entries: [{ cardId: BASIC, count: 1 }] }, { name: 'P2', entries: [{ cardId: BASIC, count: 1 }] }, pool);
  const me = inst(cardId, { energyAttached: [inst(EN[0]), inst(EN[1]), inst(EN[2])] });
  const hand = [inst(BASIC), inst(EN[0]), inst(EN[1]), inst('14124')];
  return { st: { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand, deck: Array.from({ length: 15 }, (_, i) => inst(i % 3 ? BASIC : EN[i % 3])), discard: [inst(EN[0]), inst(BASIC)],
        prizes: Array.from({ length: 6 }, () => inst(BASIC)),
        active: where === 'active' ? me : inst(BASIC, { energyAttached: [inst(EN[0])] }),
        bench: where === 'bench' ? [me, inst(BASIC)] : [inst(BASIC), inst(BASIC)] },
      { ...s.players[1], hand: [inst(BASIC), inst(BASIC)], deck: Array.from({ length: 15 }, () => inst(BASIC)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(BASIC)), active: inst(BASIC, { damage: 30 }), bench: [inst(BASIC), inst(BASIC)] }] }, iid: me.iid };
}
T('B1 ⭐ 全卡池（H／I／J）有特性的寶可夢，在戰鬥位與備戰逐一 USE_ABILITY：都不改到舊 state', () => {
  const hits = new Map();
  const apply = checked(mod.applyAction, hits);
  const seen = new Set();
  let tried = 0, accepted = 0;
  for (const [id, c] of pool) {
    if (c.supertype !== 'Pokemon' || !c.abilities?.length || !['H', 'I', 'J'].includes(c.regulationMark)) continue;
    const key = c.name + '|' + c.abilities.map((a) => a.name).join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    for (const where of ['active', 'bench']) {
      for (let ai2 = 0; ai2 < c.abilities.length; ai2++) {
        const { st, iid } = board(id, where);
        tried++;
        let nx;
        try { nx = apply(st, { type: 'USE_ABILITY', iid, abilityIndex: ai2 }, pool); } catch { continue; }
        if (nx !== st) accepted++;
        // 接著把自己的選擇視窗解掉（解視窗的那一步也要檢查）
        for (let i = 0; i < 4 && nx?.pendingSelection && nx.pendingSelection.actorIdx === 0; i++) {
          const a = mod.aiNew(nx, pool, 0);
          if (!a || a.type !== 'RESOLVE_SELECTION') break;
          let nn2; try { nn2 = apply(nx, a, pool); } catch { break; }
          if (nn2 === nx) break;
          nx = nn2;
        }
      }
    }
  }
  assert.ok(seen.size > 150, `只掃到 ${seen.size} 張有特性的卡（掃描器壞了？）`);
  assert.ok(accepted > 60, `只有 ${accepted}/${tried} 次特性被接受（盤面太假？）`);
  assert.deepEqual([...hits], [], '改到舊 state 的特性：' + [...hits].map(([k, v]) => `${k}×${v}`).join('、'));
});

// ── C：登場特性確認（喵喵ex｜殺手鐧捕捉，診斷抓到的那一個）─────────────────────
T('C1 ⭐ 喵喵ex 從手牌放到備戰 → 確認發動「殺手鐧捕捉」：確認那一步不改到舊 state', () => {
  let meowth = null;
  for (const [id, c] of pool) if (c.name === '喵喵ex' && c.abilities?.some((a) => a.name === '殺手鐧捕捉') && ['H', 'I', 'J'].includes(c.regulationMark)) { meowth = id; break; }
  assert.ok(meowth, '找不到喵喵ex');
  const { st } = board(BASIC, 'active');
  const card = inst(meowth);
  const st0 = { ...st, players: [{ ...st.players[0], hand: [card, ...st.players[0].hand], bench: [st.players[0].bench[0]] }, st.players[1]] };
  const p1 = mod.applyAction(st0, { type: 'PLAY_BASIC', iid: card.iid }, pool);
  assert.equal(p1.pendingSelection?.effectKey, 'resolve-play-ability-prompt', '前提：沒有跳出登場特性確認（' + JSON.stringify(p1.pendingSelection)?.slice(0, 120) + '）');
  const before = JSON.stringify(p1);
  const p2 = mod.applyAction(p1, { type: 'RESOLVE_SELECTION', selectedIids: ['yes'] }, pool);
  assert.notEqual(p2, p1, '前提：確認被拒絕');
  assert.equal(JSON.stringify(p1), before, '確認發動改到了舊 state');
  const b = p2.players[0].bench.find((x) => x.iid === card.iid);
  assert.equal(b?.abilityUsedThisTurn, true, '新 state 上應該蓋了「已使用」');
});

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail) { console.log('紅：' + failed.join('、')); process.exit(1); }
