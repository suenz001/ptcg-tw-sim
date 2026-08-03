// v6.114 守衛：大廳「對戰中房間」場面預覽。
//
// 玩家許願：在對戰房間外面就能看到裡面雙方戰鬥區／備戰區的寶可夢，方便找想學的牌組觀戰。
//
// 這一版的風險全部集中在「顯示了不該顯示的東西」，所以守衛的重點是三個方向：
//   A. 卡圖 URL 例外表必須跟卡片資料同步（枚舉守衛 —— 新卡出現例外而沒補表就紅燈）
//   B. buildLobbyFieldPreview 是白名單建構，輸出裡不可能夾帶手牌／牌庫／獎賞內容
//   C. setup 階段一律不預覽；等待中（lobby）的房間一律不顯示任何場面／牌組資訊
//
// C 的兩條是真的洩漏路徑，不是防禦性寫法：
//   - setup 期間對戰畫面本身是 oppHidden（雙方互相看不到場面），但房間 status 已是 playing，
//     玩家只要另開一個分頁看大廳就能偷看對手還沒揭示的備戰區。
//   - 等待中的房間雙方已選牌組但還沒開打，先看到對方牌組再決定加不加入＝牌組狙擊。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6114-s.js'), E = join(ROOT, '.v6114-e.ts'), O = join(ROOT, '.v6114-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); pass++; }
  catch (e) { console.log('  \u2717 ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

// 模組載入失敗（例如檔案還不存在）不要 crash —— 記成 FAIL，讓 HEAD 對照看得到數字。
let M = null, loadErr = null;
try {
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, "export { buildLobbyFieldPreview, lobbyCardImageUrl, CARD_IMG_EXCEPTIONS } from './src/lib/game/lobby-preview';");
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
    target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'silent' });
  M = await import(pathToFileURL(O).href);
} catch (e) { loadErr = e; }

const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

console.log('\u2460 \u5361\u5716 URL \u679a\u8209\u5b88\u885b\uff08\u4f8b\u5916\u8868\u5fc5\u9808\u8ddf\u5361\u7247\u8cc7\u6599\u540c\u6b65\uff09');

T('lobbyCardImageUrl / CARD_IMG_EXCEPTIONS \u53ef\u8f09\u5165', () => {
  ok(!loadErr, 'lobby-preview \u6a21\u7d44\u8f09\u5165\u5931\u6557\uff1a' + (loadErr && loadErr.message));
});

T('\u2b50 live \u5361\u7247\u88e1\u6bcf\u4e00\u5f35\u7684 imageUrl\uff0c\u4e0d\u662f\u5408\u6210\u503c\u5c31\u5fc5\u9808\u5728\u4f8b\u5916\u8868\u88e1', () => {
  ok(M, '\u6a21\u7d44\u672a\u8f09\u5165');
  const dir = join(ROOT, 'static/cards');
  const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
  const missing = [];
  let total = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
    for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      if (c?.id == null || !c.imageUrl) continue;
      total++;
      if (M.lobbyCardImageUrl(String(c.id)) !== c.imageUrl) missing.push(String(c.id) + ' ' + c.name + ' -> ' + c.imageUrl);
    }
  }
  ok(total > 3000, '\u6383\u5230\u7684\u5361\u592a\u5c11\uff08' + total + '\uff09\uff0c\u5224\u6e96\u53ef\u80fd\u58de\u4e86');
  ok(missing.length === 0,
    '\u6709 ' + missing.length + ' \u5f35\u5361\u7684\u5361\u5716\u7db2\u5740\u5408\u6210\u4e0d\u51fa\u4f86\u4e14\u4e0d\u5728\u4f8b\u5916\u8868\uff0c\u8acb\u88dc\u9032 CARD_IMG_EXCEPTIONS\uff1a\n        '
    + missing.slice(0, 6).join('\n        '));
});

