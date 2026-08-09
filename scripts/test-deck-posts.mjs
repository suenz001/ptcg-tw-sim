// v6.138 批次1 守衛：牌組公布欄後端（deckPosts）。
//
// 這個功能的風險不在「會不會壞」，而在幾件壞掉時**不會有錯誤訊息**的事：
//   ・投稿者的 uid / email 隨著公開列表外流 —— 沒有人會來回報，因為畫面看起來正常
//   ・名次由 client 自報 —— 任何人都能掛上「冠軍」標籤
//   ・按讚計數用 $inc 而不是唯一鍵 —— 重放請求就能刷讚，且事後無從對帳
//   ・列表把 60 張 entries 一起送 —— v6.119 的讀放大教訓重演
//   ・牌組合法性在伺服器抄第二份 —— 與前端規則漂移（v0.88／v0.93 的 classifyDeck 教訓）
//   ・整段 throw 冒泡到賽事段 —— 那個 catch 一掛會連「休閒閒置自動判負」一起停用
// 這些只能靜態釘死；名次判定則直接抽函式跑真值。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAP = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const BSE = readFileSync(join(ROOT, 'scripts/build-server-engine.mjs'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/** 取「從 anchor 起、到下一個同層 anchor 為止」的區段。⚠ 不寫死行數（v6.109 教訓）。 */
function section(src, startAnchor, endAnchor) {
  const i = src.indexOf(startAnchor);
  if (i < 0) return '';
  const j = endAnchor ? src.indexOf(endAnchor, i + startAnchor.length) : -1;
  return src.slice(i, j > 0 ? j : src.length);
}
/**
 * 從原始碼抽出一個具名 function 的完整文字（括號配對，不靠行數）。
 *
 * ⚠ 第一版直接從函式名往後數大括號，遇到**參數解構**（`function f(id, { a, b })`）
 *   會把參數列的 `{}` 當成函式主體，抽出來只剩參數列 —— 後續斷言全部在檢查一段
 *   根本不是函式主體的文字（本輪就這樣紅了兩項，而且是「假紅」，若反過來寫成
 *   否定型斷言就會變成假綠）。所以先把圓括號配對完，再從參數列後面開始數大括號。
 */
function extractFn(src, name) {
  const sig = 'function ' + name + '(';
  const i = src.indexOf(sig);
  if (i < 0) throw new Error('找不到函式 ' + name);
  // ① 先配對參數列的圓括號
  let p = 0, argEnd = -1;
  for (let k = i + sig.length - 1; k < src.length; k++) {
    if (src[k] === '(') p++;
    else if (src[k] === ')') { p--; if (p === 0) { argEnd = k; break; } }
  }
  if (argEnd < 0) throw new Error('參數列括號沒有配對完成：' + name);
  // ② 再從參數列之後配對函式主體的大括號
  let depth = 0, started = false;
  for (let k = argEnd + 1; k < src.length; k++) {
    const c = src[k];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('括號沒有配對完成：' + name);
}

const DP = section(SAP, 'v6.138 批次1：牌組公布欄（deckPosts）後端', "[deck-posts] init failed");
ok(DP.length > 3000, '抓不到 deckPosts 區段 —— 掃描器自己壞了，以下所有斷言都不可信');

console.log('\n① 隱私：投稿者身分絕不外流');

T('⭐⭐⭐ 公開序列化是白名單逐欄挑，且完全沒有 uid / email', () => {
  const fn = extractFn(DP, 'dpPublic');
  ok(!/\.\.\.doc/.test(fn), 'dpPublic 用了 spread —— 只要 doc 多一個欄位就會整包外流');
  ok(!/\buid\b/.test(fn), 'dpPublic 裡出現 uid');
  ok(!/\bemail\b/.test(fn), 'dpPublic 裡出現 email');
  ok(/authorName/.test(fn) && /deckName/.test(fn) && /likeCount/.test(fn) && /downloadCount/.test(fn),
    'dpPublic 少了 Wilson 明確要求的欄位（提供者名稱／牌組名稱／下載次數／按讚數）');
});

T('⭐⭐ 公開列表端點的 projection 排除 uid / email / entries', () => {
  const ep = section(DP, "app.get('/api/deck-posts',", "app.get('/api/deck-posts/:id'");
  ok(/projection:\s*\{[^}]*entries:\s*0/.test(ep), '列表沒有排除 entries —— 每筆 60 張 × 每頁 20 筆的讀放大（v6.119 教訓）');
  ok(/projection:\s*\{[^}]*uid:\s*0/.test(ep), '列表沒有排除 uid');
  ok(/projection:\s*\{[^}]*email:\s*0/.test(ep), '列表沒有排除 email');
});

T('⭐ 只有 admin 端點才回 email（後台要能追溯到人）', () => {
  const adm = section(DP, "app.get('/api/admin/deck-posts',", 'async function dpAdminSetStatus');
  ok(/isTournAdmin\(id\)/.test(adm), 'admin 列表沒有權限 gate');
  ok(/email:\s*d\.email/.test(adm), 'admin 列表沒有回 email —— 先發後審需要能追溯投稿者');
});

console.log('\n② 名次：伺服器權威，client 無法自報');

T('⭐⭐⭐ tournament-submit 的 body 只吃 eventId 與 notes，不吃名次也不吃牌組', () => {
  const ep = section(DP, "app.post('/api/deck-posts-tournament/submit'", "// ════════ admin");
  ok(/req\.body[^;]*eventId/.test(ep), '沒有讀 eventId');
  // ⚠ 這裡要盯的是「有沒有從 req.body 讀出名次／牌組」，不是「檔案裡有沒有 placement 這個字」
  //   （回應本來就會回 placementLabel）。用 `[^;]*` 跨句掃會誤命中回應那一行 —— 假紅。
  ok(!/req\.body[^)\n]*\.\s*placement/i.test(ep), 'client 可以送名次 —— 任何人都能自稱冠軍');
  ok(!/req\.body[^)\n]*\.\s*entries/i.test(ep), 'client 可以送 entries —— 名次標籤就不代表實際戰績了');
  ok(/me\.deckEntries/.test(ep), '牌組不是從歸檔 players[].deckEntries 取 —— Wilson 拍板②要鎖定比賽當時那副');
  ok(/dpPlacementOf\(a,\s*id\.uid/.test(ep), '名次不是伺服器自行推導');
});

