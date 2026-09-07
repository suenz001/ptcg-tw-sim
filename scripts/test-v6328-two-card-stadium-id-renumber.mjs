// ⭐⭐⭐ v6.328 守衛：「傳說」競技場右半 id 換號，把官方 id 空間還回去
//
// 事故經過（2026-09-07 查出）：
//   v6.093 把「傳說」競技場拆成左右兩張獨立卡片時，右半需要新的 cardId，
//   當時**自己捏了 19624 / 19625 / 19626**。
//   但那三個號碼**其實是台灣官方 M-P 209~211**（膽小蟲 J／超級米立龍ex J／麻麻小魚 I）——
//   repo 自己的 `scripts/data/official-set-manifest.json` 早就把它們列在 M-P 底下。
//   後果：那三張官方卡永遠補不進來（補了就 id 重複），
//   其中「超級米立龍ex」是站內完全沒有、但標準賽可用的卡。
//
// ⚠⚠ 為什麼既有守衛全都沒抓到（安慰劑型態）：
//   `test-official-set-completeness` 的判準是 `if (OURS.has(String(id))) continue;`
//   —— **只問 id 在不在我方卡庫，不問那是不是同一張卡**。
//   19624 一直在卡庫（是傳說的海溝右半）⇒ 一路綠燈。B2 補的就是這個缺口。
//
// v6.328 的修法（**只做換號**）：
//   ・右半改成「左半 id ＋ `-1`」——官方 id 一律純數字，這種形式結構上不可能再被官方佔用。
//   ・舊 id 的**卡片資料留著**、登記進 `$lib/cards/visibility` 的 HIDDEN_FROM_PLAYERS
//     ⇒ 部署當下進行中的對局／部署前的錦標賽報名快照仍解析成傳說場地卡，**零破壞**；
//        玩家選不到；舊牌組載入時由 migrateCardId 換成新 id。
//
// 🔨 v6.329（下一版）才會：刪掉那三筆停用卡 → **同版**把 19624/19625/19626 讓給官方那三張。
//   ⚠⚠ 順序反了（先加官方卡、遷移表卻還在）會讓玩家新放的官方卡被遷移吃掉 ——
//   這正是 v6.328 第一版設計被對抗性審查抓到的錯，E 區的交接斷言就是為了鎖住它。
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}

// ── 卡庫 ─────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const INDEX = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const liveCodes = new Set(INDEX.map((e) => e.code));
const BY_ID = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveCodes.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) BY_ID.set(String(c.id), c);
}
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'scripts/data/official-set-manifest.json'), 'utf8'));

// ── 判準函式（A1／B2 與它們的自檢共用同一份，避免「自檢抄一份判準」的安慰劑）─────
/** 本站自造的 cardId 必須有非數字字元；官方 id 一律純數字。 */
const isSiteMintedId = (id) => !/^\d+$/.test(String(id));
/** 官方快照說這個 id 屬於 `allowed` 這幾個本地卡包，我方收的 setCode 對不對得起來。 */
const setCodeMatchesOfficial = (allowed, setCode) => allowed.has(setCode);

// ── 從**產品端**取表（不在測試檔自己抄一份清單，否則新增第 4 組時守衛會靜默失效）──
const S = join(ROOT, '.x6328-s.js'), E = join(ROOT, '.x6328-e.ts'), O = join(ROOT, '.x6328-o.mjs');
const cleanup = () => { for (const p of [S, E, O]) { try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ } } };
let M;
try {
  const { build } = await import('esbuild');
  writeFileSync(S, 'export const base="";');
  writeFileSync(E,
    "export { TWO_CARD_STADIUM_PAIR_IDS, TWO_CARD_STADIUM_LEFT_IDS, twoCardStadiumPartnerCardId, twoCardStadiumSide } from './src/lib/decks/validation';\n"
    + "export { HIDDEN_FROM_PLAYERS, isHiddenFromPlayers } from './src/lib/cards/visibility';\n"
    + "export { migrateCardId, migrateDeck, mergeTwoCardStadiumEntries } from './src/lib/decks/cardIdMigration';\n");
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
  });
  M = await import(pathToFileURL(O).href + '?v=' + Date.now());
} finally { cleanup(); }

