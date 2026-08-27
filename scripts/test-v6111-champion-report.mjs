// v6.111 守衛：奪冠報告圖（admin）與它的資料端點。
//
// Wilson 要一張可以發佈的「奪冠報告圖」：網站賽的冠軍與四強牌組、社群賽只列冠軍。
// 這張圖是**傳播物**，一旦發出去就固定了，所以幾個口徑錯誤的代價特別高：
//   ・把個位數的奪冠事件畫成百分比 → 讀者一定誤讀
//   ・4 人賽的「四強」＝全體參賽者 → 數字正確但荒謬
//   ・名次自己再算一套 → 跟大廳排行榜對不上，玩家會抓
//   ・文案出現「官方」→ 正是 v6.110 要避開的版權風險
// 這些都不是跑得出來的錯誤，只能靜態釘死。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADM = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const SAP = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/** 取「從 anchor 起、到下一個同層 anchor 為止」的區段。⚠ 不寫死行數（v6.109 的教訓）。 */
function section(src, startAnchor, endAnchor) {
  const i = src.indexOf(startAnchor);
  if (i < 0) return '';
  const j = endAnchor ? src.indexOf(endAnchor, i + startAnchor.length) : -1;
  return src.slice(i, j > 0 ? j : src.length);
}

console.log('① 後端端點：名次與分類都走既有的單一來源');