T('⭐⭐ 名次推導重用 app.locals._detectCutPlacements，不得自抄一份', () => {
  ok(/app\.locals\s*\|\|\s*\{\}\)\._detectCutPlacements/.test(DP),
    '沒有在執行時從 app.locals 取 —— 註冊時解構會拿到 undefined（v0.94／v1.01 兩次事故）');
  ok(!/function\s+_detectCutPlacements/.test(DP), 'deckPosts 段自己又定義了一份名次推導 —— 兩份必然漂移');
});

T('⭐ 社群自辦賽不開放名次投稿（Wilson 拍板④，與 champion-report 現行邏輯一致）', () => {
  const fn = extractFn(DP, 'dpPlacementOf');
  ok(/communityEvent\s*===\s*true[\s\S]{0,40}return null/.test(fn), 'dpPlacementOf 沒有擋社群賽');
  const ep = section(DP, "app.post('/api/deck-posts-tournament/submit'", '// ════════ admin');
  ok(/communityEvent\s*===\s*true/.test(ep), 'submit 端點沒有再擋一次社群賽');
});

console.log('\n③ 名次判定：抽出純函式跑真值（含 fail-closed 與正對照）');

// 把 _detectCutPlacements 與 dpPlacementOf 抽出來實際執行。
const detectCut = new Function(extractFn(SAP, '_detectCutPlacements') + '; return _detectCutPlacements;')();
const placementOf = new Function(
  "const DP_PLACEMENT = { CHAMPION: '冠軍', FINALS: '亞軍', TOP4: '四強' };\n"
  + extractFn(DP, 'dpPlacementOf') + '; return dpPlacementOf;')();

// 標準 4 人單敗淘汰：R1 兩場（A>B、C>D），R2 決賽（A>C）。
const matches4 = [
  { round: 1, p1uid: 'A', p2uid: 'B', winnerUid: 'A' },
  { round: 1, p1uid: 'C', p2uid: 'D', winnerUid: 'C' },
  { round: 2, p1uid: 'A', p2uid: 'C', winnerUid: 'A' },
];
const arch4 = { championUid: 'A', matches: matches4, finishedAt: Date.now() };

T('⭐ 正對照：這份賽程真的推得出名次（否則以下判定全是假通過）', () => {
  const cut = detectCut(matches4);
  ok(cut.finals.size === 2, '決賽推不出兩人，size=' + cut.finals.size);
  ok(cut.top4.has('B') && cut.top4.has('D'), '四強沒有含到兩位 R1 輸家');
});

