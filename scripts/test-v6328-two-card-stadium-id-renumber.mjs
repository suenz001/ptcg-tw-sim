// ⭐⭐⭐ v6.328／v6.329 守衛：「傳說」競技場右半 id 換號 ＋ 官方 id 已歸還
//
// 事故經過（2026-09-07 查出）：
//   v6.093 把「傳說」競技場拆成左右兩張獨立卡片時，右半需要新的 cardId，
//   當時**自己捏了 19624 / 19625 / 19626**。
//   但那三個號碼**其實是台灣官方 M-P 209~211**（膽小蟲 J／超級米立龍ex J／麻麻小魚 I）——
//   repo 自己的 `scripts/data/official-set-manifest.json` 早就把它們列在 M-P 底下。
//   後果：那三張官方卡永遠補不進來，其中「超級米立龍ex」是標準賽可用、站內完全沒有的卡。
//
// ⚠⚠ 為什麼既有守衛全都沒抓到（安慰劑型態）：
//   `test-official-set-completeness` 的判準是 `if (OURS.has(String(id))) continue;`
//   —— **只問 id 在不在我方卡庫，不問那是不是同一張卡**。B2 補的就是這個缺口。
//
// 兩版分工（⚠ 遷移表與新語義**不可以同版共存**，v6.328 第一版設計就是栽在這裡）：
//   ・v6.328 只換號：右半改成「左半 id ＋ `-1`」（官方 id 一律純數字 ⇒ 結構上不可能再撞），
//     舊 id 的卡片資料留著並登記為停用卡 ⇒ 進行中的對局／舊報名快照零破壞。
//   ・v6.329 才歸還：刪停用卡 ＋ 移除停用登記 ＋ 加官方卡，**三件同版**。
//     本檔的 D 區從 v6.329 起改成「歸還完成鎖」——反向確保不會有人把 id 又拿回去自用。
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

const dir = join(ROOT, 'static/cards');
const INDEX = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const liveCodes = new Set(INDEX.map((e) => e.code));
const BY_ID = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveCodes.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) BY_ID.set(String(c.id), c);
}
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'scripts/data/official-set-manifest.json'), 'utf8'));

// ── 判準函式（正式斷言與反安慰劑自檢**共用同一份**，不得各抄一份）───────────────
/** 本站自造的 cardId 必須有非數字字元；官方 id 一律純數字。 */
const isSiteMintedId = (id) => !/^\d+$/.test(String(id));
/** 官方快照說這個 id 屬於 `allowed` 這幾個本地卡包，我方收的 setCode 對不對得起來。 */
const setCodeMatchesOfficial = (allowed, setCode) => allowed.has(setCode);

// ── 從**產品端**取表（不在測試檔自己抄清單；抄清單只守得住「今天這三張」）─────────
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
/** 那三個曾被本站佔用、v6.329 已歸還的官方 id（判準：官方快照有、而且是我方右半 id 去掉 `-1` 之外的號碼） */
const RECLAIMED = { '19624': '膽小蟲', '19625': '超級米立龍ex', '19626': '麻麻小魚' };

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

console.log('B. 官方 id 空間');

T('⭐⭐⭐ B1 被佔用過的三個官方 id 必須已完全退出本站的競技場邏輯', () => {
  for (const [id, name] of Object.entries(RECLAIMED)) {
    const c = BY_ID.get(id);
    ok(c, `官方 id ${id}（${name}）不在卡庫`);
    ok(c.name === name, `${id} 應該是「${name}」，實得「${c.name}」`);
    ok(c.subtype !== 'Stadium', `${id} 竟然又變回競技場了 —— 這個 id 屬於官方的「${name}」`);
    ok(!M.isHiddenFromPlayers(id), `${id} 仍被登記為停用卡 —— 歸還之後玩家必須選得到`);
    ok(M.twoCardStadiumPartnerCardId(id) === null,
      `⚠ 官方卡 ${id}（${name}）竟被當成競技場的另一半 —— 兩套判準不可以並存`);
    ok(M.migrateCardId(id) === id,
      `⚠⚠ ${id} 仍然會被 migrateCardId 換成別的 id ⇒ 玩家把這張官方卡放進牌組會被靜默吃掉。`
      + '\n      → 「遷移表」與「新語義」不可以同版共存（v6.328 第一版設計就是栽在這裡）');
  }
});

