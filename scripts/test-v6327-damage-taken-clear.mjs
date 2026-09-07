/**
 * v6.327 守衛 —— `damageTakenLastOppTurn` 的**唯一重置點**（END_TURN 清除區塊）
 *
 * 【卡面】超級赫拉克羅斯ex｜重裝角擊 100+（M2 `14322` / `18578`，I 標，HP280）
 *   逐字：「增加與在上個對手的回合這隻寶可夢受到的招式的傷害相同數值的傷害。」
 *
 * 【為什麼要有這一支】
 *   `src/lib/game/effects/_shared.ts` 的 `withAttackDamageTaken` 是全站唯一寫入點，而且是
 *   **純累加**（`(inst.damageTakenLastOppTurn ?? 0) + actual`）——
 *   ⇒ 全站**唯一的重置點**就是 `engine.ts` 的 END_TURN 清除區塊。
 *   把那六行刪掉，欄位會**跨回合無限累加**，重裝角擊變成傷害灌水級 bug。
 *
 * 【⛔ v6.326 自己造成的偵測缺口 —— 本檔就是來補它的】
 *   `test-v6255` C7 的 `total`（5→3）與 `test-v6256` C1 的 `totalMentions`（6→4）
 *   **是被同一段真碼撐著的**：那六行剝註解後恰好貢獻 2 行、2 次提及。
 *   實測（BASE `427fdd3b`，刪掉那六行）：
 *     · `total` 5 → **3**（＝新下限，剛好綠）／`totalMentions` 6 → **4**（＝新下限，剛好綠）
 *     · v6.325 的舊下限（≥5／≥6）下兩支都 rc=1；v6.326 放寬後**兩支都綠**
 *   ⇒ 放寬本身不是錯（合法收斂不該翻紅），但**偵測力必須另外補回來**，就是本檔。
 *
 * 【判準（寫進 docs/changelog-internal.md，這裡留一份）】
 *   放寬下限之前，先問「**有沒有第二條下限是同一段代碼撐著的**」；
 *   並且突變必須落在「**放寬的邊際帶**」——
 *   用「把掃描器打殘」型的突變（實得 0／3／5／23），證明不了下限值本身的價值。
 *
 * 【本檔的兩層】
 *   B 段＝**行為端**（主）：真管線 `applyAction(END_TURN)`，抓語義壞掉（方向錯／漏 bench／
 *        跨回合累加／重裝角擊傷害灌水）。
 *   C 段＝**結構端**（輔）：抓「清除點被刪除／改名」，並且在行為 harness 日後失效
 *        （fixture 卡下架、`applyAction` 簽名變動）時仍然守得住。
 *
 * 【HEAD-FAIL】刪掉 `engine.ts` 的那六行 ⇒ B2／B4／B5／B6／C1 同時紅；還原 ⇒ 全綠。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.v6327-e.ts'), O = join(ROOT, '.v6327-o.mjs'), S = join(ROOT, '.v6327-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';
export { ATTACK_PRE } from './src/lib/game/effects/_shared';
import './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, ATTACK_PRE } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
const liveCards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark)) liveCards.push(c);
  }
}

const ID = {
  HERA: '14322',    // 超級赫拉克羅斯ex（重裝角擊＝attacks[0]・HP280・I）
  IRON: '16832',    // 鐵頭殼ex（雙刃劍＝attacks[0] → snipe-multi 2隻各50・flat）
  UBO:  '17976',    // 帕底亞 烏波（HP60・Basic・無特性）
  eG: '14102', eP: '14103',
};

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkP = (name, active, bench = []) => ({ name, active, bench, hand: [],
  deck: Array.from({ length: 20 }, () => en(ID.eP)), discard: [],
  prizes: Array.from({ length: 6 }, () => en(ID.eP)) });
const mkS = (p0, p1, api = 0) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: api, turn: 5,
  isFirstTurn: false, firstPlayerIdx: 0, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], log: [], pendingSelection: null, activeStadium: null, players: [p0, p1] });

/** ATTACK → 反覆用 pick() 回答 pendingSelection。 */
const drive = (s, action, pick) => {
  let st = applyAction(s, action, pool); let g = 0;
  while (st.pendingSelection && g++ < 8) {
    const r = pick(st.pendingSelection, st); if (r === null) break;
    st = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: r }, pool);
  }
  return st;
};
/** END_TURN → 解掉任何附帶 picker（一律送空陣列＝不選）。 */
const endTurn = (s) => {
  let st = applyAction(s, { type: 'END_TURN' }, pool); let g = 0;
  while (st.pendingSelection && g++ < 8) st = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [] }, pool);
  return st;
};
/** P0 用鐵頭殼ex｜雙刃劍同時打 P1 的 active ＋ bench[0]（各 50，走 snipe-multi）。 */
const ironStrike = (s) => {
  const tgt = [s.players[1].active.iid, s.players[1].bench[0].iid];
  return drive(s, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, () => tgt);
};
const mkBoard = () => mkS(
  mkP('P0', inst(ID.IRON, [en(ID.eP), en(ID.eP), en(ID.eP)]), [inst(ID.UBO)]),
  mkP('P1', inst(ID.HERA, [en(ID.eG), en(ID.eG)]), [inst(ID.HERA)]), 0);