T('\u4f8b\u5916\u8868\u4e0d\u5f97\u6709\u591a\u9918\u9805\uff08\u9632\u8154\u8abf\u8150\u721b\uff09', () => {
  ok(M, '\u6a21\u7d44\u672a\u8f09\u5165');
  const dir = join(ROOT, 'static/cards');
  const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
  const urlById = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
    for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      if (c?.id != null && c.imageUrl) urlById.set(String(c.id), c.imageUrl);
    }
  }
  const stale = Object.keys(M.CARD_IMG_EXCEPTIONS).filter(id => urlById.get(id) !== M.CARD_IMG_EXCEPTIONS[id]);
  ok(stale.length === 0, '\u4f8b\u5916\u8868\u9019\u5e7e\u7b46\u5df2\u7d93\u8ddf\u5361\u7247\u8cc7\u6599\u5c0d\u4e0d\u4e0a\uff1a' + stale.join(', '));
});

T('\u6b63\u5c0d\u7167\uff1a\u5408\u6210\u898f\u5247\u672c\u8eab\u662f\u5c0d\u7684\uff08\u88dc\u96f6\u5230 8 \u4f4d\uff09', () => {
  ok(M, '\u6a21\u7d44\u672a\u8f09\u5165');
  ok(M.lobbyCardImageUrl('19621') === 'https://asia.pokemon-card.com/tw/card-img/tw00019621.png', '\u5408\u6210\u898f\u5247\u4e0d\u5c0d');
  ok(M.lobbyCardImageUrl('') === '' && M.lobbyCardImageUrl('abc') === '', '\u5783\u573e\u8f38\u5165\u61c9\u56de\u7a7a\u5b57\u4e32');
});

console.log('\u2461 buildLobbyFieldPreview \u767d\u540d\u55ae\u5efa\u69cb');

const mkRoom = (phase, extra) => ({
  roomId: 'A1B2', status: 'playing', _version: 7,
  seats: [{ name: 'P1', deckEntries: [{ cardId: '111', count: 4 }] }, { name: 'P2', deckEntries: [] }],
  gameState: {
    phase, turn: 12,
    players: [
      { active: { iid: 'a1', cardId: '19621' }, bench: [{ iid: 'b1', cardId: '19622' }, { iid: 'b2', cardId: '19623' }],
        hand: [{ iid: 'h1', cardId: '18965' }], deck: [{ iid: 'd1', cardId: '18969' }],
        discard: [], prizes: [{ iid: 'z1', cardId: '19624' }, { iid: 'z2', cardId: '19625' }] },
      { active: { iid: 'a2', cardId: '19624' }, bench: [], hand: [{ iid: 'h9', cardId: '19625' }],
        deck: [], discard: [], prizes: [{ iid: 'z9', cardId: '19626' }] },
    ],
    ...(extra || {}),
  },
});

T('\u2b50 playing \u623f\uff1a\u53d6\u5f97\u96d9\u65b9\u6230\u9b25\u5340/\u5099\u6230\u5340 + \u734e\u8cde\u5f35\u6578 + \u56de\u5408\u6578', () => {
  ok(M, '\u6a21\u7d44\u672a\u8f09\u5165');
  const fp = M.buildLobbyFieldPreview(mkRoom('playing'));
  ok(fp, '\u61c9\u8a72\u8981\u6709\u9810\u89bd');
  ok(fp.turn === 12, 'turn \u932f');
  ok(fp.sides.p1.activeCardId === '19621', 'p1 active \u932f');
  ok(JSON.stringify(fp.sides.p1.benchCardIds) === JSON.stringify(['19622', '19623']), 'p1 bench \u932f');
  ok(fp.sides.p1.prizesLeft === 2 && fp.sides.p2.prizesLeft === 1, '\u734e\u8cde\u5f35\u6578\u932f');
  ok(fp.sides.p2.benchCardIds.length === 0, 'p2 bench \u61c9\u70ba\u7a7a');
});