T('⭐ 端點存在且掛在 deck-rules 作用域（分類 helper 在那裡）', () => {
  ok(/app\.get\('\/api\/admin\/champion-report'/.test(SAP), '找不到 champion-report 端點');
  const ep = section(SAP, "app.get('/api/admin/champion-report'", "app.get('/api/admin/deck-archetype-stats'");
  ok(/classifyDeck\(deckToSets\(/.test(ep),
    '分類沒有走 classifyDeck+deckToSets —— 自己抄一份必然與總表／明細漂移');
  ok(/TRULES\.find/.test(ep), '沒有讀 deckRules（規則來源）');
});

T('⭐ 名次推導重用 app.locals._detectCutPlacements，不得自抄一份', () => {
  ok(/app\.locals\._detectCutPlacements\s*=\s*_detectCutPlacements/.test(SAP),
    '名次函式沒有掛上 app.locals');
  const ep = section(SAP, "app.get('/api/admin/champion-report'", "app.get('/api/admin/deck-archetype-stats'");
  ok(/_detectCutPlacements/.test(ep), '端點沒有用到名次推導');
  ok(!/function\s+_detectCutPlacements/.test(ep),
    '端點裡自己又定義了一份名次推導 —— 兩份只要改一邊就會對同一場算出不同名次，且沒有錯誤訊息');
  // 全檔只能有一個定義
  const defs = (SAP.match(/function _detectCutPlacements/g) || []).length;
  ok(defs === 1, '_detectCutPlacements 有 ' + defs + ' 份定義，必須只有 1 份');
});

T('⭐ 端點不回 deckEntries（前端已有一份，再傳一次每場 N×60 張很肥）', () => {
  const ep = section(SAP, "app.get('/api/admin/champion-report'", "app.get('/api/admin/deck-archetype-stats'");
  const resJson = ep.slice(ep.indexOf('res.json('));
  ok(!/deckEntries/.test(resJson), '回應裡帶了 deckEntries');
});

T('端點 limit 與 /api/tournament/admin/stats 對齊（否則兩份資料時間範圍不一致）', () => {
  const ep = section(SAP, "app.get('/api/admin/champion-report'", "app.get('/api/admin/deck-archetype-stats'");
  ok(/limit\(500\)/.test(ep), 'champion-report 的 limit 不是 500');
  ok(/limit\(500\)/.test(section(SAP, "app.get('/api/tournament/admin/stats'", 'res.json(')),
    '/api/tournament/admin/stats 的 limit 變了，請同步 champion-report');
});

console.log('② 前端：資料口徑');

const CRSEC = section(ADM, '// ══ v1.66（站台 v6.111）奪冠報告圖', 'window.loadArchetypeStats');

T('⭐ 用全量 archives，不得用被 tsEventFilter 篩過的那份', () => {
  ok(CRSEC.length > 2000, '抓不到奪冠報告圖的程式區段（結構改了？請同步更新本守衛）');
  ok(/tournStatsCache\.archives/.test(CRSEC), '沒有讀 tournStatsCache.archives');
  // 篩選後的變數名是 archives（renderTournamentStats 內），本區段不得引用它
  ok(!/crBuild\(\s*archives/.test(CRSEC),
    '把篩選過的 archives 餵進 crBuild —— 使用者切到「社群自辦賽」再產圖，網站賽區塊會整塊空掉且不報錯');
});

T('⭐ 未滿 8 人的賽事不計四強（4 人賽的「四強」＝全體參賽者）', () => {
  ok(/MIN_FOR_TOP4:\s*8/.test(CRSEC), 'MIN_FOR_TOP4 不是 8');
  ok(/playerCount \|\| 0\) < CR\.MIN_FOR_TOP4/.test(CRSEC), '沒有真的用這個門檻過濾');
});

T('⭐ 全圖不出現百分比（奪冠是個位數事件，畫比率必然誤讀）', () => {
  const draw = section(CRSEC, 'async function crDraw', 'window.openChampionReportExport');
  ok(draw.length > 1000, '抓不到 crDraw');
  ok(!/miPct\(/.test(draw), 'crDraw 用了 miPct（百分比）');
  ok(!/'%'/.test(draw) && !/\+ '%/.test(draw), 'crDraw 有拼接百分比符號');
});

// ⚠ v6.112：Wilson 回報第一版「很多字疊在一起」—— 每區固定 max 列數＋y 一路累加，
//   社群賽場次一多就壓過註腳與頁腳。修法＝畫之前先算剩餘空間。
T('⭐ 版面用 roomFor 動態算列數，且註腳有硬保留區（不得再壓字）', () => {
  const draw = section(CRSEC, 'async function crDraw', 'window.openChampionReportExport');
  ok(/const roomFor = /.test(draw), '沒有 roomFor —— 列數又寫死了');
  ok(/const NOTE_TOP = /.test(draw), '沒有註腳保留區');
  const calls = (draw.match(/roomFor\(/g) || []).length;
  ok(calls >= 4, 'roomFor 只被用了 ' + (calls - 1) + ' 次（應該每個會長高的區塊都要用）');
});

T('⭐ 匯出按鈕在「牌組原型」分頁、與環境報告圖並排（Wilson 指定位置）', () => {
  const i = ADM.indexOf('id="meta-img-btn"');
  ok(i > 0, '找不到環境報告圖按鈕');
  const win = ADM.slice(i, i + 900);
  ok(/id="champ-img-btn"/.test(win), '奪冠報告圖按鈕不在環境報告圖旁邊');
  ok(/arch-since/.test(ADM.slice(Math.max(0, i - 1500), i)), '兩顆鈕上方應該就是「統計範圍」下拉');
  // 舊位置（賽事統計的篩選列）不得殘留
  ok(!/tsFilterBarHtml[\s\S]{0,600}champ-img-btn/.test(ADM), '賽事統計分頁還留著舊按鈕');
});

T('⭐ 快取沒載過也要能產圖（按鈕換頁後 tournStatsCache 可能是 null）', () => {
  // v1.71：資料取得已收斂到 crLoadData（單頁版與完整版多頁共用同一份），本條改查那一段。
  // v6.240：補載改走中央全量 helper fetchAllTournamentStats（賽事歸檔已改伺服器端分頁，
  //   直接打 /api/tournament/admin/stats 只會拿到**第一頁**，報告圖的「全部資料」會少算）。
  //   ⚠ 判準只是換了載體，意圖不變：快取為空時 crLoadData 必須自己把資料補載回來。
  const open = section(CRSEC, 'async function crLoadData', 'window.renderChampionReportModal');
  ok(/fetchAllTournamentStats\(/.test(open),
    '沒有在快取為空時自己補載 —— 使用者從沒開過「賽事統計」就會按不出圖');
  ok(!/api\('\/api\/tournament\/admin\/stats'\)/.test(open),
    'crLoadData 直接打未分頁端點 —— 只會拿到第一頁，報告圖會少算');
});

T('⭐ 也不做「較上期」趨勢（奪冠數的期間差幾乎全是噪音）', () => {
  const draw = section(CRSEC, 'async function crDraw', 'window.openChampionReportExport');
  ok(!/miTrend\(/.test(draw), 'crDraw 引用了 miTrend —— 這張圖刻意不做趨勢');
});

console.log('③ 前端：沿用既有繪圖 helper，不要另寫一套');

T('⭐ logo 走既有 miLogo（drawImage 未 decode 會靜默不畫）', () => {
  ok(/await miLogo\(\)/.test(CRSEC), '沒有用 miLogo');
  ok(!/new Image\(\)/.test(CRSEC), '自己又寫了一份載圖 —— 未 decode 的圖 drawImage 不畫也不報錯');
});

T('字型與截斷走 miFont / miFit（canvas font 不吃繼承；卡名中英混排寬度不均）', () => {
  ok(/miFont\(ctx,/.test(CRSEC), '沒有用 miFont');
  ok(/miFit\(ctx,/.test(CRSEC), '沒有用 miFit');
});

T('固定 2× 輸出，不用 devicePixelRatio（輸出檔跟本機螢幕無關）', () => {
  ok(/MI\.W \* MI\.S/.test(CRSEC) && /ctx\.scale\(MI\.S, MI\.S\)/.test(CRSEC), '沒有沿用 MI.S');
  ok(!/devicePixelRatio/.test(CRSEC), '用了 devicePixelRatio');
});

T('⭐ 主力寶可夢 fallback 前有 await ensureCardIndex/ensureCardTags', () => {
  // v1.71：資料取得已收斂到 crLoadData（單頁版與完整版多頁共用同一份），本條改查那一段。
  const open = section(CRSEC, 'async function crLoadData', 'window.renderChampionReportModal');
  ok(/await ensureCardIndex\(\);\s*await ensureCardTags\(\)/.test(open),
    '沒有 await 卡片索引與標籤 —— 會把支援型寶可夢當成主力，產出笑話圖');
});

console.log('④ 文案：不得出現「官方」（v6.110 的版權風險）');

T('⭐ 奪冠報告圖的繪製區段不得含「官方賽」等舊稱', () => {
  for (const w of ['官方賽', '官方奪冠', '（官方）', '(官方)']) {
    ok(!CRSEC.includes(w), '奪冠報告圖區段出現「' + w + '」');
  }
});

T('正對照：判準會抓（不是永遠綠）', () => {
  const probe = "ctx.fillText('🏛️ 官方賽 冠軍', 0, 0);";
  ok(['官方賽'].some(w => probe.includes(w)), '判準抓不到違規樣本 ⇒ 假綠');
});

T('圖上有寫明「非官方」立場（頁腳）', () => {
  ok(/非官方/.test(CRSEC), '頁腳沒有非官方聲明 —— 這張圖會被轉發出去，立場要寫在圖裡');
});

console.log('⑤ crBuild 行為端（純資料聚合，最容易出錯的一段）');

// 把 crBuild 從 admin.html 抽出來實跑。⚠ 用大括號配對抓函式邊界，不寫死行數。
function extractFn(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return null;
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return null;
}
const crBuildSrc = extractFn(ADM, 'function crBuild(');
const crConst = section(ADM, 'const CR = {', '};') + '};';
// v6.244：crBuild 現在會呼叫中央的 tournStartMs（賽事日期＝開賽時間）。
//   ⚠ 這裡刻意抽**真的那一份**而不是 stub —— stub 會讓「日期基準改錯」在這支守衛裡看不出來。
const tournStartMsSrc = extractFn(ADM, 'function tournStartMs(');

T('⭐ crBuild 抽得出來且能跑（純函式，無 DOM 依賴）', () => {
  ok(crBuildSrc && crBuildSrc.length > 500, '抓不到 crBuild');
  ok(!/document\.|window\.|ctx\./.test(crBuildSrc), 'crBuild 碰了 DOM ⇒ 不再是純資料聚合，難以測試');
});

// detectMainPokemon 是 admin 頁面的既有 helper，測試裡 stub 掉（本守衛不測它）。
// ⚠ 抽不出來時不要讓整支 test crash（HEAD-FAIL 對照會看不到 FAIL 數）——
//   給一個會讓後續每條都失敗的 stub，讓失敗以正常的 ✗ 呈現。
let crBuild = () => { throw new Error('crBuild 抽取失敗（區段不存在或結構改變）'); };
try {
  crBuild = new Function(crConst + '\n' + tournStartMsSrc + '\n' + crBuildSrc
    + '\nfunction detectMainPokemon(){ return null; }\nreturn crBuild;')();
} catch (e) { /* 保持上面的 stub */ }

const ev = (id, comm, players, champUid, matches, name) => ({
  eventId: id, eventName: name || ('賽事' + id), finishedAt: Date.now() - 86400000,
  communityEvent: comm, playerCount: players, championUid: champUid, championName: 'C' + id,
  players: [{ uid: champUid, name: '冠軍' + id, deckName: '自填牌組' + id, deckEntries: [{ cardId: '1', count: 4 }] },
            { uid: 'u2', name: '亞軍', deckName: 'D2', deckEntries: [{ cardId: '2', count: 4 }] }],
  matches: matches || [{ round: 1, p1uid: champUid, p2uid: 'u2', winnerUid: champUid, status: 'done' }],
});

T('⭐ 未滿 8 人的網站賽不計四強（但仍計冠軍）', () => {
  const arcs = [ev('e1', false, 4, 'u1'), ev('e2', false, 16, 'u9')];
  const rep = new Map([
    ['e1', { championArchetype: 'A', top4: [{ uid: 'u1', archetype: 'A' }, { uid: 'u2', archetype: 'B' }], placementsOk: true }],
    ['e2', { championArchetype: 'A', top4: [{ uid: 'u9', archetype: 'A' }], placementsOk: true }],
  ]);
  const d = crBuild(arcs, rep, 0);
  ok(d.siteChamps.length === 2, '冠軍應有 2 場，實得 ' + d.siteChamps.length);
  ok(d.t4Skipped === 1, '應有 1 場因人數不足被跳過四強，實得 ' + d.t4Skipped);
  ok(d.t4Total === 1, '四強只該算 16 人那場的 1 位，實得 ' + d.t4Total);
});

T('⭐ 社群賽只算牌組次數、完全不進四強統計（與大廳排行榜口徑一致）', () => {
  const arcs = [ev('c1', true, 8, 'u1')];
  const rep = new Map([['c1', { championArchetype: 'A', top4: [{ uid: 'u1', archetype: 'A' }], placementsOk: true }]]);
  const d = crBuild(arcs, rep, 0);
  ok(d.commRank.length === 1 && d.commRank[0].n === 1, '社群賽奪冠牌組榜應有 1 筆 ×1');
  ok(d.siteChamps.length === 0, '社群賽不該進網站賽冠軍');
  ok(d.t4Total === 0, '社群賽不該進四強統計，實得 ' + d.t4Total);
});

// ⭐ v6.112（Wilson）：「社群賽不要列玩家名字，這個圖是讓玩家參考哪些牌組強勢，
//   不是針對個人玩家的成績」→ 社群賽改成「該期間奪冠次數最多的前幾名牌組」。
T('⭐ 社群賽同一牌組多次奪冠會累加成次數榜（而不是一場一列玩家）', () => {
  const arcs = [ev('c1', true, 8, 'u1'), ev('c2', true, 8, 'u2'), ev('c3', true, 8, 'u3')];
  const rep = new Map([
    ['c1', { championArchetype: '甲牌組', top4: [], placementsOk: false }],
    ['c2', { championArchetype: '甲牌組', top4: [], placementsOk: false }],
    ['c3', { championArchetype: '乙牌組', top4: [], placementsOk: false }],
  ]);
  const d = crBuild(arcs, rep, 0);
  ok(d.commRank.length === 2, '應聚合成 2 種牌組，實得 ' + d.commRank.length);
  ok(d.commRank[0].name === '甲牌組' && d.commRank[0].n === 2, '次數最多的應排第一且為 2');
  ok(d.commChampCount === 3, '總冠軍場次應為 3');
});

T('⭐ 社群賽區塊不得再輸出玩家名字（欄位層級的保證）', () => {
  ok(!/commChamps/.test(CRSEC), '還留著 commChamps（一場一列、會印玩家暱稱）');
  const draw = section(CRSEC, 'async function crDraw', 'window.openChampionReportExport');
  // ⚠ anchor 用區塊標題的 emoji，不要用「社群賽」三個字 —— 它在副標
  //   （「網站賽 X 場・社群賽 Y 場」）就出現過一次，會抓到錯的位置。
  const i = draw.indexOf("sectionHead('👥'");
  ok(i > 0, '找不到社群賽區塊');
  const win = draw.slice(i, i + 400);
  ok(!/champRows\(/.test(win), '社群賽區塊仍用 champRows（那個會印暱稱）');
  ok(/rankRows\(/.test(win), '社群賽區塊應改用牌組次數榜 rankRows');
});

T('沒有冠軍的場次（取消／雙方未到）不列，但要計入註腳數字', () => {
  const arcs = [ev('e1', false, 8, null), ev('e2', false, 8, 'u1')];
  const rep = new Map([['e2', { championArchetype: 'A', top4: [], placementsOk: false }]]);
  const d = crBuild(arcs, rep, 0);
  ok(d.siteChamps.length === 1, '只有 1 場有冠軍');
  ok(d.noChamp === 1, 'noChamp 應為 1，實得 ' + d.noChamp);
});

T('名次判不出來（placementsOk=false）要計入 noCut，不靜默當成沒有四強', () => {
  const arcs = [ev('e1', false, 16, 'u1')];
  const rep = new Map([['e1', { championArchetype: 'A', top4: [], placementsOk: false }]]);
  const d = crBuild(arcs, rep, 0);
  ok(d.noCut === 1, 'noCut 應為 1，實得 ' + d.noCut);
});

T('⭐ 原型未命中時退玩家自填牌組名，不顯示空白', () => {
  const arcs = [ev('e1', false, 8, 'u1')];
  const rep = new Map([['e1', { championArchetype: null, top4: [], placementsOk: false }]]);
  const d = crBuild(arcs, rep, 0);
  ok(d.siteChamps[0].deck === '自填牌組e1', '應退 deckName，實得 ' + d.siteChamps[0].deck);
});

T('冠軍該場戰績（勝/負）算得出來', () => {
  const arcs = [ev('e1', false, 8, 'u1', [
    { round: 1, p1uid: 'u1', p2uid: 'u2', winnerUid: 'u1', status: 'done' },
    { round: 2, p1uid: 'u1', p2uid: 'u3', winnerUid: 'u3', status: 'done' },
    { round: 3, p1uid: 'u1', p2uid: 'u4', winnerUid: 'u1', status: 'done' },
    { round: 3, bye: true, p1uid: 'u5' },
  ])];
  const d = crBuild(arcs, new Map(), 0);
  ok(d.siteChamps[0].w === 2 && d.siteChamps[0].l === 1,
    '應為 2 勝 1 負，實得 ' + d.siteChamps[0].w + '勝' + d.siteChamps[0].l + '負');
});

console.log('\n=== v6.111 奪冠報告圖：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
