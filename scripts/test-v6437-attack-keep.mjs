// 守衛 v6.437：電腦對手不打出／不使用「會讓這回合的攻擊明顯變差」的訓練家與特性；J 標夢幻ex｜記憶螺旋 × 天仙石冷卻
//
// 【問題】scripts/diag-ai-gust.mjs（v6.436）：老大的指令拉上打得倒的寶可夢之後，電腦對手又打「能量轉移」把戰鬥位的能量搬走、
//   用「支配鎖鏈」把戰鬥位換掉 ⇒ 這回合打不出招（20 次「拉上來卻沒受傷」裡約 10 次）。
//   根因：訓練家／特性的評分完全不看「用完之後戰鬥位這回合還打不打得出原本的結果」。
// 【修法】ai-eval.ts actionWeakensAttackThisTurn（在洗過看不到區域的複本上真的做一次、試打前後比較，
//   判準與老大的指令同一把尺 clearlyBetterOutcome）；ai.ts 訓練家與特性兩處都問它。
// 【J 標夢幻ex】M6a 057/103 夢幻ex 沒有「基因駭入」，是特性「記憶螺旋」：「這隻寶可夢可使用自己的備戰寶可夢持有的所有招式。」
//   ⇒ 備戰有仙子伊布ex 時可以用天仙石。冷卻判準（v6.428 中央述詞）以招式名比對，已涵蓋；本守衛釘住它。
//
// HEAD-FAIL（BASE＝v6.436 b404a8f2）：結果寫在 commit 訊息。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-v6437-s.js'), E = join(ROOT, '.x-v6437-e.ts'), O = join(ROOT, '.x-v6437-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export * as ENG from './src/lib/game/engine';\n"
  + "export * as EVAL from './src/lib/game/ai-eval';\n"
  + "export { getAIAction } from './src/lib/game/ai';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ENG, EVAL, getAIAction } = await import(pathToFileURL(O).href);
const { createGame, applyAction, getAvailableAttacks, getEffectiveAttacks } = ENG;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
// 卡片事實一律取自 static/cards（台灣官方卡面）
const SANDY = '11236';     // 沙丘娃（H）：沙沫［無無無］50
const SNORLAX = '17038';   // 卡比獸（HP160）
const TOGEPI = '11225';    // 波克比（HP50）
const SWITCH = '17134';    // 寶可夢交替：「將自己的戰鬥寶可夢與備戰寶可夢互換。」
const ESWITCH = '17109';   // 能量轉移：「選擇1個自己的場上寶可夢身上附加的基本能量，改附於自己的其他寶可夢身上。」
const OKIDOGI = '16962';   // 桃歹郎ex｜支配鎖鏈：「…選擇1隻自己的備戰區的【惡】寶可夢…與戰鬥寶可夢互換…」
const MURKROW = '14132';   // 黑暗鴉（【惡】基礎）：伏擊［惡］
const PSY = '14103';
const MEW = '19969';       // 夢幻ex（J，M6a 057/103）｜記憶螺旋
const SYLVEON = '16770';   // 仙子伊布ex｜天仙石［水雷超］
const EN = { W: '18519', L: '18520', P: '14103' };
assert.ok(/將自己的戰鬥寶可夢與備戰寶可夢互換/.test(pool.get(SWITCH).rulesText));
assert.ok(/改附於自己的其他寶可夢身上/.test(pool.get(ESWITCH).rulesText));
assert.ok(/與戰鬥寶可夢互換/.test(pool.get(OKIDOGI).abilities[0].effect));
assert.equal(pool.get(MEW).regulationMark, 'J');
assert.ok(/這隻寶可夢可使用自己的備戰寶可夢持有的所有招式/.test(pool.get(MEW).abilities[0].effect), '記憶螺旋卡面變了');