T('⭐⭐⭐ B2 官方快照宣告某 id 屬於某卡包 → 我方若也收了，setCode 必須對得起來', () => {
  // ⭐ 這條就是 v6.328 之前**完全沒有人在守**的維度：
  //   既有的 test-official-set-completeness 只問「id 在不在」，不問「是不是同一張卡」。
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
      // 唯一豁免：**已登記為停用、且排定把 id 讓出去**的過渡期卡（v6.329 之後應為 0 筆）
      if (Object.prototype.hasOwnProperty.call(HIDDEN, String(id))) { exempted.push(String(id)); continue; }
      bad.push(`${id}「${c.name}」官方屬於 ${code}(${[...allowed].join('/')})，我方卻收在 ${c.setCode}`);
    }
  }
  ok(checked >= 4000, '只比對到 ' + checked + ' 個 id —— 掃描器多半壞了（下限斷言）');
  ok(bad.length === 0,
    '官方 id 被指到別的卡包共 ' + bad.length + ' 筆：\n      ' + bad.slice(0, 10).join('\n      '));
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

T('⭐ B3 M6 的張數與 index.json 對得起來（不寫死魔術數字），且不再有停用的右半', () => {
  const m6 = JSON.parse(readFileSync(join(dir, 'M6.json'), 'utf8'));
  const decl = INDEX.find((e) => e.code === 'M6');
  ok(decl && decl.cardCount === m6.length && decl.count === m6.length,
    `index.json 宣告 M6 ${decl?.cardCount}/${decl?.count} 張，實際檔案 ${m6.length} 張`);
  const stadiumRelated = m6.filter((c) => LEFT_IDS.includes(String(c.id)) || RIGHT_IDS.includes(String(c.id)));
  ok(stadiumRelated.length === LEFT_IDS.length * 2,
    `兩張合一競技場應為 左${LEFT_IDS.length}＋右${LEFT_IDS.length} 筆，實得 ${stadiumRelated.length}`);
  const stillHidden = m6.filter((c) => M.isHiddenFromPlayers(String(c.id)));
  ok(stillHidden.length === 0, 'M6 仍有停用卡（v6.329 應該已刪除）：' + stillHidden.map((c) => c.id).join(', '));
});

console.log('C. 行為端：牌組載入、送官網合併、冪等性');

T('⭐⭐ C1 拆卡之前的舊牌組（只有左半 N 張）仍要攤成左右各半', () => {
  const left = LEFT_IDS[0], right = RIGHT_IDS[0];
  const got = M.migrateDeck({ id: 'd', name: 'y', entries: [{ cardId: left, count: 4 }] }).entries
    .map((e) => [e.cardId, e.count]);
  ok(JSON.stringify(got) === JSON.stringify([[left, 2], [right, 2]]), '攤開結果錯誤：' + JSON.stringify(got));
});

T('⭐⭐ C2 冪等：新格式的牌組連跑三次都不得變動（不會愈跑愈多張）', () => {
  let d = { id: 'd', name: 'z', entries: [{ cardId: LEFT_IDS[1], count: 2 }, { cardId: RIGHT_IDS[1], count: 2 }] };
  const want = JSON.stringify(d.entries);
  for (let i = 0; i < 3; i++) {
    d = M.migrateDeck(d);
    ok(JSON.stringify(d.entries) === want, `第 ${i + 1} 次載入就變了：` + JSON.stringify(d.entries));
  }
});

T('⭐⭐ C3 送去官網牌組工具前：右半要併回官方那張左半的 id（右半 id 官網不認得）', () => {
  const left = LEFT_IDS[2], right = RIGHT_IDS[2];
  const a = M.mergeTwoCardStadiumEntries([{ cardId: left, count: 2 }, { cardId: right, count: 2 }])
    .map((e) => [e.cardId, e.count]);
  ok(JSON.stringify(a) === JSON.stringify([[left, 4]]), '右半合併錯誤：' + JSON.stringify(a));
});

T('⭐⭐⭐ C4 歸還之後：那三個官方 id **不可以**再被合併回競技場左半', () => {
  // ⚠ v6.328 的過渡期 fail-safe 會把舊右半併回左半；v6.329 移除停用登記之後它必須自動失效，
  //   否則玩家牌組裡的「膽小蟲」送去官網時會被換成「傳說的海溝」。
  for (const [id, name] of Object.entries(RECLAIMED)) {
    const out = M.mergeTwoCardStadiumEntries([{ cardId: id, count: 2 }]).map((e) => [e.cardId, e.count]);
    ok(JSON.stringify(out) === JSON.stringify([[id, 2]]),
      `${id}（${name}）被併成別的卡了：` + JSON.stringify(out));
  }
});

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.328/v6.329 兩張合一競技場 id 換號與歸還：${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