T('⭐⭐ 冠軍→冠軍、決賽輸家→亞軍、四強兩人→都標四強（3、4 名不區分）', () => {
  ok(placementOf(arch4, 'A', detectCut) === '冠軍', 'A 不是冠軍');
  ok(placementOf(arch4, 'C', detectCut) === '亞軍', 'C（決賽輸家）不是亞軍');
  ok(placementOf(arch4, 'B', detectCut) === '四強', 'B 不是四強');
  ok(placementOf(arch4, 'D', detectCut) === '四強', 'D 不是四強');
  ok(placementOf(arch4, 'B', detectCut) === placementOf(arch4, 'D', detectCut),
    '兩位四強被標成不同名次 —— 單敗淘汰沒有季軍賽，分不出 3 與 4');
});

T('⭐⭐⭐ fail-closed：賽程推不出名次時只放行冠軍', () => {
  // 最後一輪不只一場 ⇒ _detectCutPlacements 保守回空集合
  const messy = [
    { round: 1, p1uid: 'A', p2uid: 'B', winnerUid: 'A' },
    { round: 2, p1uid: 'A', p2uid: 'C', winnerUid: 'A' },
    { round: 2, p1uid: 'B', p2uid: 'D', winnerUid: 'B' },
  ];
  const cut = detectCut(messy);
  ok(cut.finals.size === 0, '前提不成立：這份賽程其實推得出名次，換一份');
  const a = { championUid: 'A', matches: messy, finishedAt: Date.now() };
  ok(placementOf(a, 'A', detectCut) === '冠軍', 'championUid 是明確欄位，冠軍仍該放行');
  ok(placementOf(a, 'B', detectCut) === null, '推不出名次卻放行了非冠軍 —— 標籤會是編造的');
  ok(placementOf(a, 'C', detectCut) === null, '推不出名次卻放行了 C');
});

T('⭐ 沒進四強的人拿不到任何標籤', () => {
  const m8 = matches4.concat([{ round: 0, p1uid: 'E', p2uid: 'F', winnerUid: 'E' }]);
  ok(placementOf({ championUid: 'A', matches: m8, finishedAt: Date.now() }, 'F', detectCut) === null,
    '八強輸家拿到了標籤');
});

T('⭐ 社群賽即使是冠軍也不給名次標籤', () => {
  ok(placementOf({ ...arch4, communityEvent: true }, 'A', detectCut) === null, '社群賽冠軍拿到了標籤');
});

T('⭐ detectCut 拿不到（舊版 patch / app.locals 沒掛）時不得亂猜', () => {
  ok(placementOf({ championUid: 'A', matches: matches4, finishedAt: Date.now() }, 'C', undefined) === null,
    '沒有名次推導函式卻仍回傳了名次');
});

console.log('\n④ 計數：唯一鍵擋重放，不靠 client 誠實');

T('⭐⭐⭐ 按讚／下載都用 postId__uid 複合唯一鍵，DuplicateKey 即視為已計過', () => {
  const fn = extractFn(DP, 'dpToggle');
  ok(/_id:\s*key/.test(fn), '沒有把複合鍵當 _id —— 就擋不住重放');
  ok(/postId\s*\+\s*'__'\s*\+\s*uid/.test(fn), '複合鍵不是 postId__uid');
  ok(/e\.code\s*===\s*11000/.test(fn), '沒有攔 DuplicateKey(11000) —— 重複按讚會噴 500');
  ok(/return false/.test(fn), 'DuplicateKey 時沒有回「未變更」—— 會重複 $inc');
});

T('⭐ 有對帳端點（計數是快照，權威在明細表）', () => {
  const ep = section(DP, "app.post('/api/admin/deck-posts/recount'", '// 守衛與未來的管理端');
  ok(/DPLIKES\.aggregate/.test(ep) && /DPDOWNS\.aggregate/.test(ep), 'recount 沒有從明細表重算');
  ok(/isTournAdmin\(id\)/.test(ep), 'recount 沒有權限 gate');
});

T('⭐ 未登入者可以匯入但不計數（下載數語意＝多少個不同帳號拿過）', () => {
  const ep = section(DP, "app.post('/api/deck-posts/:id/download'", '// ════════ 賽事名次投稿');
  ok(/dpIdentitySoft/.test(ep), 'download 用了硬身分 —— 未登入者會被擋掉而不是靜默不計數');
  ok(/status\(204\)/.test(ep), '未登入沒有走 204 靜默路徑');
});