const LEFT_IDS = [...M.TWO_CARD_STADIUM_LEFT_IDS];
const RIGHT_IDS = LEFT_IDS.map((l) => M.TWO_CARD_STADIUM_PAIR_IDS[l]);
const HIDDEN = M.HIDDEN_FROM_PLAYERS;

console.log('A. 右半 id 的結構性不變量（清單一律從產品端的配對表推導）');

T('⭐⭐⭐ A1 每一個「兩張合一競技場」的右半 id 都必須是本站自造格式（非純數字）', () => {
  ok(LEFT_IDS.length >= 3, '左半清單只有 ' + LEFT_IDS.length + ' 筆 —— 掃描器多半壞了（下限斷言）');
  const bad = RIGHT_IDS.filter((id) => !isSiteMintedId(id));
  ok(bad.length === 0,
    '這些右半 id 是純數字，會佔用官方 id 空間（＝重演 v6.093 的事故）：' + bad.join(', ')
    + '\n      → 本站自造的 id 一律要有非數字字元（現行約定：左半 id + "-1"）');
});

T('⭐⭐ A1b 反安慰劑：A1 用的 isSiteMintedId 正反樣本都要判對（與 A1 呼叫同一個函式）', () => {
  ok(isSiteMintedId('19621-1') === true, 'isSiteMintedId 認不出本站自造格式');
  ok(isSiteMintedId('19624') === false, 'isSiteMintedId 把官方純數字 id 誤判成自造');
  ok(isSiteMintedId(19624) === false, '數字型別的官方 id 也要判成非自造');
});

T('⭐ A2 左右半必須是同一張官方卡（卡名逐字相同、都是競技場、共用同一張合併橫圖）', () => {
  for (let i = 0; i < LEFT_IDS.length; i++) {
    const L = BY_ID.get(LEFT_IDS[i]), R = BY_ID.get(RIGHT_IDS[i]);
    ok(L && R, '缺卡：' + LEFT_IDS[i] + ' / ' + RIGHT_IDS[i]);
    ok(L.name === R.name, `左右卡名不同：${L.name} vs ${R.name}`);
    ok(L.subtype === 'Stadium' && R.subtype === 'Stadium', '不是競技場：' + LEFT_IDS[i]);
    ok(R.imageUrl === L.imageUrl, '右半圖檔應指向左半那張官方合併橫圖：' + R.imageUrl);
    ok(M.twoCardStadiumPartnerCardId(LEFT_IDS[i]) === RIGHT_IDS[i]
      && M.twoCardStadiumPartnerCardId(RIGHT_IDS[i]) === LEFT_IDS[i], '配對不是雙向：' + LEFT_IDS[i]);
    ok(M.twoCardStadiumSide(LEFT_IDS[i]) === 0 && M.twoCardStadiumSide(RIGHT_IDS[i]) === 1, '左右判定錯誤');
  }
});

console.log('B. 官方 id 空間：被佔用的三個 id 已停用並排定歸還');

T('⭐⭐⭐ B1 舊右半 id 必須①資料還在②登記為停用卡③指向對應的新右半④已離開配對表', () => {
  const retired = Object.entries(HIDDEN).filter(([, v]) => RIGHT_IDS.includes(v.replacementId));
  ok(retired.length === LEFT_IDS.length,
    '登記為停用的舊右半有 ' + retired.length + ' 筆，應為 ' + LEFT_IDS.length + ' 筆');
  for (const [oldId, info] of retired) {
    const card = BY_ID.get(oldId);
    ok(card, `停用卡 ${oldId} 的資料被刪了 —— 進行中的對局／舊報名快照會變成查不到的卡`);
    ok(card.subtype === 'Stadium', `${oldId} 不是競技場：${card.subtype}`);
    ok(BY_ID.get(info.replacementId)?.name === card.name,
      `${oldId} 的 replacementId ${info.replacementId} 不是同一張卡`);
    ok(M.isHiddenFromPlayers(oldId), `${oldId} 沒有被判成「玩家選不到」`);
    ok(M.twoCardStadiumPartnerCardId(oldId) === null,
      `⚠ 舊右半 ${oldId} 還留在配對表裡 —— 那三個 id 排定要讓給官方卡，兩套判準不可以並存`);
    ok(M.migrateCardId(oldId) === info.replacementId,
      `舊牌組裡的 ${oldId} 沒有被換成 ${info.replacementId}（玩家的傳說場地卡會壞掉）`);
  }
});

