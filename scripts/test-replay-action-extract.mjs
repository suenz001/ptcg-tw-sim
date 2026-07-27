// 守衛：「從回放學打法」管線的**資料前提**必須持續成立。
//
// 背景：要從錦標賽回放學玩家打法，最怕的是「以為學得到、其實資料裡根本沒有」。
//   原本以為半回合快照只看得到淨效果、時序全丟 —— 實際查證後發現 GameState 裡本來就存著
//   **turnActionsLog**（v5.055 為了「對手回合動作面板」而加），欄位是
//   `{ turn, actions: ActionRecord[] }`，ActionRecord 有
//   `type`(play_hand/attack/retreat/use_ability/discard) + `cardId` + `extra`(招式名/特性名)，
//   而且是**按執行順序**存的 → 動作序列完整可還原。
//
// 這份守衛盯兩件事，兩件都「壞了不會有任何錯誤訊息」：
//   ① **行為**：真的跑一場對局，確認 turnActionsLog 真的有按序記錄動作。
//      若哪天引擎不再記錄（或改了欄位名），離線分析腳本會安靜地抽出一片空白，
//      看起來就像「這些玩家什麼都沒做」。
//   ② **契約**：VM 上的抽取腳本 survey-archetype-replays.cjs 讀的欄位名，
//      必須與引擎實際產出的一致 —— 兩邊分處不同 repo 路徑、沒有型別連結，是典型漂移點。
//   ③ **隱私/正確性**：抽取腳本**不得**輸出手牌或牌庫內容。快照存了雙方完整手牌與牌庫，
//      分析端看得到玩家當下看不到的東西；不設防就會「學」到
//      「牌庫頂是能量時他就不用交易」這種巧合 —— 固化進 AI 等於植入作弊知識。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

const CJS = readFileSync(join(ROOT, 'oracle-admin/tournament/survey-archetype-replays.cjs'), 'utf8');