T('⭐⭐ 投稿／按讚一律要 verified 身分（tournIdentity 對沒帶 token 的請求會回可捏造的 playerId 身分）', () => {
  const fn = extractFn(DP, 'dpIdentity');
  ok(/!id\.verified/.test(fn), 'dpIdentity 沒有檢查 verified —— 任何人送 ?playerId=xxx 就能冒充別人按讚');
  const soft = extractFn(DP, 'dpIdentitySoft');
  ok(/id\.verified/.test(soft), 'dpIdentitySoft 也必須只認 verified');
});

console.log('\n⑤ 牌組規則：只有一份');

T('⭐⭐⭐ 合法性驗證走引擎 bundle 匯出的 validateDeck，不得在伺服器抄第二份', () => {
  ok(/export \{ validateDeck \} from '\$lib\/decks\/validation'/.test(BSE),
    'build-server-engine.mjs 沒有 export validateDeck —— 伺服器拿不到中央規則');
  const fn = extractFn(DP, 'dpValidateDeck');
  ok(/TENG\.validateDeck/.test(fn), 'dpValidateDeck 沒有呼叫中央驗證器');
  ok(/r\.legal\s*===\s*false/.test(fn),
    '讀的欄位不是 legal —— DeckValidationResult 沒有 valid 欄位，寫錯會恆為 undefined 而整條靜默失效');
  // 抄第二份的特徵：自己實作同名 4 張 / ACE SPEC 上限
  ok(!/aceSpec/i.test(DP), 'deckPosts 段自己處理了 ACE SPEC —— 規則必然與前端漂移');
  ok(!/maxCopies|sameNameTotal/.test(DP), 'deckPosts 段自己算了同名張數上限');
});

T('⭐ 舊 bundle（還沒跑 update-tournament.bat）時 fail-open，但結構檢查照做', () => {
  const fn = extractFn(DP, 'dpValidateDeck');
  ok(/typeof TENG\.validateDeck !== 'function'/.test(fn), '沒有處理 validateDeck 不存在的情況 —— 舊 bundle 會整條 500');
  ok(/total !== 60/.test(fn), '結構檢查沒有驗 60 張');
  ok(/TPOOL\.get\(e\.cardId\)/.test(fn), '沒有驗卡片存在於卡池');
  const i60 = fn.indexOf('total !== 60'), iSkip = fn.indexOf("typeof TENG.validateDeck !== 'function'");
  ok(i60 >= 0 && iSkip > i60, 'fail-open 的早退寫在結構檢查之前 —— 舊 bundle 會連 60 張都不驗');
});

T('⭐ entries 正規化只留 cardId / count（丟掉 role 等前端欄位）', () => {
  const fn = extractFn(DP, 'dpNormalizeEntries');
  ok(/\{ cardId, count \}/.test(fn), '正規化沒有收斂成 {cardId,count}');
  ok(/\^\[0-9\]\+\$/.test(fn), 'cardId 沒有做純數字驗證');
  ok(/out\.sort/.test(fn), '沒有排序 —— entriesHash 會因為順序不同而算出不同值，去重失效');
});

console.log('\n⑤-2 路由可達性與最後一道門（Fable 5 review 指出的守衛缺口）');

