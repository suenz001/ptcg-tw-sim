// ⭐⭐⭐ v6.419 守衛：「雙方同時取完最後一張獎賞」不論有沒有開 picker，都必須是**平手**。
//
// 【站長裁定】v6.418 收尾時（fable 5.1 獨立審查抓到、我自行查證屬實）發現：
//   ・雙方都**沒有**正面朝上的獎賞（不開 picker，兩邊同步自動取）
//       ⇒ 走 v6.361 中央判定 ⇒ **平手**。✅
//   ・雙方都**有**正面朝上的獎賞（開 picker）
//       ⇒ `takeSpecificPrizes` 取光時自己寫死 `winner: ownerIdx`、繞過中央判定，
//         對手排在 `pendingChainQueue` 裡的那一筆永遠不會被兌現
//       ⇒ 變成「先取完的那一方獲勝」。❌
//   ⚠ **BASE v6.418 與更早的 v6.417 都錯**（只是勝方剛好相反）⇒ 不是回歸，是既有 bug。
//   站長裁示：**統一成平手**（與他自己在 v6.361 定的 D-10／D-11 一致），
//   並一併處理「終局之後仍會浮出一個點不動的 picker」。
//
// 【修法】engine：
//   ① `v6419-settle-queued-prizes`（applyActionImpl 末端、中央判定之前）：
//      終局判出來時若佇列裡還有沒兌現的 `take-prize-choose`
//      ⇒ `liftEndgameForOnKoV6361` 收回終局 → 結清那幾筆 → 交給中央判定重判。
//   ② `v6419-no-pop-after-gameover`：終局之後不再把佇列裡的 picker 浮上檯面。
//
// 【HEAD-FAIL】BASE（v6.418）上 10 條紅（A1／A3／B1／C1／D1／D2／E1～E4 之中不含零回歸那幾條）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x419-s.js'), E = join(ROOT, '.x419-e.ts'), O = join(ROOT, '.x419-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const M = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const cards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (!c || c.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark || '')) cards.push(c);
  }
}
const byAb = (n) => cards.find((c) => (c.abilities || []).some((x) => x.name === n));
const GENGAR = byAb('死亡宣告');
const HIDE = byAb('化隱');
const WHEEL = cards.find((c) => c.name === '破破舵輪' && (c.attacks || []).some((a) => a.name === '悔念錨'));
const PLAIN = cards.find((c) => c.supertype === 'Pokemon' && Number(c.hp) >= 100
  && !(c.abilities || []).length && !c.name.includes('超級'));
assert.ok(GENGAR && WHEEL && HIDE && PLAIN, '測試用卡沒挑齊');

let n = 0, pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const KANJI = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const en = (t = 'Colorless') => {
  const e = cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic'
    && (c.energyType === t || (c.name || '').includes(KANJI[t] || '草')))
    || cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic');
  return { iid: 'e' + (++n), cardId: String(e.id), damage: 0, energyAttached: [] };
};
const ai = (WHEEL.attacks || []).findIndex((a) => a.name === '悔念錨');

/**
 * 破破舵輪｜悔念錨打死耿鬼ex（ex ⇒ 攻擊方取 2 張）；死亡宣告擲到正面 ⇒ 破破舵輪昏厥
 * （非 ex ⇒ 耿鬼方取 1 張）。`p0/p1` 是雙方剩餘獎賞張數，`faceUp` 決定會不會開 picker。
 * 開了 picker 就一路解到底（一律選第一個候選）。
 */
function fire(p0, p1, faceUp) {
  for (let k = 0; k < 40; k++) {
    const es = (WHEEL.attacks[ai].cost || []).map((t) => en(t));
    for (let j = 0; j < 3; j++) es.push(en());
    const discard = [inst(HIDE.id), inst(HIDE.id), inst(HIDE.id), inst(HIDE.id)];
    const mkPrizes = (cnt) => Array.from({ length: cnt }, (_, i) => inst(PLAIN.id, [], (faceUp && i === 0) ? { faceUp: true } : {}));
    const P0 = { name: 'ATK', active: inst(WHEEL.id, es), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id)], discard, prizes: mkPrizes(p0) };
    const P1 = { name: 'GEN', active: inst(GENGAR.id, [en('Darkness')], { damage: 240 }), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id)], discard: [], prizes: mkPrizes(p1) };
    let st = {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
      isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null, players: [P0, P1],
    };
    const o = M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool);
    st = o?.state ?? o;
    const logs = () => (st.log || []).map((l) => (typeof l === 'string' ? l : l.message));
    if (!logs().some((L) => /死亡宣告/.test(L) && /正面/.test(L))) continue;
    const steps = [{ ...st }];
    for (let step = 0; step < 6 && st.pendingSelection; step++) {
      const opt = (st.pendingSelection.params?.options ?? [])[0]?.id;
      if (!opt) break;
      const r = M.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [opt] }, pool);
      const nx = r?.state ?? r;
      if (nx === st) break;
      st = nx; steps.push({ ...st });
    }
    return { st, steps, logs: logs(), tries: k + 1 };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// 【A】核心：雙方同時取完 ⇒ 平手（有沒有 picker 都一樣）
