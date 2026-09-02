#!/usr/bin/env node
// ⭐⭐⭐ v6.291 守衛：錦標賽「報名／報到」三支端點只認 verified:true 的身分（冒名報名封堵）
//
// 【漏洞】server_admin_patch.js 的 `tournIdentity` 在沒有 Bearer token 時會退回
//   `req.body.playerId`／`req.query.playerId` 並回 `verified:false`（那條 fallback 是給測試房的
//   /join、/still-here、/action、/reset 用的）。而 `/register`、`/register-and-checkin`、
//   `/checkin` **從來沒有檢查 verified**，玩家 uid 又由 `/bracket` 公開回傳
//   ⇒ 抄一個 uid ＋ `playerId=<受害者 uid>` 就能替別人報名、把牌組鎖成攻擊者的，
//     受害者本人再報名撞 409「你已經報名了（牌組已鎖定，整賽不可更換）」⇒ 報不了名。
//
// 【⚠⚠⚠ 比漏洞更高的裁定】站長 v6.160：「可用性優先於版本一致性，寧可放一個舊 client 進來，
//   也不要把人擋在賽外」⇒ 這道閘**擋到真玩家比漏洞本身更慘**。
//   ⇒ 本檔最重要的一條不是 C1（擋得住冒名），而是 **C2（真玩家三支都照常成功）** 與
//     **E（client 從來不對這三支送 playerId ⇒ gate 在正常路徑是 no-op）**。
//
// 【分組】
//   A 結構（helper 位置／三支各恰一行／在任何 DB 操作之前／未列管端點沒被順手加 gate）
//   B ⭐⭐⭐ revert-diff（逐字還原 3 行 ⇒ 兩個區塊 sha256 與 BASE 逐位元相同）＋ 14 把鎖全部重釘
//   C ⭐⭐ 行為端實跑（出貨碼本尊：真 tournIdentity ＋ 真 helper ＋ 真三支 handler 接假 mongo）
//   D 突變（8 個，各自必須紅在預期那條）
//   E client 端證據（三處呼叫的 body 字面量無 playerId；tApi 不注入）
//   F test chain ＋ 三配套 ＋ HEAD-FAIL（對真 BASE blob：BASE 的三支端點對冒名請求**不拒絕**）
//
// ⚠ 反安慰劑：只捕捉 assert.AssertionError（其餘往外炸）；行為斷言一律抽出貨碼本尊實跑；
//   每個突變都必須紅在**預期那一條**；revert 快照集中在 scripts/lib/tourn-revert-v6291.mjs。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import {
  TAIL_ANCHOR, TEV_ANCHOR,
  OLD_TAIL_SHA_V6290, OLD_TEV_SHA_V6290, OLD_TEV_LEN_V6290,
  NEW_TAIL_SHA_V6291, NEW_TEV_SHA_V6291, NEW_TEV_LEN_V6291,
  V6291_ENDPOINTS, V6291_GATE_LINES, V6291_HELPER_HEAD, V6291_BLOCK_BEGIN, V6291_BLOCK_END,
  revertV6291,
} from './lib/tourn-revert-v6291.mjs';
// ⭐⭐v6.292：同一道閘補到六支端點
//   ⇒ 區塊又多了 6 行。本檔的 revert-diff 從此是「先還原 v6.292 的 6 行、再還原 v6.291 的 3 行」，
//   鏈起來仍然是逐位元回到 v6.290。⚠ 站長明文禁止把鎖拿掉／改成不驗 ⇒ 一律串接，不放水。
import {
  NEW_TAIL_SHA_V6292, NEW_TEV_SHA_V6292, NEW_TEV_LEN_V6292,
  V6292_ENDPOINTS, revertV6292,
} from './lib/tourn-revert-v6292.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'bb3adda65b536a7e0be67b788bd1fd5934051bc7';   // v6.290
const PATCH_REL = 'oracle-admin/server_admin_patch.js';
const PATCH = readFileSync(join(ROOT, PATCH_REL), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const VERTS = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const T = async (n, fn) => {
  try { await fn(); console.log('  PASS ' + n); pass++; }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;   // ⚠ 非斷言例外一律往外炸，不吞
    fail++; console.log('  FAIL ' + n + '\n        ' + String(e.message).split('\n')[0].slice(0, 400));
  }
};
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ══ 抽取器（Rule 25：掃描器自己要先驗，見 A0）════════════════════════════════
function fnSrc(src, name) {
  for (const head of ['    async function ' + name + '(', '    function ' + name + '(']) {
    const i = src.indexOf(head);
    if (i < 0) continue;
    const j = src.indexOf('\n    }\n', i);
    assert.ok(j > i, '抓不到 ' + name + ' 的結尾');
    return src.slice(i, j + 6);
  }
  return null;
}
function epSrc(src, route) {
  const head = "app.post('" + route + "', async (req, res) => {";
  const i = src.indexOf(head);
  assert.ok(i >= 0, '找不到端點 ' + route);
  const j = src.indexOf('\n    });\n', i);
  assert.ok(j > i, '抓不到端點 ' + route + ' 的結尾');
  return src.slice(i, j + 8);
}
const ROUTE = (ep) => '/api/tournament/' + ep;
const ID_ERR_LINE = "        if (id.error) return res.status(id.code || 401).json({ error: id.error });\n";

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【A】結構 ═══════════════════════════════════════════════════════════');

