#!/usr/bin/env node
/**
 * v6.150 守衛：錦標賽玩家端盤面遮蔽（公平性）
 *
 * 背景：`/api/tournament/state` 與 `/action` 原本直接回傳整份 `doc.gameState`，只有
 *   `/spectate/state` 會蓋手牌 ⇒ 對戰中任一方用 devtools 就能讀到對手的手牌內容、牌庫順序、
 *   獎賞內容（roomId 由 `/bracket` 公開回傳）。本檔把 `server_admin_patch.js` 裡的
 *   REDACT BLOCK 抽出來當純函式跑，驗行為；另外靜態驗「每一個回玩家的 gameState 都走遮蔽出口」。
 *
 * ⚠ 兩個 IRON_RULES 對應：
 *   Rule 25（掃描器本身要先被驗證會不會漏）→ 每個靜態掃描都附「故意壞掉的樣本必須被抓到」。
 *   HEAD-FAIL 證明 → 每組行為斷言都附正對照：未遮蔽的輸入必須被判為洩漏。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

// ── 0. 抽出 REDACT BLOCK + 掃描器自我驗證 ───────────────────────────────────
const BEGIN = '── v6.150 REDACT BLOCK BEGIN ──';
const END = '── v6.150 REDACT BLOCK END ──';
const i0 = SRC.indexOf(BEGIN), i1 = SRC.indexOf(END);
ok('REDACT BLOCK 標記存在', i0 > 0 && i1 > i0, `i0=${i0} i1=${i1}`);
const BLOCK = i0 > 0 && i1 > i0 ? SRC.slice(i0 + BEGIN.length, i1) : '';
// 掃描器自我驗證：抽到的區塊必須真的含這幾個函式（否則就是抽了個空殼，斷言全綠也沒意義）
for (const fn of ['_redactStateForSeat', '_pendingReveal', '_oppDeckTopReveal', '_redactZone', '_stateForSeat', '_redactInst']) {
  ok(`BLOCK 含 ${fn}`, BLOCK.includes('function ' + fn), `len=${BLOCK.length}`);
}
ok('BLOCK 長度合理（>2000）', BLOCK.length > 2000, String(BLOCK.length));
ok('_stateForSeat 有先過 _capLog（log 截尾不能被繞過）', /_stateForSeat\(gs, seat\) \{ return _redactStateForSeat\(_capLog\(gs\), seat\); \}/.test(BLOCK));
ok('_viewerSeat 不在 BLOCK 內（它依賴 tournIdentity，不該被純函式測試吃進來）', !BLOCK.includes('_viewerSeat'));

if (!BLOCK) { console.log(`\n${pass} PASS / ${fail} FAIL`); process.exit(1); }

// v6.153：遮蔽是**預設關閉**的旗標。`_redactOn` 宣告在 BLOCK 之外，所以這裡注入它；
//   下面的行為測試預設注入「已開啟」，另有一組專門驗「關閉時玩家視角原樣回」。
const mkFactory = () => new Function('TPOOL', '_capLog', '_redactOn',
  BLOCK + '\nreturn { _redactStateForSeat, _stateForSeat, _pendingReveal, _oppDeckTopReveal, TSEAT_NO_REDACT, TREDACT_CARD_ID };');
const factory = mkFactory();
const TPOOL = new Map([
  ['CAT', { name: '火箭隊的貓老大ex', attacks: [{ name: '高傲指令' }] }],
  ['FOX', { name: '狐大盜', attacks: [{ name: '技能大盜' }] }],
  ['PLAIN', { name: '普通寶可夢', attacks: [{ name: '撞擊' }] }],
]);
const R = factory(TPOOL, (gs) => gs, () => true);          // 旗標開：驗遮蔽行為
const ROFF = mkFactory()(TPOOL, (gs) => gs, () => false);   // 旗標關：驗零影響
const HID = R.TREDACT_CARD_ID;

// ── fixture ────────────────────────────────────────────────────────────────
const inst = (iid, cardId, extra) => Object.assign({ iid, cardId, damage: 0, energyAttached: [] }, extra || {});
const mkPlayer = (tag) => ({
  active: inst(tag + 'A', 'PLAIN'),
  bench: [inst(tag + 'B1', 'PLAIN')],
  hand: [inst(tag + 'H1', 'C-h1'), inst(tag + 'H2', 'C-h2')],
  // ⚠ deck 的 iid 故意**不照字典序**排：真實 iid 是隨機字串，若 fixture 的原順序剛好等於
  //   字典序，「順序有沒有被打亂」那條斷言就會變成永遠測不出東西的安慰劑。
  deck: Array.from({ length: 20 }, (_, i) => inst(tag + 'D' + ((i * 7) % 20), 'C-d' + i)),
  discard: [inst(tag + 'X1', 'C-x1')],
  prizes: Array.from({ length: 6 }, (_, i) => inst(tag + 'P' + i, 'C-p' + i)),
});
const mkGs = (o) => Object.assign({ phase: 'playing', activePlayerIndex: 0, turn: 3, log: [], players: [mkPlayer('p0'), mkPlayer('p1')] }, o || {});

const allIids = (gs) => {
  const out = [];
  for (const p of gs.players) for (const z of ['hand', 'deck', 'discard', 'prizes']) for (const c of p[z]) out.push(c.iid);
  for (const p of gs.players) { out.push(p.active.iid); for (const b of p.bench) out.push(b.iid); }
  return out.sort().join(',');
};
/** 洩漏偵測：seat 視角下，對手隱藏區還看得到真 cardId ⇒ 洩漏。 */
const leaks = (gs, seat) => {
  const opp = gs.players[1 - seat];
  return [opp.hand, opp.deck, opp.prizes].some((z) => z.some((c) => c.cardId !== HID));
};

