// v6.147 守衛：①錦標賽動作送出中必須有視覺 busy 態 ②樂觀更新第二批白名單。
//
// 事故背景（站長：「這個 lag 的問題修了好多次都沒處理好」）：
//   v6.137 引進 `tInFlight`（對戰動作的網路單發鎖），但**整份 +page.svelte 沒有任何 template
//   綁定它**（`disabled={tInFlight}` 出現 0 次）⇒ 往返期間按鈕外觀完全不變，
//   玩家第二次點擊還會被 tournamentDispatch 開頭直接丟棄並跳紅字。體感＝「按了沒反應」。
//   同時樂觀更新白名單一年多只有 `ATTACH_ENERGY` 一種，一回合十幾個動作全部要等一次往返。
//
// ⚠ 白名單是**實跑決定的，不是照直覺列的**：EVOLVE 30 條進化鏈實跑 30/30 `randomness:1`
//   （建新實例的 uid() 會動隨機源，且會踩 iid-set gate）；`PLAY_TRAINER` 是 `opens-pending`。
//   下面 B 段把「該擋的要繼續被擋」也一起釘住，避免哪天有人把它們塞進白名單。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6147-s.js'), E = join(ROOT, '.v6147-e.ts'), O = join(ROOT, '.v6147-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { tryPredictAction, OPTIMISTIC_ACTION_TYPES } from './src/lib/game/optimistic';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { tryPredictAction, OPTIMISTIC_ACTION_TYPES } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) { pool.set(String(c.id), c); all.push(c); }
}
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
const inst = (id, iid, x = {}) => ({ iid, cardId: String(id), damage: 0, energyAttached: [], toolAttached: null,
  extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, evolvedFromStack: [], ...x });
const stage1 = all.find((c) => c.stage === 'Stage1' && c.evolvesFrom && HIJ(c)
  && all.some((b) => b.name === c.evolvesFrom && b.stage === 'Basic'));
const basicOf = all.find((c) => c.name === stage1.evolvesFrom && c.stage === 'Basic');
const plainBasic = all.find((c) => c.stage === 'Basic' && HIJ(c) && !(c.abilities || []).length
  && c.name !== basicOf.name && (c.attacks || []).length > 0);
const grass = all.find((c) => c.name === '基本【草】能量');
const stadium = all.find((c) => c.supertype === 'Trainer' && c.subtype === 'Stadium' && HIJ(c));
const fossil = all.find((c) => c.name === '陳舊的根狀化石');
const mk = (over = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
  log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null, pendingPrizes: [],
  players: [
    { name: 'A', active: inst(basicOf.id, 'A1', { energyAttached: [inst(grass.id, 'E1'), inst(grass.id, 'E2'), inst(grass.id, 'E3')], ...(over.activeOver ?? {}) }),
      bench: over.bench ?? [inst(plainBasic.id, 'B1')],
      hand: [inst(plainBasic.id, 'H1'), inst(stage1.id, 'H2'), inst(stadium.id, 'H4'), inst(fossil.id, 'H5'), inst(grass.id, 'H6')],
      deck: [inst(grass.id, 'D1')], discard: [], prizes: [] },
    { name: 'B', active: inst(plainBasic.id, 'X1'), bench: [], hand: [], deck: [inst(grass.id, 'XD1')], discard: [], prizes: [] },
  ],
});

// ── A. 樂觀更新第二批：正對照 ──────────────────────────────────────────────
const OK_CASES = [
  ['ATTACH_ENERGY', { type: 'ATTACH_ENERGY', energyIid: 'H6', targetIid: 'A1' }],
  ['PLAY_BASIC', { type: 'PLAY_BASIC', iid: 'H1' }],
  ['RETREAT', { type: 'RETREAT', newActiveIid: 'B1' }],
  ['PLAY_FOSSIL', { type: 'PLAY_FOSSIL', iid: 'H5' }],
];
for (const [name, act] of OK_CASES) {
  T(`⭐${name} 必須可以本地預測（第二批放行的意義就在這）`, () => {
    assert.ok(OPTIMISTIC_ACTION_TYPES.has(name), `${name} 不在白名單`);
    const r = tryPredictAction(mk(), act, pool);
    assert.equal(r.ok, true, `預測被擋：${r.reason}`);
    assert.ok(r.predicted && r.predicted !== null, '沒有回傳預測盤面');
  });
}