//   ⚠ bench 用 HP280 的赫拉克羅斯ex 而不是 HP60 的烏波：B5 要挨**兩輪**各 50，
//     用 HP60 的會在第二輪被 KO 而離場 ⇒ 測到的就不是「跨回合累加」而是「被 KO 移走」。

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS', n); pass++; } catch (e) {
  if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else { throw e; } } };

// ══════════════════════════════════════════════════════════════════════
console.log('A. 前提（卡面逐字 ＋ 寫入點是純累加 ⇒ 重置點只能在別處）');

T('A1 ⭐卡面：重裝角擊 live H/I/J 恰 2 張印刷、逐字未變', () => {
  const hits = liveCards.filter(c => (c.attacks ?? []).some(a => a.name === '重裝角擊'));
  assert.equal(hits.length, 2, `重裝角擊印刷張數應為 2，實得 ${hits.length}`);
  assert.deepEqual(hits.map(c => String(c.id)).sort(), ['14322', '18578']);
  for (const c of hits) {
    const a = c.attacks.find(x => x.name === '重裝角擊');
    assert.equal(a.damage, '100+');
    assert.equal(a.effect, '增加與在上個對手的回合這隻寶可夢受到的招式的傷害相同數值的傷害。');
  }
});

const stripSrc = (s, label) => stripCommentsBlankChecked(s, { label }).replace(/\/\/.*$/gm, '');
const ENGINE = stripSrc(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'), 'engine.ts');
const SHARED = stripSrc(readFileSync(join(ROOT, 'src/lib/game/effects/_shared.ts'), 'utf8'), 'effects/_shared.ts');

T('A2 ⭐⭐⭐中央寫入點是**純累加** ⇒ 沒有第二個地方會把它歸零（本檔的存在前提）', () => {
  assert.ok(/damageTakenLastOppTurn:\s*\(inst\.damageTakenLastOppTurn \?\? 0\) \+ actual/.test(SHARED),
    '_shared.ts 的 withAttackDamageTaken 不再是「純累加」⇒ 本檔的前提改變了，要回來重判整支守衛');
  // 正對照：這條樣式抓得到已知樣本、也抓不到「非累加」的樣本（否則就是恆真／恆假的安慰劑）
  assert.ok(/damageTakenLastOppTurn:\s*\(inst\.damageTakenLastOppTurn \?\? 0\) \+ actual/
    .test('x = { damageTakenLastOppTurn: (inst.damageTakenLastOppTurn ?? 0) + actual };'), 'A2 樣式恆假＝安慰劑');
  assert.ok(!/damageTakenLastOppTurn:\s*\(inst\.damageTakenLastOppTurn \?\? 0\) \+ actual/
    .test('x = { damageTakenLastOppTurn: actual };'), 'A2 樣式把「直接覆寫」也當成累加＝判準太鬆');
});

// ══════════════════════════════════════════════════════════════════════
console.log('B. 行為端（真管線 applyAction）：END_TURN 必須重置');

T('B1 前提：真管線攻擊確實會寫入 damageTakenLastOppTurn（fixture 有效）', () => {
  const r = ironStrike(mkBoard());
  assert.equal(r.players[1].active?.damageTakenLastOppTurn, 50, 'active 沒被記到 ⇒ fixture 失效，B2~B6 等於沒測');
  assert.deepEqual(r.players[1].bench.map(b => b?.damageTakenLastOppTurn), [50],
    'bench 沒被記到 ⇒ fixture 失效');
});

T('B2 ⭐⭐⭐主：受傷方自己 END_TURN ⇒ active 與**全部** bench 都必須清空', () => {
  let s = ironStrike(mkBoard());
  s = endTurn(s);                       // P0 結束回合 → 換 P1
  assert.equal(s.activePlayerIndex, 1, '回合沒切到 P1 ⇒ 下一步測不到受傷方自己的 END_TURN');
  s = endTurn(s);                       // P1（受傷方）結束回合 → 應清空
  assert.equal(s.players[1].active?.damageTakenLastOppTurn, undefined,
    'END_TURN 沒有清除 active 的 damageTakenLastOppTurn ⇒ 純累加寫入點會跨回合無限累加（重裝角擊傷害灌水）');
  assert.deepEqual(s.players[1].bench.map(b => b?.damageTakenLastOppTurn), [undefined],
    'END_TURN 沒有清除 bench 的 damageTakenLastOppTurn（只清 active 是漏的）');
});

T('B3 ⭐正對照（方向性）：對手（P0）END_TURN **不得**清掉 P1 的累計', () => {
  let s = ironStrike(mkBoard());
  s = endTurn(s);
  assert.equal(s.players[1].active?.damageTakenLastOppTurn, 50,
    'P0 END_TURN 就把 P1 的累計清掉了 ⇒ 重裝角擊永遠讀到 0（修過頭，方向相反）');
  assert.deepEqual(s.players[1].bench.map(b => b?.damageTakenLastOppTurn), [50]);
});

T('B4 ⭐⭐bench 多隻都要清（不是只清第 0 隻）', () => {
  const s0 = mkS(mkP('P0', inst(ID.UBO)),
    mkP('P1', inst(ID.HERA, [], { damageTakenLastOppTurn: 120 }),
      [inst(ID.UBO, [], { damageTakenLastOppTurn: 50 }),
       inst(ID.UBO, [], { damageTakenLastOppTurn: 70 }),
       inst(ID.UBO, [], { damageTakenLastOppTurn: 30 })]), 1);
  const r = endTurn(s0);
  assert.equal(r.players[1].active?.damageTakenLastOppTurn, undefined, 'active 沒清');
  assert.deepEqual(r.players[1].bench.map(b => b?.damageTakenLastOppTurn), [undefined, undefined, undefined],
    'bench 有殘留 ⇒ 備戰的超級赫拉克羅斯ex 補位上場後會帶著上上回合的累計');
});

T('B5 ⭐⭐⭐端到端：連續兩個對手回合各挨 50 ⇒ 第二輪必須是 50，**不是** 100', () => {
  let s = ironStrike(mkBoard());        // 第 1 輪：P1 挨 50
  s = endTurn(s);                       // P0 結束 → P1 回合
  s = endTurn(s);                       // P1 結束 → 應重置
  s = ironStrike(s);                    // 第 2 輪：P1 再挨 50
  assert.equal(s.players[1].active?.damageTakenLastOppTurn, 50,
    '跨回合累加了（實得 ≠ 50）⇒ 「上個對手的回合受到的傷害」變成「開局至今受到的傷害」');
  assert.deepEqual(s.players[1].bench.map(b => b?.damageTakenLastOppTurn), [50], 'bench 同樣跨回合累加了');
});

T('B6 ⭐⭐⭐端到端**傷害數字**：第二輪的重裝角擊必須是 100+50＝150，不是 100+100＝200', () => {
  let s = ironStrike(mkBoard());
  s = endTurn(s); s = endTurn(s);       // P1 結束回合（重置點）
  s = ironStrike(s);                    // 第 2 輪挨 50
  s = endTurn(s);                       // P0 結束 → 輪到 P1 用重裝角擊
  assert.equal(s.activePlayerIndex, 1);
  const pre = ATTACK_PRE.get('超級赫拉克羅斯ex|重裝角擊');
  assert.ok(typeof pre === 'function', '重裝角擊的 ATTACK_PRE 不見了 ⇒ 這條守衛的前提消失');
  assert.equal(pre(s, 1, pool, {}).damage, 150,
    '重裝角擊傷害灌水：重置點失效時它會把好幾個回合的傷害全部加進來');
});

T('B7 ⭐正對照（因果鏈）：dmgTaken 直接決定傷害 ⇒ 累計灌水就是傷害灌水', () => {
  const pre = ATTACK_PRE.get('超級赫拉克羅斯ex|重裝角擊');
  assert.ok(typeof pre === 'function', '重裝角擊的 ATTACK_PRE 不見了 ⇒ 這條守衛的前提消失');
  for (const [dt, dmg] of [[undefined, 100], [50, 150], [100, 200], [270, 370]]) {
    const st = mkS(mkP('P0', inst(ID.HERA, [], dt === undefined ? {} : { damageTakenLastOppTurn: dt })),
                   mkP('P1', inst(ID.UBO)), 0);
    assert.equal(pre(st, 0, pool, {}).damage, dmg, `dmgTaken=${dt} 應為 ${dmg}`);
  }
});

// ══════════════════════════════════════════════════════════════════════
console.log('C. 結構端：END_TURN 區塊裡必須有清除點（抓刪除／改名／搬走）');

// ⚠ 等價寫法一律枚舉（安慰劑型態 8「字面樣式排除」）：`delete` 型／設 `undefined` 型／rest 解構型。
const CLEAR_RES = [
  [/delete\s+[\w.$]+\.damageTakenLastOppTurn\s*;/,           'delete 型'],
  [/damageTakenLastOppTurn\s*:\s*undefined/,                  '設 undefined 型'],
  [/\{[^{}]*damageTakenLastOppTurn\s*:[^,}]*,\s*\.\.\.\s*\w/, 'rest 解構型'],
];
const END_TURN_ANCHOR = "if (action.type === 'END_TURN') {";

T('C1 ⭐⭐⭐END_TURN 區塊內必須存在「清除 damageTakenLastOppTurn」的樣式（＋anchor 上限＋正對照）', () => {
  assert.equal(ENGINE.split(END_TURN_ANCHOR).length - 1, 1,
    `END_TURN anchor 在 engine.ts 出現次數不是 1 ⇒ anchor 失效，這條守衛測不到東西`);
  const aIdx = ENGINE.indexOf(END_TURN_ANCHOR);
  const hit = CLEAR_RES.map(([re]) => { const m = re.exec(ENGINE.slice(aIdx)); return m ? aIdx + m.index : -1; })
    .filter(i => i >= 0).sort((x, y) => x - y)[0];
  assert.ok(hit !== undefined,
    'END_TURN 清除點不見了 ⇒ damageTakenLastOppTurn 會跨回合累加（重裝角擊傷害灌水）'
    + '；三種等價寫法（delete／: undefined／rest 解構）都沒找到');
  const lineGap = ENGINE.slice(aIdx, hit).split('\n').length;
  assert.ok(lineGap < 1500,
    `清除點距 END_TURN anchor ${lineGap} 行（實測基準 ~777）⇒ anchor 可能已失效，比對到別的區塊`);
  // 正對照：三種樣式各自抓得到自己的合規樣本
  const SAMPLES = ['const n = { ...c }; delete n.damageTakenLastOppTurn; return n;',
                   'return { ...c, damageTakenLastOppTurn: undefined };',
                   'const { damageTakenLastOppTurn: _drop, ...rest } = c; return rest;'];
  SAMPLES.forEach((sample, i) => assert.ok(CLEAR_RES[i][0].test(sample),
    `C1 ${CLEAR_RES[i][1]} 抓不到自己的合規樣本＝安慰劑`));
  // 反對照：只有「讀取」沒有「清除」的樣本，三種樣式都不得放行
  const BAD = 'const dmgTaken = a?.damageTakenLastOppTurn ?? 0;\nreturn { ...c, damageTakenLastOppTurn: 0 };';
  for (const [re, label] of CLEAR_RES) assert.ok(!re.test(BAD), `C1 ${label} 把「只讀取／寫 0」誤判成清除`);
});

T('C2 元守衛：本檔必須真的在 `npm test` chain 上（寫了卻沒跑＝安慰劑）', () => {
  const chain = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.test;
  assert.ok(chain.includes('test-v6327-damage-taken-clear.mjs'),
    'test-v6327 不在 package.json 的 test chain 上 ⇒ CI 不會跑它');
});

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILED'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
