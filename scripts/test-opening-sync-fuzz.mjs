#!/usr/bin/env node
/**
 * 開局同步 **隨機交錯 fuzz**（v6.058）。
 *
 * Wilson 最擔心的一件事：「setup 階段雙方輪巡／順序覆蓋，造成某一方的動作被抵銷、
 * 被回朔，甚至造成對戰卡住」。手寫幾個案例證明不了這件事 —— 真正的風險在
 * **我想不到的那些交錯順序**。這一網用亂數把「誰先動、誰先收到誰、收到的是第幾份快照」
 * 全部打散，跑上千種序列，對每一步檢查不變式。
 *
 * 模擬的是休閒線上的真實模型：
 *   ・兩端各自持有 local state，各自 applyAction（引擎），再把整份盤面推出去
 *   ・對端用 resolveRoomUpdate 決定 reject / merge / adopt
 *   ・**推送會亂序、會重複、會遲到**（房間快照是共享的，任一端可能收到對方的舊版本）
 *   ・一端可能是舊版 client（沒有 opening 流程，直接放場＋按準備）
 *
 * 每一步檢查的不變式：
 *   I1 不得拋例外
 *   I2 `mulliganCounts[i]` 對任一端都**單調不減**（＝該座位的重抽次數不會被回朔）
 *   I3 `openingDone[i]` 只能 false→true（定案不會被撤銷）
 *   I4 **同源**：`mulliganRevealedHands[i].length === mulliganCounts[i]`
 *      （counts 與揭示若來自不同快照就會不等 —— 這是「縫合怪」的照妖鏡）
 *   I5 手牌張數恆為 7（開局階段不會多抽少抽）
 *   I6 結算後 `pendingMulliganDraw` **不得超過**官方 NET 公式 max(0, 對方次數−自己次數)
 *      （領過之後會降到 0，所以是上界而非等式；要防的是「補抽被重新發放」）
 *   I7 ⭐**己側盤面不得因合併而回朔**：merge 後 `players[me]` 必須與 merge 前相同，
 *      除非該座位的開局尚未雙方定案（未定案期間才允許用對方較前進的版本補上）。
 *      —— v6.058 抓到的 R1/R2（放上場的寶可夢被洗回、補抽被洗回且永久少抽）
 *      **I2~I6 全部抓不到**：counts/done/揭示都沒變，被洗回的手牌恰好還是 7 張。
 * 收斂後檢查：
 *   C1 兩端的開局結果指紋完全相同
 *   C2 一定能走完 setup 進入 playing（不卡死）
 *
 * Run: node scripts/test-opening-sync-fuzz.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-fz-s.js'), E = join(ROOT, '.x-fz-e.ts'), O = join(ROOT, '.x-fz-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction, isOpeningInProgress, canBeInitialActiveCard } from './src/lib/game/engine';\n"
  + "export { resolveRoomUpdate } from './src/lib/game/sync-guards';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, isOpeningInProgress, canBeInitialActiveCard, resolveRoomUpdate } = await import(pathToFileURL(O).href);
/** 從手牌挑一張「可以放上戰鬥場」的卡（能量放不上去）。 */
const pickPlaceable = (hand) => hand.find((c) => canBeInitialActiveCard(pool.get(c.cardId)));

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const BURST = '13974', BASIC = '19174', ENERGY = '14128';
const burstOnly = [{ cardId: BURST, count: 4 }, { cardId: ENERGY, count: 56 }];
const mixed = [{ cardId: BURST, count: 4 }, { cardId: BASIC, count: 2 }, { cardId: ENERGY, count: 54 }];

let seed = 1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
const clone = (s) => JSON.parse(JSON.stringify(s));
const CTX = (me) => ({ myPlayerIndex: me, roomRestartCount: 0, lastAdoptedRestartCount: 0,
  roomLastUndoApplyAt: 0, lastSeenUndoApplyAt: 0 });
const key = (i) => (i === 0 ? 'p1' : 'p2');
/** 與引擎 effectiveOpeningDone 同判準（含版本 skew 逃生）。 */
const effDone = (s) => [
  !!((s.openingDone?.[0] ?? true) || s.setupDone?.[0]),
  !!((s.openingDone?.[1] ?? true) || s.setupDone?.[1]),
];
const fp = (s) => JSON.stringify({
  c: s.mulliganCounts, d: s.pendingMulliganDraw, cf: s.mulliganRevealConfirmed,
  done: s.openingDone, fin: !!s.openingFinalized, rev: s.mulliganRevealedHands,
  hands: s.players.map((p) => p.hand.map((c) => c.cardId)),
});