// ── 1. 基本遮蔽 ─────────────────────────────────────────────────────────────
{
  const gs = mkGs();
  const out = R._redactStateForSeat(gs, 0);
  ok('對手 hand 內容被遮', out.players[1].hand.every((c) => c.cardId === HID));
  ok('對手 deck 內容被遮', out.players[1].deck.every((c) => c.cardId === HID));
  ok('對手 prizes 內容被遮', out.players[1].prizes.every((c) => c.cardId === HID));
  ok('對手三區長度不變', out.players[1].hand.length === 2 && out.players[1].deck.length === 20 && out.players[1].prizes.length === 6);
  ok('對手棄牌區不動（公開區）', out.players[1].discard[0].cardId === 'C-x1');
  ok('對手場上不動（公開區）', out.players[1].active.cardId === 'PLAIN' && out.players[1].bench[0].cardId === 'PLAIN');
  ok('自己整份不動（同一物件參考）', out.players[0] === gs.players[0]);
  ok('iid 集合守恆', allIids(out) === allIids(gs));
  ok('不改動原始盤面（DB 物件不可被汙染）', gs.players[1].hand[0].cardId === 'C-h1');
  // 正對照（HEAD-FAIL 證明）：未遮蔽的輸入必須被同一個偵測器判為洩漏
  ok('★正對照：未遮蔽輸入被判為洩漏', leaks(gs, 0) === true);
  ok('★遮蔽後不再洩漏', leaks(out, 0) === false);
}

// ── 2. 不遮的情形 ───────────────────────────────────────────────────────────
{
  const over = mkGs({ phase: 'game-over' });
  ok('game-over 攤牌不遮', R._redactStateForSeat(over, 0) === over);
  const gs = mkGs();
  ok('TSEAT_NO_REDACT（測試房）不遮', R._redactStateForSeat(gs, R.TSEAT_NO_REDACT) === gs);
  const anon = R._redactStateForSeat(gs, -1);
  ok('認不出座位 ⇒ 雙方都遮（fail-closed）',
    anon.players[0].hand.every((c) => c.cardId === HID) && anon.players[1].hand.every((c) => c.cardId === HID));
  ok('認不出座位時牌庫/獎賞也雙邊遮',
    anon.players[0].deck.every((c) => c.cardId === HID) && anon.players[1].prizes.every((c) => c.cardId === HID));
}

// ── 3. 面朝上的獎賞不遮 ─────────────────────────────────────────────────────
{
  const gs = mkGs();
  gs.players[1].prizes[2] = inst('p1P2', 'C-p2', { faceUp: true });
  const out = R._redactStateForSeat(gs, 0);
  ok('faceUp 獎賞內容保留', out.players[1].prizes[2].cardId === 'C-p2');
  ok('其餘獎賞仍被遮', out.players[1].prizes.filter((c) => c.cardId === HID).length === 5);
}

