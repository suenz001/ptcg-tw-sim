// v6.267 守衛：套牌戰績（client 端）—— 放大鏡 UI ＋ `seats[].deckId` 寫入
//
// ── 這一版在做什麼 ────────────────────────────────────────────────────────
// 玩家許願：「牌組列表的 ✕ 旁邊放一個 🔍，看這一副牌的休閒勝率／對各原型的勝率」。
// 伺服器端（v6.266）已上線：`GET /api/deck-stats?deckId=`（哨兵 `deckStatsApi:1`）、
// `/api/match-result` 會從**房間 seat** 把 deckId 補進 matchRecords。
// ⚠⚠ 但房間 `seats[]` 在 v6.266 根本沒有 `deckId` 這個欄位 ⇒ 那段 enrich 是空轉的。
// 這一版把它接上，並加上 `/decks` 的放大鏡。
//
// ── 這支守衛怎麼證明（全部斷言到行為層或逐字集合，不是「字串存在」）──────────
//  【0】掃描器自我驗證（Rule 25：先證明掃描器抓得到東西、也判得出壞樣本）
//  【A】`seats[].deckId` 真的寫得進去（**實跑** room-oracle / room 的 setSeatDeck）
//       ＋ 座位被清空／換人坐時 deckId 必須一起清掉（否則會把對局記到前一位玩家的牌組上）
//  【B】`game/+page.svelte` 的 handleSetDeck **實跑**，證明第三個引數就是 `deck.id`
//  【C】`deck-stats.ts` 行為端：哨兵／429／網路錯誤／快取／防連點／三種資料情境
//  【D】⭐⭐ `/decks` 載入請求數：載入區段（onMount ＋ `$state(...)` 初始化）內
//       的網路呼叫點集合與 BASE **逐字相同**，且 `fetchDeckStats(` 出現 0 次（量測輸出會印出來）
//  【E】⭐⭐ Firestore 讀取次數：room.ts 的 setSeatDeck **實跑**並計數，getDoc=1／
//       getDocs=0／onSnapshot=0（絕對值，history-free），且與 BASE 同法量測相同
//  【F】既有牌組 CRUD 不變：`Deck.id` 仍是 `crypto.randomUUID()`、upsert/delete 行為實跑
//  【G】HEAD-FAIL：對真 BASE blob 跑，A~F 的每一條**各自**紅
//  【H】突變測試（7 條），每一條都必須紅在指定的位置
//
// ⚠⚠ 只捕捉 assert.AssertionError —— 其他例外（打錯字／抽取器壞掉）必須直接炸掉。
// Run: node scripts/test-v6267-deck-stats-client.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { countTokensStripped, stripCommentsChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// v6.266 的 sha（BASE 對照用；淺複製時大聲跳過，不 fail-open 成假綠）
const BASE_SHA = '63104f4e4c6d8dfc03d04f64369d0cc6f727b4e8';
// ⭐ v6.316：v6.267 自己的 sha。【Gc】改成比對 BASE..THIS 兩個**固定** commit（永不過期的可追溯證明），
//   不再拿**工作樹**跟 v6.266 逐位元比 —— 那是第九種安慰劑（pin 過期）：v6.309 合法改了 room.ts／room-oracle.ts
//   之後【Gc】在完整歷史下誤紅、淺複製 CI 又看不到。⚠ 不可以把 BASE_SHA 往前移（守衛會變成「跟自己比」＝恆真；
//   gcAgainst() 開頭的「THIS ≠ BASE」斷言擋這件事，H12 突變實證）。
//   「仍要守現況」的部分改成 history-free 的已知答案表（E3；FS_ROOM_EXPECTED／ORACLE_ROOM_EXPECTED）。
const THIS_SHA = '4ccfdff1c5ec485172397c9509200f12906e3646';

const P_DS = join(ROOT, 'src/lib/decks/deck-stats.ts');
const P_RO = join(ROOT, 'src/lib/game/room-oracle.ts');
const P_RT = join(ROOT, 'src/lib/game/room.ts');
const P_GP = join(ROOT, 'src/routes/game/+page.svelte');
const P_DK = join(ROOT, 'src/routes/decks/+page.svelte');
const P_ST = join(ROOT, 'src/lib/decks/storage.ts');

const readOr = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const DS = readOr(P_DS);      // 新檔：不存在時給空字串 ⇒ 下面每一條各自紅，不會整支崩掉
const RO = readFileSync(P_RO, 'utf8');
const RT = readFileSync(P_RT, 'utf8');
const GP = readFileSync(P_GP, 'utf8');
const DK = readFileSync(P_DK, 'utf8');
const ST = readFileSync(P_ST, 'utf8');