// ══════════════════════════════════════════════════════════════════════════════
T('A0. 前置：死亡宣告擲到正面、破破舵輪確實昏厥（否則下面是空真）', () => {
  const r = fire(2, 1, true);
  assert.ok(r, '40 次都沒擲到正面');
  assert.ok(r.logs.some((L) => /死亡宣告/.test(L) && /昏厥/.test(L)), '死亡宣告沒有讓攻擊方昏厥');
});
T('A1. ⭐⭐⭐【HEAD-FAIL】雙方都有正面朝上的獎賞（開 picker）⇒ **平手**', () => {
  const r = fire(2, 1, true);
  assert.ok(r, '前置不成立');
  assert.strictEqual(r.st.phase, 'game-over', '沒有終局');
  assert.strictEqual(r.st.isDraw, true, `應該平手，實得 winner=${r.st.winner} isDraw=${r.st.isDraw}`);
  assert.ok(r.st.winner === null || r.st.winner === undefined, `平手時不該有 winner（實得 ${r.st.winner}）`);
  assert.strictEqual(r.st.players[0].prizes.length, 0, '攻擊方的獎賞沒取完');
  assert.strictEqual(r.st.players[1].prizes.length, 0, '⭐ 對手排在佇列裡的那一筆沒有被兌現');
  assert.ok(r.logs.some((L) => /平手/.test(L)), '沒有平手的對戰記錄');
});
T('A2.【零回歸】雙方都沒有正面朝上的獎賞（不開 picker）⇒ 仍然平手（v6.361 行為不得改）', () => {
  const r = fire(2, 1, false);
  assert.ok(r, '前置不成立');
  assert.strictEqual(r.st.isDraw, true, `應該平手，實得 winner=${r.st.winner}`);
});
T('A3. ⭐⭐【HEAD-FAIL】兩條路徑**同解**（有沒有 picker 不得改變勝負）', () => {
  const a = fire(2, 1, false), b = fire(2, 1, true);
  assert.ok(a && b, '前置不成立');
  assert.strictEqual(a.st.isDraw, b.st.isDraw, `無 picker isDraw=${a.st.isDraw} vs 有 picker isDraw=${b.st.isDraw}`);
  assert.strictEqual(a.st.winner ?? null, b.st.winner ?? null, `winner ${a.st.winner} vs ${b.st.winner}`);
  assert.strictEqual(a.st.winReason, b.st.winReason, `winReason「${a.st.winReason}」vs「${b.st.winReason}」`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【B】零回歸：只有一方取完時**仍然正常判勝**（防止過度修正成「一律平手」）
// ══════════════════════════════════════════════════════════════════════════════
T('B1. 只有攻擊方取完（對手還有獎賞）⇒ 攻擊方獲勝，不是平手', () => {
  const r = fire(2, 3, true);   // 耿鬼方 3 張、只取 1 ⇒ 兌現後仍剩 2
  assert.ok(r, '前置不成立');
  assert.strictEqual(r.st.phase, 'game-over', '沒有終局');
  assert.strictEqual(r.st.winner, 0, `應該是攻擊方獲勝，實得 winner=${r.st.winner} isDraw=${r.st.isDraw}`);
  assert.ok(!r.st.isDraw, '不該是平手');
  assert.strictEqual(r.st.players[1].prizes.length, 2, `對手的獎賞應該被兌現 1 張（3→2），實得剩 ${r.st.players[1].prizes.length}`);
});
T('B2. 只有耿鬼方取完（攻擊方還有獎賞）⇒ 耿鬼方獲勝', () => {
  const r = fire(3, 1, true);   // 攻擊方 3 張、取 2 ⇒ 剩 1；耿鬼方 1 張、取 1 ⇒ 取完
  assert.ok(r, '前置不成立');
  assert.strictEqual(r.st.phase, 'game-over', '沒有終局');
  assert.strictEqual(r.st.winner, 1, `應該是耿鬼方獲勝，實得 winner=${r.st.winner} isDraw=${r.st.isDraw}`);
  assert.strictEqual(r.st.players[0].prizes.length, 1, '攻擊方應該還剩 1 張');
});
T('B3.【零回歸】沒有終局的一般情形：兩個 picker 依序解（v6.418 的排隊行為不得被打斷）', () => {
  const r = fire(4, 3, true);
  assert.ok(r, '前置不成立');
  assert.strictEqual(r.steps[0].pendingSelection?.actorIdx, 0, '第一個 picker 不是攻擊方的');
  assert.strictEqual((r.steps[0].pendingChainQueue ?? []).length, 1, '耿鬼方的 picker 沒有排進佇列');
  assert.strictEqual(r.steps[1]?.pendingSelection?.actorIdx, 1, '解完第一個之後耿鬼方的 picker 沒有浮上來');
  assert.strictEqual(r.st.phase, 'playing', '不該終局');
  assert.strictEqual(r.st.players[0].prizes.length, 2, '攻擊方應該取 2 張（4→2）');
  assert.strictEqual(r.st.players[1].prizes.length, 2, '耿鬼方應該取 1 張（3→2）');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【C】終局之後不再浮出點不動的 picker
// ══════════════════════════════════════════════════════════════════════════════
T('C1. ⭐⭐【HEAD-FAIL】終局之後 pendingSelection 必須是空的（不留一層點不掉的暗幕）', () => {
  for (const [p0, p1, tag] of [[2, 1, '雙方同時取完'], [2, 3, '只有攻擊方取完'], [3, 1, '只有耿鬼方取完']]) {
    const r = fire(p0, p1, true);
    assert.ok(r, '前置不成立');
    assert.strictEqual(r.st.phase, 'game-over', `${tag}：沒有終局`);
    assert.ok(!r.st.pendingSelection, `${tag}：終局後還留著 picker（${r.st.pendingSelection?.effectKey}@${r.st.pendingSelection?.actorIdx}）`);
  }
});
T('C2.【零回歸】對局進行中仍然會把佇列裡的 picker 浮上來（C1 不是把機制關掉）', () => {
  const r = fire(4, 3, true);
  assert.ok(r, '前置不成立');
  assert.strictEqual(r.steps[1]?.pendingSelection?.effectKey, 'take-prize-choose', '進行中的排隊機制被關掉了');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【D】靜態接線（含正對照）
// ══════════════════════════════════════════════════════════════════════════════
const ENG_RAW = normEol(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));   // 哨兵是註解 ⇒ 這一份不剝
const ENG = stripCommentsBlankChecked(ENG_RAW, 'engine.ts');                            // 判斷程式碼用這一份
/** ⭐ 判準只寫一份（Rule 38）：D1（正式）與 D3（正對照）共用。 */
const popHasPhaseGate = (src) => {
  const a = src.indexOf('newState.pendingChainQueue.length > 0) {');
  if (a < 0) return { found: false };
  const line = src.slice(src.lastIndexOf('\n', a) + 1, a + 40);
  return { found: true, gated: /newState\.phase === 'playing'\s*&&/.test(line), line: line.trim() };
};
T('D1. ⭐⭐【HEAD-FAIL】佇列取出的前置條件含 `phase === \'playing\'`', () => {
  const g = popHasPhaseGate(ENG);
  assert.ok(g.found, 'anchor 失效（pop 迴圈的條件被改寫了？）');
  assert.ok(g.gated, '終局後仍會浮出 picker：' + g.line);
});
T('D2. ⭐⭐【HEAD-FAIL】終局前先結清佇列中的取獎賞（走中央 lift + 中央判定）', () => {
  const i = ENG_RAW.indexOf('>>> v6419-settle-queued-prizes');
  assert.ok(i > 0, 'v6419-settle-queued-prizes 哨兵不見了');
  const end = ENG_RAW.indexOf('<<< v6419-settle-queued-prizes', i);
  assert.ok(end > i, '哨兵不成對');
  const blk = ENG_RAW.slice(i, end);
  assert.ok(blk.length > 400 && blk.length < 4000, `哨兵區塊長度異常（${blk.length}）`);
  assert.ok(/liftEndgameForOnKoV6361\(/.test(blk), '沒有走中央的終局收回（liftEndgameForOnKoV6361）');
  assert.ok(/takeSpecificPrizes\(/.test(blk), '沒有實際結清佇列裡的取獎賞');
  // ⚠ 這一行原本用未剝註解的 ENG_RAW ⇒ 註解裡就有 'take-prize-choose'，是安慰劑（審查者實測：
  //   把過濾改成「全部 effectKey」照樣綠）。改用剝註解後的 ENG，行為端另由【E】段的 E1 守。
  const codeBlk = ENG.slice(ENG.indexOf('_v6419Owed'), ENG.indexOf('_v6419Owed') + 1200);
  assert.ok(codeBlk.length > 200, 'v6419 的程式碼切片抓不到（剝註解後 anchor 失效）');
  assert.ok(/'take-prize-choose'/.test(codeBlk), '程式碼（不是註解）裡沒有針對 take-prize-choose 過濾');
  assert.ok(/params\?\.remaining/.test(codeBlk), '沒有讀 params.remaining（會忽略該取幾張）');
  // ⚠ 必須排在中央判定**之前**，否則重判不會發生
  const j = ENG_RAW.indexOf('>>> v6361-central-endgame-apply');
  assert.ok(j > i, `v6419 區塊必須排在中央判定之前（v6419@${i} vs v6361@${j}）`);
});
T('D3.【正對照】D1 的判準抓得到「沒有 phase 前置」的樣本（不是恆真）', () => {
  const bad = "    if (!newState.pendingSelection && newState.pendingChainQueue && newState.pendingChainQueue.length > 0) {";
  const good = "    if (newState.phase === 'playing' && !newState.pendingSelection && newState.pendingChainQueue && newState.pendingChainQueue.length > 0) {";
  assert.strictEqual(popHasPhaseGate(bad).gated, false, 'D1 的判準壞了：沒有前置的樣本竟然算過');
  assert.strictEqual(popHasPhaseGate(good).gated, true, 'D1 的判準壞了：正確寫法被誤判');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【E】⭐⭐ 直接構盤面的行為端邊界（審查者突變測試 M3／M10 抓到的兩個守衛洞）
//   ⚠ 這兩條的前身是 D2 的靜態斷言 —— 靜態擋不住「過濾條件被放寬」與「remaining 被忽略」，
//     因為 A～C 段的情境剛好每次都只欠 1 張、佇列裡剛好只有取獎賞。
// ══════════════════════════════════════════════════════════════════════════════
let _e = 0;
const einst = (cid, x = {}) => ({ iid: 'E' + (++_e), cardId: String(cid), damage: 0, energyAttached: [], ...x });
/** 乾淨盤面：P0 剩 `p0` 張獎賞（第 1 張 faceUp）、P1 剩 `p1` 張（第 1 張 faceUp），雙方都有戰鬥寶可夢。 */
function craft(p0, p1, queued) {
  const mkP = (name, cnt) => ({
    name, active: einst(PLAIN.id), bench: [einst(PLAIN.id)], hand: [], deck: [einst(PLAIN.id)], discard: [],
    prizes: Array.from({ length: cnt }, (_, i) => einst(PLAIN.id, i === 0 ? { faceUp: true } : {})),
  });
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], activeStadium: null, players: [mkP('ATK', p0), mkP('GEN', p1)],
    pendingSelection: null, pendingChainQueue: queued ? [queued] : undefined,
  };
  const opts = st.players[0].prizes.filter((c) => c.faceUp).map((c) => ({ id: c.iid, text: 'face' }));
  if (st.players[0].prizes.some((c) => !c.faceUp)) opts.push({ id: '__prize_random_facedown__', text: 'back' });
  st.pendingSelection = {
    type: 'modal-choice', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1,
    effectKey: 'take-prize-choose', params: { remaining: p0, options: opts },
  };
  const o = M.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [opts[0].id] }, pool);
  return o?.state ?? o;
}
const prizeSel = (owner, remaining) => ({
  type: 'modal-choice', actorIdx: owner, sourcePlayerIdx: owner, minCount: 1, maxCount: 1,
  effectKey: 'take-prize-choose', params: { remaining, options: [{ id: 'stale', text: '舊' }] },
});
const otherSel = (owner) => ({
  type: 'modal-choice', actorIdx: owner, sourcePlayerIdx: owner, minCount: 1, maxCount: 1,
  effectKey: '__v6419_other_picker__', params: { options: [{ id: 'a', text: 'a' }] },
});
T('E0. 前置：構出來的盤面真的會在 RESOLVE 之後終局（否則 E1／E2 是空真）', () => {
  const st = craft(1, 2, null);
  assert.strictEqual(st.phase, 'game-over', `沒有終局（pz=${st.players[0].prizes.length}/${st.players[1].prizes.length}）`);
  assert.strictEqual(st.winner, 0, `應該是 ATK 獲勝，實得 ${st.winner}`);
});
T('E1. ⭐⭐【M3】結清只准挑 take-prize-choose —— 佇列裡**別的** picker 不得被動到', () => {
  const st = craft(1, 2, otherSel(1));
  assert.strictEqual(st.phase, 'game-over', '沒有終局');
  assert.strictEqual(st.winner, 0, `別人的 picker 被當成取獎賞結清了（winner=${st.winner} isDraw=${st.isDraw}）`);
  assert.strictEqual(st.players[1].prizes.length, 2, '對手的獎賞被白白取走了');
  const q = st.pendingChainQueue ?? [];
  assert.ok(q.some((x) => x.effectKey === '__v6419_other_picker__'), '佇列裡別人的 picker 不見了');
});
T('E2. ⭐⭐【M10】結清要照 `remaining` 取足張數（不是固定取 1 張）', () => {
  const st = craft(1, 2, prizeSel(1, 2));   // 對手欠 2 張、手上剛好 2 張 ⇒ 結清後雙方都 0 ⇒ 平手
  assert.strictEqual(st.phase, 'game-over', '沒有終局');
  assert.strictEqual(st.players[1].prizes.length, 0,
    `對手欠 2 張卻只結清了 ${2 - st.players[1].prizes.length} 張（remaining 被忽略）`);
  assert.strictEqual(st.isDraw, true, `雙方都取完應該平手，實得 winner=${st.winner}`);
});
T('E3.【對照】對手欠 1 張、手上有 2 張 ⇒ 結清後仍有剩 ⇒ 不是平手（E2 不是恆真）', () => {
  const st = craft(1, 2, prizeSel(1, 1));
  assert.strictEqual(st.phase, 'game-over', '沒有終局');
  assert.strictEqual(st.players[1].prizes.length, 1, `應該只結清 1 張，實得剩 ${st.players[1].prizes.length}`);
  assert.strictEqual(st.winner, 0, `應該是 ATK 獲勝，實得 winner=${st.winner} isDraw=${st.isDraw}`);
});
T('E4. ⭐⭐【審查者 (a)】只有一方有正面朝上的獎賞時，檯面上那一筆也要結清（四格一致）', () => {
  // 檯面上是 P1 的取獎賞、P0 已經取完（用 craft 的另一種擺法不好造，改用 fire 的四格對照）
  const out = [[false, false], [true, false], [false, true], [true, true]].map(([f0, f1]) => {
    for (let k = 0; k < 40; k++) {
      const es = (WHEEL.attacks[ai].cost || []).map((t) => en(t));
      for (let j = 0; j < 3; j++) es.push(en());
      const mk = (cnt, fu) => Array.from({ length: cnt }, (_, i) => inst(PLAIN.id, [], (fu && i === 0) ? { faceUp: true } : {}));
      const P0 = { name: 'ATK', active: inst(WHEEL.id, es), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id)], discard: [inst(HIDE.id), inst(HIDE.id), inst(HIDE.id), inst(HIDE.id)], prizes: mk(2, f0) };
      const P1 = { name: 'GEN', active: inst(GENGAR.id, [en('Darkness')], { damage: 240 }), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id)], discard: [], prizes: mk(1, f1) };
      let st = { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null, players: [P0, P1] };
      const o = M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool);
      st = o?.state ?? o;
      const lg = (st.log || []).map((l) => (typeof l === 'string' ? l : l.message));
      if (!lg.some((L) => /死亡宣告/.test(L) && /正面/.test(L))) continue;
      for (let step = 0; step < 6 && st.pendingSelection; step++) {
        const opt = (st.pendingSelection.params?.options ?? [])[0]?.id;
        if (!opt) break;
        const r = M.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [opt] }, pool);
        const nx = r?.state ?? r;
        if (nx === st) break;
        st = nx;
      }
      return { draw: st.isDraw === true, winner: st.winner ?? null, pend: st.pendingSelection?.effectKey ?? null, q: (st.pendingChainQueue ?? []).length };
    }
    return null;
  });
  assert.ok(out.every(Boolean), '40 次都沒擲到正面');
  const key = (x) => `${x.draw}/${x.winner}`;
  assert.strictEqual(new Set(out.map(key)).size, 1,
    '四種「誰的獎賞翻正面」組合給出不同勝負：' + JSON.stringify(out));
  assert.ok(out.every((x) => x.draw === true), '同時取完應該全部平手：' + JSON.stringify(out));
  assert.ok(out.every((x) => x.pend === null && x.q === 0), '終局後還有殘留的 picker／佇列：' + JSON.stringify(out));
});

console.log(`\n=== v6.419 同時取完 ⇒ 平手：${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