// ── 4. pending 揭示豁免 ─────────────────────────────────────────────────────
{
  // 枇琶型：查看對手手牌選道具丟棄（actorIdx=我、sourcePlayerIdx=對手）
  const gs = mkGs({ pendingSelection: { type: 'hand-discard', actorIdx: 0, sourcePlayerIdx: 1, minCount: 0, maxCount: 1, effectKey: 'loquat-discard-opp-items', params: { validIids: ['p1H1'] } } });
  const out = R._redactStateForSeat(gs, 0);
  ok('查看對手手牌型 pending ⇒ 對手整手牌放行', out.players[1].hand.every((c) => c.cardId !== HID));
  ok('同一時刻對手牌庫仍被遮', out.players[1].deck.every((c) => c.cardId === HID));
  ok('同一時刻對手獎賞仍被遮', out.players[1].prizes.filter((c) => c.cardId === HID).length === 6);

  // 卡面「在不看正面的情況下」⇒ 一律不放行
  const gs2 = mkGs({ pendingSelection: { type: 'hand-discard', actorIdx: 0, sourcePlayerIdx: 1, minCount: 1, maxCount: 1, effectKey: 'x', params: { concealed: true, validIids: ['p1H1', 'p1H2'] } } });
  ok('concealed:true ⇒ 手牌仍全遮', R._redactStateForSeat(gs2, 0).players[1].hand.every((c) => c.cardId === HID));

  // 配樂之笛型：對手牌庫頂 5 張（params 點名 iid）
  const top5 = ['p1D0', 'p1D1', 'p1D2', 'p1D3', 'p1D4'];
  const gs3 = mkGs({ pendingSelection: { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 1, filter: 'Basic:TOP5', minCount: 0, maxCount: 1, effectKey: 'y', params: { top5Iids: top5 } } });
  const o3 = R._redactStateForSeat(gs3, 0);
  ok('params 點名的對手牌庫 iid 放行', top5.every((iid) => o3.players[1].deck.find((c) => c.iid === iid).cardId !== HID));
  ok('未被點名的對手牌庫仍遮', o3.players[1].deck.filter((c) => c.cardId === HID).length === 15);
  ok('deck-search 型不會順便開整手牌', o3.players[1].hand.every((c) => c.cardId === HID));

  // 對手自己的 pending（actorIdx=對手）⇒ 不得放行任何東西
  const gs4 = mkGs({ pendingSelection: { type: 'deck-search', actorIdx: 1, sourcePlayerIdx: 1, minCount: 1, maxCount: 1, effectKey: 'z', params: { validIids: ['p1D0', 'p1D1'] } } });
  ok('對手自己的 pending 不放行（正是既有的洩漏面）', R._redactStateForSeat(gs4, 0).players[1].deck.every((c) => c.cardId === HID));

  // pendingChainQueue 也要看
  const gs5 = mkGs({ pendingChainQueue: [{ type: 'hand-choose', actorIdx: 0, sourcePlayerIdx: 1, minCount: 0, maxCount: 1, effectKey: 'q', params: {} }] });
  ok('pendingChainQueue 內的 pending 同樣生效', R._redactStateForSeat(gs5, 0).players[1].hand.every((c) => c.cardId !== HID));
}