T('\u2b50\u2b50 \u8f38\u51fa\u88e1\u4e0d\u53ef\u80fd\u593e\u5e36\u624b\u724c\uff0f\u724c\u5eab\uff0f\u734e\u8cde\u5167\u5bb9\uff0f\u724c\u8868', () => {
  ok(M, '\u6a21\u7d44\u672a\u8f09\u5165');
  const fp = M.buildLobbyFieldPreview(mkRoom('playing'));
  const j = JSON.stringify(fp);
  for (const k of ['hand', 'deck', 'discard', 'deckEntries', 'iid']) {
    ok(!j.includes(k), '\u9810\u89bd\u8f38\u51fa\u88e1\u51fa\u73fe\u4e86 ' + k + '\uff1a' + j.slice(0, 200));
  }
  // \u624b\u724c\uff0f\u724c\u5eab\uff0f\u734e\u8cde\u88e1\u624d\u6709\u7684 cardId \u4e0d\u5f97\u51fa\u73fe\u5728 p1 \u5074\u7684\u5834\u9762\u88e1
  ok(!j.includes('18965') && !j.includes('18969'), 'p1 \u7684\u624b\u724c\uff0f\u724c\u5eab cardId \u5916\u6d29\u4e86\uff1a' + j);
  ok(fp.sides.p1.prizesLeft === 2, '\u734e\u8cde\u53ea\u80fd\u7d66\u5f35\u6578');
});

console.log('\u2462 \u771f\u6d29\u6f0f\u8def\u5f91\u7684 gate');

T('\u2b50\u2b50 setup \u968e\u6bb5\u4e00\u5f8b\u4e0d\u9810\u89bd\uff08\u5426\u5247\u53ef\u5728\u5927\u5ef3\u5077\u770b\u5c0d\u624b\u672a\u63ed\u793a\u7684\u5099\u6230\u5340\uff09', () => {
  ok(M, '\u6a21\u7d44\u672a\u8f09\u5165');
  ok(M.buildLobbyFieldPreview(mkRoom('setup')) === null,
    'setup \u968e\u6bb5\u5c45\u7136\u56de\u4e86\u9810\u89bd\u2014\u2014 \u5c0d\u6230\u756b\u9762 oppHidden \u5728 setup \u662f\u771f\u7684\u906e\u853d\uff0c\u5927\u5ef3\u4e0d\u80fd\u7e5e\u904e\u53bb');
});

T('game-over \u4e0d\u9810\u89bd\uff1b\u7121 gameState / \u7f3a players \u4e0d\u9810\u89bd\u4e5f\u4e0d\u7206', () => {
  ok(M, '\u6a21\u7d44\u672a\u8f09\u5165');
  ok(M.buildLobbyFieldPreview(mkRoom('game-over')) === null, 'game-over \u61c9\u56de null');
  ok(M.buildLobbyFieldPreview({ roomId: 'X' }) === null, '\u7121 gameState \u61c9\u56de null');
  ok(M.buildLobbyFieldPreview(null) === null, 'null \u61c9\u56de null');
  ok(M.buildLobbyFieldPreview({ gameState: { phase: 'playing', players: [] } }) === null, '\u7a7a players \u61c9\u56de null');
  ok(M.buildLobbyFieldPreview({ gameState: { phase: 'playing', players: [{}, {}] } }) === null,
    '\u96d9\u65b9\u90fd\u7a7a\u5834\uff08\u8cc7\u6599\u672a\u540c\u6b65\uff09\u61c9\u56de null\uff0c\u4e0d\u8981\u756b\u4e00\u6392\u7a7a\u683c');
});

T('\u6b63\u5c0d\u7167\uff1a\u4e0a\u9762\u7684 gate \u4e0d\u662f\u300c\u6c38\u9060\u56de null\u300d', () => {
  ok(M, '\u6a21\u7d44\u672a\u8f09\u5165');
  ok(M.buildLobbyFieldPreview(mkRoom('playing')) !== null, '\u6b63\u5e38\u5c0d\u6230\u4e2d\u623f\u9593\u61c9\u8a72\u8981\u6709\u9810\u89bd\uff0c\u5426\u5247\u9019\u529f\u80fd\u6839\u672c\u6c92\u751f\u6548');
});

console.log('\u2463 UI \u9759\u614b\uff1a\u7b49\u5f85\u4e2d\u7684\u623f\u9593\u7d55\u4e0d\u5f97\u986f\u793a\u724c\u7d44\uff0f\u5834\u9762\u8cc7\u8a0a');