T('⭐⭐⭐ B2 官方快照宣告某 id 屬於某卡包 → 我方若也收了，setCode 必須對得起來', () => {
  // ⭐ 這條就是 v6.328 之前**完全沒有人在守**的維度：
  //   既有的 test-official-set-completeness 只問「id 在不在」，不問「是不是同一張卡」。
  //   在 v6.327 上跑會紅：快照說 19624 屬於 M-P，我方卻收在 M6。
  const bad = [], exempted = [];
  let checked = 0;
  for (const [code, v] of Object.entries(MANIFEST.sets ?? {})) {
    const allowed = new Set(v.localSetCodes ?? []);
    if (allowed.size === 0) continue;
    for (const id of v.ids ?? []) {
      const c = BY_ID.get(String(id));
      if (!c) continue;                       // 沒收錄 → 由 test-official-set-completeness 管
      checked++;
      if (setCodeMatchesOfficial(allowed, c.setCode)) continue;
      // 唯一豁免：**已登記為停用、且排定在 v6.329 把 id 讓出去**的那幾張。
      if (Object.prototype.hasOwnProperty.call(HIDDEN, String(id))) { exempted.push(String(id)); continue; }
      bad.push(`${id}「${c.name}」官方屬於 ${code}(${[...allowed].join('/')})，我方卻收在 ${c.setCode}`);
    }
  }
  ok(checked >= 4000, '只比對到 ' + checked + ' 個 id —— 掃描器多半壞了（下限斷言）');
  ok(bad.length === 0,
    '官方 id 被指到別的卡包共 ' + bad.length + ' 筆：\n      ' + bad.slice(0, 10).join('\n      '));
  // ⚠ 豁免不可以無限期存在：每一筆都必須是「排定歸還」的停用右半，而不是隨手加白名單。
  for (const id of exempted) {
    ok(RIGHT_IDS.includes(HIDDEN[id].replacementId),
      `${id} 借用了 B2 的豁免，但它不是「排定歸還的停用右半」 —— 不得用停用清單繞過本條`);
  }
});

T('⭐⭐ B2b 反安慰劑：B2 用的 setCodeMatchesOfficial 正反樣本都要判對（同一個函式）', () => {
  const allowed = new Set(['M-P-H', 'M-P-I', 'M-P-J']);
  ok(setCodeMatchesOfficial(allowed, 'M-P-J') === true, '判準把正確卡包判成不合法');
  ok(setCodeMatchesOfficial(allowed, 'M6') === false, '判準把錯誤卡包判成合法');
});

T('⭐ B3 M6 的張數與 index.json 對得起來（不寫死魔術數字）', () => {
  const m6 = JSON.parse(readFileSync(join(dir, 'M6.json'), 'utf8'));
  const decl = INDEX.find((e) => e.code === 'M6');
  ok(decl && decl.cardCount === m6.length && decl.count === m6.length,
    `index.json 宣告 M6 ${decl?.cardCount}/${decl?.count} 張，實際檔案 ${m6.length} 張`);
  const stadium = m6.filter((c) => c.subtype === 'Stadium'
    && (LEFT_IDS.includes(String(c.id)) || RIGHT_IDS.includes(String(c.id)) || M.isHiddenFromPlayers(String(c.id))));
  ok(stadium.length === LEFT_IDS.length * 3,
    `兩張合一競技場相關的筆數應為 左${LEFT_IDS.length}＋新右${LEFT_IDS.length}＋停用右${LEFT_IDS.length}，實得 ${stadium.length}`);
});

console.log('C. 行為端：舊牌組載入、送官網合併、冪等性');