// ── 跑一場真的對局，拿真實的 GameState ────────────────────────────────────
const S = join(ROOT, '.x-rae-s.js'), E = join(ROOT, '.x-rae-e.ts'), O = join(ROOT, '.x-rae-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { getAIAction } from './src/lib/game/ai';\nimport './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// 用 sim-ai-battle 同一套預設牌組（已知能跑完整局）
const DECK = [
  ['16622', 3], ['16597', 2], ['16554', 4], ['16555', 2], ['16593', 2], ['16592', 2], ['16607', 2],
  ['17122', 4], ['17119', 3], ['17141', 3], ['17111', 2], ['17105', 2], ['17143', 1],
  ['17134', 3], ['17127', 1], ['17195', 2], ['17200', 4], ['17165', 3], ['17198', 1],
  ['17216', 14],
].map(([cardId, count]) => ({ cardId, count }));

/**
 * ⚠固定亂數種子。第一版沒固定，結果同一支測試有時累積 4 個回合紀錄、有時 0 個 ——
 *   對局有擲幣與洗牌，AI 走到哪裡是隨機的。CI 上隨機紅燈的守衛比沒有守衛更糟
 *   （會被當雜訊忽略）。用確定性 PRNG 讓這場對局每次都走同一條路。
 */
function withSeededRandom(seed, fn) {
  const orig = Math.random;
  let a = seed >>> 0;
  Math.random = () => {           // mulberry32
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return fn(); } finally { Math.random = orig; }
}

function playOneGame(maxIter = 4000) {
  let st = mod.createGame({ name: 'A', entries: DECK }, { name: 'B', entries: DECK }, pool);
  let rejected = 0;
  for (let i = 0; i < maxIter && st.phase !== 'game-over'; i++) {
    let actor;
    if (st.phase === 'setup') {
      // ⚠setup 的「誰該動作」順序照抄 scripts/sim-ai-battle.mjs（那支能穩定跑完整局）：
      //   欠 mulligan 補抽者最優先 → 未 setupDone 者 → **兩邊都 done 時回 0**。
      //   第一版最後那格寫成 1，結果雙方都 setupDone 後 getAIAction 一直回 null，
      //   對局卡在 setup、一個回合紀錄都收不到（而錯誤訊息只說「實得 0」，看不出是這裡）。
      const mul = st.pendingMulliganDraw ?? [0, 0];
      actor = mul[0] > 0 ? 0 : (mul[1] > 0 ? 1 : (!st.setupDone[0] ? 0 : (!st.setupDone[1] ? 1 : 0)));
    } else if (st.pendingSelection) actor = st.pendingSelection.actorIdx;
    else if (st.players[0].active === null && st.players[0].bench.length > 0) actor = 0;
    else if (st.players[1].active === null && st.players[1].bench.length > 0) actor = 1;
    else actor = st.activePlayerIndex;
    const act = mod.getAIAction(st, pool, actor);
    if (!act) break;
    const next = mod.applyAction(st, act, pool);
    // 被引擎拒絕（state 完全沒變）容忍幾次再放棄 —— 一次就停會在正常的
    // 「AI 送出被 gate 擋下的動作」時提早結束，導致收集不到回合紀錄。
    if (next === st) { if (++rejected > 5) break; continue; }
    rejected = 0;
    st = next;
    // 打到有足夠的歷史回合就夠了，不必打完整局（CI 時間）
    const logs = st.players.flatMap((p) => p.turnActionsLog ?? []);
    if (logs.length >= 4) return st;
  }
  return st;
}
const state = withSeededRandom(20260727, () => playOneGame());

T('前提：對局真的推進到有歷史回合紀錄（否則後面全是空轉）', () => {
  const logs = state.players.flatMap((p) => p.turnActionsLog ?? []);
  assert.ok(logs.length >= 2, '應累積至少 2 個已結束回合，實得 ' + logs.length);
  console.log(`   跑到 turn=${state.turn}，累積 ${logs.length} 個回合紀錄`);
});

T('⭐⭐turnActionsLog 真的按序記錄動作（整條學習管線的地基）', () => {
  const logs = state.players.flatMap((p) => p.turnActionsLog ?? []);
  const withActions = logs.filter((l) => Array.isArray(l.actions) && l.actions.length > 0);
  assert.ok(withActions.length >= 1,
    '至少要有一個回合記到動作 —— 一片空白代表引擎不再記錄，離線分析會安靜地抽出空的打法表');
  const l = withActions[0];
  assert.ok(typeof l.turn === 'number', 'TurnActionLog 應有 turn');
  for (const a of l.actions) {
    assert.ok(typeof a.type === 'string', 'ActionRecord 應有 type');
    assert.ok(typeof a.cardId === 'string', 'ActionRecord 應有 cardId');
  }
  console.log('   樣本回合 ' + l.turn + '：' + l.actions.map((a) => a.type + (a.extra ? '(' + a.extra + ')' : '')).join(' → '));
});

T('⭐ActionRecord 的 type 值域與抽取腳本的假設一致', () => {
  const KNOWN = new Set(['play_hand', 'attack', 'retreat', 'use_ability', 'discard']);
  const seen = new Set();
  for (const p of state.players) for (const l of (p.turnActionsLog ?? [])) for (const a of (l.actions ?? [])) seen.add(a.type);
  const unknown = [...seen].filter((t) => !KNOWN.has(t));
  assert.deepEqual(unknown, [], '出現抽取腳本不認識的動作型別：' + unknown.join('、'));
  // 抽取腳本要判到的兩個關鍵型別
  for (const t of ['use_ability', 'attack']) {
    assert.ok(CJS.includes("'" + t + "'"), '抽取腳本應處理 ' + t);
  }
});

T('⭐⭐契約：抽取腳本讀的欄位名，引擎真的有產出（兩邊沒有型別連結，是典型漂移點）', () => {
  const NEEDED = ['turnActionsLog', 'actions', 'cardId', 'extra', 'bench', 'active', 'prizes', 'hand'];
  for (const f of NEEDED) {
    assert.ok(CJS.includes(f), '抽取腳本應讀 ' + f);
  }
  const p0 = state.players[0];
  assert.ok(Array.isArray(p0.turnActionsLog), '引擎應產出 turnActionsLog');
  for (const f of ['bench', 'active', 'prizes', 'hand']) {
    assert.ok(f in p0, 'PlayerState 應有 ' + f);
  }
});

T('⭐⭐抽取腳本不得輸出手牌／牌庫**內容**（只能有張數）—— 防上帝視角污染', () => {
  // 找出 sample 物件的建構區塊，逐欄檢查
  const i = CJS.indexOf('sampleTurns.push({');
  assert.ok(i > 0, '應有 sampleTurns.push');
  const body = CJS.slice(i, CJS.indexOf('});', i));
  assert.ok(/myHandCount/.test(body), '手牌只能放張數');
  assert.ok(!/\bmyHand\b\s*:/.test(body), '不可放手牌內容');
  assert.ok(!/deck/i.test(body), '不可放任何牌庫資訊 —— 那是玩家當下看不到的');
  // 對手側只能放公開資訊（獎賞剩幾張）
  assert.ok(!/oppHand|oppDeck|opponentHand/i.test(body), '不可放對手手牌／牌庫');
  // 輸出檔要自我聲明，讓之後讀這份 JSON 的人（或模型）知道邊界
  assert.ok(/不含任何手牌內容與牌庫內容/.test(CJS), '輸出 JSON 應註明資料邊界');
});

T('⭐座位判定用玩家暱稱比對，不可硬猜 seat', () => {
  // archive 只有 uid、快照只有 name，name 是唯一能把兩邊接起來的欄位；
  // 猜錯座位會把「對手的打法」當成「這位高手的打法」學進去，而且完全不會報錯。
  const i = CJS.indexOf('let mySeat = -1');
  assert.ok(i > 0, '應有座位判定');
  const body = CJS.slice(i, i + 400);
  assert.ok(/\.name === q\.name/.test(body), '應以暱稱比對決定座位');
  assert.ok(/mySeat < 0/.test(body) && /matchesSkipped/.test(body), '對不上要跳過該場，不可硬猜');
});

T('⭐log 是中文自然語言、字面不是 API：抽不到要能看出是措辭變了', () => {
  assert.ok(/暗黑底牌：使用/.test(CJS), '應抽暗黑底牌複製了哪招');
  assert.ok(/交易：丟棄/.test(CJS), '應抽交易丟了什麼');
  assert.ok(/措辭改過/.test(CJS),
    '命中 0 時要明講「可能是措辭變了」——否則會被讀成「玩家沒用過這張卡」');
});

T('⭐⭐log 行的欄位名是 message（第一版寫成 text，整份 log 靜默失效）', () => {
  // 真實事故：第一次跑真資料，暗黑底牌與「交易丟棄」一條都沒抽到。
  //   守衛當時只檢查「措辭與 six_decks.ts 一致」→ 全綠，於是提示指向「措辭改過」，
  //   但真根因是抽取端讀 `line.text`，而 LogEntry 的欄位是 **message** ——
  //   每一行都變成空字串被 continue 掉。措辭再怎麼對也沒用。
  const types = readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8');
  const i = types.indexOf('export interface LogEntry');
  const body = types.slice(i, types.indexOf('\n}', i));
  assert.ok(/^\s*message:\s*string;/m.test(body), 'LogEntry 的公開訊息欄位應為 message');
  assert.ok(/line\.message/.test(CJS), '抽取腳本必須讀 line.message');
});

T('⭐⭐必須分得出「log 沒讀到」與「讀到了但措辭不符」', () => {
  // 這兩種失敗的處置完全不同（一個要修取 log 的路徑、一個要改正則），
  // 混在一起報就會像這次一樣把人指向錯誤方向、白繞一圈。
  assert.ok(/logLinesRead/.test(CJS) && /logLinesMatched/.test(CJS),
    '要分別統計「讀到幾行」與「解析出幾行」');
  assert.ok(/一行 log 都沒讀到/.test(CJS), '零行時要明講是取 log 的路徑壞了');
  assert.ok(/這才真的是措辭改過/.test(CJS), '只有在 log 讀得到且解析得出來時，才可以說是措辭問題');
  assert.ok(/logDiag/.test(CJS), '診斷數字要一併寫進輸出 JSON');
});

// 這兩條措辭必須與引擎當前實作一致（引擎改字 → 這裡就該紅）
T('⭐⭐抽取用的 log 措辭與引擎實作逐字一致', () => {
  const six = readFileSync(join(ROOT, 'src/lib/game/effects/cards/six_decks.ts'), 'utf8');
  assert.ok(six.includes('暗黑底牌：使用 ${nCard.name} 的「${pickedAtk.name}」'),
    '引擎的暗黑底牌 log 措辭已改，抽取用的正則要同步更新');
  assert.ok(six.includes('交易：丟棄 ${joinCardNames(picks, pool)}'),
    '引擎的交易 log 措辭已改，抽取用的正則要同步更新');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