let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'k' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const psy = (n) => Array.from({ length: n }, () => inst(PSY));
function mk({ active, bench, hand, oppActive = inst(TOGEPI), oppBench = [inst(SNORLAX)], extra = {} }) {
  const s = createGame({ name: 'P1', entries: [{ cardId: SNORLAX, count: 1 }] }, { name: 'P2', entries: [{ cardId: SNORLAX, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, ...extra,
    players: [
      { ...s.players[0], hand, deck: Array.from({ length: 12 }, () => inst(SNORLAX)), discard: [], prizes: Array.from({ length: 6 }, () => inst(SNORLAX)),
        active, bench, energyAttachedThisTurn: true, supporterPlayedThisTurn: true },
      { ...s.players[1], hand: [inst(SNORLAX)], deck: Array.from({ length: 12 }, () => inst(SNORLAX)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(SNORLAX)), active: oppActive, bench: oppBench }] };
}
const actName = (st, a) => (a?.type === 'PLAY_TRAINER' ? 'T:' + pool.get(st.players[0].hand.find((h) => h.iid === a.iid)?.cardId)?.name
  : a?.type === 'USE_ABILITY' ? 'A:' + pool.get([st.players[0].active, ...st.players[0].bench].find((c) => c?.iid === a.iid)?.cardId)?.name : a?.type);

let pass = 0, fail = 0;
const failed = [];
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n); } };

// ── V：訓練家／特性的否決 ──────────────────────────────────────────────────────
T('V1 ⭐ 戰鬥位打得倒對手（沙丘娃 50 vs 波克比 50）⇒ 不打「寶可夢交替」把牠換下場，直接出招', () => {
  const st = mk({ active: inst(SANDY, { energyAttached: psy(3) }), bench: [inst(SNORLAX)], hand: [inst(SWITCH)] });
  assert.equal(actName(st, getAIAction(st, pool, 0)), 'ATTACK');
});
T('V2 ⭐ 戰鬥位剛好 3 個能量（少 1 個就打不出沙沫）⇒ 不打「能量轉移」', () => {
  const st = mk({ active: inst(SANDY, { energyAttached: psy(3) }), bench: [inst(SNORLAX)], hand: [inst(ESWITCH)] });
  assert.equal(actName(st, getAIAction(st, pool, 0)), 'ATTACK');
});
T('V3 ⭐ 特性：戰鬥位打得倒對手 ⇒ 不用「支配鎖鏈」把沒能量的黑暗鴉換上來', () => {
  const st = mk({ active: inst(SANDY, { energyAttached: psy(3) }), bench: [inst(OKIDOGI), inst(MURKROW)], hand: [] });
  const a = getAIAction(st, pool, 0);
  assert.equal(actName(st, a), 'ATTACK', '實際：' + actName(st, a));
});
T('V4 正對照：戰鬥位打不出招、備戰的沙丘娃打得倒 ⇒ 照樣打「寶可夢交替」', () => {
  const st = mk({ active: inst(SNORLAX), bench: [inst(SANDY, { energyAttached: psy(3) })], hand: [inst(SWITCH)] });
  assert.equal(actName(st, getAIAction(st, pool, 0)), 'T:寶可夢交替');
});
T('V5 正對照：戰鬥位有 4 個能量（搬走 1 個仍打得出）⇒ 能量轉移不在否決之列（中央判定回 false）', () => {
  const st = mk({ active: inst(SANDY, { energyAttached: psy(4) }), bench: [inst(SNORLAX)], hand: [inst(ESWITCH)] });
  assert.equal(typeof EVAL.actionWeakensAttackThisTurn, 'function', '中央判定不存在');
  assert.equal(EVAL.actionWeakensAttackThisTurn(st, 0, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool), false);
});
T('V6 ⭐ 中央判定直呼：寶可夢交替（V1 盤面）⇒ true；戰鬥位本來就打不出招（V4 盤面）⇒ false', () => {
  const f = EVAL.actionWeakensAttackThisTurn;
  assert.equal(typeof f, 'function', '中央判定不存在');
  const s1 = mk({ active: inst(SANDY, { energyAttached: psy(3) }), bench: [inst(SNORLAX)], hand: [inst(SWITCH)] });
  assert.equal(f(s1, 0, { type: 'PLAY_TRAINER', iid: s1.players[0].hand[0].iid }, pool), true);
  const s2 = mk({ active: inst(SNORLAX), bench: [inst(SANDY, { energyAttached: psy(3) })], hand: [inst(SWITCH)] });
  assert.equal(f(s2, 0, { type: 'PLAY_TRAINER', iid: s2.players[0].hand[0].iid }, pool), false);
});
T('V7 ⭐ 試算不改到真正的盤面（傳進去的 state 逐字不變）', () => {
  const st = mk({ active: inst(SANDY, { energyAttached: psy(3) }), bench: [inst(SNORLAX)], hand: [inst(ESWITCH)] });
  const snap = JSON.stringify(st);
  EVAL.actionWeakensAttackThisTurn?.(st, 0, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool);
  getAIAction(st, pool, 0);
  assert.equal(JSON.stringify(st), snap);
});