// ── A2. fail-closed 負對照：該被擋的必須繼續被擋 ────────────────────────────
T('⭐⭐對手【黏美龍】｜黏滑失足在場時撤退要擲幣 → 必須被 randomness gate 擋住', () => {
  // ⚠ 這裡刻意**不用**「混亂狀態撤退」當負對照：現行規則的混亂只影響使用招式（擲幣、反面自傷），
  //   撤退不受影響 ⇒ 那條路徑本來就是確定性的，拿它當負對照會是錯的期待。
  const goodra = all.find((c) => c.name === '黏美龍' && (c.abilities ?? []).some((a) => a.name === '黏滑失足'));
  assert.ok(goodra, '找不到帶「黏滑失足」的黏美龍 —— 錨點過期');
  const st = mk();
  st.players[1].bench = [inst(goodra.id, 'G1')];
  const r = tryPredictAction(st, { type: 'RETREAT', newActiveIid: 'B1' }, pool);
  assert.equal(r.ok, false, '對手黏滑失足在場還預測撤退成功（伺服器擲反面就會不同步）');
  assert.ok(/randomness/.test(r.reason), `擋下來的理由不對：${r.reason}`);
});
T('⭐⭐備戰滿時放基礎 → 不得預測（gate ⑤b：引擎回了淺拷貝但什麼都沒變）', () => {
  // ⚠ 實測發現：備戰滿時引擎正確地沒有放下去，但**回傳的是新物件**，
  //   所以只靠 `predicted === base` 的 gate ⑤ 判不出來 → v6.147 補了指紋比對的 gate ⑤b。
  const full = Array.from({ length: 5 }, (_, i) => inst(plainBasic.id, 'F' + i));
  const r = tryPredictAction(mk({ bench: full }), { type: 'PLAY_BASIC', iid: 'H1' }, pool);
  assert.equal(r.ok, false, '備戰滿還預測放得下去');
  assert.ok(/engine-rejected|no-op/.test(r.reason), `擋下來的理由不對：${r.reason}`);
});
T('⭐⭐EVOLVE 不得放進白名單（建新實例會產新 iid → 伺服器 sanitize 會讓後續效果靜默消失）', () => {
  assert.ok(!OPTIMISTIC_ACTION_TYPES.has('EVOLVE'), 'EVOLVE 被放進白名單了');
  const r = tryPredictAction(mk(), { type: 'EVOLVE', fromIid: 'A1', toIid: 'H2' }, pool);
  assert.equal(r.ok, false);
  // 就算有人硬放進白名單，底層 gate 也必須擋住 —— 這條驗的是「gate 本身還有效」
  const r2 = tryPredictAction(mk(), { type: 'EVOLVE', fromIid: 'A1', toIid: 'H2' }, pool,
    { allowedTypes: new Set(['EVOLVE']) });
  assert.equal(r2.ok, false, `硬放行後 gate 沒擋住：${JSON.stringify(r2)}`);
  assert.ok(/randomness|iid-set-changed/.test(r2.reason), `擋下來的理由不對：${r2.reason}`);
});
T('⭐PLAY_TRAINER 不得放進白名單（第一段就會開 picker）', () => {
  assert.ok(!OPTIMISTIC_ACTION_TYPES.has('PLAY_TRAINER'), 'PLAY_TRAINER 被放進白名單了');
});
T('⭐END_TURN 不得放進白名單（換手一律等伺服器）', () => {
  assert.ok(!OPTIMISTIC_ACTION_TYPES.has('END_TURN'), 'END_TURN 被放進白名單了');
  const r = tryPredictAction(mk(), { type: 'END_TURN' }, pool, { allowedTypes: new Set(['END_TURN']) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'turn-flipped');
});
T('白名單只會成長、不會被誤刪（第一批的 ATTACH_ENERGY 仍在）', () => {
  assert.ok(OPTIMISTIC_ACTION_TYPES.has('ATTACH_ENERGY'));
  assert.equal(OPTIMISTIC_ACTION_TYPES.size, 4, `白名單大小 ${OPTIMISTIC_ACTION_TYPES.size}，新增/移除請一併更新本守衛`);
});
T('⭐⭐gate ⑤b：引擎回了淺拷貝但盤面完全沒變 → 必須判成不預測（USE_STADIUM 假陽性就是這樣被抓回來的）', () => {
  // 場上沒有場地卡時 USE_STADIUM 什麼都不會做，但引擎回的是新物件。
  // 舊的 gate ⑤（物件同一性）判不出來 → 會把「什麼都沒發生」當成預測畫上去。
  const r = tryPredictAction(mk(), { type: 'USE_STADIUM' }, pool, { allowedTypes: new Set(['USE_STADIUM']) });
  assert.equal(r.ok, false, 'no-op 竟然被當成有效預測');
  assert.equal(r.reason, 'no-op');
});

// ── B. UI busy 態（靜態，剝註解後比對）─────────────────────────────────────
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const RAW_P = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const RAW_M = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');
const P = stripComments(RAW_P), M = stripComments(RAW_M);

T('掃描器自我驗證：註解確實被剝掉（本版註解裡也寫滿 actionBusy）', () => {
  assert.equal(RAW_P.length, P.length, 'stripComments 必須等長替換');
  assert.ok(RAW_P.includes('唯一**的視覺 busy 述詞'), '前提：被測檔應含本版註解');
  assert.ok(!P.includes('唯一**的視覺 busy 述詞'), '註解沒被剝掉 → 下面的斷言不可信');
});
T('⭐⭐actionBusy 必須是唯一中央述詞，且只在錦標賽動作送出期間為真', () => {
  const m = P.match(/const actionBusy\s*=\s*\$derived\(([^)]*)\)/);
  assert.ok(m, '找不到 actionBusy 的 $derived 宣告');
  // ⭐⭐⭐v6.172：actionBusy 由「有動作在途」收緊成「有動作在途**且佇列已滿**」。
  //   原因：v6.170 的重送窗讓 tInFlight 最長 33 秒，舊定義等於把玩家鎖死 33 秒
  //   （手牌拖曳被靜默丟棄）。「有沒有在送」改由 actionSending 表示（純視覺、不擋操作）。
  //   本條斷言的意圖不變：**只能有一個中央述詞**，而且只在錦標賽動作路徑上為真。
  assert.ok(/tActQueue\.length >= TACT_QUEUE_MAX/.test(m[1]),
    'actionBusy 必須只在佇列已滿時為真（否則又會鎖死玩家）：' + m[1]);
  const ms = P.match(/const actionSending\s*=\s*\$derived\(([^)]*)\)/);
  assert.ok(ms && /isTournament && tInFlight/.test(ms[1]), '找不到 actionSending（純視覺的送出中述詞）');
  assert.ok(/isTournament/.test(m[1]) && /tInFlight/.test(m[1]),
    `actionBusy 應由 isTournament && tInFlight 算出，實際：${m[1]}`);
});
T('⭐⭐所有會送出動作的關鍵按鈕都要綁 actionBusy（v6.137 的教訓：加了旗標卻沒有任何 template 綁定）', () => {
  const need = [
    ['招式鈕', /disabled=\{actionBusy\|\|!availableAttacks/],
    ['結束回合', /disabled=\{actionBusy\} onclick=\{\(\)=>dispatch\(GameActions\.endTurn\(\)\)\}>⏭/],
    ['使用場地', /stadium-btn" disabled=\{actionBusy\}/],
    ['撤退送出', /retreat-pick" disabled=\{actionBusy\}/],
    ['進化送出', /evo-choice wide-evo" disabled=\{actionBusy\}/],
    ['場上特性', /ability-btn" disabled=\{actionBusy\}/],
    ['備戰特性', /ability-btn-sm" disabled=\{actionBusy\}/],
    ['取獎賞', /btn-xs primary" disabled=\{actionBusy\}/],
    ['picker 確認', /disabled=\{actionBusy\|\|!selectionValid\}/],
    ['picker 放棄', /disabled=\{actionBusy\} onclick=\{abandonSelection\}/],
    ['補位確認(防守方)', /disabled=\{actionBusy\|\|!_pickOkD\}/],
    ['補位確認(自KO)', /disabled=\{actionBusy\|\|!_pickOkS\}/],
    // ⭐v6.172 這四處由「靜默 return」改成「講出來再 return」（tActSay），gate 本身還在。
    // ⭐v6.200：可拖與否改問中央述詞 handCardDraggable(ops)（拖曳與點擊同源），gate 本身不變。
    ['手牌拖曳 gate', /if\(handCardDraggable\(ops\)\)\{ if\(actionBusy\)\{tActSay\(TACT_BLOCKED_MSG,5000\);\} else startDrag/],
    // ⭐ Fable 5 審查抓到的缺口：拖曳派已擋，但**點擊派**（點手牌能量→點目標）整條沒查，
    //   而附能是最高頻動作。函式端與 onclick 端都要 gate。
    ['點擊派附能', /function onAttachEnergy\(targetIid: string\) \{\s*if \(!selectedEnergyIid\) return;[\s\S]{0,600}?if \(actionBusy\) \{ tActSay\(TACT_BLOCKED_MSG, 5000\); return; \}/],
    ['手牌特性(點擊)', /function triggerHandActivateAbility\(handIid: string\): void \{\s*if \(actionBusy\) \{ tActSay\(TACT_BLOCKED_MSG, 5000\); return; \}/],
    ['手牌 onclick', /onclick=\{\(\)=>\{if\(actionBusy\)\{tActSay\(TACT_BLOCKED_MSG,5000\);return;\}/],
    // setup / mulligan 是 CAS 衝突歷史事故最密集的區段
    ['準備完成', /disabled=\{actionBusy\|\|!myPlayer\?\.active\}/],
    ['完成補抽', /disabled=\{actionBusy\}\s*\n\s*onclick=\{\(\)=>dispatch\(GameActions\.finishMulliganPostBench/],
    ['開局重抽', /disabled=\{actionBusy\} onclick=\{\(\) => dispatch\(GameActions\.openingMulligan/],
    ['開局保留', /disabled=\{actionBusy\} onclick=\{\(\) => dispatch\(GameActions\.openingKeep/],
  ];
  const miss = need.filter(([, re]) => !re.test(P)).map(([n]) => n);
  assert.deepEqual(miss, [], '這些送出點沒綁 actionBusy：' + miss.join('、'));
});
T('⭐手機直式必須拿得到 actionBusy（子元件，不傳就永遠是 false＝靜默失效）', () => {
  assert.ok(/actionBusy\?: boolean;/.test(M), 'MobilePortraitBattle 的 Props 沒有 actionBusy');
  assert.ok(/actionBusy = false,/.test(M), '$props() 解構沒有 actionBusy 預設值');
  assert.ok(/actionBusy=\{actionBusy\}/.test(P), '父層沒有把 actionBusy 傳給 MobilePortraitBattle');
  for (const [name, re] of [
    ['sheet 動作鈕', /disabled=\{a\.disabled \|\| actionBusy\}/],
    ['pick 目標鈕', /mp-pick-btn" disabled=\{actionBusy\}/],
    ['結束回合', /mp-end-btn" disabled=\{actionBusy\}/],
    ['手牌卡', /mp-hand-card"[^>]*disabled=\{actionBusy\}/],
    ['準備完成', /disabled=\{actionBusy \|\| !myPlayer\.active\}/],
    ['完成補抽', /disabled=\{actionBusy\}\s*\n\s*onclick=\{\(\) => onAction\(GameActions\.finishMulliganPostBench/],
  ]) assert.ok(re.test(M), `手機版「${name}」沒綁 actionBusy`);
});
T('⭐兩個自動計時器（自動取獎／自動結束回合）撞上送出中要跳過，不得噴莫名紅字給玩家', () => {
  for (const [name, re] of [
    // ⭐v6.172：自動計時器改守 actionSending —— actionBusy 已改成「佇列已滿」，
    //   繼續守它會讓自動動作被排進佇列，網路恢復時補送一個玩家早就不想要的動作。
    ['自動取獎', /if \(actionSending\) return;\s*\n\s*dispatch\(GameActions\.takePrizes/],
    ['自動結束回合', /if \(actionSending\) return;[^\n]*\n\s*dispatch\(GameActions\.endTurn\(\)\);/],
  ]) assert.ok(re.test(P), `「${name}」沒有 actionBusy 早退`);
});
T('⭐不得改用全畫面遮罩（網路卡住時玩家會連設定/離開都按不了）', () => {
  assert.ok(!/class:busy-overlay|actionBusy[^\n]*pointer-events\s*:\s*none/.test(P),
    '出現全域遮罩式的 busy 實作 —— tApi 有 12 秒逾時，全域鎖會把玩家鎖死');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
