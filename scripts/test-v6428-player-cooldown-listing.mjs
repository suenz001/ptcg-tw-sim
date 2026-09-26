// 守衛 v6.428：玩家層級招式冷卻（仙子伊布ex｜天仙石、騎拉帝納｜渾沌匍匐）
//   「招式可用清單」與「真的出招」必須用同一個判準（Rule 38）。
//
// 【bug】卡面：「在上個自己的回合，若自己的寶可夢使出了『天仙石』，則無法使用這個招式。」
//   v5.967 起冷卻只寫在 ATTACK handler 裡 ⇒ getAvailableAttacks 仍把它列為可用 ⇒
//   招式按鈕亮著、按下去才被擋；AI 也會把它當候選（批次 B2 診斷抓到）。
// 【修法】中央述詞 isPlayerLevelAttackOnCooldown，ATTACK handler 與 getAvailableAttacks 共用。
//
// HEAD-FAIL（2026-09-26 手動實測）：engine.ts 換回 BASE 2f4e3801 的 blob 後，
//   A1／A3／B1／C1 紅（清單仍列出冷卻中的招式、AI 送出必被擋的 ATTACK）、D1／D2 紅（述詞不存在）、
//   E0／E1／E3 紅（清單仍列出；E1 另驗「離場後仍冷卻」——fable 審查追加，只讀實體蓋章的版本也會紅；
//   E3 驗遊戲層級紀錄要比對招式名——fable 複審追加），其餘綠（共 9 紅 5 綠）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-v6428-s.js'), E = join(ROOT, '.x-v6428-e.ts'), O = join(ROOT, '.x-v6428-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export * as ENG from './src/lib/game/engine';\n"
  + "export { getAIAction } from './src/lib/game/ai';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ENG, getAIAction } = await import(pathToFileURL(O).href);
const { createGame, applyAction, getAvailableAttacks } = ENG;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// 卡片事實一律取自 static/cards（台灣官方卡面）
const SYLVEON = '16770';    // 仙子伊布ex：魔法魅惑［超無無］／天仙石［水雷超］
const GIRATINA = '19581';   // 騎拉帝納：渾沌匍匐［超超無］
const FILLER = '17038';     // 卡比獸（基礎、無特性）
const EN = { W: '18519', L: '18520', P: '14103' };
const sy = pool.get(SYLVEON), gi = pool.get(GIRATINA);
assert.ok(sy && gi, '找不到測試用卡（卡池變了？）');
const IDX_CHARM = sy.attacks.findIndex((a) => a.name === '魔法魅惑');
const IDX_STONE = sy.attacks.findIndex((a) => a.name === '天仙石');
const IDX_CRAWL = gi.attacks.findIndex((a) => a.name === '渾沌匍匐');
assert.ok(IDX_CHARM >= 0 && IDX_STONE >= 0 && IDX_CRAWL >= 0, '招式名對不上卡面');
assert.ok(/自己的寶可夢使出了「天仙石」，則無法使用這個招式/.test(sy.attacks[IDX_STONE].effect), '天仙石卡面措辭變了，請重新查證');

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'v' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (k) => inst(EN[k]);
/** 我方戰鬥位＝attacker（能量足夠）；可指定戰鬥位／備戰的冷卻蓋章。 */
function mk(attackerId, energies, { activeStamp, benchStamp, activeExtra = {} } = {}) {
  const s = createGame({ name: 'P1', entries: [{ cardId: FILLER, count: 1 }] },
    { name: 'P2', entries: [{ cardId: FILLER, count: 1 }] }, pool);
  const bench0 = inst(FILLER, [], benchStamp ? { attackUsedLastSelfTurn: benchStamp } : {});
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 4,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: Array.from({ length: 8 }, () => inst(FILLER)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(FILLER)),
        active: inst(attackerId, energies.map(en), { ...(activeStamp ? { attackUsedLastSelfTurn: activeStamp } : {}), ...activeExtra }),
        bench: [bench0], energyAttachedThisTurn: true },
      { ...s.players[1], hand: [], deck: Array.from({ length: 8 }, () => inst(FILLER)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(FILLER)),
        active: inst(FILLER), bench: [inst(FILLER), inst(FILLER)] }] };
}

let pass = 0, fail = 0;
const failed = [];
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n); } };