T('V9 ⭐（fable 審查 必須修 1）動作本身就打倒對手戰鬥位（黑夜魔靈｜咒詛炸彈放 13 個指示物）⇒ 不擋', () => {
  const GENGAR = '14734';   // 黑夜魔靈｜咒詛炸彈：「…將這隻寶可夢【昏厥】。在對手的1隻寶可夢身上放置13個傷害指示物。」
  assert.ok(/放置13個傷害指示物/.test(pool.get(GENGAR).abilities[0].effect));
  // ⚠ 戰鬥位本來也打得倒（卡比獸剩 40，沙沫 50）⇒ 「做之前」拿得到 1 張獎賞；若不計動作本身的擊倒，
  //   「做之後對手戰鬥位空了 ⇒ 0 張」就會被誤判成變差（第一版這一條沒讓戰鬥位打得倒 ⇒ 突變 X6b 存活＝安慰劑）
  const st = mk({ active: inst(SANDY, { energyAttached: psy(3) }), bench: [inst(GENGAR)], hand: [], oppActive: inst(SNORLAX, { damage: 120 }) });
  const g = st.players[0].bench[0];
  assert.equal(EVAL.actionWeakensAttackThisTurn(st, 0, { type: 'USE_ABILITY', iid: g.iid, abilityIndex: 0 }, pool), false);
});
T('V10 ⭐（必須修 2）神奇糖果讓戰鬥位原地進化（進化後這回合能量不夠出招，但原本也拿不到獎賞）⇒ 不擋', () => {
  const CHARMANDER = '14416', CANDY = '14229', MCX = '15971';
  const fire = [...pool.values()].find((c) => c.supertype === 'Energy' && c.subtype === 'Basic' && /【火】/.test(c.name));
  assert.ok(fire, '找不到基本火能量');
  const st = mk({ active: inst(CHARMANDER, { energyAttached: [inst(fire.id)] }), bench: [inst(SNORLAX)], hand: [inst(CANDY), inst(MCX)], oppActive: inst(SNORLAX) });
  const candy = st.players[0].hand[0];
  assert.equal(EVAL.actionWeakensAttackThisTurn(st, 0, { type: 'PLAY_TRAINER', iid: candy.iid }, pool), false);
});
T('V11 ⭐（必須修 3）戰鬥位用純抽牌特性（超級袋獸ex｜使者衝刺）、攻擊是擲幣招 ⇒ 連問 20 次都不擋（不受試打亂數影響）', () => {
  const KANGA = '14071';   // 超級袋獸ex：使者衝刺（抽 2 張）／機關槍合擊 200+（擲幣）
  assert.ok(/從自己的牌庫抽出2張卡/.test(pool.get(KANGA).abilities[0].effect));
  const st = mk({ active: inst(KANGA, { energyAttached: psy(3) }), bench: [inst(SNORLAX)], hand: [], oppActive: inst('13045') });
  const k = st.players[0].active;
  let t = 0;
  for (let i = 0; i < 20; i++) if (EVAL.actionWeakensAttackThisTurn(st, 0, { type: 'USE_ABILITY', iid: k.iid, abilityIndex: 0 }, pool)) t++;
  assert.equal(t, 0, `20 次裡 ${t} 次判定會變差`);
});

T('V12 ⭐（fable 複審）擲幣招戰鬥位（機關槍合擊）用治療道具（超大冰淇淋）⇒ 連問 20 次都不擋（前後配對取樣，不受擲幣運氣影響）', () => {
  const KANGA = '14071', ICE = '18542';   // 超大冰淇淋：「將自己的身上附有3個以上能量的戰鬥寶可夢恢復「80」HP。」
  assert.ok(/恢復「80」HP/.test(pool.get(ICE).rulesText));
  let t = 0;
  for (let i = 0; i < 20; i++) {
    // 每次換一個盤面物件（不吃快取），讓每次都重新試打
    const st = mk({ active: inst(KANGA, { energyAttached: psy(3), damage: 100 }), bench: [inst(SNORLAX)], hand: [inst(ICE)], oppActive: inst('13045') });
    if (EVAL.actionWeakensAttackThisTurn(st, 0, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool)) t++;
  }
  assert.equal(t, 0, `20 次裡 ${t} 次判定治療會讓攻擊變差`);
});