T('⭐⭐⭐ 賽事端點不得掛在 /api/deck-posts/ 底下（會被 :id 單段 pattern 整個吃掉）', () => {
  // 這是本輪抓到的擋刀級 bug：Express 依註冊順序比對，`/api/deck-posts/:id` 註冊在前，
  // `/api/deck-posts/tournament-eligibility` 就永遠打不到，而且回 404「找不到這篇投稿」
  // —— 不是 500、沒有 log，前端接上去只會看到入口壞死。
  ok(!/app\.(get|post|put|delete)\('\/api\/deck-posts\/(?!:id)[a-z]/i.test(SAP),
    '出現了 /api/deck-posts/具名子路徑 —— 會被 :id 遮蔽');
  ok(/app\.get\('\/api\/deck-posts-tournament\/eligibility'/.test(DP), 'eligibility 端點不見了');
  ok(/app\.post\('\/api\/deck-posts-tournament\/submit'/.test(DP), 'submit 端點不見了');
});

T('⭐⭐ 一般投稿硬編 tournament: null —— 這是「玩家自封冠軍」的最後一道門', () => {
  const ep = section(DP, "app.post('/api/deck-posts',", "app.delete('/api/deck-posts/:id'");
  ok(/tournament:\s*null/.test(ep), '一般投稿沒有硬編 tournament: null');
  ok(!/tournament:\s*b\.tournament|req\.body[^)\n]*tournament/.test(ep), '一般投稿從 body 讀了 tournament');
});

T('⭐⭐ 公開查詢一律限定 status: published（漏掉＝被下架的內容繼續公開）', () => {
  for (const [name, a, b] of [
    ['列表', "app.get('/api/deck-posts',", "app.get('/api/deck-posts/:id'"],
    ['明細', "app.get('/api/deck-posts/:id',", '// ════════ 投稿'],
    ['按讚', 'async function dpLikeHandler', "app.post('/api/deck-posts/:id/like'"],
    ['下載', "app.post('/api/deck-posts/:id/download'", '// ════════ 賽事名次投稿'],
  ]) ok(/status:\s*'published'/.test(section(DP, a, b)), name + '端點沒有限定 status: published');
});

T('⭐⭐ app.locals 的**每一個**取用點都要在執行時取（只驗一處會漏掉另一處改回解構）', () => {
  const uses = DP.match(/_deckRuleHelpers|_detectCutPlacements/g) || [];
  const runtime = DP.match(/\(app\.locals \|\| \{\}\)\._(deckRuleHelpers|detectCutPlacements)/g) || [];
  // 扣掉「掛上去」那一次（app.locals._dpPlacementOf = ...）不算取用
  ok(runtime.length >= 3, '執行時取用點只有 ' + runtime.length + ' 處，比預期少 —— 有人改回註冊時解構了');
  ok(!/const\s*\{[^}]*classifyDeck[^}]*\}\s*=\s*app\.locals/.test(SAP), '出現了註冊時解構 app.locals（v0.94／v1.01 事故）');
});

T('⭐⭐ 名次判定只認「標準四強結構」（瑞士制邊角會把整輪的人標成四強）', () => {
  const fn = extractFn(DP, 'dpPlacementOf');
  ok(/cut\.finals\.size !== 2 \|\| cut\.top4\.size !== 4/.test(fn),
    '沒有要求決賽 2 人＋四強 4 人 —— 瑞士制最後一輪會被當成四強輪，整輪的人（含輪空者）都拿到「四強」標籤');
});

T('⭐⭐ 賽事路徑不跑合法性驗證（歸檔那副是伺服器給的，擋下來就是把有名次的人關在門外）', () => {
  const fn = extractFn(DP, 'dpInsert');
  ok(/tournament \? null : dpValidateDeck/.test(fn),
    '賽事投稿也跑了 validateDeck —— 報名端點當初只驗 60 張，歸檔可能不合法，玩家會永遠 400');
  ok(/\['tournament\.eventId'\]/.test(fn),
    '同內容去重沒有帶 eventId 維度 —— 同一副牌連兩場拿名次時，第二場會永遠 409');
});

T('⭐ fail-open 不是靜默的（沒有訊號就沒有人會發現驗證其實沒開）', () => {
  ok(/牌組完整驗證停用/.test(DP), 'validateDeck 缺席時沒有 console.warn');
  ok(/validated:\s*typeof TENG\.validateDeck === 'function'/.test(DP),
    '投稿沒有記錄「進來時完整驗證有沒有開」—— 事後無法回溯補驗');
});

console.log('\n⑤-3 「我的投稿」端點（v6.140 批次3）');