// ── A：天仙石 ────────────────────────────────────────────────────────────────
T('A0 正對照：沒有冷卻時，天仙石與魔法魅惑都列為可用', () => {
  const av = getAvailableAttacks(mk(SYLVEON, ['W', 'L', 'P']), pool);
  assert.ok(av.includes(IDX_STONE) && av.includes(IDX_CHARM), JSON.stringify(av));
});
T('A1 ⭐ 戰鬥位上個自己的回合用過天仙石 ⇒ 清單不列天仙石（魔法魅惑照列）', () => {
  const av = getAvailableAttacks(mk(SYLVEON, ['W', 'L', 'P'], { activeStamp: '天仙石' }), pool);
  assert.ok(!av.includes(IDX_STONE), '天仙石仍列為可用：' + JSON.stringify(av));
  assert.ok(av.includes(IDX_CHARM), '不可以連別的招一起擋掉：' + JSON.stringify(av));
});
T('A2 正對照：蓋章的是別招（魔法魅惑）⇒ 天仙石照列（比對的是招式名），魔法魅惑也照列（不在冷卻清單）', () => {
  const av = getAvailableAttacks(mk(SYLVEON, ['W', 'L', 'P'], { activeStamp: '魔法魅惑' }), pool);
  assert.ok(av.includes(IDX_STONE), JSON.stringify(av));
  assert.ok(av.includes(IDX_CHARM), '上回合用過一般招式不可以被擋：' + JSON.stringify(av));
});
T('A3 ⭐ 玩家層級：備戰寶可夢上個自己的回合用過天仙石 ⇒ 戰鬥位的天仙石也不列（卡面主詞「自己的寶可夢」）', () => {
  const av = getAvailableAttacks(mk(SYLVEON, ['W', 'L', 'P'], { benchStamp: '天仙石' }), pool);
  assert.ok(!av.includes(IDX_STONE), JSON.stringify(av));
});
T('A4 ATTACK handler 仍然擋下（送出冷卻中的天仙石 ⇒ 記錄「無法使用」、對手備戰不變）', () => {
  const st = mk(SYLVEON, ['W', 'L', 'P'], { activeStamp: '天仙石' });
  const nx = applyAction(st, { type: 'ATTACK', attackIndex: IDX_STONE }, pool);
  const msg = String(nx.log?.[nx.log.length - 1]?.message ?? '');
  assert.ok(/無法使用/.test(msg), '最後一則 log：' + msg);
  assert.equal(nx.players[1].bench.length, 2, '天仙石的效果不可以發動');
  assert.ok(!nx.pendingSelection, '不可以開出天仙石的選擇視窗');
});

// ── B：渾沌匍匐（同一條規則的第二張卡）───────────────────────────────────────
T('B0 正對照：沒有冷卻時渾沌匍匐列為可用', () => {
  assert.ok(getAvailableAttacks(mk(GIRATINA, ['P', 'P', 'P']), pool).includes(IDX_CRAWL));
});
T('B1 ⭐ 上個自己的回合用過渾沌匍匐 ⇒ 清單不列', () => {
  assert.ok(!getAvailableAttacks(mk(GIRATINA, ['P', 'P', 'P'], { benchStamp: '渾沌匍匐' }), pool).includes(IDX_CRAWL));
});

// ── C：AI 不再送出必被擋的 ATTACK ─────────────────────────────────────────────
T('C1 ⭐ 唯一可用的招是冷卻中的天仙石 ⇒ AI 不送 ATTACK 天仙石', () => {
  // 魔法魅惑用「單招下回合禁用」擋掉，讓天仙石成為唯一候選（修前 AI 會一直送它、引擎一直擋）
  const st = mk(SYLVEON, ['W', 'L', 'P'], { activeStamp: '天仙石', activeExtra: { blockedAttackNamesThisTurn: ['魔法魅惑'] } });
  const act = getAIAction(st, pool, 0);
  assert.ok(!(act?.type === 'ATTACK' && act.attackIndex === IDX_STONE), 'AI 仍送出：' + JSON.stringify(act));
});