await T('A0 抽取器自驗：三支端點都抽得到、長度合理、且抽到的是**完整** handler（有 tournIdentity 也有 catch 收尾）', () => {
  for (const ep of V6291_ENDPOINTS) {
    const s = epSrc(PATCH, ROUTE(ep));
    assert.ok(s.length > 600, ep + ' 只抽到 ' + s.length + ' 字元 ⇒ 抽取器壞了，下面的斷言會變恆真');
    assert.ok(s.includes('await tournIdentity(req)'), ep + ' 抽到的片段沒有 tournIdentity');
    assert.ok(s.includes('catch (e) { res.status(500)'), ep + ' 抽到的片段沒有收尾 catch ⇒ 抽早了');
  }
  assert.ok(fnSrc(PATCH, 'tournIdentity').length > 500, 'tournIdentity 抽太短');
});

await T('A1 helper tournRequireVerified 存在，且**在兩個區塊錨點之前**（所以它不進區塊 sha）', () => {
  const h = fnSrc(PATCH, 'tournRequireVerified');
  assert.ok(h, 'HEAD-FAIL：找不到 tournRequireVerified');
  assert.strictEqual(PATCH.split(V6291_HELPER_HEAD).length - 1, 1, 'helper 定義出現不只一次');
  assert.ok(PATCH.includes(V6291_BLOCK_BEGIN) && PATCH.includes(V6291_BLOCK_END), '缺 BEGIN/END 區塊標記');
  const at = PATCH.indexOf(V6291_HELPER_HEAD);
  assert.ok(at < PATCH.indexOf(TAIL_ANCHOR), 'helper 落進了 tail 區塊（會讓 8 把鎖多出一段差異）');
  assert.ok(at < PATCH.indexOf(TEV_ANCHOR), 'helper 落進了 TEVENTS 區塊');
  // 與 tournIdentity 同一個 closure（handler 直接呼叫得到）：中間不得有任何 0~3 空白縮排的收尾
  const between = PATCH.slice(PATCH.indexOf('async function tournIdentity('), PATCH.indexOf(ROUTE('register')));
  assert.ok(!/\n {0,3}\}\)?\(\);?\n/.test(between), 'helper 與端點之間出現 IIFE 邊界 ⇒ 跨 closure 取不到');
});