// \u7528\u7d50\u69cb anchor \u622a\u65b7\uff0c\u4e0d\u5beb\u6b7b\u884c\u6578\uff08\u5beb\u6b7b\u884c\u6578\u7684\u6383\u63cf\u7a97\u53e3\u662f\u8106\u5f31\u9ede\uff0cv6.109 \u88ab\u54ac\u904e\uff09
function sliceBetween(text, startNeedle, endNeedle) {
  const i = text.indexOf(startNeedle);
  if (i < 0) return null;
  const j = text.indexOf(endNeedle, i + startNeedle.length);
  return text.slice(i, j < 0 ? text.length : j);
}

T('\u2b50\u2b50 lobbyRooms \u5340\u584a\u5167\u4e0d\u5f97\u51fa\u73fe\u5834\u9762\uff0f\u724c\u8868\u76f8\u95dc\u7684\u4efb\u4f55\u6771\u897f', () => {
  const blk = sliceBetween(PAGE, '{#each lobbyRooms as r (r.roomId)}', '{#each playingRooms as r (r.roomId)}');
  ok(blk, '\u627e\u4e0d\u5230 lobbyRooms \u5340\u584a\uff08markup \u7d50\u69cb\u6539\u4e86\uff0c\u8acb\u91cd\u65b0\u6aa2\u8996\u672c\u5b88\u885b\uff09');
  ok(blk.length < 4000, 'lobbyRooms \u5340\u584a\u622a\u5f97\u592a\u5927\uff08' + blk.length + '\uff09\uff0canchor \u53ef\u80fd\u5931\u6548');
  for (const bad of ['buildLobbyFieldPreview', 'gameState', 'deckEntries', 'or-field', 'lobbyCardImageUrl']) {
    ok(!blk.includes(bad),
      '\u7b49\u5f85\u4e2d\u7684\u623f\u9593\u51fa\u73fe\u4e86 ' + bad + ' \u2014\u2014 \u96d9\u65b9\u5df2\u9078\u724c\u7d44\u4f46\u672a\u958b\u6253\uff0c\u5148\u770b\u5230\u5c0d\u65b9\u724c\u7d44\u518d\u6c7a\u5b9a\u52a0\u4e0d\u52a0\u5165\uff1d\u724c\u7d44\u72d9\u64ca');
  }
});

T('\u6b63\u5c0d\u7167\uff1a\u5c0d\u6230\u4e2d\u5340\u584a\u78ba\u5be6\u6709\u63a5\u4e0a\u5834\u9762\u9810\u89bd', () => {
  const blk = sliceBetween(PAGE, '{#each playingRooms as r (r.roomId)}', '</ul>');
  ok(blk, '\u627e\u4e0d\u5230 playingRooms \u5340\u584a');
  ok(blk.includes('buildLobbyFieldPreview'), '\u5c0d\u6230\u4e2d\u5340\u584a\u6c92\u63a5\u5834\u9762\u9810\u89bd \u21d2 \u9019\u529f\u80fd\u6839\u672c\u6c92\u4e0a');
  ok(blk.includes('lobbyCardImageUrl'), '\u6c92\u7528\u4e2d\u592e\u7684\u5361\u5716 URL helper');
  ok(!blk.includes('.hand') && !blk.includes('.deck'), '\u5c0d\u6230\u4e2d\u5340\u584a\u4e0d\u5f97\u76f4\u63a5\u78b0\u624b\u724c\uff0f\u724c\u5eab');
});

T('\u2b50 UI \u4e0d\u5f97\u7e5e\u904e\u4e2d\u592e\u7ba1\u7dda\u76f4\u8b80 r.gameState', () => {
  const blk = sliceBetween(PAGE, '{#each playingRooms as r (r.roomId)}', '</ul>');
  ok(blk && !/r\.gameState/.test(blk),
    'UI \u76f4\u63a5\u8b80 r.gameState \u4e86 \u2014\u2014 \u516c\u5e73\u6027\u5b88\u9580\u9ede\u5c31\u7834\u4e86\uff0c\u4e00\u5f8b\u8d70 buildLobbyFieldPreview');
});