T('V8 ⭐ 資訊防線：AI 的試算一律在洗過看不到區域的複本上做 —— ai*.ts 不可把真實盤面（state）直接交給 applyAction', () => {
  // 突變 X5（actionWeakensAttackThisTurn 改成 applyAction(state, …)）時，既有 test-ai-eval-deck-privacy 的掃描
  //   只認 `applyAction(cloneState(` 這一種寫法 ⇒ 抓不到（型態 10：只掃字面）。這裡補上「直接用真實盤面」這一型。
  const dirG = join(ROOT, 'src/lib/game');
  const files = readdirSync(dirG).filter((f) => /^ai.*\.ts$/.test(f));
  assert.ok(files.length >= 6 && files.includes('ai-eval.ts'), '掃描器壞了？' + files.join(','));
  const re = /applyAction\(\s*state\s*,/g;
  const bad = [];
  for (const f of files) {
    const src = readFileSync(join(dirG, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const m of src.matchAll(re)) bad.push(f + '@' + m.index);
  }
  assert.deepEqual(bad, [], '有 AI 試算直接用真實盤面：' + bad.join('、'));
  assert.equal([...'let st = applyAction(state, action, pool);'.matchAll(re)].length, 1, '判準抓不到違規樣本');
});

// ── R：J 標夢幻ex｜記憶螺旋 × 天仙石冷卻 ─────────────────────────────────────
function mewBoard(cool) {
  return mk({ active: inst(MEW, { energyAttached: [inst(EN.W), inst(EN.L), inst(EN.P)] }), bench: [inst(SYLVEON)], hand: [],
    oppBench: [inst(SNORLAX), inst(SNORLAX)], extra: { attackNamesUsedLastSelfTurn: { p1: cool, p2: [] } } });
}
const stoneIdx = (st) => getEffectiveAttacks(st, st.players[0].active, pool).findIndex((e) => e.atk.name === '天仙石');
T('R1 正對照：記憶螺旋 ⇒ 備戰有仙子伊布ex 時，夢幻ex 可以使用天仙石', () => {
  const st = mewBoard([]);
  const i = stoneIdx(st);
  assert.ok(i >= 0, '招式清單裡沒有天仙石');
  assert.ok(getAvailableAttacks(st, pool).includes(i), '天仙石沒有列為可用');
});
T('R2 ⭐ 上個自己的回合用過天仙石 ⇒ 夢幻ex 透過記憶螺旋也不能用（清單不列、送出也被擋）', () => {
  const st = mewBoard(['天仙石']);
  const i = stoneIdx(st);
  assert.ok(i >= 0);
  assert.ok(!getAvailableAttacks(st, pool).includes(i), '冷卻中的天仙石仍列為可用');
  const nx = applyAction(st, { type: 'ATTACK', attackIndex: i }, pool);
  assert.ok(!(nx.pendingSelection?.effectKey === 'sylveon-skystone-bounce'), '冷卻中仍開出天仙石的選擇視窗');
  assert.equal(nx.players[1].bench.length, 2);
});
T('R3 ⭐ 夢幻ex 透過記憶螺旋使出天仙石 ⇒ 記成「自己的寶可夢使出了天仙石」（下個自己的回合冷卻）', () => {
  // 記憶螺旋是「這隻寶可夢可使用…的招式」——夢幻ex 自己使出了天仙石（不是「作為這個招式使用」的借招）
  const st = mewBoard([]);
  const nx = applyAction(st, { type: 'ATTACK', attackIndex: stoneIdx(st) }, pool);
  assert.ok((nx.attackNamesUsedThisTurn?.p1 ?? []).includes('天仙石'), JSON.stringify(nx.attackNamesUsedThisTurn));
});

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail) { console.log('紅：' + failed.join('、')); process.exit(1); }