await T('A2 helper 的判準：verified === true 才放行、403 + code:tourn-needs-verified、文案可行動、log 只記 uid 前 8 碼', () => {
  const h = fnSrc(PATCH, 'tournRequireVerified');
  assert.ok(/if \(id && id\.verified === true\) return false;/.test(h), 'HEAD-FAIL：放行條件不是 id.verified === true');
  assert.ok(/res\.status\(403\)/.test(h), 'HEAD-FAIL：沒有回 403');
  assert.ok(/code: 'tourn-needs-verified'/.test(h), 'HEAD-FAIL：回應沒有明確 code');
  assert.ok(/請先用 email 帳號登入/.test(h) && /重新整理頁面/.test(h), '文案沒有告訴玩家怎麼自救（不可靜默 403）');
  assert.ok(/console\.warn\(/.test(h), 'HEAD-FAIL：被擋下來沒有留 log，站長無法分辨誤擋');
  assert.ok(/\.slice\(0, 8\)/.test(h), 'uid 沒有截短');
  assert.ok(!/id\.email/.test(h), '⚠ log/回應碰了 email（隱私紀律）');
});

await T('A3 三支端點各恰一行 gate、緊接在 `if (id.error) …` 之後、且在**任何** DB 操作之前', () => {
  for (const ep of V6291_ENDPOINTS) {
    const s = epSrc(PATCH, ROUTE(ep));
    const line = V6291_GATE_LINES[ep];
    assert.strictEqual(s.split(line).length - 1, 1, 'HEAD-FAIL：' + ep + ' 的 gate 行不是恰好 1 行');
    assert.ok(s.includes(ID_ERR_LINE + line), ep + '：gate 行沒有緊接在 id.error 那一行之後');
    const gateAt = s.indexOf(line);
    const dbAt = s.search(/\b(TREGS|TMATCH|TEVENTS|TCHAT|TROOMS)\.(findOne|find|insertOne|updateOne|deleteOne|countDocuments|updateMany|deleteMany)\(/);
    assert.ok(dbAt < 0 || dbAt > gateAt, ep + '：gate 之前就碰了資料庫（檢查放在寫入之後＝沒用）');
    assert.ok(s.indexOf('await tournIdentity(req)') < gateAt, ep + '：gate 排在 tournIdentity 之前');
  }
  // ⭐v6.292：改成由兩版的宣告清單推導（1 個定義 ＋ v6.291 三支 ＋ v6.292 六支）——
  //   寫死數字會在下一版靜默失效，推導式則會逼下一版回來把新端點列進宣告。
  const _expectCalls = 1 + V6291_ENDPOINTS.length + V6292_ENDPOINTS.length;
  assert.strictEqual(PATCH.split('tournRequireVerified(id, res, ').length - 1, _expectCalls,
    'tournRequireVerified 的出現次數應為 ' + _expectCalls + '（1 定義 ＋ 兩版宣告的呼叫）—— 有未宣告的插入？');
});

await T('A4 ⚠ 兩版宣告之外的端點一個都沒被順手加 gate（playerId 相容路徑一個字不動）', () => {
  // ⚠ v6.292 把 /drop /unregister /cancel-proposal /chat /match/enter /match/forfeit 收進宣告 ⇒ 它們從這張清單移出，
  //   但**不是**放行：下面那一圈反過來斷言它們真的有 gate（少一支就紅）。
  for (const r of ['/api/tournament/join', '/api/tournament/still-here', '/api/tournament/action',
    '/api/tournament/reset', '/api/tournament/clientdiag', '/api/tournament/propose']) {
    assert.ok(!epSrc(PATCH, r).includes('tournRequireVerified'), r + ' 被加了 gate（不在兩版的宣告範圍）');
  }
  for (const ep of V6292_ENDPOINTS) {
    assert.ok(epSrc(PATCH, ROUTE(ep)).includes('tournRequireVerified(id, res, '),
      'HEAD-FAIL(v6.292)：' + ep + ' 的 gate 不見了');
  }
  // 測試房既有的「正式賽房才要求 verified」條件必須原封不動（v6.150／v6.156／v6.158）
  assert.ok(/if \(doc\.matchId && !_id\.verified\) return res\.status\(403\)/.test(epSrc(PATCH, '/api/tournament/join')), '/join 的既有 verified 條件不見了');
  assert.ok(/if \(doc\.matchId && !id\.verified\) return res\.status\(403\)/.test(epSrc(PATCH, '/api/tournament/still-here')), '/still-here 的既有 verified 條件不見了');
  assert.ok(/if \(!id\.email\) return res\.status\(403\)/.test(epSrc(PATCH, '/api/tournament/propose')), '/propose 的 !id.email 既有防線不見了');
});

await T('A5 ⚠⚠ 本版零刪除：TREGS/TEVENTS 的刪除與改寫路徑數量與 BASE 相同（只加判斷、不動資料）', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('v6291 A5 與 BASE 比刪除路徑數', 'B 的 revert-diff 已逐位元涵蓋'); return; }
  const b = readBaseBlob(ROOT, BASE_SHA, PATCH_REL);
  assert.ok(b.ok, '讀不到 BASE blob');
  for (const pat2 of ['TREGS.deleteOne(', 'TREGS.deleteMany(', 'TREGS.updateOne(', 'TREGS.insertOne(',
    'TEVENTS.deleteOne(', 'TEVENTS.updateOne(', 'TEVENTS.insertOne(']) {
    assert.strictEqual(PATCH.split(pat2).length, b.out.split(pat2).length, pat2 + ' 的出現次數與 BASE 不同');
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【B】⭐⭐⭐ revert-diff：區塊 ＝ BASE ＋ 恰好這 3 行 ═════════════════');

await T('B1 現行兩個區塊的指紋 ＝ v6.292 重釘的新值；只還原 v6.292 的 6 行 ⇒ 逐位元回到 v6.291 的值', () => {
  const tail = PATCH.slice(PATCH.indexOf(TAIL_ANCHOR));
  const tev = PATCH.slice(PATCH.indexOf(TEV_ANCHOR));
  assert.ok(tail.length > 200000 && tev.length > 200000, '區塊抽太短 ⇒ 比對會變恆真式');
  assert.strictEqual(sha256(tail), NEW_TAIL_SHA_V6292, 'tail sha=' + sha256(tail));
  assert.strictEqual(sha256(tev), NEW_TEV_SHA_V6292, 'tev sha=' + sha256(tev));
  assert.strictEqual(tev.length, NEW_TEV_LEN_V6292, 'tev 長度=' + tev.length);
  // ⭐ 中繼站：本檔原本守的那一版指紋沒有被丟掉，只是往後退了一層。
  assert.strictEqual(sha256(revertV6292(tail)), NEW_TAIL_SHA_V6291, '還原 v6.292 後 tail ≠ v6.291');
  assert.strictEqual(sha256(revertV6292(tev)), NEW_TEV_SHA_V6291, '還原 v6.292 後 tev ≠ v6.291');
  assert.strictEqual(revertV6292(tev).length, NEW_TEV_LEN_V6291, '還原 v6.292 後 tev 長度 ≠ v6.291');
});

await T('B2 ⭐⭐⭐ 逐字還原 v6.292 的 6 行 ＋ v6.291 的 3 行後，兩個區塊 sha256 與 BASE(v6.290) **逐位元相同**', () => {
  const tail = revertV6291(revertV6292(PATCH.slice(PATCH.indexOf(TAIL_ANCHOR))));
  const tev = revertV6291(revertV6292(PATCH.slice(PATCH.indexOf(TEV_ANCHOR))));
  console.log('        revert-diff → tail sha256 = ' + sha256(tail) + '（BASE ' + OLD_TAIL_SHA_V6290 + '）');
  console.log('        revert-diff → tev  sha256 = ' + sha256(tev) + '  len=' + tev.length + '（BASE ' + OLD_TEV_SHA_V6290 + ' / ' + OLD_TEV_LEN_V6290 + '）');
  assert.strictEqual(sha256(tail), OLD_TAIL_SHA_V6290, '還原後 tail 與 BASE 不同 ⇒ 區塊有「宣告之外」的改動');
  assert.strictEqual(sha256(tev), OLD_TEV_SHA_V6290, '還原後 tev 與 BASE 不同');
  assert.strictEqual(tev.length, OLD_TEV_LEN_V6290, '還原後 tev 長度不符');
});

await T('B3 掃描器自驗：revert-diff 不是恆真（區塊裡改一個字元 ⇒ B2 必翻紅）', () => {
  const mutated = PATCH.slice(PATCH.indexOf(TAIL_ANCHOR)).replace('tournamentEvents', 'tournamentEventsX');
  assert.notStrictEqual(sha256(revertV6291(revertV6292(mutated))), OLD_TAIL_SHA_V6290, 'revert-diff 抓不到差異 ⇒ B2 是安慰劑');
});

const TAIL_LOCKS = [
  'scripts/test-v6265-phantom-start-race.mjs', 'scripts/test-v6272-firestore-read-reduction.mjs',
  'scripts/test-v6275-usersall-scan-guard.mjs', 'scripts/test-v6276-deck-tournament-stats.mjs',
  'scripts/test-v6286-friends-hardening.mjs', 'scripts/test-v6287-friends-dm.mjs',
  'scripts/test-v6288-friends-dm-ui.mjs', 'scripts/test-v6289-unblock-purge.mjs',
];
const TEV_LOCKS = [
  'scripts/test-v6266-deck-stats-server.mjs', 'scripts/test-v6268-delta-put-server.mjs',
  'scripts/test-v6276-deck-tournament-stats.mjs', 'scripts/test-v6278-delta-put-deep-path.mjs',
  'scripts/test-v6282-friends-p0.mjs', 'scripts/test-v6283-friends-p1a.mjs',
  'scripts/test-v6284-friends-p1b.mjs', 'scripts/test-v6286-friends-hardening.mjs',
  'scripts/test-v6287-friends-dm.mjs', 'scripts/test-v6288-friends-dm-ui.mjs',
  'scripts/test-v6289-unblock-purge.mjs',
];

await T('B4 ⭐⭐ 全站 14 把區塊鎖都重釘到新值，且**沒有一把被拿掉**（舊值零殘留）', () => {
  for (const f of TAIL_LOCKS) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(s.includes(NEW_TAIL_SHA_V6292), f + ' 沒重釘 tail sha（它現在守的是錯的值）');
    assert.ok(!s.includes(OLD_TAIL_SHA_V6290), f + ' 還留著 v6.290 的舊 tail sha');
    assert.ok(!s.includes(NEW_TAIL_SHA_V6291), f + ' 還留著 v6.291 的舊 tail sha');
  }
  for (const f of TEV_LOCKS) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(s.includes(NEW_TEV_SHA_V6292), f + ' 沒重釘 TEVENTS sha');
    assert.ok(!s.includes(OLD_TEV_SHA_V6290), f + ' 還留著 v6.290 的舊 TEVENTS sha');
    assert.ok(!s.includes(NEW_TEV_SHA_V6291), f + ' 還留著 v6.291 的舊 TEVENTS sha');
  }
  // 長度常數（3 支有）：v6.290 的 219484 與 v6.291 的 219837 都不得殘留
  for (const f of ['scripts/test-v6266-deck-stats-server.mjs', 'scripts/test-v6268-delta-put-server.mjs', 'scripts/test-v6278-delta-put-deep-path.mjs']) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(s.includes(String(NEW_TEV_LEN_V6292)), f + ' 的長度常數沒重釘');
    assert.ok(!s.includes(String(OLD_TEV_LEN_V6290)), f + ' 還留著 v6.290 的舊長度常數');
    assert.ok(!s.includes(String(NEW_TEV_LEN_V6291)), f + ' 還留著 v6.291 的舊長度常數');
  }
});