T('⭐⭐⭐ C1 舊牌組（帶舊右半 id）載入後不得殘留舊 id，且張數守恆', () => {
  const oldRight = Object.keys(HIDDEN).filter((k) => RIGHT_IDS.includes(HIDDEN[k].replacementId));
  for (const oldId of oldRight) {
    const left = M.twoCardStadiumPartnerCardId(HIDDEN[oldId].replacementId);
    const deck = { id: 'd', name: 'x', entries: [{ cardId: left, count: 2 }, { cardId: oldId, count: 2 }] };
    const got = M.migrateDeck(deck).entries;
    ok(!got.some((e) => e.cardId === oldId), `載入後仍殘留舊 id ${oldId}：` + JSON.stringify(got));
    ok(got.reduce((s, e) => s + e.count, 0) === 4, '張數沒有守恆：' + JSON.stringify(got));
    const byId = Object.fromEntries(got.map((e) => [e.cardId, e.count]));
    ok(byId[left] === 2 && byId[HIDDEN[oldId].replacementId] === 2, '左右張數不對：' + JSON.stringify(got));
  }
});

T('⭐⭐ C2 拆卡之前的更舊牌組（只有左半 N 張）仍要攤成左右各半', () => {
  const left = LEFT_IDS[0], right = RIGHT_IDS[0];
  const got = M.migrateDeck({ id: 'd', name: 'y', entries: [{ cardId: left, count: 4 }] }).entries
    .map((e) => [e.cardId, e.count]);
  ok(JSON.stringify(got) === JSON.stringify([[left, 2], [right, 2]]), '攤開結果錯誤：' + JSON.stringify(got));
});

T('⭐⭐ C3 冪等：新格式的牌組連跑三次都不得變動（不會愈跑愈多張）', () => {
  let d = { id: 'd', name: 'z', entries: [{ cardId: LEFT_IDS[1], count: 2 }, { cardId: RIGHT_IDS[1], count: 2 }] };
  const want = JSON.stringify(d.entries);
  for (let i = 0; i < 3; i++) {
    d = M.migrateDeck(d);
    ok(JSON.stringify(d.entries) === want, `第 ${i + 1} 次載入就變了：` + JSON.stringify(d.entries));
  }
});

T('⭐⭐ C4 送去官網牌組工具前：新右半與**舊**右半都要併回官方那張左半的 id', () => {
  const left = LEFT_IDS[2], right = RIGHT_IDS[2];
  const a = M.mergeTwoCardStadiumEntries([{ cardId: left, count: 2 }, { cardId: right, count: 2 }])
    .map((e) => [e.cardId, e.count]);
  ok(JSON.stringify(a) === JSON.stringify([[left, 4]]), '新右半合併錯誤：' + JSON.stringify(a));
  const oldId = Object.keys(HIDDEN).find((k) => HIDDEN[k].replacementId === right);
  ok(oldId, '找不到對應的停用右半 id');
  const b = M.mergeTwoCardStadiumEntries([{ cardId: left, count: 1 }, { cardId: oldId, count: 1 }])
    .map((e) => [e.cardId, e.count]);
  ok(JSON.stringify(b) === JSON.stringify([[left, 2]]),
    '舊右半的 fail-safe 失效（沒跑過 migrate 的舊報名快照會送出官網不認得的 id）：' + JSON.stringify(b));
});

console.log('D. 交接給 v6.329 的硬約束');

T('⭐⭐⭐ D1 那三個官方 id 目前**還不是**官方那三張卡（v6.329 才會歸還，順序反了會吃掉新卡）', () => {
  // ⚠ 這條是「交接鎖」：只要有人在遷移表還在的情況下把官方卡加進來，這裡就會紅。
  //   v6.093→v6.328 的第一版設計就是栽在這裡：migrateCardId 會把玩家新放的
  //   超級米立龍ex(19625) 無條件換成傳說的山頂右半，那張卡等於完全不能用。
  for (const [oldId, info] of Object.entries(HIDDEN)) {
    if (!RIGHT_IDS.includes(info.replacementId)) continue;
    const c = BY_ID.get(oldId);
    ok(c && c.subtype === 'Stadium' && c.setCode === 'M6',
      `${oldId} 已經被換成別的卡（${c?.name} / ${c?.setCode}），但遷移表還在 ⇒ 那張新卡會被靜默吃掉。`
      + '\n      → v6.329 必須「刪停用卡 ＋ 移除本表項目 ＋ 加官方卡」**同版**完成');
    ok(M.migrateCardId(oldId) !== oldId, `${oldId} 的遷移已失效，舊牌組會壞掉`);
  }
});

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.328 兩張合一競技場 id 換號：${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