T('⭐⭐⭐ -mine 用獨立前綴，且回應必須經過 dpPublic（裸回 doc 會外流 uid/email）', () => {
  ok(/app\.get\('\/api\/deck-posts-mine'/.test(DP), '找不到 -mine 端點');
  ok(!/app\.get\('\/api\/deck-posts\/mine'/.test(SAP), '寫成 /api/deck-posts/mine 會被 :id 吃掉');
  const ep = section(DP, "app.get('/api/deck-posts-mine'", "app.get('/api/deck-posts-tournament/eligibility'");
  ok(/dpPublic\(d,/.test(ep),
    '-mine 沒有走 dpPublic —— 直接 res.json(docs) 會把 uid 與 email 一起送出去，而守衛①只測 dpPublic 本身');
  ok(/projection:\s*\{[^}]*email:\s*0/.test(ep), '-mine 的 projection 沒排除 email');
  ok(/projection:\s*\{[^}]*entries:\s*0/.test(ep), '-mine 的 projection 沒排除 entries');
});

T('⭐⭐ -mine 要顯式帶 status（前端的刪除鈕與下架徽章全靠它）', () => {
  const ep = section(DP, "app.get('/api/deck-posts-mine'", "app.get('/api/deck-posts-tournament/eligibility'");
  ok(/status:\s*d\.status/.test(ep), '沒有回 status —— 玩家不會知道自己的投稿被下架了，刪除鈕也會消失');
  ok(/dpIdentity\(req\)/.test(ep), '沒有身分 gate');
  ok(/uid:\s*id\.uid/.test(ep), '沒有限定只查本人的投稿');
  ok(/no-store/.test(ep), '沒設 no-store');
});

T('⭐⭐ 投稿被「內容不合格」退回時要退還冷卻額度', () => {
  ok(/function dpRateRefund/.test(DP), '沒有 refund 機制');
  const ep = section(DP, "app.post('/api/deck-posts',", "app.delete('/api/deck-posts/:id'");
  ok(/r\.code === 400/.test(ep) && /dpRateRefund/.test(ep),
    '驗證失敗沒退冷卻 —— 玩家挑錯一副牌，換一副合法的立刻撞 429，看起來像系統在刁難他');
  ok(!/r\.code === 409[\s\S]{0,60}dpRateRefund/.test(ep), '連 409（已投過同一副）也退 —— 那就等於沒有冷卻');
});

console.log('\n⑥ 隔離與快取');

T('⭐⭐⭐ 整段自帶 try/catch，不得讓 throw 冒泡到賽事段', () => {
  ok(/\[deck-posts\] init failed/.test(SAP),
    'deckPosts 沒有自己的 catch —— 賽事段那個 catch 一觸發會連「休閒閒置自動判負」一起停用');
  // catch 內只能 warn，不能再 throw
  const cat = section(SAP, '} catch (_dpe) {', '\n    }');
  ok(/console\.warn/.test(cat) && !/throw/.test(cat), 'deckPosts 的 catch 又往外丟了');
});

T('⭐⭐ 公開 GET 設 no-store（正式站 Cloudflare 有快取住 index.json 四天的前科）', () => {
  const list = section(DP, "app.get('/api/deck-posts',", "app.get('/api/deck-posts/:id'");
  const detail = section(DP, "app.get('/api/deck-posts/:id',", '// ════════ 投稿');
  ok(/Cache-Control['"],\s*['"]no-store/.test(list), '列表端點沒設 no-store');
  ok(/Cache-Control['"],\s*['"]no-store/.test(detail), '明細端點沒設 no-store');
});

T('⭐ 寫入路徑都會清列表快取（否則新投稿要等 30 秒才看得到）', () => {
  const writes = ['dpInsert', 'dpAdminSetStatus'];
  for (const w of writes) ok(/_dpListCache\.clear\(\)/.test(extractFn(DP, w)), w + ' 沒有清快取');
  ok((DP.match(/_dpListCache\.clear\(\)/g) || []).length >= 5, '清快取的呼叫點太少，八成漏了某條寫入路徑');
});

T('⭐ 投稿有頻率／每日／總量三道上限', () => {
  const fn = extractFn(DP, 'dpInsert');
  ok(/DP_PER_DAY/.test(fn), '沒有每日上限');
  ok(/DP_ALIVE_CAP/.test(fn), '沒有未刪總量上限');
  ok(/DP_POST_COOLDOWN/.test(DP), '沒有投稿冷卻');
  ok(/entriesHash/.test(fn), '沒有同內容去重');
});

T('⭐ 刪除是軟刪（明細表要能對帳），且只能刪自己的', () => {
  const ep = section(DP, "app.delete('/api/deck-posts/:id',", '// ════════ 按讚');
  ok(/status:\s*'deleted'/.test(ep), '不是軟刪');
  ok(/uid:\s*id\.uid/.test(ep), '沒有限定本人 —— 任何人都能刪別人的投稿');
  ok(!/deleteOne|deleteMany/.test(ep), '用了硬刪除');
});

T('⭐ 投稿不可編輯（能改內容就能換皮繼承別人給的讚）', () => {
  ok(!/app\.(put|patch)\('\/api\/deck-posts/.test(SAP), '出現了編輯端點');
});

console.log('\n' + (fail ? '✗' : '✓') + ' 通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
process.exit(fail ? 1 : 0);