// ── 5. 高傲指令：條件式放行對手牌庫頂 10 張 ─────────────────────────────────
{
  const gs = mkGs();
  gs.players[0].active = inst('p0A', 'CAT');
  const out = R._redactStateForSeat(gs, 0);
  ok('貓老大ex 在戰鬥場＋輪到我 ⇒ 對手牌庫頂 10 張放行',
    out.players[1].deck.slice(0, 10).every((c) => c.cardId !== HID));
  ok('第 11 張起仍被遮', out.players[1].deck.slice(10).every((c) => c.cardId === HID));
  ok('手牌/獎賞不受影響（仍遮）',
    out.players[1].hand.every((c) => c.cardId === HID) && out.players[1].prizes.every((c) => c.cardId === HID));

  const notMyTurn = mkGs({ activePlayerIndex: 1 });
  notMyTurn.players[0].active = inst('p0A', 'CAT');
  ok('不是我的回合 ⇒ 不放行', R._redactStateForSeat(notMyTurn, 0).players[1].deck.every((c) => c.cardId === HID));

  const setup = mkGs({ phase: 'setup' });
  setup.players[0].active = inst('p0A', 'CAT');
  ok('setup 階段 ⇒ 不放行', R._redactStateForSeat(setup, 0).players[1].deck.every((c) => c.cardId === HID));

  const bench = mkGs();
  bench.players[0].bench = [inst('p0B1', 'CAT')];
  ok('貓老大ex 只在備戰 ⇒ 不放行（招式只有戰鬥場能用）', R._redactStateForSeat(bench, 0).players[1].deck.every((c) => c.cardId === HID));

  // 狐大盜｜技能大盜 借招（engine gate：手牌 0）
  const fox = mkGs();
  fox.players[0].active = inst('p0A', 'FOX');
  fox.players[0].hand = [];
  fox.players[1].bench = [inst('p1B1', 'CAT')];
  ok('技能大盜＋手牌0＋對手場上有貓老大ex ⇒ 放行牌庫頂 10 張',
    R._redactStateForSeat(fox, 0).players[1].deck.slice(0, 10).every((c) => c.cardId !== HID));

  const fox2 = mkGs();
  fox2.players[0].active = inst('p0A', 'FOX');
  fox2.players[1].bench = [inst('p1B1', 'CAT')];
  ok('技能大盜但手牌非 0 ⇒ 不放行（engine gate 不成立）', R._redactStateForSeat(fox2, 0).players[1].deck.every((c) => c.cardId === HID));

  const fox3 = mkGs();
  fox3.players[0].active = inst('p0A', 'FOX');
  fox3.players[0].hand = [];
  ok('技能大盜但對手場上沒有貓老大ex ⇒ 不放行', R._redactStateForSeat(fox3, 0).players[1].deck.every((c) => c.cardId === HID));
}

// ── 6. 座位 1 視角（方向不能寫死）───────────────────────────────────────────
{
  const gs = mkGs();
  const out = R._redactStateForSeat(gs, 1);
  ok('seat=1 時遮的是 players[0]', out.players[0].hand.every((c) => c.cardId === HID));
  ok('seat=1 時自己（players[1]）不動', out.players[1] === gs.players[1]);
  ok('★正對照（seat=1）：未遮蔽輸入被判為洩漏', leaks(gs, 1) === true);
}

// ── 7. 靜態：每一個回給玩家的 gameState 都要走遮蔽出口 ──────────────────────
/**
 * 掃出所有 `gameState:` 的值表達式，並判斷它是「回給玩家的回應」還是「寫進 DB」。
 * ⚠ 原本是逐行掃、要求 `res.json(` 與 `gameState:` 同一行 —— 同檔的 `/replay` 就是多行
 *   `res.json({ … })`，那種寫法會整個被漏掉（Fable 5 第二輪審查抓到的掃描器盲點，Rule 25）。
 *   改成往前找最近的 `res.json(` / DB 寫入關鍵字來歸類，不受換行影響。
 */
function scanGameStateExprs(src) {
  const out = [];
  const re = /\bgameState:\s*([^,\n}]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const before = src.slice(Math.max(0, m.index - 800), m.index);
    const iRes = before.lastIndexOf('res.json(');
    const iDb = Math.max(before.lastIndexOf('updateOne('), before.lastIndexOf('insertOne('),
      before.lastIndexOf('$set'), before.lastIndexOf('$setOnInsert'), before.lastIndexOf('return {'),
      before.lastIndexOf('projection'));
    out.push({ expr: m[1].trim(), isResJson: iRes > iDb });
  }
  return out;
}
{
  const hits = scanGameStateExprs(SRC).filter((h) => h.isResJson);
  ok('掃到的回應端 gameState 數量合理（/join 1 + /state 1 + /action 5 + /spectate 1 = 8）',
    hits.length >= 8, String(hits.length));
  const bad = hits.filter((h) => !h.expr.startsWith('_stateForSeat('));
  ok('所有回給玩家的 gameState 都走 _stateForSeat（含觀戰端；v6.150 已收斂）',
    bad.length === 0, bad.map((b) => b.expr).join(' | '));
  // 掃描器自我驗證①：單行的壞樣本
  const broken1 = scanGameStateExprs('        res.json({ gameState: doc.gameState, version: doc.version });');
  ok('★掃描器自我驗證：單行裸 doc.gameState 會被抓到',
    broken1.length === 1 && broken1[0].isResJson && !broken1[0].expr.startsWith('_stateForSeat('));
  // 掃描器自我驗證②：**跨多行**的壞樣本（舊版逐行掃描器在這裡會靜默漏掉）
  const broken2 = scanGameStateExprs('        res.json({\n          version: doc.version,\n          gameState: doc.gameState,\n        });');
  ok('★掃描器自我驗證：跨多行的裸 doc.gameState 也會被抓到',
    broken2.length === 1 && broken2[0].isResJson && !broken2[0].expr.startsWith('_stateForSeat('));
  // 掃描器自我驗證③：DB 寫入不該被誤報成回應
  const dbWrite = scanGameStateExprs("        await TROOMS.updateOne({ _id: room }, { $set: { gameState: newGs, version: nv } });");
  ok('★掃描器自我驗證：DB 寫入不會被誤判成回應', dbWrite.length === 1 && dbWrite[0].isResJson === false);
}