await T('B5 ⚠⚠ 那 14 把鎖仍然「在守」：sha 比對式與 notStrictEqual 自驗都還在（沒被改成不驗／只比片段）', () => {
  const n = TAIL_LOCKS.length + TEV_LOCKS.length;
  assert.ok(n >= 19, '鎖清單掃描器壞了？只列到 ' + n + ' 條');
  const files = [...new Set([...TAIL_LOCKS, ...TEV_LOCKS])];
  assert.strictEqual(files.length, 14, '應涵蓋 14 支守衛，實際 ' + files.length);
  for (const f of files) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(/assert\.(strictEqual|equal)\(/.test(s) && /sha256/.test(s), f + ' 已經沒有 sha256 比對式了');
    assert.ok(/createHash\('sha256'\)/.test(s), f + ' 不再自己算 sha ⇒ 可能被改成只比字串片段');
  }
  // v6.276 的 revert-diff 必須改成「先還原 v6.291 再還原 v6.276」，而不是被停用
  const v76 = readFileSync(join(ROOT, 'scripts/test-v6276-deck-tournament-stats.mjs'), 'utf8');
  assert.ok(v76.includes("from './lib/tourn-revert-v6291.mjs'"), 'test-v6276 沒有串接 v6.291 的還原器（它的 revert-diff 會被停用）');
  assert.ok(v76.includes('revertV6291('), 'test-v6276 沒有實際呼叫 revertV6291');
  // ⭐v6.292：鏈又長一節 —— v6.276 必須先還原 v6.292 的 6 行，否則它的 B1/B2 只能靠改基準值來「湊綠」。
  assert.ok(v76.includes("from './lib/tourn-revert-v6292.mjs'"), 'test-v6276 沒有串接 v6.292 的還原器');
  assert.ok(v76.includes('revertV6292('), 'test-v6276 沒有實際呼叫 revertV6292');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【C】⭐⭐ 行為端實跑（出貨碼本尊 ＋ 假 mongo）══════════════════════');

/** 用**出貨碼本尊**組出可執行的三支端點。gateSrc 為 null 時 ＝ BASE（沒有 helper）。 */
function buildRoutes(src) {
  const idFn = fnSrc(src, 'tournIdentity');
  assert.ok(idFn, '抽不到 tournIdentity');
  const gateFn = fnSrc(src, 'tournRequireVerified') || '';
  const eps = V6291_ENDPOINTS.map((ep) => epSrc(src, ROUTE(ep))).join('\n');
  const body = ''
    + '"use strict";\n'
    + 'const { TADMIN, TEVENTS, TREGS, evDoc, warns, app } = env;\n'
    + 'const console = { warn: (...a) => warns.push(a.map(String).join(" ")), log() {}, error() {} };\n'
    + 'const TMINVER_RE = /^\\d+\\.\\d+$/;\n'
    + 'async function resolveEventFromReq(req) { return evDoc(); }\n'
    + 'function deckCount(entries) { if (!Array.isArray(entries)) return -1; let n = 0; for (const e of entries) n += (e && e.count) || 0; return n; }\n'
    + 'function runInSeedChain(fn) { return fn(); }\n'
    + idFn + '\n' + gateFn + '\n' + eps + '\n';
  const routes = Object.create(null);
  const env = {
    TADMIN: null, TEVENTS: null, TREGS: null, evDoc: null, warns: null,
    app: { post: (p, h) => { routes[p] = h; }, locals: {} },
  };
  return { routes, env, factory: new Function('env', body) };
}

function mkColl(state) {
  return {
    writes: 0, reads: 0, inserted: [],
    async findOne(q) { this.reads++; return state.findOne ? state.findOne(q) : null; },
    async insertOne(d) { this.writes++; this.inserted.push(d); return { insertedId: d._id }; },
    async updateOne() { this.writes++; return { modifiedCount: 1, matchedCount: 1 }; },
    async deleteOne() { this.writes++; return { deletedCount: 1 }; },
    async countDocuments() { this.reads++; return state.count || 0; },
  };
}
function mkRes() {
  const r = { statusCode: 200, body: null, ended: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; r.ended = true; return r; };
  return r;
}
const DECK60 = [{ cardId: 'sv1-1', count: 60 }];
const VICTIM = 'victim-uid-0123456789';
const REAL_UID = 'realplayer-uid-abcdef';
function mkTadmin() {
  return {
    apps: [1],
    auth: () => ({
      async verifyIdToken(tok) {
        if (tok === 'GOOD') return { uid: REAL_UID, email: 'real@example.com', name: '真玩家', firebase: { sign_in_provider: 'password' } };
        if (tok === 'ANON') return { uid: 'anon-1', firebase: { sign_in_provider: 'anonymous' } };
        throw new Error('bad token');
      },
    }),
  };
}
/** 跑一支端點；回傳 { res, warns, regs }。 */
async function run(src, ep, { auth, body }, opts = {}) {
  const { routes, env, factory } = buildRoutes(src);
  const warns = [];
  const evStatus = (ep === 'register') ? 'registration' : 'checkin';
  const ev = { _id: 'evt_test', status: evStatus, maxPlayers: null };
  const regs = mkColl({ findOne: () => (opts.existingReg === undefined ? null : opts.existingReg), count: 0 });
  const events = mkColl({ findOne: () => ({ _id: ev._id, status: evStatus }) });
  Object.assign(env, { TADMIN: mkTadmin(), TEVENTS: events, TREGS: regs, evDoc: () => ev, warns });
  factory(env);
  const route = ROUTE(ep);
  assert.ok(routes[route], '端點沒註冊：' + route);
  const req = { headers: auth ? { authorization: auth } : {}, body: body || {}, query: {} };
  const res = mkRes();
  await routes[route](req, res);
  return { res, warns, regs, events };
}
const ATTACK_BODY = { playerId: VICTIM, eventId: 'evt_test', name: '壞人', deckName: '偷來的', deckEntries: DECK60, coinPref: 'first', ver: '6.291' };
const REAL_BODY = { eventId: 'evt_test', name: '真玩家', deckName: '我的牌組', deckEntries: DECK60, coinPref: 'random', ver: '6.291' };

await T('C1 ⭐⭐⭐ 帶 playerId 但**無 Bearer** ⇒ 三支各自 403 + code:tourn-needs-verified，且 TREGS **一個位元都沒寫**', async () => {
  for (const ep of V6291_ENDPOINTS) {
    const { res, regs } = await run(PATCH, ep, { auth: null, body: ATTACK_BODY },
      ep === 'checkin' ? { existingReg: { _id: 'evt_test__' + VICTIM, name: '受害者' } } : {});
    assert.strictEqual(res.statusCode, 403, ep + ' 的狀態碼是 ' + res.statusCode + '（應 403）');
    assert.strictEqual(res.body && res.body.code, 'tourn-needs-verified', ep + ' 沒有回明確 code');
    assert.ok(/請先用 email 帳號登入/.test(String(res.body && res.body.error)), ep + ' 的錯誤訊息不可行動');
    assert.strictEqual(regs.writes, 0, '⚠⚠ ' + ep + ' 竟然寫了 TREGS ' + regs.writes + ' 次（冒名成功）');
    assert.strictEqual(regs.reads, 0, ep + ' 在 gate 之前就讀了 TREGS');
  }
});

await T('C2 ⭐⭐⭐【最重要】帶合法 Bearer（verified:true）⇒ 三支**全部照常成功**（證明沒擋到真玩家）', async () => {
  const r1 = await run(PATCH, 'register', { auth: 'Bearer GOOD', body: REAL_BODY });
  assert.deepStrictEqual(r1.res.body, { ok: true }, '/register 沒成功：' + JSON.stringify(r1.res.body));
  assert.strictEqual(r1.regs.writes, 1, '/register 沒有寫進 TREGS');
  assert.strictEqual(r1.regs.inserted[0].uid, REAL_UID, '/register 寫進去的 uid 不是驗證後的 uid');

  const r2 = await run(PATCH, 'register-and-checkin', { auth: 'Bearer GOOD', body: REAL_BODY });
  assert.deepStrictEqual(r2.res.body, { ok: true, lateJoin: true }, '/register-and-checkin 沒成功：' + JSON.stringify(r2.res.body));
  assert.strictEqual(r2.regs.writes, 1, '/register-and-checkin 沒有寫進 TREGS');

  const r3 = await run(PATCH, 'checkin', { auth: 'Bearer GOOD', body: REAL_BODY },
    { existingReg: { _id: 'evt_test__' + REAL_UID, name: '真玩家' } });
  assert.deepStrictEqual(r3.res.body, { ok: true }, '/checkin 沒成功：' + JSON.stringify(r3.res.body));
  assert.strictEqual(r3.regs.writes, 1, '/checkin 沒有把 checkedIn 寫進去');
});

await T('C3 沒 Bearer 也沒 playerId（＝取不到 token 的真玩家）⇒ 維持 BASE 既有的 401「需要登入」，不是新的 403', async () => {
  for (const ep of V6291_ENDPOINTS) {
    const { res } = await run(PATCH, ep, { auth: null, body: REAL_BODY });
    assert.strictEqual(res.statusCode, 401, ep + ' 回了 ' + res.statusCode + '（BASE 行為是 401）');
    assert.strictEqual(res.body.error, '需要登入', ep + ' 的訊息變了：' + JSON.stringify(res.body));
  }
});

await T('C4 匿名 token ⇒ 維持既有 403「錦標賽不開放匿名帳號」；過期／壞 token ⇒ 維持 401（本版沒有改變這兩條）', async () => {
  const a = await run(PATCH, 'register', { auth: 'Bearer ANON', body: REAL_BODY });
  assert.strictEqual(a.res.statusCode, 403);
  assert.ok(/不開放匿名/.test(a.res.body.error), '匿名的訊息被改了：' + JSON.stringify(a.res.body));
  const b = await run(PATCH, 'register', { auth: 'Bearer EXPIRED', body: REAL_BODY });
  assert.strictEqual(b.res.statusCode, 401);
  assert.ok(/憑證無效或過期/.test(b.res.body.error), '過期的訊息被改了：' + JSON.stringify(b.res.body));
});

await T('C5 log：被擋時 console.warn 帶端點與 uid 前 8 碼，且**不含完整 uid、不含 email**', async () => {
  const { warns } = await run(PATCH, 'register', { auth: null, body: ATTACK_BODY });
  assert.strictEqual(warns.length, 1, 'warn 應恰 1 則，實際 ' + warns.length);
  const w = warns[0];
  assert.ok(w.includes('verified-gate'), 'log 沒有可 grep 的關鍵字：' + w);
  assert.ok(w.includes('ep=register'), 'log 沒有端點名：' + w);
  assert.ok(w.includes('uid8=' + VICTIM.slice(0, 8)), 'log 沒有 uid 前 8 碼：' + w);
  assert.ok(!w.includes(VICTIM), '⚠ log 記了完整 uid');
  assert.ok(!w.includes('@'), '⚠ log 記了 email');
  const ok = await run(PATCH, 'register', { auth: 'Bearer GOOD', body: REAL_BODY });
  assert.strictEqual(ok.warns.length, 0, '正常成功的請求也在 warn ⇒ 站長會被雜訊淹沒');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【D】突變：每一個都必須紅在**預期那一條** ══════════════════════════');

/** 對「改過的原始碼」跑指定檢查，回傳它有沒有紅（true ＝ 紅）。 */
async function reds(fn) {
  try { await fn(); return false; }
  catch (e) { if (e instanceof assert.AssertionError) return true; throw e; }
}
const MUT = [
  ['M1 只擋 register、另外兩支拿掉',
    (s) => s.replace(V6291_GATE_LINES['checkin'], '').replace(V6291_GATE_LINES['register-and-checkin'], ''),
    async (s) => {
      const r = await run(s, 'checkin', { auth: null, body: ATTACK_BODY }, { existingReg: { _id: 'x' } });
      assert.strictEqual(r.res.statusCode, 403, 'C1');
    }],
  ['M2 檢查放到寫入之後（gate 移到 handler 尾巴）',
    (s) => {
      const ep = epSrc(s, ROUTE('register'));
      const moved = ep.replace(V6291_GATE_LINES['register'], '')
        .replace('        res.json({ ok: true });\n', V6291_GATE_LINES['register'] + '        res.json({ ok: true });\n');
      return s.replace(ep, moved);
    },
    async (s) => {
      const r = await run(s, 'register', { auth: null, body: ATTACK_BODY });
      assert.strictEqual(r.regs.writes, 0, 'C1：TREGS 被寫了');
    }],
  ['M3 verified 判斷寫反（=== true → !== true）',
    (s) => s.replace('if (id && id.verified === true) return false;', 'if (id && id.verified !== true) return false;'),
    async (s) => {
      const r = await run(s, 'register', { auth: null, body: ATTACK_BODY });
      assert.strictEqual(r.res.statusCode, 403, 'C1');
    }],
  ['M4 錯誤訊息把 code 拿掉',
    (s) => s.replace("        code: 'tourn-needs-verified',\n", ''),
    async (s) => {
      const r = await run(s, 'register', { auth: null, body: ATTACK_BODY });
      assert.strictEqual(r.res.body && r.res.body.code, 'tourn-needs-verified', 'C1');
    }],
  ['M5 gate 誤擋真玩家（改成連 verified:true 也擋）',
    (s) => s.replace('if (id && id.verified === true) return false;', 'if (false) return false;'),
    async (s) => {
      const r = await run(s, 'register', { auth: 'Bearer GOOD', body: REAL_BODY });
      assert.deepStrictEqual(r.res.body, { ok: true }, 'C2：真玩家被擋');
    }],
  ['M6 log 記了完整 uid（隱私）',
    (s) => s.replace('.slice(0, 8);', ';'),
    async (s) => {
      const r = await run(s, 'register', { auth: null, body: ATTACK_BODY });
      assert.ok(!r.warns[0].includes(VICTIM), 'C5：log 記了完整 uid');
    }],
  ['M7 區塊被多動一處（revert 後 sha 對不上）',
    (s) => s.replace("if (ev.status !== 'registration') return res.status(409)", "if (ev.status !== 'registration') return res.status(410)"),
    async (s) => {
      assert.strictEqual(sha256(revertV6291(revertV6292(s.slice(s.indexOf(TAIL_ANCHOR))))), OLD_TAIL_SHA_V6290, 'B2');
    }],
  ['M8 helper 被搬進區塊內（區塊 sha 會多一大段 ⇒ revert 對不上、A1 位置證明也垮）',
    (s) => {
      const i = s.indexOf(V6291_BLOCK_BEGIN), j = s.indexOf(V6291_BLOCK_END) + V6291_BLOCK_END.length;
      const blk = s.slice(i, j);
      const rest = s.slice(0, i) + s.slice(j);
      const at = rest.indexOf("    app.post('/api/tournament/checkin'");
      return rest.slice(0, at) + blk + rest.slice(at);
    },
    async (s) => {
      assert.ok(s.indexOf(V6291_HELPER_HEAD) < s.indexOf(TAIL_ANCHOR), 'A1：helper 落進區塊');
      assert.strictEqual(sha256(revertV6291(revertV6292(s.slice(s.indexOf(TAIL_ANCHOR))))), OLD_TAIL_SHA_V6290, 'B2');
    }],
  ['M9 鎖的基準值被亂改（把某一把鎖釘到別的值）',
    null,
    async () => {
      const f = 'scripts/test-v6287-friends-dm.mjs';
      const s = readFileSync(join(ROOT, f), 'utf8').replace(NEW_TEV_SHA_V6292, '0'.repeat(64));
      assert.ok(s.includes(NEW_TEV_SHA_V6292), 'B4：' + f + ' 沒重釘');
    }],
];
for (const [name, mutate, check] of MUT) {
  await T('D ' + name + ' ⇒ 必須紅', async () => {
    const src = mutate ? mutate(PATCH) : PATCH;
    if (mutate) assert.notStrictEqual(src, PATCH, '突變沒生效（字面量對不上）⇒ 這條是安慰劑');
    assert.ok(await reds(() => check(src)), '⚠⚠ 這個突變沒有翻紅 —— 守衛有洞');
  });
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【E】client 端證據：gate 在正常路徑是 no-op ═════════════════════════');

await T('E1 三支端點的 client 呼叫**都沒有**送 playerId（body 字面量逐一檢查）', () => {
  const calls = [
    ["tApi('/register', {", "/register"],
    ["tApi('/register-and-checkin', {", "/register-and-checkin"],
    ["tApi('/checkin', {", "/checkin"],
  ];
  for (const [needle, label] of calls) {
    const i = PAGE.indexOf(needle);
    assert.ok(i > 0, '找不到 client 呼叫：' + label);
    assert.strictEqual(PAGE.split(needle).length - 1, 1, label + ' 的呼叫點不只一處（新增的那處也要檢查）');
    const seg = PAGE.slice(i, PAGE.indexOf('}', PAGE.indexOf('{', i)) + 1);
    assert.ok(!/playerId/.test(seg), '⚠⚠ ' + label + ' 的 body 帶了 playerId ⇒ 這道 gate 會擋到真玩家：' + seg.slice(0, 200));
  }
});

await T('E2 tApi 本身不會注入 playerId（唯一共同入口）；帶 playerId 的四支是 /still-here /join /action /reset', () => {
  const A = '  async function tApi(path: string, body?: any, opts?: { timeoutMs?: number }) {';
  const i = PAGE.indexOf(A);
  assert.ok(i > 0, '找不到 tApi');
  const seg = PAGE.slice(i, PAGE.indexOf('\n  }\n', i) + 4);
  assert.ok(seg.length > 1000, 'tApi 抽太短');
  assert.ok(!/playerId\s*:/.test(seg), 'tApi 竟然注入了 playerId');
  // ⚠ 跨行：/action 的 body 寫在下一行（v6.170 冪等重試）⇒ 不可以用 [^\n]*，否則會漏掉它
  //   （這正是 Rule 25「掃描器自己會漏」的樣本：第一版寫成單行 regex 時 /action 真的被漏掉了）。
  const withPid = [...PAGE.matchAll(/tApi\('(\/[a-z/-]+)'[\s\S]{0,200}?playerId: tPlayerId\(\)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(withPid, ['/action', '/join', '/reset', '/still-here'].sort(),
    '帶 playerId 的呼叫點清單變了：' + JSON.stringify(withPid) + ' ⇒ 要重新評估 gate 範圍');
});

await T('E3 ⭐ tApi 取不到 token 時是**不帶 Authorization** 送出（6 秒上限，v6.167）—— 這正是 gate 必須靠 playerId 缺席才安全的理由', () => {
  const A = '  async function tApi(path: string, body?: any, opts?: { timeoutMs?: number }) {';
  const seg = PAGE.slice(PAGE.indexOf(A), PAGE.indexOf('\n  }\n', PAGE.indexOf(A)) + 4);
  assert.ok(/setTimeout\(\(\) => r\(null\), 6000\)/.test(seg), 'tApi 的 6 秒 token 上限不見了（行為前提變了，要重驗 gate）');
  assert.ok(/if \(_tok\) headers\['Authorization'\] = 'Bearer ' \+ _tok;/.test(seg), 'tApi 帶 token 的方式變了');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【F】test chain ／ 三配套 ／ HEAD-FAIL ══════════════════════════════');

await T('F1 本守衛在 package.json 的 test chain 裡（CI 的 iron-rules-audit 是 continue-on-error，不算數）', () => {
  assert.ok(String(PKG.scripts.test).includes('node scripts/test-v6291-tourn-verified-gate.mjs'), '沒進 npm test chain');
});

await T('F2 三配套：version.ts ＝ admin.html SITE_VERSION_HINT，且 ≥ 6.291；patch 檔頭已 bump 且舊紀錄還在', () => {
  const v = /export const VERSION = '([\d.]+)';/.exec(VERTS)[1];
  const h = /window\.SITE_VERSION_HINT = '([\d.]+)';/.exec(ADMIN)[1];
  assert.strictEqual(h, v, 'admin.html hint(' + h + ') ≠ version.ts(' + v + ')');
  assert.ok(Number(v.split('.')[1]) >= 291, 'version.ts 沒 bump：' + v);
  const mp = /^\/\/ === ORACLE ADMIN ENDPOINTS === v1\.(\d+) \(/.exec(PATCH);
  assert.ok(mp, 'patch 檔頭格式不對');
  assert.ok(Number(mp[1]) >= 41, 'patch 檔頭沒 bump：v1.' + mp[1]);
  assert.ok(PATCH.includes('← v1.40 ('), 'v1.40 的檔頭紀錄被洗掉了');
});

await T('F3 ⚠ 本守衛沒有 pin 死任何 v6.xxx 版本號當判準（第九種安慰劑）', () => {
  const self = readFileSync(join(ROOT, 'scripts/test-v6291-tourn-verified-gate.mjs'), 'utf8');
  const body = self.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  assert.ok(!/VERSION === '6\.29\d'/.test(body), '出現 pin 死版本號的判準');
});

await T('F4 ⭐ HEAD-FAIL：對真 BASE blob 跑同一組行為斷言 ⇒ BASE 的三支端點對冒名請求**不拒絕**（漏洞真的存在）', async () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('v6291 F4 對 BASE blob 的行為端 HEAD-FAIL', 'C1/C2 內嵌行為斷言＋B 的 revert-diff 仍在守'); return; }
  const b = readBaseBlob(ROOT, BASE_SHA, PATCH_REL);
  assert.ok(b.ok && b.out.length > 600000, '讀不到 BASE blob');
  assert.ok(!b.out.includes('tournRequireVerified'), 'BASE 竟然已經有 helper？BASE_SHA 抓錯了');
  // ① BASE 的 /register 會讓冒名請求**成功寫入**，而且寫的是受害者的 uid
  const r = await run(b.out, 'register', { auth: null, body: ATTACK_BODY });
  assert.deepStrictEqual(r.res.body, { ok: true }, 'BASE 的 /register 竟然拒絕了冒名請求 ⇒ 漏洞假設有誤');
  assert.strictEqual(r.regs.inserted[0].uid, VICTIM, 'BASE 寫進去的不是受害者 uid');
  assert.strictEqual(r.regs.inserted[0].deckName, '偷來的', 'BASE 鎖進去的不是攻擊者的牌組');
  // ② 另外兩支同樣不擋
  const r2 = await run(b.out, 'register-and-checkin', { auth: null, body: ATTACK_BODY });
  assert.deepStrictEqual(r2.res.body, { ok: true, lateJoin: true }, 'BASE 的 /register-and-checkin 竟然擋住了');
  const r3 = await run(b.out, 'checkin', { auth: null, body: ATTACK_BODY }, { existingReg: { _id: 'evt_test__' + VICTIM } });
  assert.deepStrictEqual(r3.res.body, { ok: true }, 'BASE 的 /checkin 竟然擋住了');
  // ③ BASE 的區塊 sha ＝ 還原後的 sha（再次確認 BASE 基準值沒抓錯）
  assert.strictEqual(sha256(b.out.slice(b.out.indexOf(TAIL_ANCHOR))), OLD_TAIL_SHA_V6290, 'BASE tail sha 與內嵌基準不符');
  assert.strictEqual(sha256(b.out.slice(b.out.indexOf(TEV_ANCHOR))), OLD_TEV_SHA_V6290, 'BASE tev sha 與內嵌基準不符');
});

await T('F5 內部 changelog 有本版（公平性／安全修正 ⇒ 依站長既有裁定**不寫首頁 changelog**）', () => {
  const ic = readFileSync(join(ROOT, 'docs/changelog-internal.md'), 'utf8');
  assert.ok(/v6\.291/.test(ic), 'docs/changelog-internal.md 沒有 v6.291');
  assert.ok(/tourn-needs-verified/.test(ic), 'internal changelog 沒寫下 code（站長查 log 要用）');
  for (const f of ['src/routes/+page.svelte', 'src/lib/changelog-data.ts', 'src/lib/changelog.ts']) {
    let s = null;
    try { s = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    assert.ok(!/6\.291/.test(s), '⚠ 公平性修正被寫進首頁 changelog（' + f + '）—— 站長裁定不寫');
  }
});

console.log('\n────────────────────────────────');
console.log('test-v6291-tourn-verified-gate: ' + pass + ' pass, ' + fail + ' fail');
if (fail > 0) process.exit(1);