let pass = 0, fail = 0;
const T = async (n, f) => {
  try { await f(); console.log('  OK  ', n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};
const ok = (c, m) => assert.ok(c, m);
const esbuild = await import('esbuild');

// ══════════════════════════════════════════════════════════════════════════
// 共用抽取器（Rule 25：每一支都有下限斷言，抽不到東西一律當成掃描器壞掉）
// ══════════════════════════════════════════════════════════════════════════
/** 從 `start` 起，用括號配對抓出一整塊（含最外層的那一對）。 */
function matchBlock(src, startIdx, open, close) {
  const i = src.indexOf(open, startIdx);
  assert.ok(i >= 0, '找不到起始的 ' + open);
  let depth = 0, inStr = null, inTpl = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k], p = src[k - 1];
    if (inStr) { if (c === inStr && p !== '\\') inStr = null; continue; }
    if (c === '`' && p !== '\\') { inTpl ^= 1; continue; }
    if (inTpl) continue;
    if ((c === '"' || c === "'") && p !== '\\') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  assert.fail('括號沒有配對到底');
}
function extractFn(src, header, minLen, label) {
  const i = src.indexOf(header);
  assert.ok(i >= 0, '抽不到 ' + label + '（找不到 ' + header.trim().slice(0, 50) + '）');
  const body = matchBlock(src, i, '{', '}');
  const out = src.slice(i, src.indexOf(body, i) + body.length);
  assert.ok(out.length >= minLen, label + ' 只抽到 ' + out.length + ' 字元（下限 ' + minLen + '）—— 抽取器壞了？');
  return out;
}
// ⚠ 抽出來的是 `export async function …`，要在 new Function 裡跑必須先脫掉 export。
/**
 * 剝掉註解再數（Rule 25 第 4 條）。
 * ⚠ 這一條是實際被抓到的：v6.267 我自己在 Seat 的 JSDoc 裡寫了
 *   「見下方所有 `deckEntries: null, deckId: null` 的地方」，
 *   沒剝註解的話那一行會被算成第 10 個「清空座位」而誤報。
 * ⚠ 只剝 /* *\/ 區塊與整行註解，不做字串解析 —— 避免把含 `//` 的網址整行吃掉。
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
}
const ts2js = (s) => {
  const stripped = s.replace(/^export /, '');
  assert.ok(!/^export /.test(stripped), 'export 沒脫掉');
  return esbuild.transformSync(stripped, { loader: 'ts' }).code;
};

// ── ⭐ v6.316 history-free 已知答案表（E3／【Gc】用）────────────────────────────
//   room.ts 的 Firestore 呼叫點、room-oracle.ts 的 Oracle 請求呼叫點：**剝註解後**（中央 helper
//   scripts/lib/strip-comments.mjs，帶長度護欄＋正對照）逐 token 的確切數字。
//   ⚠ 這不是「拿新碼算出來的期望值」—— 是從 v6.266 (63104f4e)／v6.267 (4ccfdff1)／v6.315 (e73af91a) 三個 blob
//     量出來、再用一份獨立的 Python 行級狀態機重算核對後手抄進來的（三個 blob 的 room.ts 數字相同；
//     room-oracle.ts 的 oracleUpsertRoomDelta 在 v6.270 由 0 → 1，表寫的是現況）。
//   ⚠ 合法新增請求點時要**同步改表**（並在 changelog-internal 說明為什麼多一次讀取）；不可以放寬成 >=。
//   ⭐ v6.317：ORACLE_TOKENS 補上 v6.316 漏列的四支真請求 oraclePollRoom／oracleListMessages／oracleListRoomsCombined／oracleAuth
//     （審查者用「加一個 __probePoll 呼叫 oraclePollRoom」實證 v6.316 抓不到）。四格的期望值同樣是從
//     v6.266／v6.267／v6.315／v6.316 四個 blob 用獨立的 Python 行級狀態機量出後手抄（四個 blob 數字相同：1／2／1／1；
//     oracleAuth 在檔頭區塊註解裡還有一處，剝註解後不算）。
//   ⭐ 清單怎麼決定：room-oracle.ts 從 './oracle-client' import 進來、名字以 oracle 開頭的**每一個**符號都必須在表裡，
//     只有 ORACLE_NON_NET 白名單（純讀模組變數／localStorage，不發請求）例外 —— E3b 用 import 清單實跑核對，
//     以後多 import 一支請求 helper 卻沒進表會直接紅（H14 突變實證），不再靠人記得。
const FS_TOKENS = ['getDoc(', 'getDocs(', 'onSnapshot(', 'runTransaction(', 'tx.get(', 'setDoc(', 'updateDoc(', 'deleteDoc(', 'addDoc(', 'query(', 'collection('];
const FS_ROOM_EXPECTED = { 'getDoc(': 12, 'getDocs(': 1, 'onSnapshot(': 3, 'runTransaction(': 11, 'tx.get(': 11, 'setDoc(': 1, 'updateDoc(': 19, 'deleteDoc(': 4, 'addDoc(': 1, 'query(': 3, 'collection(': 4 };
const ORACLE_TOKENS = ['oracleGetRoom(', 'oracleUpsertRoom(', 'oracleUpsertRoomDelta(', 'oracleDeleteRoom(', 'oracleListRooms(', 'oracleApi(', 'fetch(',
  'oraclePollRoom(', 'oracleListMessages(', 'oracleListRoomsCombined(', 'oracleAuth('];
const ORACLE_ROOM_EXPECTED = { 'oracleGetRoom(': 3, 'oracleUpsertRoom(': 2, 'oracleUpsertRoomDelta(': 1, 'oracleDeleteRoom(': 2, 'oracleListRooms(': 2, 'oracleApi(': 1, 'fetch(': 0,
  'oraclePollRoom(': 1, 'oracleListMessages(': 2, 'oracleListRoomsCombined(': 1, 'oracleAuth(': 1 };
// 從 oracle-client import 進來、名字以 oracle 開頭但**不發請求**的符號（行為端：只讀 _uid／localStorage，見 oracle-client.ts oracleCurrentUid）
const ORACLE_NON_NET = ['oracleCurrentUid'];
/**
 * room-oracle.ts 從 './oracle-client' 進來的**每一個** import 語句（不只第一個），名字以 oracle 開頭的符號，以**本地名**回傳。
 * ⭐ v6.318（審查者兩種繞道實證 v6.317 都 53/0 綠）：
 *   ① 只 match 第一個 `import { … } from './oracle-client'` ⇒ 第二行 `import { oraclePollRoom as pollAlias } from './oracle-client'`
 *      （IDE 自動 import 會產生的形狀）沒被看到；而且 alias 原本取的是**匯入名**，`pollAlias(c, 0)` 的呼叫根本不在 token 表的口徑裡。
 *   ② `import * as oc from './oracle-client'` ＋ `oc.oraclePollMessages(c, 0)` 完全繞過。
 *   ⇒ 現在：matchAll 掃全部 import 語句（剝註解走行級 helper）、alias 以本地名計、namespace／default／動態 import() 一律斷言為 0。
 */
function oracleImportsOf(src) {
  const code = stripCommentsChecked(src, { label: 'room-oracle.ts', minRatio: 0.5, mustKeep: ["from './oracle-client'"] });
  const isOc = (spec) => /^['"]\.\/oracle-client(?:\.ts|\.js)?['"]$/.test(spec);
  const stmts = [...code.matchAll(/^[ \t]*import\s+([\s\S]*?)\s+from\s*(['"][^'"]+['"])/gm)].filter((m) => isOc(m[2]));
  assert.ok(stmts.length >= 1, 'room-oracle.ts 找不到 from ./oracle-client 的 import 語句');
  assert.strictEqual((code.match(/import\s*\(\s*['"]\.\/oracle-client/g) || []).length, 0, '⚠⚠ 動態 import(\'./oracle-client\') 繞過 token 表');
  assert.strictEqual((code.match(/require\s*\(\s*['"]\.\/oracle-client/g) || []).length, 0, '⚠⚠ require(\'./oracle-client\') 繞過 token 表');
  const names = [];
  for (const m of stmts) {
    const clause = m[1].trim();
    if (/^type\s/.test(clause)) continue;                                            // import type { … } ⇒ 編譯後消失
    assert.ok(!/\*\s*as\s+/.test(clause), '⚠⚠ namespace import（import * as）會讓 token 計數失效：' + clause);
    const br = clause.match(/\{([\s\S]*)\}/);
    assert.ok(br, '⚠⚠ default import 不在 token 表的口徑裡：' + clause);
    assert.ok(!clause.slice(0, br.index).trim(), '⚠⚠ default import 不在 token 表的口徑裡：' + clause);
    for (const part of br[1].split(',')) {
      const p = part.trim();
      if (!p || /^type\s/.test(p)) continue;
      const [imported, local] = p.split(/\s+as\s+/).map((x) => x.trim());
      if (/^oracle[A-Z]/.test(imported)) names.push(local || imported);            // alias 以本地名計（呼叫點長什麼樣就數什麼）
    }
  }
  assert.ok(names.length >= 8, '只抽到 ' + names.length + ' 個 oracle* import（下限 8）⇒ 抽取器壞了');
  return names;
}
const fsCountsRoom = (src) => countTokensStripped(src, FS_TOKENS, { label: 'room.ts', minRatio: 0.5, mustKeep: ['getDoc(', 'runTransaction('] });
const oracleCountsRoom = (src) => countTokensStripped(src, ORACLE_TOKENS, { label: 'room-oracle.ts', minRatio: 0.5, mustKeep: ['oracleGetRoom('] });

// ── 載入區段抽取（【D】用）─────────────────────────────────────────────────
//   「/decks 載入時會跑到的程式碼」＝ onMount(...) 整塊 ＋ 每一個 `$state(...)` 的初始化運算式。
//   ⚠ 這一頁沒有任何 `$effect(`（下面 D0 有下限／零值斷言，變了會紅）。
function loadPathOf(src, minMount = 2000, minInits = 20) {
  const i = src.indexOf('onMount(');
  assert.ok(i >= 0, '抓不到 onMount(');
  const mount = matchBlock(src, i, '(', ')');
  assert.ok(mount.length >= minMount, 'onMount 區塊只有 ' + mount.length + ' 字元 —— 抽取器壞了？');
  const inits = [];
  for (let k = src.indexOf('$state('); k >= 0; k = src.indexOf('$state(', k + 1)) {
    inits.push(matchBlock(src, k, '(', ')'));
  }
  assert.ok(inits.length >= minInits, '只抓到 ' + inits.length + ' 個 $state( —— 抽取器壞了？');
  return { mount, inits, all: mount + '\n' + inits.join('\n'), effects: (src.match(/\$effect\(/g) || []).length };
}
// 載入路徑上「可能發出網路請求」的呼叫點字典。⚠ 這份清單就是量測口徑。
const NET_TOKENS = [
  'fetch(', 'loadAllSets(', 'loadIndex(', 'loadDecksFromCloud(', 'syncDeckToCloud(',
  'removeDeckFromCloud(', 'loadFavoritesFromCloud(', 'saveFavoritesToCloud(',
  'signInAnonymously(', 'onAuthStateChanged(', 'getDoc(', 'getDocs(', 'setDoc(', 'onSnapshot(',
  'fetchDeckStats(',
];
// ⭐ 這一版在載入區段新增的**唯一**呼叫。它是純函式（只讀 env 與模組變數），
//   C10 用「一被呼叫就丟 AssertionError 的 fetch」呼叫它 200 次證明零請求。
//   所以它不在 NET_TOKENS 內，但 Ga 會把「兩版的差集恰好只有它」釘住。
const PURE_TOKENS = ['deckStatsHidden('];
function pureCallSites(text) {
  const out = [];
  for (const t of PURE_TOKENS) { const n = text.split(t).length - 1; if (n > 0) out.push(t + '×' + n); }
  return out.sort();
}
function netCallSites(text) {
  const out = [];
  for (const t of NET_TOKENS) {
    const n = (text.split(t).length - 1);
    if (n > 0) out.push(t + '×' + n);
  }
  return out.sort();
}

console.log('【0】掃描器自我驗證（Rule 25）');
await T('0-1 抽取器抓得到 setSeatDeck / handleSetDeck / onMount，且長度合理', () => {
  extractFn(RO, 'export async function setSeatDeck(', 200, 'room-oracle setSeatDeck');
  extractFn(RT, 'export async function setSeatDeck(', 200, 'room setSeatDeck');
  extractFn(GP, '  async function handleSetDeck() {', 200, 'handleSetDeck');
  loadPathOf(DK);
});
await T('0-2 對「人工植入的壞樣本」判得出來（正對照：判準真的在看東西）', () => {
  const probe = 'onMount(() => { fetchDeckStats("x"); loadIndex(); });\nlet a = $state(1);\nlet b = $state(2);';
  const lp = loadPathOf(probe, 20, 2);
  const sites = netCallSites(lp.all);
  assert.ok(sites.includes('fetchDeckStats(×1'), '掃描器抓不到植入的 fetchDeckStats ⇒ 【D】全是假綠：' + sites.join(','));
  assert.ok(sites.includes('loadIndex(×1'), '掃描器抓不到 loadIndex');
});
await T('0-2b [正對照] stripComments 真的會把註解裡的假樣本剔掉（否則 A4 會誤報）', () => {
  const probe = 'const a = { deckEntries: null, ready: 1 };\n  // 見 deckEntries: null, 的地方\n/** x deckEntries: null, y */\n';
  assert.strictEqual(probe.split('deckEntries: null,').length - 1, 3, '樣本自己就不對');
  assert.strictEqual(stripComments(probe).split('deckEntries: null,').length - 1, 1, 'stripComments 沒剝掉註解');
});
await T('0-3 括號配對器不會被字串／樣板字面內的括號騙倒', () => {
  const s = 'f({ a: "}{", b: `${x})(`, c: 1 })';
  assert.strictEqual(matchBlock(s, 0, '(', ')'), s.slice(1));
  assert.strictEqual(matchBlock(s, 0, '{', '}'), '{ a: "}{", b: `${x})(`, c: 1 }');
});

// ══════════════════════════════════════════════════════════════════════════
// 【A】seats[].deckId 寫得進去，而且座位換人時清得掉
// ══════════════════════════════════════════════════════════════════════════
console.log('【A】seats[].deckId（room-oracle：正式站走這一份）');

function loadOracleSetSeatDeck(roSrc) {
  const js = ts2js(extractFn(roSrc, 'export async function setSeatDeck(', 200, 'room-oracle setSeatDeck'));
  const captured = [];
  const fn = new Function('getMyUid', 'oracleTx', 'findMySeatIdx', 'computeMemberUids', 'captured',
    js + '\n;return setSeatDeck;')(
    async () => 'U1',
    async (code, f) => { const out = await f(captured.shift()); captured.push(out); return out; },
    (seats, uid) => seats.findIndex((s) => s.uid === uid),
    (seats) => seats.filter((s) => s.uid).map((s) => s.uid),
    captured,
  );
  return { fn, captured };
}
const seed = () => ({ status: 'lobby', seats: [
  { role: 'p1', uid: 'U1', name: 'A', deckEntries: null, ready: false },
  { role: 'p2', uid: 'U2', name: 'B', deckEntries: null, ready: false },
  { role: 'spectator', uid: null, name: null, deckEntries: null, ready: false },
] });

await T('A1 ⭐⭐ setSeatDeck(code, entries, deckId) 把 deckId 寫進自己的座位（實跑）', async () => {
  const { fn, captured } = loadOracleSetSeatDeck(RO);
  captured.push(seed());
  await fn('AAAA', [{ cardId: 'x', count: 60 }], 'd-11111111-2222-3333');
  const out = captured.pop();
  assert.strictEqual(out.seats[0].deckId, 'd-11111111-2222-3333', 'p1 的 deckId 沒寫進去（實得 ' + out.seats[0].deckId + '）');
  assert.deepStrictEqual(out.seats[0].deckEntries, [{ cardId: 'x', count: 60 }], 'deckEntries 被改壞了');
  assert.strictEqual(out.seats[0].ready, false, 'ready 沒有被重置（既有行為）');
  assert.ok(!('deckId' in out.seats[1]) || out.seats[1].deckId === undefined, '動到了對手的座位');
});
await T('A2 沒帶 deckId ⇒ 寫 null（不是保留舊值；否則換牌組後戰績會記到舊牌組上）', async () => {
  const { fn, captured } = loadOracleSetSeatDeck(RO);
  const s = seed(); s.seats[0].deckId = 'OLD-DECK-ID';
  captured.push(s);
  await fn('AAAA', [{ cardId: 'x', count: 60 }]);
  assert.strictEqual(captured.pop().seats[0].deckId, null);
});
await T('A3 ⭐⭐ 座位被清空／換人坐時 deckId 一起清掉（實跑 takeSeat；否則對局會記到前一位玩家的牌組）', async () => {
  const js = ts2js(extractFn(RO, 'export async function takeSeat(', 300, 'room-oracle takeSeat'));
  let out = null;
  const st = seed();
  st.seats[0].deckId = 'MINE'; st.seats[0].deckEntries = [{ cardId: 'x', count: 60 }];
  st.seats[1] = { role: 'p2', uid: null, name: null, deckEntries: null, ready: false, deckId: 'GHOST' };
  const takeSeat = new Function('getMyUid', 'oracleTx', 'findMySeatIdx', 'computeMemberUids', 'auth', 'ORACLE_SIDEEFFECT_TIMEOUT_MS', 'sink',
    js + '\n;return takeSeat;')(
    async () => 'U1',
    async (code, f) => { out = await f(st); return out; },
    (seats, uid) => seats.findIndex((s) => s.uid === uid),
    (seats) => seats.filter((s) => s.uid).map((s) => s.uid),
    { currentUser: { email: 'a@b.c' } }, 60000, null);
  await takeSeat('AAAA', 1);
  assert.strictEqual(out.seats[0].deckId, null, '離開的舊座位還留著 deckId（實得 ' + out.seats[0].deckId + '）');
  assert.strictEqual(out.seats[1].deckId, null, '新座位沿用了前一位玩家的 deckId（實得 ' + out.seats[1].deckId + '）—— 會把對局記到別人的牌組上');
  assert.strictEqual(out.seats[0].deckEntries, null, '既有的清空行為被改壞了');
});
await T('A4 ⭐ 兩份 room 檔內「清空座位」的每一處都同時清掉 deckId（枚舉，剝註解，含下限斷言）', () => {
  for (const [name, raw] of [['room.ts', RT], ['room-oracle.ts', RO]]) {
    const src = stripComments(raw);
    const clears = src.split('deckEntries: null,').length - 1;
    assert.ok(clears >= 9, name + ' 只找到 ' + clears + ' 處清空座位 —— 掃描器壞了？');
    const withDeckId = src.split('deckEntries: null, deckId: null,').length - 1;
    assert.strictEqual(withDeckId, clears, name + ' 有 ' + (clears - withDeckId) + ' 處清空座位沒有一起清 deckId');
  }
});
await T('A5 Seat 型別有 deckId 欄位，而且是 optional（舊房間沒有這個欄位也要能讀）', () => {
  const i = RT.indexOf('export interface Seat {');
  assert.ok(i >= 0, '找不到 Seat 介面');
  const body = matchBlock(RT, i, '{', '}');
  assert.ok(/\bdeckId\?: string \| null;/.test(body), 'Seat 沒有 optional 的 deckId 欄位');
});

// ══════════════════════════════════════════════════════════════════════════
// 【B】game/+page.svelte 真的把 deck.id 傳下去
// ══════════════════════════════════════════════════════════════════════════
console.log('【B】handleSetDeck 把 deck.id 一起送出（實跑）');
function loadHandleSetDeck(gpSrc, decks) {
  const js = ts2js(extractFn(gpSrc, '  async function handleSetDeck() {', 200, 'handleSetDeck'));
  const calls = [];
  const box = new Function('roomCode', 'myDeckId', 'allDecks', 'countDeckCards', 'setSeatDeck', 'calls',
    'let onlineError = "";\n' + js + '\n;return { handleSetDeck, err: () => onlineError };')(
    'AAAA', decks[0] && decks[0].id, decks,
    (entries) => entries.reduce((n, e) => n + e.count, 0),
    async (...a) => { calls.push(a); }, calls);
  return { box, calls };
}
await T('B1 ⭐⭐ setSeatDeck 收到第三個引數，而且逐字等於 deck.id', async () => {
  const d = { id: 'DECK-UUID-AAAA-BBBB', name: 'n', entries: [{ cardId: 'c', count: 60 }] };
  const { box, calls } = loadHandleSetDeck(GP, [d]);
  await box.handleSetDeck();
  assert.strictEqual(calls.length, 1, 'setSeatDeck 被呼叫 ' + calls.length + ' 次');
  assert.strictEqual(calls[0].length, 3, 'setSeatDeck 只收到 ' + calls[0].length + ' 個引數（deckId 沒送）');
  assert.strictEqual(calls[0][0], 'AAAA');
  assert.deepStrictEqual(calls[0][1], d.entries);
  assert.strictEqual(calls[0][2], 'DECK-UUID-AAAA-BBBB', '第三個引數不是 deck.id（實得 ' + calls[0][2] + '）');
});
await T('B2 [正對照] 60 張以外的牌組照舊被擋下、一發都不送（既有行為逐字不變）', async () => {
  const d = { id: 'X', name: 'n', entries: [{ cardId: 'c', count: 59 }] };
  const { box, calls } = loadHandleSetDeck(GP, [d]);
  await box.handleSetDeck();
  assert.strictEqual(calls.length, 0, '張數不對還是送出去了');
  assert.ok(/59/.test(box.err()), '錯誤訊息不見了：' + box.err());
});

// ══════════════════════════════════════════════════════════════════════════
// 【C】deck-stats.ts 行為端
// ══════════════════════════════════════════════════════════════════════════
console.log('【C】deck-stats.ts：哨兵 / 429 / 網路錯誤 / 快取 / 防連點 / 三種資料情境');
function loadDeckStats(dsSrc, { apiUrl = 'http://t.local' } = {}) {
  assert.ok(dsSrc.length > 3000, 'deck-stats.ts 只有 ' + dsSrc.length + ' 字元 —— 檔案不存在或被掏空');
  const marker = "(((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || ''";
  assert.ok(dsSrc.includes(marker), 'deck-stats.ts 的 apiBase() 不是預期的形狀 —— 注入點壞了');
  const prepped = dsSrc.replace(marker, JSON.stringify(apiUrl));
  assert.ok(!prepped.includes('import.meta'), '還有 import.meta 沒換掉');
  const js = esbuild.transformSync(prepped, { loader: 'ts', format: 'cjs' }).code;
  const m = { exports: {} };
  return { m, load: (fetchImpl) => { new Function('module', 'exports', 'fetch', js)(m, m.exports, fetchImpl); return m.exports; } };
}
const goodBody = (over = {}) => ({
  ok: true, deckStatsApi: 1, deckId: 'D1',
  casual: { scope: 'online-only', games: 10, wins: 6, losses: 4, draws: 0, winRate: 0.6 },
  vsArchetype: [{ name: '噴火龍ex', games: 6, wins: 5, losses: 1, draws: 0, winRate: 5 / 6 }],
  tournament: { status: 'not-collected', games: 0, wins: 0, losses: 0, draws: 0, winRate: null },
  since: 'v6.266', scanned: 10, truncated: false, scanCap: 5000, ...over,
});
const mkFetch = (respFn) => { const calls = []; const f = async (url, init) => { calls.push(url); return respFn(calls.length, url, init); }; f.calls = calls; return f; };
const jsonRes = (status, body) => ({ status, ok: status < 400, json: async () => body });

await T('C1 ⭐ 有資料：哨兵在 ⇒ ok，數字逐欄正規化，且 hidden 維持 false', async () => {
  const f = mkFetch(() => jsonRes(200, goodBody()));
  const mod = loadDeckStats(DS).load(f);
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.ok, true, '應該成功，實得：' + JSON.stringify(r));
  assert.strictEqual(r.data.casual.games, 10);
  assert.strictEqual(r.data.casual.winRate, 0.6);
  assert.strictEqual(r.data.vsArchetype[0].name, '噴火龍ex');
  assert.strictEqual(r.data.since, 'v6.266', '「自 v6.266 起計」的來源欄位不見了');
  assert.strictEqual(r.data.tournament.status, 'not-collected', '錦標賽狀態欄不見了（UI 要靠它顯示「累積中」）');
  assert.strictEqual(mod.deckStatsHidden(), false);
  assert.strictEqual(f.calls.length, 1);
  assert.ok(String(f.calls[0]).includes('/api/deck-stats?deckId=D1'), '打錯端點：' + f.calls[0]);
});
await T('C2 ⭐ 零場次：games=0、winRate=null ⇒ 仍然是 ok（不可當成錯誤）', async () => {
  const f = mkFetch(() => jsonRes(200, goodBody({
    casual: { scope: 'online-only', games: 0, wins: 0, losses: 0, draws: 0, winRate: null },
    vsArchetype: [], scanned: 0,
  })));
  const mod = loadDeckStats(DS).load(f);
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.casual.games, 0);
  assert.strictEqual(r.data.casual.winRate, null, 'winRate 被誤轉成 0 ⇒ UI 會顯示 0.0% 騙玩家');
  assert.deepStrictEqual(r.data.vsArchetype, []);
});
await T('C3 ⭐ truncated 為真：旗標與 scanCap 都要留給 UI 講給玩家聽', async () => {
  const f = mkFetch(() => jsonRes(200, goodBody({ truncated: true, scanned: 5000, scanCap: 5000 })));
  const mod = loadDeckStats(DS).load(f);
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.data.truncated, true);
  assert.strictEqual(r.data.scanCap, 5000);
});
await T('C4 ⭐⭐ 哨兵缺席（舊伺服器 404 / 自我停用 503）⇒ unsupported、hidden 變 true、**之後一發都不再打**', async () => {
  const f = mkFetch(() => jsonRes(503, { error: 'deck-stats 尚未就緒（索引未建立）' }));
  const mod = loadDeckStats(DS).load(f);
  assert.strictEqual(mod.deckStatsHidden(), false, '還沒問過就先藏起來 ⇒ 功能永遠出不來');
  const r1 = await mod.fetchDeckStats('D1');
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.unsupported, true);
  assert.strictEqual(mod.deckStatsHidden(), true, '哨兵缺席之後沒有記住');
  const r2 = await mod.fetchDeckStats('D2');
  const r3 = await mod.fetchDeckStats('D3');
  assert.strictEqual(r2.unsupported, true);
  assert.strictEqual(r3.unsupported, true);
  assert.strictEqual(f.calls.length, 1, '記住之後又多打了 ' + (f.calls.length - 1) + ' 發');
});
await T('C5 ⭐⭐ 429 限流**不可以**被當成「不支援」（伺服器明明支援，只是這一刻太頻繁）', async () => {
  const f = mkFetch(() => jsonRes(429, { error: '請求過於頻繁（每分鐘最多 30 次）' }));
  const mod = loadDeckStats(DS).load(f);
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.unsupported, false, '429 被誤判成不支援 ⇒ 放大鏡會被永久藏掉');
  assert.strictEqual(mod.deckStatsHidden(), false);
});
await T('C6 ⭐ 網路錯誤（玩家自己斷線）也不可以藏掉放大鏡', async () => {
  const f = mkFetch(() => { throw new Error('Failed to fetch'); });
  const mod = loadDeckStats(DS).load(f);
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.unsupported, false);
  assert.strictEqual(mod.deckStatsHidden(), false);
});
await T('C7 ⭐⭐ 快取：同一副牌 60 秒內再點 ⇒ fromCache、fetch 次數維持 1', async () => {
  const f = mkFetch(() => jsonRes(200, goodBody()));
  const mod = loadDeckStats(DS).load(f);
  const a = await mod.fetchDeckStats('D1');
  const b = await mod.fetchDeckStats('D1');
  assert.strictEqual(a.fromCache, false);
  assert.strictEqual(b.fromCache, true, '第二次沒有走快取');
  assert.strictEqual(f.calls.length, 1, '快取沒生效，打了 ' + f.calls.length + ' 發');
  const c = await mod.fetchDeckStats('D2');   // 另一副牌不共用快取（正對照）
  assert.strictEqual(c.fromCache, false);
  assert.strictEqual(f.calls.length, 2);
});
await T('C8 ⭐⭐ 防連點：同一副牌連點 6 下 ⇒ fetch 只被呼叫 1 次，6 個呼叫都拿到同一份結果', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = mkFetch(async () => { await gate; return jsonRes(200, goodBody()); });
  const mod = loadDeckStats(DS).load(f);
  const ps = [0, 1, 2, 3, 4, 5].map(() => mod.fetchDeckStats('D1'));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(f.calls.length, 1, '連點 6 下打了 ' + f.calls.length + ' 發');
  release();
  const rs = await Promise.all(ps);
  assert.ok(rs.every((r) => r.ok && r.data.casual.games === 10), '有呼叫沒拿到結果');
  assert.strictEqual(f.calls.length, 1);
});
await T('C9 ⭐⭐ 沒有 VITE_ORACLE_API_URL（GitHub Pages 測試站）⇒ hidden=true 且**零請求**', async () => {
  const f = mkFetch(() => jsonRes(200, goodBody()));
  const mod = loadDeckStats(DS, { apiUrl: '' }).load(f);
  assert.strictEqual(mod.deckStatsHidden(), true);
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.unsupported, true);
  assert.strictEqual(f.calls.length, 0, '沒有 API 位址卻還是打了 ' + f.calls.length + ' 發');
});
await T('C10 ⭐⭐⭐ deckStatsHidden() 是純函式：呼叫 200 次一發請求都不發（這是「載入不多打」的根據）', async () => {
  const f = mkFetch(() => { throw new assert.AssertionError({ message: 'deckStatsHidden() 竟然發了請求' }); });
  const mod = loadDeckStats(DS).load(f);
  for (let i = 0; i < 200; i++) mod.deckStatsHidden();
  assert.strictEqual(f.calls.length, 0);
});

// ══════════════════════════════════════════════════════════════════════════
// 【D】/decks 載入的請求數（⭐ 量測，Rule 32）
// ══════════════════════════════════════════════════════════════════════════
console.log('【D】/decks 載入路徑的網路呼叫點（量測）');
const lpNow = loadPathOf(DK);
const sitesNow = netCallSites(lpNow.all);
console.log('        修後載入區段：onMount ' + lpNow.mount.length + ' 字元、$state 初始化 ' + lpNow.inits.length + ' 個、$effect ' + lpNow.effects + ' 個');
console.log('        修後載入區段的網路呼叫點：' + sitesNow.join('  '));
await T('D0 /decks 沒有任何 $effect（載入路徑只有 onMount ＋ $state 初始化，量測口徑成立）', () => {
  assert.strictEqual(lpNow.effects, 0, '出現了 ' + lpNow.effects + ' 個 $effect ⇒ 量測口徑要重寫');
});
await T('D1 ⭐⭐⭐ 載入區段內 fetchDeckStats( 出現 0 次（頁面載入不可以多打任何一發）', () => {
  assert.ok(!sitesNow.some((s) => s.startsWith('fetchDeckStats(')),
    '載入區段出現了 fetchDeckStats：' + sitesNow.join(','));
});
await T('D2 ⭐ deckStatsHidden( 只在 $state(...) 初始化裡出現恰 1 次（純函式、不發請求，見 C10）', () => {
  const inMount = (lpNow.mount.split('deckStatsHidden(').length - 1);
  const inInit = (lpNow.inits.join('\n').split('deckStatsHidden(').length - 1);
  assert.strictEqual(inMount, 0, 'onMount 內出現了 deckStatsHidden ' + inMount + ' 次');
  assert.strictEqual(inInit, 1, '$state 初始化內出現 ' + inInit + ' 次（應為 1）');
});
await T('D3 ⭐ 放大鏡是「點下去才打」：fetchDeckStats 只出現在 openDeckStats 內，且恰 1 次', () => {
  const total = DK.split('fetchDeckStats(').length - 1;
  const fn = extractFn(DK, '  async function openDeckStats(d: Deck) {', 200, 'openDeckStats');
  const inFn = fn.split('fetchDeckStats(').length - 1;
  assert.strictEqual(inFn, 1, 'openDeckStats 內呼叫了 ' + inFn + ' 次');
  assert.strictEqual(total, 1, '全檔出現 ' + total + ' 次呼叫（應為 1：只有 openDeckStats 那一處）');
});
await T('D4 ⭐ 放大鏡按鈕被 statsHidden 閘住（哨兵缺席時整顆不出現）', () => {
  const i = DK.indexOf('deck-stats-btn');
  assert.ok(i > 0, '找不到放大鏡按鈕');
  const before = DK.slice(Math.max(0, i - 400), i);
  assert.ok(before.includes('{#if !statsHidden}'), '放大鏡按鈕前面沒有 statsHidden 閘');
});

// ══════════════════════════════════════════════════════════════════════════
// 【E】Firestore 讀取次數（⭐ 量測）
// ══════════════════════════════════════════════════════════════════════════
console.log('【E】Firestore 讀取次數（room.ts setSeatDeck 實跑計數）');
function runFirestoreSetSeatDeck(rtSrc, args) {
  const js = ts2js(extractFn(rtSrc, 'export async function setSeatDeck(', 200, 'room setSeatDeck'));
  const n = { getDoc: 0, getDocs: 0, onSnapshot: 0, updateDoc: 0 };
  let written = null;
  const data = { seats: [
    { role: 'p1', uid: 'U1', name: 'A', deckEntries: null, ready: false },
    { role: 'p2', uid: 'U2', name: 'B', deckEntries: null, ready: false },
  ] };
  const fn = new Function('auth', 'doc', 'db', 'getDoc', 'getDocs', 'onSnapshot', 'updateDoc',
    'serverTimestamp', 'findMySeatIdx', 'computeMemberUids', 'n',
    js + '\n;return setSeatDeck;')(
    { currentUser: { uid: 'U1' } }, () => ({}), {},
    async () => { n.getDoc++; return { exists: () => true, data: () => data }; },
    async () => { n.getDocs++; return { docs: [] }; },
    () => { n.onSnapshot++; return () => {}; },
    async (_ref, payload) => { n.updateDoc++; written = payload; },
    () => 'TS',
    (seats, uid) => seats.findIndex((s) => s.uid === uid),
    (seats) => seats.filter((s) => s.uid).map((s) => s.uid), n);
  return fn(...args).then(() => ({ n, written }));
}
let eNow = null;
await T('E1 ⭐⭐⭐ setSeatDeck（Firestore 版）讀取次數＝getDoc 1／getDocs 0／onSnapshot 0（絕對值，不需要歷史）', async () => {
  eNow = await runFirestoreSetSeatDeck(RT, ['AAAA', [{ cardId: 'c', count: 60 }], 'DECK-1']);
  assert.strictEqual(eNow.n.getDoc, 1, 'getDoc 被呼叫 ' + eNow.n.getDoc + ' 次');
  assert.strictEqual(eNow.n.getDocs, 0);
  assert.strictEqual(eNow.n.onSnapshot, 0);
  assert.strictEqual(eNow.n.updateDoc, 1, 'updateDoc 被呼叫 ' + eNow.n.updateDoc + ' 次');
  console.log('        量測：getDoc=' + eNow.n.getDoc + ' getDocs=' + eNow.n.getDocs + ' onSnapshot=' + eNow.n.onSnapshot + ' updateDoc=' + eNow.n.updateDoc);
});
await T('E2 ⭐ Firestore 版也真的把 deckId 寫進座位（測試站測得到）', () => {
  assert.ok(eNow, 'E1 沒有跑成功');
  assert.strictEqual(eNow.written.seats[0].deckId, 'DECK-1');
  assert.deepStrictEqual(Object.keys(eNow.written).sort(), ['memberUids', 'seats', 'updatedAt'],
    'updateDoc 的欄位集合變了（多寫欄位＝多一次寫入成本）：' + Object.keys(eNow.written));
});

await T('E3 ⭐⭐⭐ history-free 已知答案表：room.ts 的 Firestore 呼叫點／room-oracle.ts 的 Oracle 請求點（剝註解後）逐 token 等於表（v6.316；淺複製也在守）', () => {
  assert.ok(FS_ROOM_EXPECTED['getDoc('] > 0 && ORACLE_ROOM_EXPECTED['oracleGetRoom('] > 0, '已知答案表是空的？');
  const rt = fsCountsRoom(RT), ro = oracleCountsRoom(RO);
  assert.deepStrictEqual(rt, FS_ROOM_EXPECTED, 'room.ts 的 Firestore 呼叫點變了（與已知答案表不同）：' + JSON.stringify(rt));
  assert.deepStrictEqual(ro, ORACLE_ROOM_EXPECTED, 'room-oracle.ts 的 Oracle 請求點變了（與已知答案表不同）：' + JSON.stringify(ro));
  // 反面對照（內嵌樣本，不綁真檔）：註解裡的呼叫點不算 —— 不剝就對不上、剝了就對得上 ⇒ 剝註解是必要的
  const withCmt = RT + '\n// v6.307 風格的註解：getDocs(collection(db, "rooms")) 只是提一下\n';
  assert.notStrictEqual(withCmt.split('getDocs(').length - 1, FS_ROOM_EXPECTED['getDocs('], '反面對照失效：多一行註解、不剝也對得上？');
  assert.deepStrictEqual(fsCountsRoom(withCmt), FS_ROOM_EXPECTED, '剝了註解還是對不上 ⇒ 剝除器沒把 // 行剔掉');
});
await T('E3b ⭐⭐ 表的完整性（v6.317）：room-oracle.ts 從 oracle-client import 的每個 oracle* 符號都在 ORACLE_TOKENS（或 ORACLE_NON_NET 白名單）；表裡每個 oracle* token 也都有 import', () => {
  const names = oracleImportsOf(RO);
  const tokens = ORACLE_TOKENS.filter((t) => t.startsWith('oracle')).map((t) => t.slice(0, -1));
  for (const n of names) assert.ok(tokens.includes(n) || ORACLE_NON_NET.includes(n), '⚠⚠ room-oracle.ts import 了 ' + n + ' 卻不在 ORACLE_TOKENS ⇒ 這支請求 helper 沒被數到（v6.316 就是這樣漏了四支）');
  for (const t of tokens) assert.ok(names.includes(t), 'ORACLE_TOKENS 裡的 ' + t + ' 沒有被 import ⇒ 表裡有死項（或 import 被改名）');
  for (const n of ORACLE_NON_NET) assert.ok(names.includes(n), '白名單 ' + n + ' 沒被 import ⇒ 白名單過期');
  // 正對照：白名單成員真的不發請求 —— oracle-client.ts 裡它的函式本體不含 fetch(/oracleApi(
  const oc = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');
  const body = extractFn(oc, 'export function oracleCurrentUid(', 40, 'oracleCurrentUid');
  assert.ok(!/fetch\(|oracleApi\(/.test(body), 'oracleCurrentUid 現在會發請求了 ⇒ 不能留在白名單');
});

// ══════════════════════════════════════════════════════════════════════════
// 【F】既有牌組 CRUD 不變
// ══════════════════════════════════════════════════════════════════════════
console.log('【F】既有牌組 CRUD（storage.ts）不可以被改壞');
await T('F1 ⭐⭐⭐ newDeck() 產出的 id **實跑**：仍走 crypto.randomUUID()、每次都不同，而且伺服器的 sanitizeDeckId 收得下', () => {
  // 伺服器 v6.266 `oracle-admin/server_admin_patch.js` 的 DECK_ID_RE（逐字抄）。
  // ⚠ client 產的 id 若不合這個式子，伺服器會**靜默丟掉** ⇒ 整個功能無聲失效。
  const DECK_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
  const js = ts2js(extractFn(ST, 'export function newDeck(', 100, 'newDeck')
    + '\n' + extractFn(ST, 'function randomId(): string {', 80, 'randomId'));
  const make = (c) => new Function('crypto', js + '\n;return newDeck;')(c);
  const uuidC = { randomUUID: () => '3f2504e0-4f89-11d3-9a0c-0305e82c3301' };
  const a = make(uuidC)('x');
  assert.strictEqual(a.id, '3f2504e0-4f89-11d3-9a0c-0305e82c3301', 'newDeck 沒有走 crypto.randomUUID()（實得 ' + a.id + '）');
  assert.ok(DECK_ID_RE.test(a.id), 'randomUUID 產的 id 不合伺服器的 sanitizeDeckId：' + a.id);
  // fallback 路徑（沒有 randomUUID 的環境）也必須通過伺服器的正規式
  const fb = make({})('x');
  assert.ok(/^d_/.test(fb.id), 'fallback 形狀變了：' + fb.id);
  assert.ok(DECK_ID_RE.test(fb.id), 'fallback 產的 id 不合伺服器的 sanitizeDeckId：' + fb.id);
  const seen = new Set([0, 1, 2, 3, 4].map(() => make({})('x').id));
  assert.ok(seen.size >= 2, 'fallback 產的 id 會重複');
});
await T('F2 upsertDeck 依 id 就地更新、不換 id（編輯牌組不會讓戰績歸零）', () => {
  const fn = extractFn(ST, 'export function upsertDeck(', 100, 'upsertDeck');
  assert.ok(/findIndex\(/.test(fn) && /\.id === /.test(fn), 'upsertDeck 不再依 id 就地更新：\n' + fn);
  assert.ok(!/randomUUID/.test(fn), 'upsertDeck 竟然會產生新 id');
});
await T('F3 storage.ts 一個位元都沒有被這一版動到（對 BASE 逐字比對）', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('F3 storage.ts 逐字比對', 'F1／F2 是 history-free 的等價保護'); return; }
  const b = readBaseBlob(ROOT, BASE_SHA, 'src/lib/decks/storage.ts');
  assert.ok(b.ok, '讀不到 BASE 的 storage.ts');
  assert.strictEqual(ST, b.out, 'storage.ts 被動到了');
});

// ══════════════════════════════════════════════════════════════════════════
// 【G】HEAD-FAIL：對真 BASE blob 跑，每一條各自紅
// ══════════════════════════════════════════════════════════════════════════
console.log('【G】HEAD-FAIL：對 BASE(v6.266) 的原始碼，A~E 的每一條各自紅');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【G】HEAD-FAIL（需要 BASE blob）', '【H】突變測試不需要歷史，仍在守');
} else {
  const bRO = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/room-oracle.ts');
  const bRT = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/room.ts');
  const bGP = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
  const bDK = readBaseBlob(ROOT, BASE_SHA, 'src/routes/decks/+page.svelte');
  const bDS = readBaseBlob(ROOT, BASE_SHA, 'src/lib/decks/deck-stats.ts');
  await T('G0 BASE 上根本沒有 src/lib/decks/deck-stats.ts（確認 BASE 抓對了）', () => {
    assert.strictEqual(bDS.ok, false, 'BASE 竟然有 deck-stats.ts ⇒ BASE_SHA 抓錯了');
  });
  const reds = [];
  const red = async (label, f) => {
    let threw = false;
    try { await f(); } catch (e) { if (e instanceof assert.AssertionError) threw = true; else throw e; }
    reds.push([label, threw]);
  };
  await red('A1 setSeatDeck 寫 deckId', async () => {
    const { fn, captured } = loadOracleSetSeatDeck(bRO.out);
    captured.push(seed());
    await fn('AAAA', [{ cardId: 'x', count: 60 }], 'D');
    assert.strictEqual(captured.pop().seats[0].deckId, 'D');
  });
  await red('A3 takeSeat 清 deckId', async () => {
    const js = ts2js(extractFn(bRO.out, 'export async function takeSeat(', 300, 'takeSeat'));
    let out = null; const st = seed(); st.seats[1] = { role: 'p2', uid: null, name: null, deckEntries: null, ready: false, deckId: 'GHOST' };
    const takeSeat = new Function('getMyUid', 'oracleTx', 'findMySeatIdx', 'computeMemberUids', 'auth', 'ORACLE_SIDEEFFECT_TIMEOUT_MS',
      js + '\n;return takeSeat;')(async () => 'U1', async (c, f) => { out = await f(st); return out; },
      (s, u) => s.findIndex((x) => x.uid === u), (s) => s.filter((x) => x.uid).map((x) => x.uid), { currentUser: {} }, 60000);
    await takeSeat('AAAA', 1);
    assert.strictEqual(out.seats[1].deckId, null);
  });
  await red('A4 清空座位處都帶 deckId: null', () => {
    for (const raw of [bRT.out, bRO.out]) {
      const src = stripComments(raw);
      const clears = src.split('deckEntries: null,').length - 1;
      assert.strictEqual(src.split('deckEntries: null, deckId: null,').length - 1, clears);
    }
  });
  await red('A5 Seat 有 deckId 欄位', () => {
    const body = matchBlock(bRT.out, bRT.out.indexOf('export interface Seat {'), '{', '}');
    assert.ok(/\bdeckId\?: string \| null;/.test(body));
  });
  await red('B1 handleSetDeck 送出 deck.id', async () => {
    const d = { id: 'DECK-UUID', name: 'n', entries: [{ cardId: 'c', count: 60 }] };
    const { box, calls } = loadHandleSetDeck(bGP.out, [d]);
    await box.handleSetDeck();
    assert.strictEqual(calls[0].length, 3);
    assert.strictEqual(calls[0][2], 'DECK-UUID');
  });
  await red('C1 deck-stats.ts 存在且可實跑', async () => {
    const mod = loadDeckStats(bDS.ok ? bDS.out : '').load(mkFetch(() => jsonRes(200, goodBody())));
    const r = await mod.fetchDeckStats('D1');
    assert.strictEqual(r.ok, true);
  });
  await red('D3 放大鏡點下去才打', () => {
    const fn = extractFn(bDK.out, '  async function openDeckStats(d: Deck) {', 200, 'openDeckStats');
    assert.strictEqual(fn.split('fetchDeckStats(').length - 1, 1);
  });
  await red('D4 放大鏡被 statsHidden 閘住', () => {
    const i = bDK.out.indexOf('deck-stats-btn');
    assert.ok(i > 0);
  });
  await red('E2 Firestore 版寫 deckId', async () => {
    const r = await runFirestoreSetSeatDeck(bRT.out, ['AAAA', [{ cardId: 'c', count: 60 }], 'DECK-1']);
    assert.strictEqual(r.written.seats[0].deckId, 'DECK-1');
  });
  await T('G1 ⭐⭐ 對 BASE 的每一條**各自**紅（不是單一 crash）', () => {
    const notRed = reds.filter(([, r]) => !r).map(([l]) => l);
    assert.strictEqual(notRed.length, 0, 'BASE 上沒有紅的：' + notRed.join('、'));
    assert.ok(reds.length >= 9, '只跑了 ' + reds.length + ' 條 HEAD-FAIL');
    console.log('        BASE 上 ' + reds.length + '/' + reds.length + ' 條各自紅：' + reds.map(([l]) => l).join('、'));
  });
  // ── 正對照 (a)：/decks 載入的網路呼叫點與 BASE **逐字相同** ────────────────
  await T('Ga ⭐⭐⭐【正對照 a】/decks 載入區段的網路呼叫點集合與 BASE 完全相同（量測）', () => {
    const lpBase = loadPathOf(bDK.out);
    const sitesBase = netCallSites(lpBase.all);
    console.log('        BASE 載入區段：' + sitesBase.join('  '));
    console.log('        修後載入區段：' + sitesNow.join('  '));
    assert.ok(sitesBase.length >= 4, 'BASE 只掃到 ' + sitesBase.length + ' 個呼叫點 —— 掃描器壞了？');
    assert.deepStrictEqual(sitesNow, sitesBase, '/decks 載入路徑的網路呼叫點變了 ⇒ 載入請求數變了');
    assert.strictEqual(lpBase.effects, 0);
    // 非網路的新增只允許 deckStatsHidden（純函式，C10 已證明零請求）
    const pureBase = pureCallSites(lpBase.all), pureNow = pureCallSites(lpNow.all);
    assert.deepStrictEqual(pureBase, [], 'BASE 不該有 deckStatsHidden');
    assert.deepStrictEqual(pureNow, ['deckStatsHidden(×1'],
      '載入區段多了預期以外的呼叫：' + pureNow.join(','));
  });
  // ── 正對照 (b)：Firestore 讀取次數與 BASE 相同 ──────────────────────────
  await T('Gb ⭐⭐⭐【正對照 b】Firestore 讀取次數與 BASE 同法量測完全相同', async () => {
    const rb = await runFirestoreSetSeatDeck(bRT.out, ['AAAA', [{ cardId: 'c', count: 60 }]]);
    console.log('        BASE：getDoc=' + rb.n.getDoc + ' getDocs=' + rb.n.getDocs + ' onSnapshot=' + rb.n.onSnapshot + ' updateDoc=' + rb.n.updateDoc);
    assert.deepStrictEqual(eNow.n, rb.n, 'Firestore 呼叫次數變了');
    assert.deepStrictEqual(Object.keys(rb.written).sort(), Object.keys(eNow.written).sort(), 'updateDoc 的欄位集合變了');
  });
  // ── 正對照 (c)：⭐ v6.316 改成比對 BASE(v6.266)..THIS(v6.267) 兩個**固定** commit ──────────
  //   原本：**工作樹**的 room.ts／room-oracle.ts 剝掉 deckId 那幾處後必須逐位元等於 v6.266（後來還疊了 v6.270 的剝除字串）。
  //   那守的是「v6.267 只動了這些」這個**歷史事實**，卻拿會一直往前走的工作樹去比 ⇒ v6.309 合法改動後在完整歷史下誤紅
  //   （第九種安慰劑：pin 過期；淺複製 CI 因 SHALLOW-SKIP 看不到）。
  //   現在：拿 v6.267 自己的 blob 比 v6.266 —— 同一個事實、永不過期。「跟自己比」由 (1) 擋住（H12 突變實證）；
  //   現況的守備（請求點不准偷偷變多）由 E3 的 history-free 已知答案表接手，並在 (3) 拿真 blob 核對表沒抄錯。
  function gcAgainst(thisRT, thisRO) {
    // (1) 不是「跟自己比」：THIS 的兩個檔都與 BASE 不同
    assert.notStrictEqual(thisRT, bRT.out, 'THIS_SHA 的 room.ts 與 BASE 相同 ⇒ THIS_SHA 抓錯了（守衛會變成恆真）');
    assert.notStrictEqual(thisRO, bRO.out, 'THIS_SHA 的 room-oracle.ts 與 BASE 相同 ⇒ THIS_SHA 抓錯了（守衛會變成恆真）');
    // (2) 剝掉宣告的改動之後逐位元等於 BASE（字面對不上＝有人再動 ⇒ 照樣紅）
    const undo = (x) => x
      .replace(/deckEntries: null, deckId: null,/g, 'deckEntries: null,')
      .replace(/\{ \.\.\.s, deckEntries, deckId: deckId \?\? null, ready: false \}/g, '{ ...s, deckEntries, ready: false }');
    const stripNew = (x, marks) => { let t = undo(x); for (const m of marks) t = t.split(m).join(''); return t; };
    const RT_MARKS = [
      `  /**
   * v6.267 套牌戰績：這個座位目前選用的牌組 id（＝\`Deck.id\`，client 端的穩定 UUID）。
   *   - undefined / null ＝ 沒有選牌組、或是 v6.267 之前建立的房間（舊房不回填）。
   *   - 伺服器 \`/api/match-result\` 會從房間 seat 把它補進 matchRecords，
   *     \`GET /api/deck-stats?deckId=\` 才查得到這副牌的勝率。
   *   ⚠⚠ **只能寫入、不改變 \`Deck.id\` 的產生方式**（\`crypto.randomUUID()\`）——
   *     「戰績跟著這副牌走」整個建立在那個 id 不會變之上。
   *   ⚠ 座位被清空／換人坐時**必須一起清掉**，否則新玩家的對局會被記到前一位
   *     玩家的牌組上（見下方所有 \`deckEntries: null, deckId: null\` 的地方）。
   */
  deckId?: string | null;
`,
      `  /** v6.267：這副牌的 \`Deck.id\`（套牌戰績用）。沒帶＝清成 null，與舊行為等價。 */
  deckId?: string | null,
`,
    ];
    for (const m of RT_MARKS) assert.ok(thisRT.includes(m), 'v6.267 的 room.ts 找不到宣告的改動字面：' + m.slice(0, 40));
    assert.strictEqual(stripNew(thisRT, RT_MARKS), bRT.out, 'v6.267 的 room.ts 除了 deckId 之外還動到別的地方');
    const roStripped = stripNew(thisRO, []).replace(
      /\/\*\*\n \* v6\.267：連同 `deckId` 一起寫進座位。[\s\S]*?\n \*\/\n(export async function setSeatDeck\(roomCode: string, deckEntries: DeckEntry\[\]), deckId\?: string \| null\)/,
      '$1)');
    assert.notStrictEqual(roStripped, thisRO, 'room-oracle.ts 的剝除一個字都沒剝到 ⇒ 字面對不上');
    assert.strictEqual(roStripped, bRO.out, 'v6.267 的 room-oracle.ts 除了 deckId 之外還動到別的地方');
    // (3) 已知答案表沒抄錯：BASE／THIS 的 room.ts 都等於表；THIS 的 room-oracle.ts 請求點與 BASE 相同（v6.267 零新增請求）
    assert.deepStrictEqual(fsCountsRoom(bRT.out), FS_ROOM_EXPECTED, '已知答案表與真 BASE(v6.266) 的 room.ts 對不上：' + JSON.stringify(fsCountsRoom(bRT.out)));
    assert.deepStrictEqual(fsCountsRoom(thisRT), FS_ROOM_EXPECTED, '已知答案表與 v6.267 的 room.ts 對不上：' + JSON.stringify(fsCountsRoom(thisRT)));
    assert.deepStrictEqual(oracleCountsRoom(thisRO), oracleCountsRoom(bRO.out), 'v6.267 的 room-oracle.ts 多了請求點');
  }
  const tRT = readBaseBlob(ROOT, THIS_SHA, 'src/lib/game/room.ts');
  const tRO = readBaseBlob(ROOT, THIS_SHA, 'src/lib/game/room-oracle.ts');
  await T('Gc ⭐⭐【正對照 c】v6.267 的 room.ts／room-oracle.ts 除了 deckId 那幾處，其餘逐字等於 v6.266（固定兩 commit，永不過期）；已知答案表對得上真 blob', () => {
    assert.ok(hasBaseCommit(ROOT, THIS_SHA) && tRT.ok && tRO.ok, '讀不到 THIS_SHA(v6.267) 的 room.ts／room-oracle.ts');
    gcAgainst(tRT.out, tRO.out);
    console.log('        v6.266..v6.267：room.ts／room-oracle.ts 剝掉 deckId 後逐位元相同；room.ts Firestore 呼叫點 ' + JSON.stringify(FS_ROOM_EXPECTED));
  });
  await T('Gc-H12 突變：THIS_SHA 指到 BASE（「跟自己比」）⇒ Gc 必紅在 (1)', () => {
    assert.throws(() => gcAgainst(bRT.out, bRO.out), (e) => e instanceof assert.AssertionError && /THIS_SHA 抓錯了/.test(e.message), '「跟自己比」沒有被擋下');
  });
  await T('Gc-H13 突變：v6.267 若多動了一行（room.ts 多一個 getDocs）⇒ Gc 必紅在 (2)', () => {
    assert.ok(tRT.ok && tRO.ok);
    const m = tRT.out.replace('export async function setSeatDeck(', 'export async function __probe() { return getDocs(collection(db, "rooms")); }\nexport async function setSeatDeck(');
    assert.notStrictEqual(m, tRT.out, '突變沒套上');
    assert.throws(() => gcAgainst(m, tRO.out), (e) => e instanceof assert.AssertionError && /還動到別的地方/.test(e.message), '多動一行沒有被抓到');
  });
  // ── 正對照 (d)：哨兵缺席時放大鏡不出現且不多打請求 → 已由 C4/C9/C10 行為端證明 ──
}

// ══════════════════════════════════════════════════════════════════════════
// 【H】突變測試 —— 每一條都必須紅在指定的位置
// ══════════════════════════════════════════════════════════════════════════
console.log('【H】突變測試（沒紅＝守衛沒測到，不是「這件事不重要」）');
const mut = async (label, mutate, check) => {
  const src = mutate();
  assert.notStrictEqual(src.changed, false, label + '：突變沒改到東西（樣式對不上＝守衛在測不存在的形狀）');
  let red = false;
  try { await check(src.out); } catch (e) { if (e instanceof assert.AssertionError) red = true; else throw e; }
  await T('H ' + label + ' ⇒ 必須紅', () => assert.ok(red, '突變沒有翻紅 ⇒ 先假設守衛沒測到'));
};
const mk = (src, a, b) => ({ out: src.replace(a, b), changed: src.includes(a) && src.replace(a, b) !== src });

await mut('H1 setSeatDeck 收了 deckId 卻沒寫進座位', () => mk(RO,
  '{ ...s, deckEntries, deckId: deckId ?? null, ready: false }', '{ ...s, deckEntries, ready: false }'),
  async (out) => {
    const { fn, captured } = loadOracleSetSeatDeck(out);
    captured.push(seed());
    await fn('AAAA', [{ cardId: 'x', count: 60 }], 'D');
    assert.strictEqual(captured.pop().seats[0].deckId, 'D');
  });
await mut('H2 換座位時忘了清掉前一位玩家的 deckId', () => mk(RO,
  "uid, email: myEmail, name: myName, deckEntries: null, deckId: null, ready: false",
  "uid, email: myEmail, name: myName, deckEntries: null, ready: false"),
  async (out) => {
    const js = ts2js(extractFn(out, 'export async function takeSeat(', 300, 'takeSeat'));
    let o = null; const st = seed(); st.seats[1] = { role: 'p2', uid: null, name: null, deckEntries: null, ready: false, deckId: 'GHOST' };
    const takeSeat = new Function('getMyUid', 'oracleTx', 'findMySeatIdx', 'computeMemberUids', 'auth', 'ORACLE_SIDEEFFECT_TIMEOUT_MS',
      js + '\n;return takeSeat;')(async () => 'U1', async (c, f) => { o = await f(st); return o; },
      (s, u) => s.findIndex((x) => x.uid === u), (s) => s.filter((x) => x.uid).map((x) => x.uid), { currentUser: {} }, 60000);
    await takeSeat('AAAA', 1);
    assert.strictEqual(o.seats[1].deckId, null);
  });
await mut('H3 handleSetDeck 沒把 deck.id 傳下去', () => mk(GP,
  'await setSeatDeck(roomCode, deck.entries, deck.id);', 'await setSeatDeck(roomCode, deck.entries);'),
  async (out) => {
    const d = { id: 'DECK-UUID', name: 'n', entries: [{ cardId: 'c', count: 60 }] };
    const { box, calls } = loadHandleSetDeck(out, [d]);
    await box.handleSetDeck();
    assert.strictEqual(calls[0].length, 3);
    assert.strictEqual(calls[0][2], 'DECK-UUID');
  });
await mut('H4 哨兵判斷改成看 res.ok（503 會被當成「支援」⇒ 顯示壞掉的空表）', () => mk(DS,
  "if (!b || typeof b.deckStatsApi !== 'number') {", 'if (!b) {'),
  async (out) => {
    const f = mkFetch(() => jsonRes(503, { error: 'x' }));
    const mod = loadDeckStats(out).load(f);
    const r = await mod.fetchDeckStats('D1');
    assert.strictEqual(r.unsupported, true);
    assert.strictEqual(mod.deckStatsHidden(), true);
  });
await mut('H5 429 也被當成「不支援」（會把功能永久藏掉）', () => mk(DS,
  "  if (res.status === 429) return { ok: false, unsupported: false, message: DECK_STATS_BUSY_MSG };\n", ''),
  async (out) => {
    const f = mkFetch(() => jsonRes(429, { error: 'x' }));
    const mod = loadDeckStats(out).load(f);
    const r = await mod.fetchDeckStats('D1');
    assert.strictEqual(r.unsupported, false);
    assert.strictEqual(mod.deckStatsHidden(), false);
  });
await mut('H6 拿掉防連點（同一副牌連點會併發打伺服器）', () => mk(DS,
  '  const busy = inflight.get(deckId);\n  if (busy) return busy;\n', ''),
  async (out) => {
    let release; const gate = new Promise((r) => { release = r; });
    const f = mkFetch(async () => { await gate; return jsonRes(200, goodBody()); });
    const mod = loadDeckStats(out).load(f);
    const ps = [0, 1, 2, 3, 4, 5].map(() => mod.fetchDeckStats('D1'));
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(f.calls.length, 1, '連點打了 ' + f.calls.length + ' 發');
    release(); await Promise.all(ps);
  });
await mut('H7 拿掉快取（60 秒內重複點會一直打）', () => mk(DS,
  '  if (hit && Date.now() - hit.at < DECK_STATS_CACHE_TTL_MS) {', '  if (false) {'),
  async (out) => {
    const f = mkFetch(() => jsonRes(200, goodBody()));
    const mod = loadDeckStats(out).load(f);
    await mod.fetchDeckStats('D1');
    const b = await mod.fetchDeckStats('D1');
    assert.strictEqual(b.fromCache, true);
    assert.strictEqual(f.calls.length, 1);
  });
await mut('H8 記住「不支援」之後又繼續打（哨兵 fail-open 失效）', () => mk(DS,
  '  if (deckStatsHidden()) {\n    return Promise.resolve({ ok: false, unsupported: true, message: DECK_STATS_UNSUPPORTED_MSG });\n  }\n', ''),
  async (out) => {
    const f = mkFetch(() => jsonRes(503, { error: 'x' }));
    const mod = loadDeckStats(out).load(f);
    await mod.fetchDeckStats('D1');
    await mod.fetchDeckStats('D2');
    await mod.fetchDeckStats('D3');
    assert.strictEqual(f.calls.length, 1, '記住之後又多打了 ' + (f.calls.length - 1) + ' 發');
  });
await mut('H9 把放大鏡的請求搬到 onMount（＝載入就多打一發）', () => mk(DK,
  '    loadIndex().then((setIndex) => {', '    fetchDeckStats("x");\n    loadIndex().then((setIndex) => {'),
  (out) => {
    const sites = netCallSites(loadPathOf(out).all);
    assert.ok(!sites.some((s) => s.startsWith('fetchDeckStats(')), '載入區段出現 fetchDeckStats：' + sites.join(','));
  });

await mut('H10 room.ts 多一個 getDocs( ⇒ E3 已知答案表必紅（history-free，淺複製也在守）', () => mk(RT,
  'export async function setSeatDeck(', 'export async function __probe() { return getDocs(collection(db, "rooms")); }\nexport async function setSeatDeck('),
  (out) => { assert.deepStrictEqual(fsCountsRoom(out), FS_ROOM_EXPECTED); });
await mut('H11 room-oracle.ts 多一個 oracleGetRoom( ⇒ E3 已知答案表必紅', () => mk(RO,
  'export async function setSeatDeck(', 'export async function __probe(c) { return oracleGetRoom(c); }\nexport async function setSeatDeck('),
  (out) => { assert.deepStrictEqual(oracleCountsRoom(out), ORACLE_ROOM_EXPECTED); });
await mut('H14 ⭐ v6.317 審查者的探針：多一個 oraclePollRoom( ⇒ E3 必紅（v6.316 的表抓不到這一支）', () => mk(RO,
  'export async function setSeatDeck(', 'export async function __probePoll(c) { return oraclePollRoom(c, 0); }\nexport async function setSeatDeck('),
  (out) => { assert.deepStrictEqual(oracleCountsRoom(out), ORACLE_ROOM_EXPECTED); });
const e3bCheck = (out) => {
  const names = oracleImportsOf(out);
  const tokens = ORACLE_TOKENS.filter((t) => t.startsWith('oracle')).map((t) => t.slice(0, -1));
  for (const n of names) assert.ok(tokens.includes(n) || ORACLE_NON_NET.includes(n), n + ' 不在表裡');
};
await mut('H15 ⭐ v6.317 表的完整性：多 import 一支請求 helper（oraclePollMessages）卻沒進表 ⇒ E3b 必紅', () => mk(RO,
  '  oracleListRooms, oraclePollRoom, oracleListMessages, oracleCurrentUid,', '  oracleListRooms, oraclePollRoom, oracleListMessages, oracleCurrentUid, oraclePollMessages,'),
  e3bCheck);
await mut('H16 ⭐ v6.318 審查者繞道①：第二行 import { oraclePollRoom as pollAlias }（IDE 自動 import 的形狀）＋ pollAlias(c, 0) ⇒ E3b 必紅（alias 以本地名計）', () => mk(RO,
  "} from './oracle-client';\n", "} from './oracle-client';\nimport { oraclePollRoom as pollAlias } from './oracle-client';\nexport async function __probeAlias(c) { return pollAlias(c, 0); }\n"),
  e3bCheck);
await mut('H17 ⭐ v6.318 審查者繞道②：import * as oc ＋ oc.oraclePollMessages(c, 0) ⇒ E3b 必紅（namespace import 禁用）', () => mk(RO,
  "} from './oracle-client';\n", "} from './oracle-client';\nimport * as oc from './oracle-client';\nexport async function __probeNs(c) { return oc.oraclePollMessages(c, 0); }\n"),
  e3bCheck);
await mut('H18 ⭐ v6.318 動態 import(\'./oracle-client\') ⇒ E3b 必紅', () => mk(RO,
  'export async function setSeatDeck(', "export async function __probeDyn(c) { const m = await import('./oracle-client'); return m.oraclePollMessages(c, 0); }\nexport async function setSeatDeck("),
  e3bCheck);

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.267 守衛：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