// ── E：真流程（fable 審查追加）——用過的那一隻離場後，冷卻仍然有效 ───────────────
/** 從目前盤面推進到「我方（0）下一個主階段」：待選擇交給 AI、對手回合直接結束。 */
function toMyNextMain(st0) {
  let st = st0; const startTurn = st0.turn;
  for (let i = 0; i < 300; i++) {
    if (st.phase === 'game-over') throw new Error('對局提前結束');
    if (st.pendingSelection) { st = applyAction(st, getAIAction(st, pool, st.pendingSelection.actorIdx), pool); continue; }
    // 有一方戰鬥位被擊倒 ⇒ 交給那一方的 AI 派出新的戰鬥寶可夢
    const need = [0, 1].find((i) => st.players[i].active === null && st.players[i].bench.length > 0);
    if (need !== undefined) { st = applyAction(st, getAIAction(st, pool, need), pool); continue; }
    if (st.activePlayerIndex === 0 && st.turnPhase === 'main' && st.turn > startTurn) return st;
    if (st.turnPhase === 'main') { st = applyAction(st, { type: 'END_TURN' }, pool); continue; }
    const a = getAIAction(st, pool, st.activePlayerIndex);
    const nx = a ? applyAction(st, a, pool) : st;
    if (nx === st) st = applyAction(st, { type: 'END_TURN' }, pool); else st = nx;
  }
  throw new Error('推進失敗');
}
let E_AFTER = null;
T('E0 真流程：使出天仙石 → 下個自己的回合，天仙石不列（戰鬥位還是牠）', () => {
  const st = mk(SYLVEON, ['W', 'L', 'P']);
  const a = applyAction(st, { type: 'ATTACK', attackIndex: IDX_STONE }, pool);
  assert.ok(a !== st, '天仙石沒有打出去');
  E_AFTER = toMyNextMain(a);
  assert.ok(!getAvailableAttacks(E_AFTER, pool).includes(IDX_STONE));
});
T('E1 ⭐ 用過的那一隻已離場（昏厥進棄牌區、第二張仙子伊布ex 上場）⇒ 天仙石仍不列、送出也被擋', () => {
  assert.ok(E_AFTER, 'E0 沒有產生盤面');
  const me = E_AFTER.players[0];
  const second = inst(SYLVEON, ['W', 'L', 'P'].map(en));   // 第二張，身上沒有任何蓋章
  const st = { ...E_AFTER, players: [{ ...me, active: second, discard: [...me.discard, { ...me.active }] }, E_AFTER.players[1]] };
  assert.ok(!getAvailableAttacks(st, pool).includes(IDX_STONE), '離場後冷卻被繞過（天仙石仍列為可用）');
  const nx = applyAction(st, { type: 'ATTACK', attackIndex: IDX_STONE }, pool);
  assert.ok(/無法使用/.test(String(nx.log?.[nx.log.length - 1]?.message ?? '')), '送出沒有被擋');
  assert.equal(ENG.isPlayerLevelAttackOnCooldown(st, 1, '天仙石'), false, '對手那一側不可以被波及');
});
T('E2 這個回合沒用 ⇒ 再下一個自己的回合冷卻解除（天仙石重新列為可用）', () => {
  assert.ok(E_AFTER, 'E0 沒有產生盤面');
  const later = toMyNextMain(E_AFTER);
  assert.ok(getAvailableAttacks(later, pool).includes(IDX_STONE), '冷卻沒有解除：' + JSON.stringify(getAvailableAttacks(later, pool)));
});

T('E3 真流程：上個自己的回合用的是別招（魔法魅惑）⇒ 天仙石照列（遊戲層級紀錄要比對招式名）', () => {
  // fable 複審：述詞把遊戲層級的 includes(attackName) 改成 length > 0 時，A2 只用實體蓋章測不到
  const st = mk(SYLVEON, ['W', 'L', 'P']);
  const a = applyAction(st, { type: 'ATTACK', attackIndex: IDX_CHARM }, pool);
  assert.ok(a !== st, '魔法魅惑沒有打出去');
  const nx = toMyNextMain(a);
  assert.ok((nx.attackNamesUsedLastSelfTurn?.p1 ?? []).includes('魔法魅惑'), '前置：遊戲層級應記到魔法魅惑');
  assert.ok(getAvailableAttacks(nx, pool).includes(IDX_STONE), '上回合用別招，天仙石不可以被擋：' + JSON.stringify(getAvailableAttacks(nx, pool)));
});

// ── D：Rule 38 —— 判準只有一份 ───────────────────────────────────────────────
T('D1 ⭐ 中央述詞存在、且 engine 只在述詞裡讀 PLAYER_LEVEL_ATTACK_COOLDOWN', () => {
  assert.equal(typeof ENG.isPlayerLevelAttackOnCooldown, 'function', '中央述詞不存在');
  const src = stripCommentsBlankChecked(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
  const reads = src.split('PLAYER_LEVEL_ATTACK_COOLDOWN.has(').length - 1;
  assert.equal(reads, 1, `PLAYER_LEVEL_ATTACK_COOLDOWN.has( 出現 ${reads} 次（應只在中央述詞裡 1 次）`);
  const calls = src.split('isPlayerLevelAttackOnCooldown(').length - 1;
  assert.ok(calls >= 3, `述詞定義＋兩個呼叫點應 ≥ 3 處，實際 ${calls}`);
});
T('D2 述詞本身：戰鬥位／備戰／別招／非冷卻招', () => {
  const f = ENG.isPlayerLevelAttackOnCooldown;
  assert.equal(f(mk(SYLVEON, ['W'], { activeStamp: '天仙石' }), 0, '天仙石'), true);
  assert.equal(f(mk(SYLVEON, ['W'], { benchStamp: '天仙石' }), 0, '天仙石'), true);
  assert.equal(f(mk(SYLVEON, ['W'], { activeStamp: '天仙石' }), 1, '天仙石'), false, '對手那一側沒蓋章');
  assert.equal(f(mk(SYLVEON, ['W'], { activeStamp: '魔法魅惑' }), 0, '魔法魅惑'), false, '非冷卻招不可以被擋');
  assert.equal(f(mk(SYLVEON, ['W']), 0, undefined), false);
});

console.log(`\n=== v6.428 玩家層級冷卻 × 可用清單：PASS ${pass} / FAIL ${fail} ===`);
if (fail) { console.log('紅的：' + failed.join('、')); process.exit(1); }