/** 每一步都要成立的不變式。 */
function checkInvariants(tag, s, prev) {
  // ⚠只在 setup 階段檢查。一旦進入 playing 就代表開局已正確結束、結算結果也已被消費，
  //   `openingDone` / `pendingMulliganDraw` 這些欄位不再有意義。
  //   （版本 skew 下舊 client 靠逃生規則走完 setup，它的 openingDone 本來就會是 [true,false]
  //     卻合法進 playing —— 那是正確行為，不是「定案被撤銷」。）
  if (s.phase !== 'setup') return;
  for (const i of [0, 1]) {
    if (prev && prev.phase === 'setup') {
      assert.ok((s.mulliganCounts?.[i] ?? 0) >= (prev.mulliganCounts?.[i] ?? 0),
        `${tag} I2 座位${i} 重抽次數被回朔 ${prev.mulliganCounts?.[i]} → ${s.mulliganCounts?.[i]}`);
      assert.ok(!(prev.openingDone?.[i] === true && s.openingDone?.[i] === false),
        `${tag} I3 座位${i} 已定案又被撤銷 prev=` + JSON.stringify({
          done: prev.openingDone, sd: prev.setupDone, id: prev.id?.slice(0, 6),
          fin: !!prev.openingFinalized, phase: prev.phase })
        + ' now=' + JSON.stringify({ done: s.openingDone, sd: s.setupDone,
          id: s.id?.slice(0, 6), fin: !!s.openingFinalized, phase: s.phase }));
    }
    const rev = (s.mulliganRevealedHands?.[key(i)] ?? []).length;
    assert.equal(rev, s.mulliganCounts?.[i] ?? 0,
      `${tag} I4 座位${i} 揭示筆數(${rev})≠重抽次數(${s.mulliganCounts?.[i]}) ＝ 兩者來自不同快照（縫合怪）`);
    // ⚠只在「該座位還沒放上戰鬥場」時檢查 —— 放場會從手牌移走一張，屬正常。
    if (s.phase === 'setup' && !s.openingFinalized && !s.players[i].active && !s.setupDone?.[i]
        && (s.pendingMulliganDraw?.[i] ?? 0) === 0) {
      assert.equal(s.players[i].hand.length, 7, `${tag} I5 座位${i} 開局手牌不是 7 張`);
    }
  }
  if (s.openingFinalized) {
    // ⚠玩家領過補抽後 pendingMulliganDraw 會降到 0，所以不能斷言「等於」NET 公式。
    //   真正要防的是**超過應得**（＝補抽被重新發放）→ 用上界斷言。
    const [m1, m2] = s.mulliganCounts;
    const net = [Math.max(0, m2 - m1), Math.max(0, m1 - m2)];
    for (const i of [0, 1]) {
      assert.ok((s.pendingMulliganDraw?.[i] ?? 0) <= net[i],
        `${tag} I6 座位${i} 補抽張數 ${s.pendingMulliganDraw?.[i]} 超過官方 NET 公式應得的 ${net[i]}`
        + '（＝補抽被重新發放）');
    }
  }
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

/**
 * 跑一局隨機交錯。
 * @param oldClientSide 模擬舊版 client 的座位（-1 = 都是新版）
 */
function fuzzOne(entriesA, entriesB, oldClientSide) {
  const base = createGame({ name: 'P1', entries: entriesA }, { name: 'P2', entries: entriesB }, pool,
    { firstChoicePreferences: ['random', 'random'] });
  if (base.openingFlow !== 'interactive') return null;      // 這局不含目標卡，跳過
  // 兩端各自的 local state（一開始都是 canonical 局）
  const local = [clone(base), clone(base)];
  const prev = [null, null];
  // 每端推出去的歷史快照（收端可能拿到任何一份 → 模擬亂序／遲到／重複）
  const outbox = [[clone(base)], [clone(base)]];

  for (let step = 0; step < 40; step++) {
    const who = rnd() < 0.5 ? 0 : 1;
    const act = rnd();
    if (act < 0.45) {
      // ① 該端做一個開局選擇（若輪得到）
      const s = local[who];
      if (s.openingChoicePending?.[who]) {
        if (who === oldClientSide) {
          // 舊版 client：不認得 opening，直接放場 + 按準備
          const hand = s.players[who].hand;
          const c = pickPlaceable(hand) ?? hand[0];
          let n = applyAction(s, { type: 'PLACE_ACTIVE', iid: c.iid, senderIdx: who }, pool);
          n = applyAction(n, { type: 'FINISH_SETUP', senderIdx: who }, pool);
          // 舊引擎沒有 gate，這裡用「直接改盤面」模擬它成功放場的結果
          if (!n.players[who].active) {
            n = clone(s);
            n.players[who] = { ...n.players[who], active: { ...c },
              hand: hand.filter((x) => x.iid !== c.iid) };
            n.setupDone = [...n.setupDone]; n.setupDone[who] = true;
          }
          prev[who] = local[who]; local[who] = n;
        } else {
          const type = rnd() < 0.5 ? 'OPENING_KEEP' : 'OPENING_MULLIGAN';
          const n = applyAction(s, { type, senderIdx: who }, pool);
          prev[who] = local[who]; local[who] = n;
        }
        outbox[who].push(clone(local[who]));
      }
    } else if (act < 0.65) {
      // ②「開局定案之後」的 setup 動作 —— 這一段原本沒被 fuzz 涵蓋，正是 R1/R2 的盲點。
      const s2 = local[who];
      let n = s2;
      if (!s2.players[who].active) {
        const c = pickPlaceable(s2.players[who].hand);
        if (c) n = applyAction(s2, { type: 'PLACE_ACTIVE', iid: c.iid, senderIdx: who }, pool);
      } else if ((s2.pendingMulliganDraw?.[who] ?? 0) > 0) {
        n = applyAction(s2, { type: 'MULLIGAN_DRAW_DECISION',
          count: s2.pendingMulliganDraw[who], senderIdx: who }, pool);
      } else if (!s2.mulliganRevealConfirmed?.[who]) {
        n = applyAction(s2, { type: 'CONFIRM_MULLIGAN_REVEAL', senderIdx: who }, pool);
      } else if (!s2.setupDone?.[who]) {
        n = applyAction(s2, { type: 'FINISH_SETUP', senderIdx: who }, pool);
      }
      if (n !== s2) { prev[who] = local[who]; local[who] = n; outbox[who].push(clone(n)); }
    } else {
      // ③ 該端收到對手 outbox 裡的**任意一份**快照（可能是舊的／重複的）
      const box = outbox[1 - who];
      const incoming = clone(pick(box));
      const beforeMerge = local[who];
      const d = resolveRoomUpdate(local[who], incoming, CTX(who));
      if (d.game) {
        // I7：己側盤面不得因合併而回朔（雙定案後尤其不可）
        const lD = effDone(beforeMerge), iD = effDone(incoming);
        // ⚠只在真的走 merge-setup 且仍停在 setup 時檢查：
        //   ・`adopt`（不同 id 的局）本來就該整份採用
        //   ・進 playing 時 tryAdvanceToPlaying 會抽牌，players 當然會變
        if (d.kind === 'merge-setup' && d.game.phase === 'setup' && lD[who] && iD[who]) {
          assert.deepEqual(d.game.players[who], beforeMerge.players[who],
            `step${step}/端${who} I7 己側盤面被合併回朔（開局已雙定案，己側必須恆用本地）`);
        }
        prev[who] = local[who]; local[who] = d.game; outbox[who].push(clone(d.game));
      }
    }
    for (const i of [0, 1]) if (local[i]) checkInvariants(`step${step}/端${i}`, local[i], prev[i]);
  }
  // ── 收斂階段：讓兩端把還沒定案的選擇做完，並互相同步到穩定 ──
  for (let r = 0; r < 30; r++) {
    for (const i of [0, 1]) {
      if (local[i].openingChoicePending?.[i] && i !== oldClientSide) {
        prev[i] = local[i];
        local[i] = applyAction(local[i], { type: 'OPENING_KEEP', senderIdx: i }, pool);
      }
    }
    for (const i of [0, 1]) {
      const d = resolveRoomUpdate(local[i], clone(local[1 - i]), CTX(i));
      if (d.game) { prev[i] = local[i]; local[i] = d.game; }
      checkInvariants(`收斂r${r}/端${i}`, local[i], prev[i]);
    }
  }
  return { local, oldClientSide };
}

T('⭐⭐fuzz A：雙方都只有閃焰王牌，600 種隨機交錯（含亂序／重複／遲到快照）', () => {
  let ran = 0;
  for (let n = 0; n < 600; n++) {
    seed = n * 7919 + 13;
    const r = fuzzOne(burstOnly, burstOnly, -1);
    if (!r) continue;
    ran++;
    const [a, b] = r.local;
    assert.ok(!isOpeningInProgress(a) && !isOpeningInProgress(b), `#${n} 收斂後仍卡在開局`);
    assert.equal(fp(a), fp(b), `#${n} C1 兩端開局結果不一致`);
  }
  assert.ok(ran >= 500, `實際跑到的局數太少：${ran}`);
});

T('⭐⭐fuzz B：一方混合牌組（可能自動 mulligan），600 種隨機交錯', () => {
  let ran = 0;
  for (let n = 0; n < 600; n++) {
    seed = n * 104729 + 7;
    const r = fuzzOne(mixed, burstOnly, -1);
    if (!r) continue;
    ran++;
    const [a, b] = r.local;
    assert.equal(fp(a), fp(b), `#${n} C1 兩端開局結果不一致`);
  }
  assert.ok(ran >= 400, `實際跑到的局數太少：${ran}`);
});

T('⭐⭐fuzz C：版本 skew — 其中一端是舊版 client（直接放場＋按準備），400 種交錯', () => {
  let ran = 0;
  for (let n = 0; n < 400; n++) {
    seed = n * 15485863 + 3;
    const oldSide = n % 2;
    const r = fuzzOne(burstOnly, burstOnly, oldSide);
    if (!r) continue;
    ran++;
    const [a, b] = r.local;
    // 舊 client 端不會送 OPENING_*，新端必須靠逃生規則收斂、不得死結
    assert.ok(!isOpeningInProgress(a), `#${n} 端0 被自己的 opening gate 卡死（setup 沒有自癒）`);
    assert.ok(!isOpeningInProgress(b), `#${n} 端1 被自己的 opening gate 卡死`);
  }
  assert.ok(ran >= 300, `實際跑到的局數太少：${ran}`);
});

T('⭐⭐收斂後一定能走完 setup 進到 playing（不卡死）', () => {
  let done = 0;
  for (let n = 0; n < 120; n++) {
    seed = n * 2654435761 + 11;
    const r = fuzzOne(burstOnly, burstOnly, -1);
    if (!r) continue;
    let s = r.local[0];
    // 雙方擺場 → 準備 → 處理揭示確認與補抽 → 應進 playing
    for (let round = 0; round < 12 && s.phase === 'setup'; round++) {
      for (const i of [0, 1]) {
        if (!s.players[i].active) {
          const c = pickPlaceable(s.players[i].hand);
          if (c) s = applyAction(s, { type: 'PLACE_ACTIVE', iid: c.iid, senderIdx: i }, pool);
        }
        if (!s.setupDone[i]) s = applyAction(s, { type: 'FINISH_SETUP', senderIdx: i }, pool);
        if (!s.mulliganRevealConfirmed?.[i]) s = applyAction(s, { type: 'CONFIRM_MULLIGAN_REVEAL', senderIdx: i }, pool);
        const nd = s.pendingMulliganDraw?.[i] ?? 0;
        if (nd > 0) s = applyAction(s, { type: 'MULLIGAN_DRAW_DECISION', count: nd, senderIdx: i }, pool);
        if (s.mulliganPostBenchOpen?.[i]) s = applyAction(s, { type: 'FINISH_MULLIGAN_POST_BENCH', senderIdx: i }, pool);
      }
    }
    assert.equal(s.phase, 'playing', `#${n} C2 走不完 setup。狀態＝`
      + JSON.stringify({ setupDone: s.setupDone, openingDone: s.openingDone,
          pend: s.openingChoicePending, fin: !!s.openingFinalized,
          draw: s.pendingMulliganDraw, conf: s.mulliganRevealConfirmed,
          mpb: s.mulliganPostBenchOpen, counts: s.mulliganCounts,
          active: s.players.map((p) => !!p.active) }));
    done++;
  }
  assert.ok(done >= 100, `實際跑到的局數太少：${done}`);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