// ── 8. 靜態：/action 在正式賽房必須要求 verified 身分 ───────────────────────
{
  const a0 = SRC.indexOf("app.post('/api/tournament/action'");
  const a1 = SRC.indexOf("app.post('/api/tournament/reset'");
  ok('/action 區段可定位', a0 > 0 && a1 > a0);
  const seg = SRC.slice(a0, a1);
  ok('/action 正式賽房要求 verified（未驗證身分可以替對手送動作）',
    /if \(doc\.matchId && !_id\.verified\) return res\.status\(403\)/.test(seg));
  ok('/action 區段沒有殘留裸 gameState 回應', !/gameState: gs,/.test(seg) && !/gameState: _capLog\(newGs\)/.test(seg));
  // 掃描器自我驗證
  ok('★掃描器自我驗證：裸 "gameState: gs," 樣本會被抓到', /gameState: gs,/.test('res.json({ gameState: gs, version: 1 })'));
}

// ── 9. 靜態：/state 走 _viewerSeat ─────────────────────────────────────────
{
  const s0 = SRC.indexOf("app.get('/api/tournament/state'");
  const s1 = SRC.indexOf("app.post('/api/tournament/action'");
  const seg = SRC.slice(s0, s1);
  // v6.153：只有遮蔽開啟時才去判座位（關閉時直接走不遮的哨兵值，見 10d 那組斷言）
  ok('/state 取得請求者座位', /_vseat = _redactOn\(\) \? await _viewerSeat\(req, doc\) : TSEAT_NO_REDACT/.test(seg));
  ok('/state 用 _stateForSeat 出口', /gameState: _stateForSeat\(doc\.gameState, _vseat\)/.test(seg));
  ok('_viewerSeat 只採信 verified 身分', /if \(!id \|\| id\.error \|\| !id\.verified/.test(SRC));
  ok('_viewerSeat 對無 matchId 的測試房回 TSEAT_NO_REDACT', /if \(!doc \|\| !doc\.matchId\) return TSEAT_NO_REDACT;/.test(SRC));
}

// ── 10. 前端：ensurePoolForStateIds 必須濾掉佔位 cardId ─────────────────────
{
  const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  ok('前端有 HIDDEN_CARD_ID 常數', PAGE.includes("const HIDDEN_CARD_ID = '__HIDDEN__';"));
  ok('pushInst 會濾掉佔位 cardId（否則每次盤面更新都全載 40 個卡包）',
    PAGE.includes("if (it.cardId && String(it.cardId) !== HIDDEN_CARD_ID) ids.push(String(it.cardId));"));
  ok('★掃描器自我驗證：舊寫法樣本會被判為未修',
    !"      if (it.cardId) ids.push(String(it.cardId));".includes('HIDDEN_CARD_ID'));
}

// ── 10b. 對手牌庫的**順序**必須被打亂 ──────────────────────────────────────
{
  // 為什麼：iid 是刻意保留的，但棄牌區/場上是公開區 —— 曾公開過的卡被洗回牌庫後，
  //   它的 iid 對應對方早就知道；照原順序回傳等於告訴對方那張卡在牌庫第幾位。
  const gs = mkGs();
  const origIids = gs.players[1].deck.map((c) => c.iid);
  const out = R._redactStateForSeat(gs, 0);
  const newIids = out.players[1].deck.map((c) => c.iid);
  ok('牌庫 iid 集合不變（守恆）', [...newIids].sort().join(',') === [...origIids].sort().join(','));
  ok('牌庫順序確實被打亂（不是原順序）', newIids.join(',') !== origIids.join(','));
  ok('打亂是確定性的（同一份盤面兩次回應必須一致）',
    R._redactStateForSeat(mkGs(), 0).players[1].deck.map((c) => c.iid).join(',') === newIids.join(','));
  ok('★正對照：未遮蔽的盤面就是原順序（斷言有鑑別度）', origIids.join(',') === mkGs().players[1].deck.map((c) => c.iid).join(','));
  ok('自己的牌庫順序完全不動', out.players[0] === gs.players[0]);

  // 放行的卡必須維持原本的索引，否則「牌庫頂 10 張」會指到別的地方
  const cat = mkGs();
  cat.players[0].active = inst('p0A', 'CAT');
  const catOut = R._redactStateForSeat(cat, 0);
  ok('高傲指令放行的牌庫頂 10 張維持原索引與原內容',
    catOut.players[1].deck.slice(0, 10).map((c) => c.iid).join(',') === origIids.slice(0, 10).join(',')
    && catOut.players[1].deck.slice(0, 10).every((c) => c.cardId !== HID));
  ok('第 11 張起被遮且順序被打亂',
    catOut.players[1].deck.slice(10).every((c) => c.cardId === HID)
    && catOut.players[1].deck.slice(10).map((c) => c.iid).join(',') !== origIids.slice(10).join(','));
}

// ── 10c. v6.153 遮蔽總開關：預設關閉時玩家視角必須零影響 ─────────────────
{
  const gs = mkGs();
  ok('★旗標關閉 ⇒ 玩家視角原樣回（連物件都不換，＝ v6.149 行為）',
    ROFF._redactStateForSeat(gs, 0) === gs);
  ok('★旗標關閉 ⇒ 對手手牌看得到（正對照：證明上面那條不是因為別的原因才通過）',
    ROFF._redactStateForSeat(gs, 0).players[1].hand.every((c) => c.cardId !== HID));
  // ⚠ 觀戰視角**不受旗標影響**：那是 v6.149 就有的既有行為，關掉旗標不可以讓觀戰者看到手牌
  const spec = ROFF._redactStateForSeat(mkGs(), -1);
  ok('★★旗標關閉時觀戰視角仍然遮（不可以退化成看得見雙方手牌）',
    spec.players[0].hand.every((c) => c.cardId === HID) && spec.players[1].hand.every((c) => c.cardId === HID));
  ok('旗標關閉時觀戰的牌庫/獎賞也仍然遮',
    spec.players[0].deck.every((c) => c.cardId === HID) && spec.players[1].prizes.every((c) => c.cardId === HID));
  ok('旗標開啟時玩家視角照常遮（對照組）', R._redactStateForSeat(mkGs(), 0).players[1].hand.every((c) => c.cardId === HID));
}

// ── 10d. 靜態：旗標的預設與接線 ────────────────────────────────────────────
{
  ok('★遮蔽旗標預設關閉', /let _redactFlag = false, _redactAt = 0;/.test(SRC));
  ok('只有明確 true 才算開（避免 "true" 字串誤開）', /_redactFlag = !!\(d && d\.enabled === true\);/.test(SRC));
  ok('旗標在 BLOCK 之外（BLOCK 才能被純函式測試注入）', !BLOCK.includes('let _redactFlag'));
  ok('BLOCK 內用 _redactOn() 判斷，且只套用在玩家視角',
    BLOCK.includes('if ((seat === 0 || seat === 1) && !_redactOn()) return gs;'));
  // ⚠ 以下一律 scope 到各自的區段再比對 —— 全檔比對會被別處的同款字面滿足而變成安慰劑
  //   （Fable 5 第三輪審查實測：`/_redactAt = 0;/` 全檔比對會被宣告行 `let _redactFlag = false, _redactAt = 0;`
  //   滿足，把 admin 端點裡真正的失效那行刪掉照樣 PASS）。
  const _segState = SRC.slice(SRC.indexOf("app.get('/api/tournament/state'"), SRC.indexOf("app.post('/api/tournament/action'"));
  const _iRedact = SRC.indexOf("app.post('/api/tournament/admin/redact'");
  const _segRedactPost = SRC.slice(_iRedact, _iRedact + 900);
  const _segAction = SRC.slice(SRC.indexOf("app.post('/api/tournament/action'"), SRC.indexOf("app.post('/api/tournament/reset'"));
  ok('/state 每次都會刷新旗標（10 秒快取）', /await redactEnabled\(\);/.test(_segState));
  ok('★遮蔽關閉時 /state 完全不做身分判定、直接走「不遮」的哨兵值',
    /const _vseat = _redactOn\(\) \? await _viewerSeat\(req, doc\) : TSEAT_NO_REDACT;/.test(_segState));
  ok('★★關閉時不可以只把 401 拿掉就算數（-1 在 _redactStateForSeat 是「兩邊都遮」＝玩家自己手牌變卡背）',
    !/const _vseat = await _viewerSeat\(req, doc\);/.test(_segState));
  ok('遮蔽開啟時仍然擋認不出座位的請求（401）', /if \(_vseat === -1\) return res\.status\(401\)/.test(_segState));
  ok('admin 開關端點有管理員 gate', /isTournAdmin\(id\)/.test(_segRedactPost));
  ok('改設定後快取立刻失效（scope 到 admin POST，不是全檔）', /_redactAt = 0;/.test(_segRedactPost));
  ok('★掃描器自我驗證：宣告行不該讓上一條 PASS',
    !/_redactAt = 0;/.test("    let _redactFlag = false, _redactAtX = 0;"));
  // ⚠ /action 與 /join 的 verified 要求**不**受旗標影響：那擋的是「替對手送動作」，
  //   是會直接破壞別人對局的，與「偷看手牌」不同一件事。
  ok('★/action 的 verified 要求不受遮蔽旗標影響（scope 到 /action 區段）',
    /if \(doc\.matchId && !_id\.verified\) return res\.status\(403\)/.test(_segAction)
    && !/_redactOn\(\)[\s\S]{0,80}!_id\.verified/.test(_segAction));
}

// ── 11. log 的 privateMessage 只能給本人 ─────────────────────────────────────
{
  const mkLogGs = () => {
    const g = mkGs();
    g.log = [
      { turn: 3, playerIndex: 0, message: '搜到 一張卡片', privateMessage: '搜到 秘密卡A 加入手牌' },
      { turn: 3, playerIndex: 1, message: '搜到 一張卡片', privateMessage: '搜到 秘密卡B 加入手牌' },
      { turn: 3, playerIndex: null, message: '系統訊息' },
    ];
    return g;
  };
  const gs = mkLogGs();
  const out = R._redactStateForSeat(gs, 0);
  ok('自己的 privateMessage 保留', out.log[0].privateMessage === '搜到 秘密卡A 加入手牌');
  ok('對手的 privateMessage 被剝除', out.log[1].privateMessage === undefined);
  ok('對手那行的公開 message 仍在（只拿掉私有版）', out.log[1].message === '搜到 一張卡片');
  ok('不改動原始 log（DB 物件不可被汙染）', gs.log[1].privateMessage === '搜到 秘密卡B 加入手牌');
  ok('★正對照：未遮蔽輸入看得到對手的 privateMessage', gs.log[1].privateMessage !== undefined);
  const spec = R._redactStateForSeat(mkLogGs(), -1);
  ok('觀戰視角（-1）雙方 privateMessage 全部剝除',
    spec.log[0].privateMessage === undefined && spec.log[1].privateMessage === undefined);
  const over = mkLogGs(); over.phase = 'game-over';
  ok('game-over 攤牌時 privateMessage 不剝（與 /replay 的 finalLog 一致）',
    R._redactStateForSeat(over, 0).log[1].privateMessage === '搜到 秘密卡B 加入手牌');
  ok('測試房（TSEAT_NO_REDACT）不剝', R._redactStateForSeat(mkLogGs(), R.TSEAT_NO_REDACT).log[1].privateMessage !== undefined);
}

// ── 12. 靜態：/spectate/state 收斂到同一條出口 + 拒絕當事人 ─────────────────
{
  const p0 = SRC.indexOf("app.get('/api/tournament/spectate/state'");
  const p1 = SRC.indexOf("app.post('/api/tournament/match/enter'");
  ok('/spectate/state 區段可定位', p0 > 0 && p1 > p0);
  const seg = SRC.slice(p0, p1);
  ok('/spectate/state 走中央出口（seat=-1 ⇒ 雙方 hand/deck/prizes 都遮）',
    /gameState: _stateForSeat\(doc\.gameState, -1\)/.test(seg));
  ok('/spectate/state 不再只手刻蓋 hand（原本牌庫順序與獎賞照送）',
    !/pl\.hand = pl\.hand\.map/.test(seg));
  ok('/spectate/state 拒絕當事人觀戰自己的房',
    /light\.seats\.indexOf\(id\.uid\) >= 0\) return res\.status\(403\)/.test(seg));
  // ⚠ 這條原本只比 indexOf 大小：訊息文字一改就變 -1，而 -1 < 任何正數恆成立 ⇒ 靜默失效。
  //   （Fable 5 第二輪審查抓到的安慰劑斷言。）先確認兩個錨點都真的存在。
  const iGate = seg.indexOf('return res.status(403)'), iMark = seg.indexOf('markSpectator(room, id.uid)');
  ok('當事人 gate 在 markSpectator 之前（否則會被計進觀戰人數）',
    iGate > -1 && iMark > -1 && iGate < iMark, `iGate=${iGate} iMark=${iMark}`);
}