T('\u2b50 \u5099\u6230\u5340 each \u5fc5\u9808\u6709\u7a69\u5b9a key\uff08\u540c\u540d\u5169\u96bb\u6703\u649e key \u2192 \u767d\u5c4f\uff09', () => {
  const blk = sliceBetween(PAGE, '{#each playingRooms as r (r.roomId)}', '</ul>');
  ok(blk, '\u627e\u4e0d\u5230\u5340\u584a');
  ok(/\{#each _sd\.benchCardIds as _bid, _bi \(_bid \+ '_' \+ _bi\)\}/.test(blk),
    '\u5099\u6230\u5340 each \u6c92\u6709\u7528\u300ccardId + index\u300d\u8907\u5408 key\uff1b\u53ea\u7528 cardId \u9047\u5230\u5834\u4e0a\u5169\u96bb\u540c\u540d\u5c31\u6703\u649e key');
});

console.log('\u2464 \u624b\u6a5f\u7248');

T('\u2b50 \u624b\u6a5f\u89e3\u9664\u6e05\u55ae\u5167\u6efe\u52d5\uff08\u907f\u514d\u96d9\u5c64\u6efe\u52d5\uff09', () => {
  const i = PAGE.indexOf('@media (max-width:600px){');
  ok(i > 0, '\u627e\u4e0d\u5230\u5927\u5ef3\u7684\u624b\u6a5f media query');
  const win = PAGE.slice(i, i + 400);
  ok(/\.open-room-list\{[^}]*max-height:\s*none/.test(win), '\u624b\u6a5f\u6c92\u89e3\u9664 .open-room-list \u7684 max-height');
  ok(/overflow-y:\s*visible/.test(win), '\u624b\u6a5f\u6c92\u89e3\u9664 overflow-y');
});

T('\u2b50 \u6bcf\u4e00\u884c\u90fd\u8981 flex-wrap\uff08\u820a\u7248\u55ae\u884c flex \u7121 wrap \u5728 375px \u5bec\u6703\u64e0\u7206\uff09', () => {
  for (const cls of ['.or-main', '.or-meta', '.or-field']) {
    const i = PAGE.indexOf('  ' + cls + '{');
    ok(i > 0, '\u627e\u4e0d\u5230 ' + cls + ' \u7684\u6a23\u5f0f');
    ok(/flex-wrap:\s*wrap/.test(PAGE.slice(i, i + 220)), cls + ' \u6c92\u6709 flex-wrap:wrap');
  }
});

console.log('\u2465 \u65e2\u6709\u529f\u80fd\u4e0d\u5f97\u6389\u4e86');

T('\u7df4\u7fd2\u623f\u6a19\u7c64\uff0f\u7b49\u5f85\u958b\u6230\u6a19\u7c64\uff0f\u623f\u4e3b\u5728\u7dda\uff0f\u623f\u9f61\uff0f\u623f\u865f\uff0f\u624b\u52d5\u52a0\u5165\u90fd\u9084\u5728', () => {
  for (const [needle, what] of [
    ['or-practice-tag', '\u7df4\u7fd2\u623f\u6a19\u7c64'],
    ['or-waiting-tag', '\u7b49\u5f85\u958b\u6230\u6a19\u7c64'],
    ['hostPresence(r)', '\u623f\u4e3b\u5728\u7dda\u72c0\u614b'],
    ['fmtRoomAge(r.createdAt)', '\u623f\u9f61'],
    ['\u623f\u865f {r.roomId}', '\u623f\u865f\u986f\u793a'],
    ['\u7528\u623f\u865f\u624b\u52d5\u52a0\u5165', '\u624b\u52d5\u623f\u865f\u52a0\u5165'],
    ['spectator-btn', '\u89c0\u6230\u9215'],
  ]) ok(PAGE.includes(needle), what + ' \u4e0d\u898b\u4e86');
});

console.log('\n=== v6.114 \u5927\u5ef3\u5834\u9762\u9810\u89bd\uff1aPASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