// ── 13. 靜態：/join 與 /state 的身分處理 ────────────────────────────────────
{
  const j0 = SRC.indexOf("app.post('/api/tournament/join'");
  const j1 = SRC.indexOf("app.get('/api/tournament/state'");
  const seg = SRC.slice(j0, j1);
  ok('/join 正式賽房要求 verified（否則填對手 uid 就能換到未遮蔽盤面）',
    /if \(doc\.matchId && !_id\.verified\) return res\.status\(403\)/.test(seg));
  ok('/join 回應走 _stateForSeat', /gameState: _stateForSeat\(doc\.gameState, doc\.matchId \? seat : TSEAT_NO_REDACT\)/.test(seg));
  const s0 = SRC.indexOf("app.get('/api/tournament/state'");
  const s1 = SRC.indexOf("app.post('/api/tournament/action'");
  const segS = SRC.slice(s0, s1);
  // v6.153：關閉時 _vseat 直接是「不遮」的哨兵值、根本不會是 -1，所以這條 401 只有開啟時才會走到
  ok('（遮蔽開啟時）認不出座位回 401，而不是回一份「連自己都遮」的 200 盤面',
    /if \(_vseat === -1\) return res\.status\(401\)/.test(segS));
}

// ── 14. 前端：concealed picker 沒有卡面資料也要畫得出卡背 ───────────────────
{
  const PAGE2 = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  ok('concealed 的候選卡不再被「有卡面才渲染」擋掉', PAGE2.includes('{#if c || concealed}'));
  ok('★掃描器自我驗證：舊寫法樣本會被判為未修', !'              {#if c}'.includes('{#if c || concealed}'));
  // 只有 sel-grid（可能含遮蔽卡）那一個 each 需要改；三個 retreat-grid 都是場上寶可夢，不該被動到
  const oldGate = (PAGE2.match(/\{#each selectionItems as item \(item\.iid\)\}\{@const c=getCard\(item\.cardId\)\}\s*\n\s*\{#if c\}/g) || []).length;
  ok('三個 retreat-grid 的渲染判斷維持原樣（場上寶可夢不會被遮）', oldGate === 3, String(oldGate));
}

// ── 15. 前端：401 要分得出「身分失效」與「網路失聯」──────────────────────
{
  const PAGE3 = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  ok('tApi 把 HTTP status 帶給呼叫端', PAGE3.includes('_err.status = res.status;'));
  ok('有 tAuthLost 旗標', PAGE3.includes('let tAuthLost = $state(false);'));
  ok('輪詢與強制同步在 401 時設旗標',
    (PAGE3.match(/if \(e && e\.status === 401\) tAuthLost = true;/g) || []).length === 2);
  ok('拿到正常回應時會清掉旗標（否則橫幅永遠掛著）',
    (PAGE3.match(/tAuthLost = false;/g) || []).length === 2);
  ok('橫幅有身分失效的專屬文案（不能沿用「與伺服器失聯」）', PAGE3.includes('⚠ 登入狀態已失效'));
  ok('⭐旗標有被 template 消費（新增狀態旗標必問「UI 有沒有用它」）', PAGE3.includes('{#if tAuthLost}'));
  ok('重新同步鈕會先強制刷新 token（憑證過期可就地自救）', PAGE3.includes('await firebaseUser.getIdToken(true)'));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
